/**
 * Admin → Super Speakers (S12, SSP-1/4/9/10): switch the school-wide module on or off, settings
 * (week start, participating classes, undo window, rate limit, board title, language, theme, sound,
 * badge subject), scorer links and board links (copy, QR code, regenerate, revoke), the award log with
 * void (reason, audited) and the weekly history (S11 report section with CSV).
 */
import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as C from '../../../shared/contracts/superSpeakers.ts';
import * as S from '../../../shared/contracts/school.ts';
import { addDays } from '../../../domain/dates.ts';
import { formatDate, pickText, type Locale } from '../../../shared/i18n/index.ts';
import { call, urlFor } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useRun } from '../../lib/useRun.ts';
import { SectionView } from '../../reports/ReportView.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextArea, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconCopy } from '../../ui/icons.tsx';
import { Tabs } from '../../ui/Tabs.tsx';
import { ThemePicker } from '../../ui/ThemePreview.tsx';
import { copyLink, QrCode } from '../teacher/StudentLinks.tsx';
import { ADMIN } from './Admin.tsx';

const K = {
  all: [...ADMIN, 'speakers'] as const,
  overview: [...ADMIN, 'speakers', 'overview'] as const,
  awards: [...ADMIN, 'speakers', 'awards'] as const,
  history: [...ADMIN, 'speakers', 'history'] as const,
  board: [...ADMIN, 'speakers', 'board'] as const,
  policies: [...ADMIN, 'policies'] as const,
};

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const weekdayName = (d: number, locale: Locale) => formatDate(Date.UTC(2026, 0, 4 + d, 12), locale, 'UTC', { weekday: 'long' });

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="cc-field">
      <label htmlFor={id} className="cc-field__label">
        {label}
      </label>
      <input id={id} type="date" className="cc-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function useOverview() {
  return useQuery({ queryKey: K.overview, queryFn: () => call(C.speakersAdmin, {}) });
}

