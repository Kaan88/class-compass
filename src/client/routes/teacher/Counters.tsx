/**
 * Counter settings and history (teacher area, PIN-gated in classroom mode): CNT-1, CNT-6, CNT-7,
 * CNT-9, CNT-12, RPT-5, DAT-6.
 * - Settings: labels in English and Turkish, segments (the lesson limit), reset period, colour,
 *   visual levels, threshold responses and the active one; create custom counters, add the English
 *   preset, archive / unarchive (history is kept).
 * - History: per-student counts per week with explicit week ranges in the class timezone; counts
 *   only, no scores or rankings (RPT-5).
 */
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { historyCell } from '../../../domain/counters.ts';
import * as Cn from '../../../shared/contracts/counters.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import * as School from '../../../shared/contracts/school.ts';
import { COUNTER_COLOURS, COUNTER_SCOPES, RESET_PERIODS, RESPONSE_KINDS, validThresholds, type CounterColour, type CounterScope, type ResetPeriod, type ResponseKind } from '../../../shared/counters.ts';
import { formatWeekRange, pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconArchive, IconCalendar, IconPlus, IconX } from '../../ui/icons.tsx';
import { Avatar, CounterBar, MetricCell } from '../../ui/Students.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const countersKey = (contextId: string) => [SENSITIVE, 'teacher', 'counters', contextId] as const;

const text = (en: string, tr: string): LocalizedTextValue => ({ ...(en.trim() ? { en: en.trim() } : {}), ...(tr.trim() ? { tr: tr.trim() } : {}) });
const hasText = (en: string, tr: string) => Boolean(en.trim() || tr.trim());

