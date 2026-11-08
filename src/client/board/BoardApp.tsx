/**
 * The Super Speakers board (S12, SSP-2/3/8): a full-screen 16:9 page for a classroom or hall screen,
 * readable from the back of the room, with no scrolling at 1920×1080 or 1280×720.
 *
 * - Top 3 places of the current week (dense ranks, full name + class, avatar, points); the first place
 *   is the largest, in the centre. Ties share a place and EVERY tied student is shown: a crowded place
 *   switches to a compact list and its text shrinks until it fits (D-133). Empty places keep the
 *   placeholder style; with no points at all the friendly placeholder message is shown (both messages
 *   can be changed by the administrator). Students with 0 points never appear.
 * - Class totals: every participating class, including 0, as bars with the number (never colour only);
 *   many classes are spread over up to four columns with a smaller font, so rows never overlap.
 * - Live: Server-Sent Events signal a new board version; the board refetches (conditional GET). When
 *   the stream is down it reconnects with backoff and polls every 10 s meanwhile (D-134).
 * - A gentle single-play theme motion on a podium change (reduced motion respected); the theme's
 *   celebration and sounds only when the administrator turned board sound on (default off).
 * - The mouse pointer hides after a few seconds without movement.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { board as boardEndpoint, exchangeBoardLink, type Board, type BoardPlace } from '../../shared/contracts/superSpeakers.ts';
import { formatDate, pickText, type Locale } from '../../shared/i18n/index.ts';
import { ApiError, call, callConditional } from '../lib/api.ts';
import { setDisplay } from '../lib/display.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { celebrate, CelebrationLayer } from '../themes/Celebration.tsx';
import { useThemeMotion } from '../themes/index.tsx';
import { ThemeBackdrop, ThemeIllustration } from '../ui/Mascot.tsx';
import { Avatar } from '../ui/Students.tsx';

/** Fallback polling while the event stream is down (D-134). */
export const BOARD_POLL_MS = 10_000;
const CURSOR_IDLE_MS = 3_000;
const BOARD_EVENTS_URL = '/api/board/events';

type Phase = 'opening' | 'ready' | 'gone' | 'retry';

/** Board data with live updates: SSE signal → conditional refetch; polling while the stream is down. */
function useLiveBoard(active: boolean, onGone: () => void) {
  const [board, setBoard] = useState<Board | null>(null);
  const [live, setLive] = useState(false);
  const etag = useRef<string | null>(null);
  const version = useRef<string | null>(null);
  const liveRef = useRef(false);
  const load = useCallback(async () => {
    try {
      const r = await callConditional(boardEndpoint, {}, etag.current);
      if (r.notModified) return;
      etag.current = r.etag;
      version.current = r.data.version;
      setBoard(r.data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onGone();
    }
  }, [onGone]);

  useEffect(() => {
    if (!active) return;
    let es: EventSource | null = null;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const setLiveState = (v: boolean) => {
      liveRef.current = v;
      setLive(v);
    };
    const open = () => {
      es = new EventSource(BOARD_EVENTS_URL);
      es.addEventListener('open', () => {
        failures = 0;
        setLiveState(true);
      });
      es.addEventListener('version', (e) => {
        if ((e as MessageEvent<string>).data !== version.current) void load();
      });
      es.addEventListener('error', () => {
        setLiveState(false);
        // A refused stream (revoked link, server restart) is closed for good: reopen with backoff.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          failures += 1;
          const delay = Math.min(60_000, 1000 * 2 ** Math.min(6, failures));
          timer = setTimeout(() => {
            if (stopped) return;
            void load();
            open();
          }, delay);
        }
      });
    };
    void load();
    open();
    const poll = setInterval(() => {
      if (!liveRef.current) void load();
    }, BOARD_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      es?.close();
    };
  }, [active, load]);
  return { board, live };
}

const dayMs = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

function WeekRange({ start, end }: { start: string; end: string }) {
  const { t, locale } = useI18n();
  const f = (d: string) => formatDate(dayMs(d), locale, 'UTC', { day: 'numeric', month: 'long' });
  return <p className="cc-board__week">{t('speakers.board.week', { from: f(start), to: f(end) })}</p>;
}

/** The administrator's message for this language, else the built-in translated one. */
function useBoardMessage(text: Board['messages']['placeholder'], fallback: 'speakers.board.placeholder' | 'speakers.board.waitingShort') {
  const { t, locale } = useI18n();
  return (text[locale] ?? '').trim() || t(fallback);
}

/** Smallest text scale the fitting loop goes down to. */
const MIN_FIT = 0.2;

/**
 * Shrinks the text of `ref` (through `--cc-fit`) until its content fits its box without scrolling,
 * and again when the window size changes. Every tied name stays on the board (D-133).
 */