// ---------------------------------------------------------------- settings
function SettingsPanel({ data }: { data: C.SpeakersAdmin }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [s, setS] = useState<C.SpeakersSettings>(data.settings);
  useEffect(() => setS(data.settings), [data.settings]);
  const set = <K extends keyof C.SpeakersSettings>(k: K, v: C.SpeakersSettings[K]) => setS((o) => ({ ...o, [k]: v }));
  const all = s.participatingClassIds === null;
  const chosen = new Set(s.participatingClassIds ?? []);
  const toggleClass = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    set('participatingClassIds', [...next]);
  };
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Math.round(Number(v)) : fallback);
  return (
    <div className="cc-stack">
      <section className="cc-card cc-stack">
        <h2 className="cc-h2">{t('speakers.admin.module')}</h2>
        <p className="cc-muted">{t('speakers.admin.moduleExplain')}</p>
        <Toggle
          label={t('module.superSpeakers')}
          isSelected={data.enabled}
          onChange={(v) => void run(() => call(S.setModulePolicy, { module: 'superSpeakers', availability: v ? 'enabled' : 'disabled' }), { invalidate: [K.all, K.policies], success: t('save.saved') })}
        />
      </section>
      <form
        className="cc-card cc-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => call(C.setSpeakersSettings, s), { invalidate: [K.all], success: t('save.saved') });
        }}
        data-testid="speakers-settings"
      >
        <h2 className="cc-h2">{t('speakers.admin.settings')}</h2>
        <Select
          label={t('speakers.admin.weekStartsOn')}
          description={t('speakers.admin.weekStartsOnHint', { tz: data.timezone })}
          items={WEEKDAYS.map((d) => ({ id: String(d), label: weekdayName(d, locale) }))}
          value={String(s.weekStartsOn)}
          onChange={(v) => set('weekStartsOn', Number(v))}
        />
        <fieldset className="cc-stack cc-fieldset">
          <legend className="cc-field__label">{t('speakers.admin.classes')}</legend>
          <Toggle label={t('speakers.admin.allClasses')} isSelected={all} onChange={(v) => set('participatingClassIds', v ? null : data.classes.map((c) => c.id))} />
          {!all ? (
            <div className="cc-speakers-classes">
              {data.classes.map((c) => (
                <label key={c.id} className="cc-check">
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={(e) => toggleClass(c.id, e.target.checked)} />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
        <div className="cc-row">
          <TextField label={t('speakers.admin.undoWindow')} type="number" value={String(s.undoWindowMinutes)} onChange={(v) => set('undoWindowMinutes', num(v, s.undoWindowMinutes))} />
          <TextField label={t('speakers.admin.rateMax')} type="number" value={String(s.rateLimitMax)} onChange={(v) => set('rateLimitMax', num(v, s.rateLimitMax))} />
          <TextField label={t('speakers.admin.rateWindow')} type="number" value={String(s.rateLimitWindowMinutes)} onChange={(v) => set('rateLimitWindowMinutes', num(v, s.rateLimitWindowMinutes))} />
        </div>
        <div className="cc-row">
          <TextField label={t('speakers.admin.titleEn')} value={s.boardTitle.en ?? ''} onChange={(v) => set('boardTitle', { ...s.boardTitle, en: v })} />
          <TextField label={t('speakers.admin.titleTr')} value={s.boardTitle.tr ?? ''} onChange={(v) => set('boardTitle', { ...s.boardTitle, tr: v })} />
        </div>
        <Select
          label={t('speakers.admin.boardLanguage')}
          items={(['en', 'tr'] as const).map((l) => ({ id: l, label: t(`student.languageName.${l}`) }))}
          value={s.boardLanguage}
          onChange={(v) => set('boardLanguage', v === 'tr' ? 'tr' : 'en')}
        />
        <ThemePicker label={t('speakers.admin.theme')} value={s.theme} onChange={(v) => set('theme', v)} />
        <Toggle label={t('speakers.admin.sound')} description={t('speakers.admin.soundHint')} isSelected={s.boardSound} onChange={(v) => set('boardSound', v)} />
        <Select
          label={t('speakers.admin.badgeSubject')}
          description={data.badgeSubject ? t('speakers.admin.badgeSubjectNow', { name: pickText(data.badgeSubject.name, locale) }) : t('speakers.admin.badgeSubjectNone')}
          items={[{ id: '', label: t('speakers.admin.badgeSubjectAuto') }, ...data.subjects.map((x) => ({ id: x.id, label: pickText(x.name, locale) }))]}
          value={s.badgeSubjectId ?? ''}
          onChange={(v) => set('badgeSubjectId', v || null)}
        />
        <div>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- links
function LinkActions({ url, label, onRegenerate, onRevoke, revoked, testId }: { url: string | null; label: string; onRegenerate: () => void; onRevoke: () => void; revoked: boolean; testId: string }) {
  const { t } = useI18n();
  const [qr, setQr] = useState(false);
  const [confirm, setConfirm] = useState<'regenerate' | 'revoke' | null>(null);
  return (
    <div className="cc-row" data-testid={testId}>
      {url ? (
        <>
          <Button size="small" onPress={() => copyLink(t, url)}>
            <IconCopy />
            {t('links.copy')}
          </Button>
          <Button size="small" onPress={() => setQr(true)}>
            {t('speakers.admin.qr')}
          </Button>
          <input className="cc-input cc-speakers-url" readOnly value={url} aria-label={t('speakers.admin.linkAddress', { name: label })} onFocus={(e) => e.target.select()} />
        </>
      ) : null}
      <Button size="small" onPress={() => setConfirm('regenerate')}>
        {revoked ? t('speakers.admin.restore') : t('speakers.admin.regenerate')}
      </Button>
      {!revoked ? (
        <Button size="small" variant="danger" onPress={() => setConfirm('revoke')}>
          {t('speakers.admin.revoke')}
        </Button>
      ) : null}
      <Modal isOpen={qr} onOpenChange={setQr} title={label}>
        {url ? <QrCode text={url} label={t('speakers.admin.qrLabel', { name: label })} /> : null}
        <DialogActions>
          <Button onPress={() => setQr(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Modal>
      <Modal isOpen={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)} title={confirm === 'revoke' ? t('speakers.admin.revokeTitle', { name: label }) : t('speakers.admin.regenerateTitle', { name: label })}>
        <p>{confirm === 'revoke' ? t('speakers.admin.revokeBody') : t('speakers.admin.regenerateBody')}</p>
        <DialogActions>
          <Button onPress={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button
            variant={confirm === 'revoke' ? 'danger' : 'primary'}
            onPress={() => {
              if (confirm === 'revoke') onRevoke();
              else onRegenerate();
              setConfirm(null);
            }}
          >
            {confirm === 'revoke' ? t('speakers.admin.revoke') : t('speakers.admin.regenerate')}
          </Button>
        </DialogActions>
      </Modal>
    </div>
  );
}

function LinksPanel({ data }: { data: C.SpeakersAdmin }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [label, setLabel] = useState('');
  const [lang, setLang] = useState<Locale>('en');
  const [userId, setUserId] = useState('');
  const [boardLabel, setBoardLabel] = useState('');
  const when = (ms: number | null) => (ms ? formatDate(ms, locale, data.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('speakers.admin.never'));
  return (
    <div className="cc-stack">
      <section className="cc-card cc-stack" aria-labelledby="scorers-title">
        <h2 id="scorers-title" className="cc-h2">
          {t('speakers.admin.scorers')}
        </h2>
        <p className="cc-muted">{t('speakers.admin.scorersExplain')}</p>
        <form
          className="cc-row cc-speakers-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            void run(() => call(C.createScorerLink, { label: label.trim(), locale: lang, userId: userId || null }), { invalidate: [K.all], success: t('speakers.admin.created') }).then((r) => r && setLabel(''));
          }}
          data-testid="create-scorer"
        >
          <TextField label={t('speakers.admin.scorerName')} value={label} onChange={setLabel} />
          <Select label={t('speakers.admin.language')} items={(['en', 'tr'] as const).map((l) => ({ id: l, label: t(`student.languageName.${l}`) }))} value={lang} onChange={(v) => setLang(v === 'tr' ? 'tr' : 'en')} />
          <Select label={t('speakers.admin.teacher')} items={[{ id: '', label: t('speakers.admin.noTeacher') }, ...data.teachers.map((x) => ({ id: x.id, label: x.name }))]} value={userId} onChange={setUserId} />
          <Button type="submit" variant="primary">
            {t('speakers.admin.createScorer')}
          </Button>
        </form>
        {data.scorerLinks.length === 0 ? <p className="cc-muted">{t('speakers.admin.noScorers')}</p> : null}
        <ul className="cc-stack cc-speakers-links">
          {data.scorerLinks.map((l) => (
            <li key={l.id} className="cc-card cc-stack" data-testid="scorer-link-row">
              <div className="cc-row">
                <strong>{l.label}</strong>
                <span className="cc-chip">{t(`student.languageName.${l.locale}`)}</span>
                {l.userName ? <span className="cc-chip">{l.userName}</span> : null}
                {l.revokedAt ? <span className="cc-chip">{t('speakers.admin.revoked')}</span> : null}
                <span className="cc-muted cc-push-right">
                  {t('speakers.admin.lastUsed', { when: when(l.lastUsedAt) })} · {t('speakers.admin.awardsThisWeek', { count: l.awardsThisWeek })}
                </span>
              </div>
              <LinkActions
                url={l.url}
                label={l.label}
                revoked={l.revokedAt !== null}
                testId="scorer-link-actions"
                onRegenerate={() => void run(() => call(C.regenerateScorerLink, { id: l.id }), { invalidate: [K.all], success: t('speakers.admin.regenerated') })}
                onRevoke={() => void run(() => call(C.revokeScorerLink, { id: l.id }), { invalidate: [K.all], success: t('speakers.admin.revokedToast') })}
              />
            </li>
          ))}
        </ul>
      </section>
      <section className="cc-card cc-stack" aria-labelledby="boards-title">
        <h2 id="boards-title" className="cc-h2">
          {t('speakers.admin.boards')}
        </h2>
        <p className="cc-muted">{t('speakers.admin.boardsExplain')}</p>
        <form
          className="cc-row cc-speakers-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!boardLabel.trim()) return;
            void run(() => call(C.createDisplayLink, { label: boardLabel.trim() }), { invalidate: [K.all], success: t('speakers.admin.created') }).then((r) => r && setBoardLabel(''));
          }}
          data-testid="create-board"
        >
          <TextField label={t('speakers.admin.boardName')} value={boardLabel} onChange={setBoardLabel} />
          <Button type="submit" variant="primary">
            {t('speakers.admin.createBoard')}
          </Button>
        </form>
        {data.displayLinks.length === 0 ? <p className="cc-muted">{t('speakers.admin.noBoards')}</p> : null}
        <ul className="cc-stack cc-speakers-links">
          {data.displayLinks.map((l) => (
            <li key={l.id} className="cc-card cc-stack" data-testid="board-link-row">
              <div className="cc-row">
                <strong>{l.label}</strong>
                {l.revokedAt ? <span className="cc-chip">{t('speakers.admin.revoked')}</span> : null}
                <span className="cc-muted cc-push-right">{t('speakers.admin.lastUsed', { when: when(l.lastUsedAt) })}</span>
              </div>
              <LinkActions
                url={l.url}
                label={l.label}
                revoked={l.revokedAt !== null}
                testId="board-link-actions"
                onRegenerate={() => void run(() => call(C.regenerateDisplayLink, { id: l.id }), { invalidate: [K.all], success: t('speakers.admin.regenerated') })}
                onRevoke={() => void run(() => call(C.revokeDisplayLink, { id: l.id }), { invalidate: [K.all], success: t('speakers.admin.revokedToast') })}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- award log
function AwardsPanel({ data }: { data: C.SpeakersAdmin }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [from, setFrom] = useState(data.week.start);
  const [to, setTo] = useState(data.week.end);
  const [classId, setClassId] = useState('');
  const [scorerLinkId, setScorer] = useState('');
  const [includeVoided, setIncludeVoided] = useState(true);
  const [voiding, setVoiding] = useState<C.AdminAward | null>(null);
  const [reason, setReason] = useState('');
  const input = { from, to, ...(classId ? { classId } : {}), ...(scorerLinkId ? { scorerLinkId } : {}), includeVoided: includeVoided ? ('1' as const) : ('0' as const) };
  const q = useQuery({ queryKey: [...K.awards, input], queryFn: () => call(C.speakersAwards, input) });
  return (
    <section className="cc-card cc-stack" data-testid="speakers-awards">
      <h2 className="cc-h2">{t('speakers.admin.awards')}</h2>
      <div className="cc-row">
        <DateInput label={t('report.ui.from')} value={from} onChange={setFrom} />
        <DateInput label={t('report.ui.to')} value={to} onChange={setTo} />
        <Select label={t('speakers.history.class')} items={[{ id: '', label: t('speakers.admin.anyClass') }, ...data.classes.map((c) => ({ id: c.id, label: c.name }))]} value={classId} onChange={setClassId} />
        <Select label={t('speakers.history.scorer')} items={[{ id: '', label: t('speakers.admin.anyScorer') }, ...data.scorerLinks.map((s) => ({ id: s.id, label: s.label }))]} value={scorerLinkId} onChange={setScorer} />
      </div>
      <Toggle label={t('speakers.admin.showVoided')} isSelected={includeVoided} onChange={setIncludeVoided} />
      {q.data?.truncated ? <Alert kind="warning">{t('speakers.admin.truncated', { count: q.data.awards.length, total: q.data.total })}</Alert> : null}
      {q.data && q.data.awards.length === 0 ? <p className="cc-muted">{t('speakers.admin.noAwards')}</p> : null}
      {q.data && q.data.awards.length ? (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th scope="col">{t('speakers.admin.when')}</th>
                <th scope="col">{t('report.col.student')}</th>
                <th scope="col">{t('speakers.history.class')}</th>
                <th scope="col">{t('speakers.history.scorer')}</th>
                <th scope="col">{t('speakers.admin.status')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.awards.map((a) => (
                <tr key={a.id} data-testid="award-row">
                  <td>{formatDate(a.occurredAt, locale, data.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{a.fullName}</td>
                  <td>{a.className}</td>
                  <td>{a.userName ? `${a.scorerLabel} (${a.userName})` : a.scorerLabel}</td>
                  <td>
                    {a.voidedAt ? (
                      <span>
                        {a.voidedByKind === 'scorer' ? t('speakers.admin.undoneByScorer') : t('speakers.admin.voided')}
                        {a.voidReason ? <span className="cc-muted"> – {a.voidReason}</span> : null}
                      </span>
                    ) : (
                      <Button size="small" variant="danger" onPress={() => setVoiding(a)}>
                        {t('speakers.admin.void')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Modal isOpen={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)} title={t('speakers.admin.voidTitle', { name: voiding?.fullName ?? '' })}>
        <p>{t('speakers.admin.voidBody')}</p>
        <TextArea label={t('speakers.admin.voidReason')} rows={3} value={reason} onChange={setReason} />
        <DialogActions>
          <Button onPress={() => setVoiding(null)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            isDisabled={reason.trim().length < 3}
            onPress={() => {
              const a = voiding;
              if (!a) return;
              void run(() => call(C.voidAward, { id: a.id, reason: reason.trim() }), { invalidate: [K.all], success: t('speakers.admin.voidedToast') }).then((r) => {
                if (r) {
                  setVoiding(null);
                  setReason('');
                }
              });
            }}
          >
            {t('speakers.admin.void')}
          </Button>
        </DialogActions>
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------- history
function HistoryPanel({ data }: { data: C.SpeakersAdmin }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(addDays(data.week.start, -7 * 7));
  const [to, setTo] = useState(data.week.end);
  const valid = Boolean(from && to && from <= to);
  const q = useQuery({ queryKey: [...K.history, from, to], queryFn: () => call(C.speakersHistory, { from, to }), enabled: valid });
  return (
    <section className="cc-stack" data-testid="speakers-history">
      <div className="cc-card cc-row">
        <DateInput label={t('report.ui.from')} value={from} onChange={setFrom} />
        <DateInput label={t('report.ui.to')} value={to} onChange={setTo} />
      </div>
      {q.error ? <Alert>{t('common.error')}</Alert> : null}
      {q.data ? <SectionView section={q.data.section} csvHref={(table) => urlFor(C.speakersHistoryCsv, { from, to, table })} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- board preview
function BoardPreview() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: K.board, queryFn: () => call(C.adminBoard, {}), refetchInterval: 15_000 });
  if (!q.data) return null;
  const b = q.data;
  return (
    <section className="cc-card cc-stack" data-testid="speakers-preview">
      <h2 className="cc-h2">{t('speakers.admin.preview')}</h2>
      {b.places.length === 0 ? <p className="cc-muted">{t('speakers.board.placeholder')}</p> : null}
      <ol className="cc-stack">
        {b.places.map((p) => (
          <li key={p.rank}>
            <strong>{p.rank}.</strong> {p.students.map((s) => `${s.fullName} (${s.className})`).join(', ')}
            {p.more ? ` ${t('speakers.board.more', { count: p.more })}` : ''} – {t('speakers.board.points', { count: p.points })}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SuperSpeakersPage() {
  const { t } = useI18n();
  const q = useOverview();
  const [tab, setTab] = useState('settings');
  return (
    <main className="cc-page cc-page--wide cc-stack" data-testid="speakers-admin">
      <h1 className="cc-h1">{t('module.superSpeakers')}</h1>
      <p className="cc-muted">{t('speakers.admin.intro')}</p>
      {q.error ? <EmptyState title={t('common.error')} /> : null}
      {q.data ? (
        <>
          {!q.data.enabled ? <Alert kind="warning">{t('speakers.admin.offNotice')}</Alert> : null}
          <Tabs
            label={t('module.superSpeakers')}
            selectedKey={tab}
            onSelectionChange={setTab}
            items={[
              { id: 'settings', label: t('speakers.admin.settings'), content: <SettingsPanel data={q.data} /> },
              { id: 'links', label: t('speakers.admin.links'), content: <LinksPanel data={q.data} /> },
              { id: 'awards', label: t('speakers.admin.awards'), content: <AwardsPanel data={q.data} /> },
              { id: 'history', label: t('speakers.admin.history'), content: <HistoryPanel data={q.data} /> },
              { id: 'preview', label: t('speakers.admin.preview'), content: <BoardPreview /> },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}