function useContexts() {
  const { locale } = useI18n();
  const q = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const items = (q.data?.contexts ?? []).map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}`, timezone: c.timezone }));
  return { q, items };
}

const scopeKey = (s: CounterScope) => `counters.scope.${s}` as MessageKey;
const periodKey = (p: ResetPeriod) => `counters.period.${p}` as MessageKey;
const colourKey = (c: CounterColour) => `counters.colour.${c}` as MessageKey;
const kindKey = (k: ResponseKind) => `counters.responseKind.${k}` as MessageKey;

/** Two text fields (English + Turkish) for one teacher-editable label. */
function TextPair({ label, en, tr, onChange, hint }: { label: string; en: string; tr: string; onChange: (en: string, tr: string) => void; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="cc-row" style={{ alignItems: 'flex-start' }}>
      <TextField label={t('counters.inEnglish', { label })} value={en} onChange={(v) => onChange(v, tr)} {...(hint ? { description: hint } : {})} />
      <TextField label={t('counters.inTurkish', { label })} value={tr} onChange={(v) => onChange(en, v)} />
    </div>
  );
}

interface ResponseDraft {
  key: string;
  id?: string | undefined;
  labelEn: string;
  labelTr: string;
  messageEn: string;
  messageTr: string;
  mascot: boolean;
  kind: ResponseKind;
}
interface Draft {
  mainEn: string;
  mainTr: string;
  supEn: string;
  supTr: string;
  indEn: string;
  indTr: string;
  scope: CounterScope;
  segments: string;
  period: ResetPeriod;
  colour: CounterColour;
  levels: [string, string, string];
  responses: ResponseDraft[];
  active: string;
}

let seq = 0;
const draftOf = (c: Cn.CounterConfig): Draft => ({
  mainEn: c.labels.main.en ?? '',
  mainTr: c.labels.main.tr ?? '',
  supEn: c.labels.supporting.en ?? '',
  supTr: c.labels.supporting.tr ?? '',
  indEn: c.labels.individual.en ?? '',
  indTr: c.labels.individual.tr ?? '',
  scope: c.scope,
  segments: String(c.barSegments),
  period: c.resetPeriod,
  colour: c.colour,
  levels: [0, 1, 2].map((i) => (c.thresholds[i] !== undefined ? String(c.thresholds[i]) : '')) as [string, string, string],
  responses: c.responses.map((r) => ({ key: `r${seq++}`, id: r.id, labelEn: r.label.en ?? '', labelTr: r.label.tr ?? '', messageEn: r.message.en ?? '', messageTr: r.message.tr ?? '', mascot: r.mascot, kind: r.kind })),
  active: c.activeResponseId ?? '',
});

const parseSegments = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
};
const parseLevels = (ls: string[]) => {
  const nums = ls.filter((l) => l.trim() !== '').map(Number);
  return validThresholds(nums) ? nums : null;
};

function CounterEditor({ counter, onDone }: { counter: Cn.CounterConfig; onDone: () => void }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [d, setD] = useState<Draft>(() => draftOf(counter));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setResponse = (i: number, patch: Partial<ResponseDraft>) => set({ responses: d.responses.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const segments = parseSegments(d.segments);
  const levels = parseLevels(d.levels);
  const valid = hasText(d.mainEn, d.mainTr) && hasText(d.indEn, d.indTr) && segments !== null && levels !== null && d.responses.every((r) => hasText(r.labelEn, r.labelTr));

  const save = async () => {
    if (!valid) return;
    const kept = d.responses.find((r) => (r.id ?? r.key) === d.active);
    const body = {
      counterId: counter.id,
      labels: { main: text(d.mainEn, d.mainTr), supporting: text(d.supEn, d.supTr), individual: text(d.indEn, d.indTr) },
      scope: d.scope,
      barSegments: segments!,
      resetPeriod: d.period,
      colour: d.colour,
      thresholds: levels!,
      responses: d.responses.map((r) => ({ ...(r.id ? { id: r.id } : {}), label: text(r.labelEn, r.labelTr), message: text(r.messageEn, r.messageTr), mascot: r.mascot, kind: r.kind })),
    };
    const result = await run(
      async () => {
        // A new response gets its id from the server; a newly added active response is chosen in a second call.
        const first = await call(Cn.updateCounter, { ...body, ...(kept?.id ? { activeResponseId: kept.id } : !d.active ? { activeResponseId: null } : {}) });
        if (kept && !kept.id) {
          const created = first.responses[d.responses.indexOf(kept)];
          if (created) return call(Cn.updateCounter, { counterId: counter.id, activeResponseId: created.id });
        }
        return first;
      },
      { success: t('counters.saved'), invalidate: [countersKey(counter.contextId), ['classroom', 'lesson']] },
    );
    if (result) onDone();
  };

  const previewLimit = segments ?? counter.barSegments;
  return (
    <form
      className="cc-stack"
      aria-label={t('counters.editor', { name: pickText(counter.labels.main, locale) })}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="cc-h2">{t('counters.labels')}</h3>
      <TextPair label={t('counters.mainLabel')} en={d.mainEn} tr={d.mainTr} onChange={(mainEn, mainTr) => set({ mainEn, mainTr })} />
      <TextPair label={t('counters.supportingLabel')} en={d.supEn} tr={d.supTr} onChange={(supEn, supTr) => set({ supEn, supTr })} hint={t('counters.supportingHint')} />
      <TextPair label={t('counters.individualLabel')} en={d.indEn} tr={d.indTr} onChange={(indEn, indTr) => set({ indEn, indTr })} />
      <CounterBar value={Math.min(3, previewLimit)} max={previewLimit} label={t('counters.preview')} colour={d.colour} />

      <h3 className="cc-h2">{t('counters.behaviour')}</h3>
      <div className="cc-row" style={{ alignItems: 'flex-start' }}>
        <Select label={t('counters.scope')} value={d.scope} onChange={(v) => set({ scope: v as CounterScope })} items={COUNTER_SCOPES.map((s) => ({ id: s, label: t(scopeKey(s)) }))} />
        <TextField label={t('counters.segments')} inputMode="numeric" value={d.segments} onChange={(segments) => set({ segments })} errorMessage={segments === null ? t('counters.segmentsInvalid') : null} />
        <Select label={t('counters.resetPeriod')} value={d.period} onChange={(v) => set({ period: v as ResetPeriod })} items={RESET_PERIODS.map((p) => ({ id: p, label: t(periodKey(p)) }))} />
        <Select label={t('counters.colour')} value={d.colour} onChange={(v) => set({ colour: v as CounterColour })} items={COUNTER_COLOURS.map((c) => ({ id: c, label: t(colourKey(c)) }))} />
      </div>
      <h3 className="cc-h2">{t('counters.levels')}</h3>
      <p className="cc-muted">{t('counters.levelsHint')}</p>
      <div className="cc-row" style={{ alignItems: 'flex-start' }}>
        {[0, 1, 2].map((i) => (
          <TextField
            key={i}
            label={t(`counters.level.${i + 1}` as MessageKey)}
            inputMode="numeric"
            value={d.levels[i]!}
            onChange={(v) => set({ levels: d.levels.map((x, j) => (j === i ? v : x)) as [string, string, string] })}
          />
        ))}
      </div>
      {levels === null ? <p className="cc-field__hint">{t('counters.levelsInvalid')}</p> : null}

      <h3 className="cc-h2">{t('counters.responses')}</h3>
      <p className="cc-muted">{t('counters.responsesHint')}</p>
      <ul className="cc-response-list">
        {d.responses.map((r, i) => (
          <li key={r.key} className="cc-stack">
            <TextPair label={t('counters.responseName', { n: i + 1 })} en={r.labelEn} tr={r.labelTr} onChange={(labelEn, labelTr) => setResponse(i, { labelEn, labelTr })} />
            <TextPair label={t('counters.responseMessage', { n: i + 1 })} en={r.messageEn} tr={r.messageTr} onChange={(messageEn, messageTr) => setResponse(i, { messageEn, messageTr })} hint={t('counters.supportingHint')} />
            <div className="cc-row">
              <Select label={t('counters.responseKind', { n: i + 1 })} value={r.kind} onChange={(v) => setResponse(i, { kind: v as ResponseKind })} items={RESPONSE_KINDS.map((k) => ({ id: k, label: t(kindKey(k)) }))} />
              <Toggle label={t('counters.mascot')} isSelected={r.mascot} onChange={(mascot) => setResponse(i, { mascot })} />
              <Button size="small" aria-label={t('counters.removeResponse', { n: i + 1 })} onPress={() => set({ responses: d.responses.filter((_, j) => j !== i), active: d.active === (r.id ?? r.key) ? '' : d.active })}>
                <IconX />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <Button
          isDisabled={d.responses.length >= 8}
          onPress={() => set({ responses: [...d.responses, { key: `r${seq++}`, labelEn: '', labelTr: '', messageEn: '', messageTr: '', mascot: false, kind: 'message' }] })}
        >
          <IconPlus />
          {t('counters.addResponse')}
        </Button>
      </div>
      <Select
        label={t('counters.activeResponse')}
        value={d.active}
        onChange={(active) => set({ active })}
        items={[{ id: '', label: t('counters.noResponse') }, ...d.responses.map((r, i) => ({ id: r.id ?? r.key, label: pickText(text(r.labelEn, r.labelTr), locale) || t('counters.responseName', { n: i + 1 }) }))]}
        description={t('counters.activeResponseHint')}
      />
      {!valid ? <p className="cc-field__hint">{t('counters.needNames')}</p> : null}
      <div className="cc-dialog__actions">
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isDisabled={!valid}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function NewCounterForm({ contextId, onDone }: { contextId: string; onDone: () => void }) {
  const { t } = useI18n();
  const run = useRun();
  const [en, setEn] = useState('');
  const [tr, setTr] = useState('');
  const [scope, setScope] = useState<CounterScope>('both');
  const [segments, setSegments] = useState('10');
  const [period, setPeriod] = useState<ResetPeriod>('week');
  const [colour, setColour] = useState<CounterColour>('teal');
  const seg = parseSegments(segments);
  const valid = hasText(en, tr) && seg !== null;
  return (
    <form
      className="cc-card cc-stack"
      aria-label={t('counters.new')}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        const ok = await run(() => call(Cn.createCounter, { contextId, name: text(en, tr), scope, barSegments: seg!, resetPeriod: period, colour }), {
          success: t('counters.created'),
          invalidate: [countersKey(contextId), ['classroom', 'lesson']],
        });
        if (ok) onDone();
      }}
    >
      <h2 className="cc-h2">{t('counters.new')}</h2>
      <TextPair label={t('counters.name')} en={en} tr={tr} onChange={(a, b) => (setEn(a), setTr(b))} />
      <div className="cc-row" style={{ alignItems: 'flex-start' }}>
        <Select label={t('counters.scope')} value={scope} onChange={(v) => setScope(v as CounterScope)} items={COUNTER_SCOPES.map((s) => ({ id: s, label: t(scopeKey(s)) }))} />
        <TextField label={t('counters.segments')} inputMode="numeric" value={segments} onChange={setSegments} errorMessage={seg === null ? t('counters.segmentsInvalid') : null} />
        <Select label={t('counters.resetPeriod')} value={period} onChange={(v) => setPeriod(v as ResetPeriod)} items={RESET_PERIODS.map((p) => ({ id: p, label: t(periodKey(p)) }))} />
        <Select label={t('counters.colour')} value={colour} onChange={(v) => setColour(v as CounterColour)} items={COUNTER_COLOURS.map((c) => ({ id: c, label: t(colourKey(c)) }))} />
      </div>
      <p className="cc-muted">{t('counters.newHint')}</p>
      <div className="cc-dialog__actions">
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isDisabled={!valid}>
          {t('counters.create')}
        </Button>
      </div>
    </form>
  );
}

export function CountersPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const navigate = useNavigate();
  const { q: contexts, items } = useContexts();
  const [selected, setSelected] = useState('');
  const contextId = selected || items[0]?.id || '';
  const list = useQuery({ queryKey: countersKey(contextId), queryFn: () => call(Cn.listCounters, { contextId }), enabled: Boolean(contextId) });
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const counters = list.data?.counters ?? [];
  const hasEnglish = counters.some((c) => c.kind === 'english_reminders' && !c.archived);
  const invalidate = [countersKey(contextId), ['classroom', 'lesson']];

  return (
    <main className="cc-page cc-stack" data-testid="counters-page">
      <h1 className="cc-h1">{t('counters.title')}</h1>
      {contexts.isSuccess && items.length === 0 ? <EmptyState title={t('classroom.noClasses.title')} mascot={false} /> : null}
      {items.length ? <Select label={t('counters.class')} value={contextId} onChange={(v) => (setSelected(v), setEditing(null), setCreating(false))} items={items} /> : null}
      <Alert kind="warning">{t('counters.liveHint')}</Alert>
      {list.data && !list.data.enabled ? (
        <Alert kind="warning">
          {t('counters.moduleOff')} <Link to="/teacher/$page" params={{ page: 'classes' }}>{t('teacher.classSettings')}</Link>
        </Alert>
      ) : null}
      <div className="cc-row">
        <Button variant="primary" onPress={() => setCreating(true)} isDisabled={!contextId}>
          <IconPlus />
          {t('counters.new')}
        </Button>
        {list.isSuccess && !hasEnglish ? (
          <Button onPress={() => void run(() => call(Cn.createEnglishPreset, { contextId }), { success: t('counters.created'), invalidate })}>
            <IconPlus />
            {t('counters.addEnglish')}
          </Button>
        ) : null}
        <Link to="/teacher/counter-history" search={{ counterId: undefined }} className={buttonClass('secondary')}>
          <IconCalendar />
          {t('counters.history')}
        </Link>
      </div>
      {creating && contextId ? <NewCounterForm contextId={contextId} onDone={() => setCreating(false)} /> : null}
      {list.isSuccess && counters.length === 0 ? <EmptyState title={t('counters.none')} body={t('counters.noneBody')} mascot={false} /> : null}
      {counters.map((c) => (
        <section key={c.id} className="cc-card cc-stack" aria-label={pickText(c.labels.main, locale)} data-testid="counter-settings">
          <div className="cc-row">
            <h2 className="cc-h2" style={{ margin: 0 }}>
              {pickText(c.labels.main, locale)}
            </h2>
            <span className="cc-chip">{c.kind === 'english_reminders' ? t('counters.kind.english') : t('counters.kind.custom')}</span>
            {c.archived ? (
              <span className="cc-chip">
                <IconArchive />
                {t('counters.archived')}
              </span>
            ) : null}
          </div>
          <p className="cc-muted" style={{ margin: 0 }}>
            {t('counters.summary', {
              scope: t(scopeKey(c.scope)),
              limit: c.barSegments,
              period: t(periodKey(c.resetPeriod)),
              response: pickText(c.responses.find((r) => r.id === c.activeResponseId)?.label, locale) || t('counters.noResponse'),
            })}
          </p>
          {editing === c.id ? (
            <CounterEditor counter={c} onDone={() => setEditing(null)} />
          ) : (
            <div className="cc-row">
              {!c.archived ? <Button onPress={() => setEditing(c.id)}>{t('counters.edit')}</Button> : null}
              <Button onPress={() => void navigate({ to: '/teacher/counter-history', search: { counterId: c.id } })}>
                <IconCalendar />
                {t('counters.history')}
              </Button>
              {c.archived ? (
                <Button onPress={() => void run(() => call(Cn.unarchiveCounter, { counterId: c.id }), { success: t('counters.unarchived'), invalidate })}>{t('counters.unarchive')}</Button>
              ) : (
                <Button onPress={() => void run(() => call(Cn.archiveCounter, { counterId: c.id }), { success: t('counters.archivedToast'), invalidate })}>
                  <IconArchive />
                  {t('counters.archive')}
                </Button>
              )}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}

// ---------------------------------------------------------------- history
const WEEK_CHOICES = [4, 8, 13, 26];

/** One student × week cell: a count, "not recorded" (no lesson that week) or "not in the class" (RPT-5). */
function HistoryCellView({ week, studentId }: { week: Parameters<typeof historyCell>[0]; studentId: string }) {
  const { t } = useI18n();
  const cell = historyCell(week, studentId);
  if (cell.kind === 'count') return <MetricCell value={cell.value} />;
  if (cell.kind === 'not_recorded') return <MetricCell value={null} />;
  return (
    <span className="cc-metric" data-state="not-enrolled">
      — {t('counterHistory.notEnrolled')}
    </span>
  );
}

export function CounterHistoryPage({ initialCounterId }: { initialCounterId?: string | undefined }) {
  const { t, locale } = useI18n();
  const { items } = useContexts();
  const [contextSel, setContextSel] = useState('');
  const [counterSel, setCounterSel] = useState(initialCounterId ?? '');
  const [weeks, setWeeks] = useState(8);
  // Find the context of a counter opened from the settings page.
  const all = useQuery({
    queryKey: [SENSITIVE, 'teacher', 'counters', 'all', items.map((i) => i.id).join(',')],
    queryFn: async () => Promise.all(items.map(async (i) => ({ contextId: i.id, list: (await call(Cn.listCounters, { contextId: i.id })).counters }))),
    enabled: items.length > 0,
  });
  const owner = all.data?.find((x) => x.list.some((c) => c.id === counterSel))?.contextId;
  const contextId = contextSel || owner || items[0]?.id || '';
  const counters = all.data?.find((x) => x.contextId === contextId)?.list ?? [];
  const counterId = counters.some((c) => c.id === counterSel) ? counterSel : (counters[0]?.id ?? '');
  const hist = useQuery({ queryKey: [SENSITIVE, 'teacher', 'counter-history', counterId, weeks], queryFn: () => call(Cn.counterHistory, { counterId, weeks }), enabled: Boolean(counterId) });
  const h = hist.data;

  return (
    <main className="cc-page cc-page--wide cc-stack" data-testid="counter-history">
      <h1 className="cc-h1">{t('counterHistory.title')}</h1>
      <p className="cc-muted">{t('counterHistory.hint')}</p>
      <div className="cc-row" style={{ alignItems: 'flex-start' }}>
        <Select label={t('counters.class')} value={contextId} onChange={(v) => (setContextSel(v), setCounterSel(''))} items={items} />
        <Select label={t('counterHistory.counter')} value={counterId} onChange={setCounterSel} items={counters.map((c) => ({ id: c.id, label: `${pickText(c.labels.main, locale)}${c.archived ? ` (${t('counters.archived')})` : ''}` }))} />
        <Select label={t('counterHistory.weeks')} value={String(weeks)} onChange={(v) => setWeeks(Number(v))} items={WEEK_CHOICES.map((n) => ({ id: String(n), label: t('counterHistory.lastWeeks', { count: n }) }))} />
      </div>
      {all.isSuccess && counters.length === 0 ? <EmptyState title={t('counters.none')} mascot={false} /> : null}
      {h ? (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <caption>
              {t('counterHistory.caption', { label: pickText(h.counter.labels.individual, locale) || pickText(h.counter.labels.main, locale), timezone: h.timezone })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('counterHistory.student')}</th>
                {h.weeks.map((w) => (
                  <th key={w.weekStart} scope="col" className="cc-week-range">
                    {formatWeekRange(w.weekStart, w.weekEnd, locale, h.timezone)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.students.map((s) => (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="cc-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                      <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
                      {s.fullName}
                    </span>
                  </th>
                  {h.weeks.map((w) => (
                    <td key={w.weekStart}>
                      <HistoryCellView week={w} studentId={s.id} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">{t('counterHistory.classOnly')}</th>
                {h.weeks.map((w) => (
                  <td key={w.weekStart}>{w.classOnly}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('counterHistory.total')}</th>
                {h.weeks.map((w) => (
                  <td key={w.weekStart}>{w.total}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('counterHistory.voided')}</th>
                {h.weeks.map((w) => (
                  <td key={w.weekStart}>{w.voided}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('counterHistory.lessons')}</th>
                {h.weeks.map((w) => (
                  <td key={w.weekStart}>{w.lessons === 0 ? t('counterHistory.noLessons') : w.lessons}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">{t('counterHistory.labelsUsed')}</th>
                {h.weeks.map((w) => (
                  <td key={w.weekStart}>{w.labelsUsed.map((l) => pickText(l, locale)).join(', ') || t('counterHistory.noLabels')}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="cc-muted">{t('counterHistory.noScores')}</p>
    </main>
  );
}
