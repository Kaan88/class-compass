/**
 * The Super Speakers scorer app (S12, SSP-4..7): mobile-first, one-handed.
 *
 * - Opening the scorer link (`/p#<token>`) exchanges the token for a scorer cookie and shows the
 *   welcome page: start giving points, install the app (Android / iPhone, with pictures) and a 6-digit
 *   pairing code for the installed iPhone app, which has its own cookie store (D-129).
 * - The installed app (`/p/app`) without a session asks for the pairing code.
 * - Scoring: a big search field over the whole participating-student list held in memory (never
 *   stored on the device), Turkish folding ("isik" finds "Işık"), class chips, a Recent row, large
 *   cards with a huge +1. A second +1 for the same student within 700 ms is ignored with a "tap again"
 *   hint (SSP-6). After an award: an undo bar for the undo window, the save state and the
 *   Needs-attention tray (UX-10/11). "My awards today" lists the scorer's awards with undo.
 * - Language: the link's language; the EN/TR switch is remembered on this device only.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildSearchIndex, searchStudents } from '../../domain/speakers.ts';
import {
  DOUBLE_TAP_MS,
  PairingCode,
  createPairingCode,
  exchangeScorerLink,
  leaveScorerSession,
  pairScorer,
  scorerAwards,
  scorerMe,
  scorerStudents,
  type ScorerAward,
  type ScorerMe,
  type ScorerStudent,
} from '../../shared/contracts/superSpeakers.ts';
import { formatDate, translate, type Locale } from '../../shared/i18n/index.ts';
import { ApiError, call } from '../lib/api.ts';
import { commandErrorText, errorText } from '../lib/errors.ts';
import { setDisplay } from '../lib/display.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { isRetryable, saveStateOf, type OutboxOp } from '../lib/outbox.ts';
import { Button } from '../ui/Button.tsx';
import { NeedsAttentionTray, SaveStateBadge, Toaster } from '../ui/Feedback.tsx';
import { IconGlobe, IconPlus, IconUndo, IconX } from '../ui/icons.tsx';
import { Avatar } from '../ui/Students.tsx';
import { ThemeBackdrop, ThemeIllustration } from '../ui/Mascot.tsx';
import { scorerOutbox, useScorerOutboxStatus } from './outbox.ts';
import { AndroidSteps, IosSteps } from './InstallPictures.tsx';
import { liveCount, todayAwards, type Today } from './today.ts';

const LOCALE_KEY = 'cc.scorerLocale';
/** The scorer guide (docs/guides), loaded only when "Help" is pressed. */
const HelpPanel = lazy(() => import('../help/HelpPanel.tsx'));
const ME_KEY = ['scorer', 'me'] as const;
const STUDENTS_KEY = ['scorer', 'students'] as const;
const AWARDS_KEY = ['scorer', 'awards'] as const;
/** How long the undo bar stays after a +1 (the server's undo window still applies in "My awards today"). */
const UNDO_BAR_MS = 10_000;

export function readScorerLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v === 'tr' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function saveLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* private mode: this visit only */
  }
}