export function useFitText(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let scale = 1;
      el.style.setProperty('--cc-fit', '1');
      while (scale > MIN_FIT && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        scale = Math.max(MIN_FIT, scale * 0.88);
        el.style.setProperty('--cc-fit', scale.toFixed(3));
      }
    };
    fit();
    let live = true;
    // The theme's web font may arrive after the first layout: fit again once it has.
    void document.fonts?.ready.then(() => {
      if (live) fit();
    });
    window.addEventListener('resize', fit);
    return () => {
      live = false;
      window.removeEventListener('resize', fit);
    };
  }, [ref, key]);
}

/** How a place lays out its names: one big card, a two-column list, or a compact flowing list. */
export const placeDensity = (count: number) => (count <= 1 ? undefined : count <= 6 ? 'many' : 'crowd');

function PlaceCard({ place, slot, changed, waiting }: { place: BoardPlace | undefined; slot: 1 | 2 | 3; changed: boolean; waiting: string }) {
  const { t } = useI18n();
  const motion = useThemeMotion('threshold', changed);
  const names = useRef<HTMLUListElement>(null);
  useFitText(names, place ? place.students.map((s) => s.id).join(',') : '');
  if (!place) {
    return (
      <li className={`cc-board__place cc-board__place--${slot} cc-board__place--empty`} data-testid={`board-place-${slot}`} data-empty="yes">
        <span className="cc-board__rank" aria-label={t('speakers.board.placeLabel', { rank: slot })}>
          {slot}
        </span>
        <p className="cc-board__waiting">{waiting}</p>
      </li>
    );
  }
  const density = placeDensity(place.students.length);
  return (
    <li className={`cc-board__place cc-board__place--${slot} ${motion.className ?? ''}`} style={motion.style} data-testid={`board-place-${slot}`} data-many={density ? 'yes' : undefined} data-density={density}>
      <span className="cc-board__rank" aria-label={t('speakers.board.placeLabel', { rank: place.rank })}>
        {place.rank}
      </span>
      <ul className="cc-board__names" ref={names} data-count={place.students.length}>
        {place.students.map((s) => (
          <li key={s.id} className="cc-board__student">
            <Avatar name={s.fullName} hue={s.avatarHue} initials={s.initials} spec={s.avatar} size="lg" />
            <span className="cc-board__who">
              <span className="cc-board__name">{s.fullName}</span>
              <span className="cc-board__class">{s.className}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="cc-board__points">{t('speakers.board.points', { count: place.points })}</p>
    </li>
  );
}

/**
 * Columns and rows of the class totals panel: one column up to 12 classes, then up to 18 rows per
 * column (at most four columns; a school with more classes gets smaller rows, never overlapping ones).
 */
export function classGrid(count: number): { columns: number; rows: number } {
  const columns = count <= 12 ? 1 : Math.min(4, Math.ceil(count / 18));
  return { columns, rows: Math.max(6, Math.ceil(count / columns)) };
}

function ClassTotals({ classes }: { classes: Board['classes'] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...classes.map((c) => c.points));
  const grid = classGrid(classes.length);
  return (
    <section className="cc-board__classes" aria-labelledby="board-classes-title" data-testid="board-classes">
      <h2 id="board-classes-title" className="cc-board__subtitle">
        {t('speakers.board.classTotals')}
      </h2>
      <ol className="cc-board__bars" data-columns={String(grid.columns)} style={{ '--cc-board-rows': String(grid.rows), '--cc-board-columns': String(grid.columns) } as CSSProperties}>
        {classes.map((c) => (
          <li key={c.classId} className="cc-board__bar-row">
            <span className="cc-board__bar-name">{c.name}</span>
            <span className="cc-board__bar-track" aria-hidden="true">
              <span className="cc-board__bar" style={{ width: `${(c.points / max) * 100}%` }} />
            </span>
            <span className="cc-board__bar-value">{c.points}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Column widths of the podium (2nd, 1st, 3rd): a crowded place gets more room. */
export function podiumColumns(places: readonly Pick<BoardPlace, 'students'>[]): string {
  const weight = (i: number, base: number) => base * (placeDensity(places[i]?.students.length ?? 0) === 'crowd' ? 1.7 : 1);
  return `${weight(1, 1)}fr ${weight(0, 1.25)}fr ${weight(2, 1)}fr`;
}

const podiumKey = (b: Board) => b.places.map((p) => `${p.rank}:${p.points}:${p.students.map((s) => s.id).join(',')}`).join('|');

function BoardView({ board, live }: { board: Board; live: boolean }) {
  const { t, locale } = useI18n();
  const key = podiumKey(board);
  const previous = useRef<string | null>(null);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    if (previous.current !== null && previous.current !== key && board.places.length) {
      setChanged((n) => n + 1);
      // The theme's celebration (with its sounds) only when the administrator turned board sound on.
      if (board.sound) celebrate(t('speakers.board.newPodium'));
    }
    previous.current = key;
  }, [key, board.places.length, board.sound, t]);
  const [first, second, third] = board.places;
  const empty = board.places.length === 0;
  const placeholder = useBoardMessage(board.messages.placeholder, 'speakers.board.placeholder');
  const waiting = useBoardMessage(board.messages.waiting, 'speakers.board.waitingShort');
  const title = pickText(board.title, locale) || t('module.superSpeakers');
  return (
    <main className="cc-board" data-testid="board" data-version={board.version}>
      <header className="cc-board__head">
        <h1 className="cc-board__title">{title}</h1>
        <WeekRange start={board.week.start} end={board.week.end} />
        <p className="cc-board__live" data-live={live ? 'yes' : 'no'} role="status">
          <span className="cc-board__live-dot" aria-hidden="true" />
          {live ? t('speakers.board.live') : t('speakers.board.reconnecting')}
          {board.updatedAt ? <span> · {t('speakers.board.updated', { time: formatDate(board.updatedAt, locale, board.timezone, { hour: '2-digit', minute: '2-digit' }) })}</span> : null}
        </p>
      </header>
      <section className="cc-board__podium-wrap" aria-label={t('speakers.board.podium')}>
        {empty ? (
          <div className="cc-board__placeholder" data-testid="board-placeholder">
            <ThemeIllustration name="emptyState" width={260} />
            <p>{placeholder}</p>
          </div>
        ) : (
          <ol className="cc-board__podium" key={changed} style={{ '--cc-podium-columns': podiumColumns(board.places) } as CSSProperties}>
            <PlaceCard place={second} slot={2} changed={changed > 0} waiting={waiting} />
            <PlaceCard place={first} slot={1} changed={changed > 0} waiting={waiting} />
            <PlaceCard place={third} slot={3} changed={changed > 0} waiting={waiting} />
          </ol>
        )}
      </section>
      <ClassTotals classes={board.classes} />
    </main>
  );
}

function Message({ title, body, testId }: { title: string; body: string; testId: string }) {
  return (
    <main className="cc-board cc-board--message" data-testid={testId}>
      <ThemeIllustration name="emptyState" width={240} />
      <h1 className="cc-board__title">{title}</h1>
      <p className="cc-board__week">{body}</p>
    </main>
  );
}

/** Hides the mouse pointer after a few seconds without movement (a board is not a desktop). */
function useIdleCursor() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const html = document.documentElement;
    const wake = () => {
      html.dataset.cursor = 'on';
      clearTimeout(timer);
      timer = setTimeout(() => (html.dataset.cursor = 'off'), CURSOR_IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      delete html.dataset.cursor;
    };
  }, []);
}

function Inner({ phase, board, live }: { phase: Phase; board: Board | null; live: boolean }) {
  const { t } = useI18n();
  if (phase === 'gone') return <Message testId="board-link-gone" title={t('speakers.board.goneTitle')} body={t('speakers.board.goneBody')} />;
  if (phase === 'retry') return <Message testId="board-retry" title={t('speakers.board.retryTitle')} body={t('speakers.board.retryBody')} />;
  if (!board) return null;
  if (!board.enabled) return <Message testId="board-off" title={t('module.superSpeakers')} body={t('speakers.board.off')} />;
  return <BoardView board={board} live={live} />;
}

export function BoardApp({ token }: { token: string | null }) {
  const [phase, setPhase] = useState<Phase>(token ? 'opening' : 'ready');
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Nobody may be standing at the board: a busy or unreachable server is retried on its own.
    const tryOpen = () =>
      void call(exchangeBoardLink, { token })
        .then(() => setPhase('ready'))
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) return setPhase('gone');
          setPhase('retry');
          attempt += 1;
          timer = setTimeout(tryOpen, Math.min(60_000, 2000 * 2 ** Math.min(5, attempt)));
        });
    tryOpen();
    return () => clearTimeout(timer);
  }, [token]);
  const gone = useCallback(() => setPhase('gone'), []);
  const { board, live } = useLiveBoard(phase === 'ready', gone);
  const locale: Locale = board?.language ?? 'en';
  useEffect(() => {
    if (board) setDisplay({ theme: board.theme, locale: board.language, classSounds: board.sound, classAnimations: true });
  }, [board]);
  useIdleCursor();
  return (
    <I18nProvider locale={locale}>
      <ThemeBackdrop />
      <Inner phase={phase} board={board} live={live} />
      <CelebrationLayer />
    </I18nProvider>
  );
}