function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  const { t } = useI18n();
  return (
    <div className="cc-row cc-lang" role="group" aria-label={t('student.language')}>
      <IconGlobe />
      {(['en', 'tr'] as const).map((l) => (
        <Button key={l} size="small" variant={l === locale ? 'primary' : 'secondary'} aria-pressed={l === locale} onPress={() => onChange(l)}>
          {translate(l, `student.languageName.${l}`)}
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- opening, pairing, gone
type OpenResult = 'ok' | 'invalid' | 'retry';

async function openLink(token: string): Promise<OpenResult> {
  try {
    await call(exchangeScorerLink, { token });
    return 'ok';
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? 'invalid' : 'retry';
  }
}

function Gone({ installed }: { installed: boolean }) {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-scorer" data-testid="scorer-link-gone">
      <section className="cc-card cc-stack cc-scorer__center">
        <ThemeIllustration name="emptyState" width={150} />
        <h1 className="cc-h1">{t('speakers.scorer.goneTitle')}</h1>
        <p>{installed ? t('speakers.scorer.goneInstalled') : t('speakers.scorer.goneBody')}</p>
      </section>
    </main>
  );
}

function TryAgain({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-scorer" data-testid="scorer-link-retry">
      <section className="cc-card cc-stack cc-scorer__center" role="alert">
        <h1 className="cc-h1">{t('student.retry.title')}</h1>
        <p>{t('speakers.scorer.retryBody')}</p>
        <div>
          <Button variant="primary" onPress={onRetry}>
            {t('student.retry.button')}
          </Button>
        </div>
      </section>
    </main>
  );
}

/** The installed app without a session: enter the pairing code shown on the link page (D-129). */
function PairPage({ onPaired }: { onPaired: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const parsed = PairingCode.safeParse(code.replace(/\s+/gu, ''));
    if (!parsed.success) {
      setError(t('speakers.pair.sixDigits'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call(pairScorer, { code: parsed.data });
      onPaired();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="cc-page cc-scorer" data-testid="scorer-pair">
      <form
        className="cc-card cc-stack cc-scorer__center"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="cc-h1">{t('speakers.pair.title')}</h1>
        <p>{t('speakers.pair.body')}</p>
        <label className="cc-field">
          <span className="cc-field__label">{t('speakers.pair.label')}</span>
          <input
            className="cc-input cc-scorer__code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'pair-error' : undefined}
            data-testid="pair-code"
          />
        </label>
        {error ? (
          <p id="pair-error" className="cc-field__error" role="alert">
            ⚠ {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" size="big" isDisabled={busy}>
            {t('speakers.pair.submit')}
          </Button>
        </div>
        <p className="cc-muted">{t('speakers.pair.noCode')}</p>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------- install + pairing code
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function useInstallPrompt(): (() => void) | null {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return evt ? () => void evt.prompt().finally(() => setEvt(null)) : null;
}

const isIos = () => /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function PairingCodeBox() {
  const { t } = useI18n();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);
  const make = async () => {
    setError(null);
    try {
      setCode(await call(createPairingCode, {}));
      setNow(Date.now());
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 60_000)) : 0;
  return (
    <div className="cc-stack">
      {code && left > 0 ? (
        <>
          <p className="cc-scorer__code" data-testid="pairing-code" aria-label={t('speakers.install.codeLabel')}>
            {code.code.slice(0, 3)} {code.code.slice(3)}
          </p>
          <p className="cc-muted">{t('speakers.install.codeExpires', { count: left })}</p>
        </>
      ) : null}
      {error ? <p className="cc-field__error">⚠ {error}</p> : null}
      <div>
        <Button onPress={() => void make()} data-testid="make-pairing-code">
          {code ? t('speakers.install.newCode') : t('speakers.install.showCode')}
        </Button>
      </div>
    </div>
  );
}

function InstallPanel() {
  const { t } = useI18n();
  const install = useInstallPrompt();
  const ios = useMemo(isIos, []);
  return (
    <section className="cc-card cc-stack" aria-labelledby="install-title" data-testid="scorer-install">
      <h2 id="install-title" className="cc-h2">
        {t('speakers.install.title')}
      </h2>
      <p>{t('speakers.install.why')}</p>
      {install ? (
        <div>
          <Button variant="primary" onPress={install}>
            {t('speakers.install.button')}
          </Button>
        </div>
      ) : null}
      <details open={!ios}>
        <summary className="cc-h3">{t('speakers.install.android')}</summary>
        <AndroidSteps />
      </details>
      <details open={ios}>
        <summary className="cc-h3">{t('speakers.install.ios')}</summary>
        <IosSteps />
        <p>{t('speakers.install.iosPair')}</p>
        <PairingCodeBox />
      </details>
    </section>
  );
}

// ---------------------------------------------------------------- scoring
interface UndoState {
  opId: string;
  name: string;
  until: number;
}

function StudentCard({ s, onAward, hint }: { s: ScorerStudent; onAward: (s: ScorerStudent) => void; hint: boolean }) {
  const { t } = useI18n();
  return (
    <li className="cc-scorer__card" data-testid="scorer-student">
      <Avatar name={s.fullName} hue={s.avatarHue} initials={s.initials} spec={s.avatar} />
      <span className="cc-scorer__who">
        <span className="cc-scorer__name">{s.fullName}</span>
        <span className="cc-muted">{s.className}</span>
        {hint ? (
          <span className="cc-scorer__hint" role="status">
            {t('speakers.scorer.tapAgain')}
          </span>
        ) : null}
      </span>
      <Button variant="primary" className="cc-scorer__plus" aria-label={t('speakers.scorer.awardLabel', { name: s.fullName })} onPress={() => onAward(s)}>
        <IconPlus />1
      </Button>
    </li>
  );
}

function AwardsToday({ today, onUndo, timezone }: { today: Today; onUndo: (a: ScorerAward) => void; timezone: string }) {
  const { t, locale } = useI18n();
  const now = Date.now();
  const { awards, voiding } = today;
  return (
    <section className="cc-card cc-stack" aria-labelledby="today-title" data-testid="scorer-today">
      <h2 id="today-title" className="cc-h2">
        {t('speakers.scorer.today', { count: liveCount(today) })}
      </h2>
      {awards.length === 0 ? <p className="cc-muted">{t('speakers.scorer.todayEmpty')}</p> : null}
      <ul className="cc-stack cc-scorer__today">
        {awards.map((a) => {
          const voided = a.voidedAt !== null || voiding.has(a.id);
          return (
            <li key={a.id} className="cc-row" data-voided={voided ? 'yes' : undefined} data-testid="scorer-today-row">
              <span className="cc-muted">{formatDate(a.occurredAt, locale, timezone, { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="cc-scorer__today-name">
                {voided ? <s>{a.fullName}</s> : a.fullName} <span className="cc-muted">{a.className}</span>
              </span>
              {voided ? (
                <span className="cc-chip">{t('speakers.scorer.undone')}</span>
              ) : a.undoUntil !== null && a.undoUntil > now ? (
                <Button size="small" onPress={() => onUndo(a)}>
                  <IconUndo />
                  {t('speakers.scorer.undo')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Scorer({ me, installed, welcome, onLeave }: { me: ScorerMe; installed: boolean; welcome: boolean; onLeave: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const students = useQuery({ queryKey: STUDENTS_KEY, queryFn: () => call(scorerStudents, {}), staleTime: 5 * 60_000 });
  const awards = useQuery({ queryKey: AWARDS_KEY, queryFn: () => call(scorerAwards, {}), refetchInterval: 60_000 });
  const status = useScorerOutboxStatus();
  const [query, setQuery] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [hintFor, setHintFor] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [help, setHelp] = useState(false);
  const [started, setStarted] = useState(!welcome || installed);
  /** This link's commands in the outbox, and what the server confirmed since the last refetch (today.ts). */
  const [queued, setQueued] = useState<OutboxOp[]>([]);
  const [confirmed, setConfirmed] = useState<ScorerAward[]>([]);
  const [confirmedVoids, setConfirmedVoids] = useState<ReadonlySet<string>>(new Set());
  const lastTap = useRef(new Map<string, number>());
  const search = useRef<HTMLInputElement>(null);
  const list = useMemo(() => students.data?.students ?? [], [students.data]);
  const byId = useMemo(() => new Map(list.map((s) => [s.id, s])), [list]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const undoMsRef = useRef(me.undoWindowMinutes * 60_000);
  undoMsRef.current = me.undoWindowMinutes * 60_000;

  useEffect(() => {
    void scorerOutbox().setOwner(me.id);
  }, [me.id]);
  useEffect(() => {
    const box = scorerOutbox();
    return box.onSuccess((op, result) => {
      if (op.type === 'points.award') {
        const studentId = (op.payload as { studentId: string }).studentId;
        const st = byIdRef.current.get(studentId);
        const undoUntil = (result.result as { undoUntil?: number } | null)?.undoUntil ?? op.clientTime + undoMsRef.current;
        const row: ScorerAward = { id: op.opId, studentId, fullName: st?.fullName ?? '', className: st?.className ?? '', occurredAt: op.clientTime, voidedAt: null, undoUntil };
        setConfirmed((c) => [row, ...c.filter((x) => x.id !== row.id)].slice(0, 200));
      } else if (op.type === 'points.voidOwn') {
        const eventId = (op.payload as { eventId: string }).eventId;
        setConfirmedVoids((v) => new Set(v).add(eventId));
      }
      queueMicrotask(() => {
        if (box.getStatus().pending === 0) void qc.invalidateQueries({ queryKey: AWARDS_KEY });
      });
    });
  }, [qc]);
  // The outbox is the truth for what is still waiting or was refused (re-read on every status change).
  useEffect(() => {
    let live = true;
    void scorerOutbox()
      .all()
      .then((ops) => {
        if (live) setQueued(ops.filter((o) => o.ownerId === me.id));
      });
    return () => {
      live = false;
    };
  }, [status, me.id]);
  // Rows the server list now holds need no local copy.
  useEffect(() => {
    const server = awards.data?.today;
    if (!server) return;
    const known = new Set(server.map((a) => a.id));
    setConfirmed((c) => (c.some((a) => known.has(a.id)) ? c.filter((a) => !known.has(a.id)) : c));
  }, [awards.data]);
  // A refused +1 cannot be undone: the undo bar goes (the tray explains the refusal).
  useEffect(() => {
    if (undo && status.rejected.some((op) => op.opId === undo.opId)) setUndo(null);
  }, [status.rejected, undo]);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(id);
  }, [undo]);
  useEffect(() => {
    if (!hintFor) return;
    const id = setTimeout(() => setHintFor(null), 2500);
    return () => clearTimeout(id);
  }, [hintFor]);

  const index = useMemo(() => buildSearchIndex(list), [list]);
  const results = useMemo(() => searchStudents(index, query, { classId, limit: classId ? 400 : 40 }), [index, query, classId]);
  const recent = useMemo(() => (awards.data?.recentStudentIds ?? []).map((id) => byId.get(id)).filter((s): s is ScorerStudent => Boolean(s)), [awards.data, byId]);

  // Server awards plus what this device still has queued or just had confirmed (newest first, no duplicates).
  const today = useMemo(
    () => todayAwards({ server: awards.data?.today ?? [], queued, confirmed, confirmedVoids, student: (id) => byId.get(id), undoWindowMs: me.undoWindowMinutes * 60_000 }),
    [awards.data, queued, confirmed, confirmedVoids, byId, me.undoWindowMinutes],
  );

  const award = useCallback(
    async (s: ScorerStudent) => {
      const now = Date.now();
      const last = lastTap.current.get(s.id) ?? 0;
      if (now - last < DOUBLE_TAP_MS) {
        setHintFor(s.id);
        return;
      }
      lastTap.current.set(s.id, now);
      const opId = await scorerOutbox().enqueue('points.award', { studentId: s.id });
      setUndo({ opId, name: s.fullName, until: now + UNDO_BAR_MS });
    },
    [],
  );
  const undoAward = useCallback(async (eventId: string) => {
    await scorerOutbox().enqueue('points.voidOwn', { eventId });
    setUndo((u) => (u && u.opId === eventId ? null : u));
  }, []);

  const nameOfOp = (payload: unknown) => {
    const p = payload as { studentId?: string; eventId?: string };
    if (p.studentId) return byId.get(p.studentId)?.fullName ?? '';
    const a = today.awards.find((x) => x.id === p.eventId);
    return a?.fullName ?? '';
  };
  const attention = status.rejected.map((op) => ({
    id: op.opId,
    title: op.type === 'points.award' ? t('speakers.scorer.awardFor', { name: nameOfOp(op.payload) }) : t('speakers.scorer.undoFor', { name: nameOfOp(op.payload) }),
    detail: commandErrorText(t, op.error),
    canRetry: isRetryable(op),
  }));

  if (help) {
    return (
      <main className="cc-page cc-scorer cc-stack">
        <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
          <HelpPanel guide="scorer" onClose={() => setHelp(false)} />
        </Suspense>
      </main>
    );
  }
  if (!started) {
    return (
      <main className="cc-page cc-scorer cc-stack" data-testid="scorer-welcome">
        <section className="cc-card cc-stack">
          <h1 className="cc-h1">{t('speakers.scorer.welcome', { name: me.label })}</h1>
          <p>{t('speakers.scorer.welcomeBody')}</p>
          <div>
            <Button variant="primary" size="big" onPress={() => setStarted(true)} data-testid="scorer-start">
              {t('speakers.scorer.start')}
            </Button>
          </div>
        </section>
        <InstallPanel />
      </main>
    );
  }

  return (
    <main className="cc-page cc-scorer cc-stack" data-testid="scorer-app">
      <header className="cc-row cc-scorer__head">
        <div className="cc-stack cc-scorer__title">
          <h1 className="cc-h2">{t('module.superSpeakers')}</h1>
          <span className="cc-muted">{me.label}</span>
        </div>
        <SaveStateBadge state={saveStateOf(status)} />
      </header>
      {!me.enabled ? <p className="cc-alert cc-alert--warning">{t('speakers.scorer.off')}</p> : null}
      <NeedsAttentionTray items={attention} onRetry={(id) => void scorerOutbox().retry(id)} onDismiss={(id) => void scorerOutbox().dismiss(id)} />
      <div className="cc-scorer__search">
        <label htmlFor="scorer-search" className="cc-visually-hidden">
          {t('speakers.scorer.search')}
        </label>
        <input
          id="scorer-search"
          ref={search}
          className="cc-input cc-scorer__search-input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('speakers.scorer.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="scorer-search"
        />
        {query ? (
          <Button
            variant="ghost"
            aria-label={t('speakers.scorer.clear')}
            onPress={() => {
              setQuery('');
              search.current?.focus();
            }}
          >
            <IconX />
          </Button>
        ) : null}
      </div>
      {students.data && students.data.classes.length > 1 ? (
        <div className="cc-scorer__chips" role="group" aria-label={t('speakers.scorer.classes')}>
          <Button size="small" variant={classId === null ? 'primary' : 'secondary'} aria-pressed={classId === null} onPress={() => setClassId(null)}>
            {t('speakers.scorer.allClasses')}
          </Button>
          {students.data.classes.map((c) => (
            <Button key={c.id} size="small" variant={classId === c.id ? 'primary' : 'secondary'} aria-pressed={classId === c.id} onPress={() => setClassId(classId === c.id ? null : c.id)}>
              {c.name}
            </Button>
          ))}
        </div>
      ) : null}
      {students.error ? <p className="cc-alert cc-alert--danger">{errorText(t, students.error)}</p> : null}
      {!students.data && !students.error ? <p className="cc-muted">{t('common.loading')}</p> : null}
      {!query && !classId && recent.length ? (
        <section className="cc-stack" aria-labelledby="recent-title">
          <h2 id="recent-title" className="cc-h3">
            {t('speakers.scorer.recent')}
          </h2>
          <ul className="cc-scorer__list">
            {recent.slice(0, 6).map((s) => (
              <StudentCard key={s.id} s={s} onAward={(x) => void award(x)} hint={hintFor === s.id} />
            ))}
          </ul>
        </section>
      ) : null}
      {query || classId ? (
        <section aria-label={t('speakers.scorer.results')} className="cc-stack">
          {results.length === 0 && students.data ? <p className="cc-muted">{t('speakers.scorer.noResults')}</p> : null}
          <ul className="cc-scorer__list" data-testid="scorer-results">
            {results.map((s) => (
              <StudentCard key={s.id} s={s} onAward={(x) => void award(x)} hint={hintFor === s.id} />
            ))}
          </ul>
        </section>
      ) : students.data ? (
        <p className="cc-muted">{t('speakers.scorer.searchHint', { count: list.length })}</p>
      ) : null}
      <AwardsToday today={today} onUndo={(a) => void undoAward(a.id)} timezone={me.timezone} />
      {showInstall ? <InstallPanel /> : null}
      <footer className="cc-row cc-muted cc-scorer__foot">
        {!installed ? (
          <Button size="small" variant="ghost" onPress={() => setShowInstall((v) => !v)}>
            {t('speakers.install.title')}
          </Button>
        ) : null}
        <Button size="small" variant="ghost" onPress={() => setHelp(true)}>
          {t('help.link')}
        </Button>
        <Button size="small" variant="ghost" onPress={onLeave}>
          {t('speakers.scorer.leave')}
        </Button>
      </footer>
      {undo ? (
        <div className="cc-scorer__undo" role="status" data-testid="scorer-undo-bar">
          <span>{t('speakers.scorer.awarded', { name: undo.name })}</span>
          <Button variant="secondary" onPress={() => void undoAward(undo.opId)} data-testid="scorer-undo">
            <IconUndo />
            {t('speakers.scorer.undo')}
          </Button>
        </div>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------- shell
type OpenState = OpenResult | 'opening' | 'none';

export function ScorerApp({ token, installed }: { token: string | null; installed: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState<OpenState>(token ? 'opening' : 'none');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  useEffect(() => {
    if (!token || started.current === attempt) return;
    started.current = attempt;
    void openLink(token).then(setState);
  }, [token, attempt]);
  const opened = state === 'ok' || state === 'none';
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => call(scorerMe, {}), enabled: opened, staleTime: 60_000 });
  const [chosen, setChosen] = useState<Locale | null>(readScorerLocale);
  const locale: Locale = chosen ?? me.data?.locale ?? 'en';
  useEffect(() => setDisplay({ locale }), [locale]);
  useEffect(() => {
    if (me.data) setDisplay({ theme: me.data.theme });
  }, [me.data]);
  const change = (l: Locale) => {
    setChosen(l);
    saveLocale(l);
  };
  const leave = async () => {
    await call(leaveScorerSession, {}).catch(() => undefined);
    qc.clear();
    window.location.replace(installed ? '/p/app' : '/p');
  };
  let body;
  if (state === 'opening') body = null;
  else if (state === 'invalid') body = <Gone installed={installed} />;
  else if (state === 'retry')
    body = (
      <TryAgain
        onRetry={() => {
          setState('opening');
          setAttempt((a) => a + 1);
        }}
      />
    );
  else if (me.error) {
    const unauth = me.error instanceof ApiError && me.error.status === 401;
    body = unauth ? installed ? <PairPage onPaired={() => void qc.invalidateQueries({ queryKey: ME_KEY })} /> : <Gone installed={false} /> : <TryAgain onRetry={() => void me.refetch()} />;
  } else if (!me.data) body = null;
  else body = <Scorer me={me.data} installed={installed} welcome={state === 'ok'} onLeave={() => void leave()} />;
  return (
    <I18nProvider locale={locale}>
      <ThemeBackdrop />
      <div className="cc-student__bar">
        <LanguageSwitch locale={locale} onChange={change} />
      </div>
      {body}
      <Toaster />
    </I18nProvider>
  );
}
