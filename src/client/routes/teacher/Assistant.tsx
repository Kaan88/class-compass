/**
 * Daily Assistant in the teacher area (PIN-gated in classroom mode): AST-2..6, D-063, D-065, D-066.
 * - Week: plan once (never regenerated silently), announce, re-plan only future unchanged days of
 *   an unannounced week (with confirmation), swap two days, override one day; a print view to
 *   announce the week in advance. The announced week itself is classroom-safe and can also be shown
 *   on the display from the dashboard panel.
 * - Settings: school days and the editable responsibilities (EN + TR).
 * - History: planned vs actual per day, turns and missed turns per student.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays } from '../../../domain/dates.ts';
import * as A from '../../../shared/contracts/assistant.ts';
import type { AssistantPlan } from '../../../shared/contracts/assistant.ts';
import * as School from '../../../shared/contracts/school.ts';
import { formatDate, pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { dayLabel } from '../../modules/assistant/AssistantPanel.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconCalendar, IconNext, IconPlus, IconPrev, IconSwap, IconSync, IconX } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { Tabs } from '../../ui/Tabs.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const planKey = (contextId: string, week: string | null) => [SENSITIVE, 'teacher', 'assistant', 'plan', contextId, week ?? 'current'] as const;
const settingsKey = (contextId: string) => [SENSITIVE, 'teacher', 'assistant', 'settings', contextId] as const;
const historyKey = (contextId: string) => [SENSITIVE, 'teacher', 'assistant', 'history', contextId] as const;
const ALL = [SENSITIVE, 'teacher', 'assistant'] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

type Student = { id: string; fullName: string; initials: string; avatarHue: number } | null;
const statusKey = (s: string) => `assistant.status.${s}` as MessageKey;

function Who({ s }: { s: Student }) {
  const { t } = useI18n();
  if (!s) return <span className="cc-muted">{t('assistant.notPlanned')}</span>;
  return (
    <span className="cc-row" style={{ gap: '0.5rem' }}>
      <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
      {s.fullName}
    </span>
  );
}

function reasonText(t: ReturnType<typeof useI18n>['t'], reason: string | null) {
  if (!reason) return '';
  if (reason === 'absent' || reason === 'carry_forward' || reason === 'teacher_swap' || reason === 'teacher_override' || reason === 'not_in_class') return t(`assistant.reason.${reason}`);
  return reason;
}

function WeekTab({ contextId }: { contextId: string }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [week, setWeek] = useState<string | null>(null);
  const q = useQuery({ queryKey: planKey(contextId, week), queryFn: () => call(A.getAssistantPlan, { contextId, ...(week ? { weekStart: week } : {}) }) });
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [swapA, setSwapA] = useState('');
  const [swapB, setSwapB] = useState('');
  const [ovDay, setOvDay] = useState('');
  const [ovStudent, setOvStudent] = useState('');
  const [ovReason, setOvReason] = useState('');
  const p = q.data;
  if (!p) return <p className="cc-muted">{q.isError ? t('common.error') : t('common.loading')}</p>;
  const ws = p.weekStart;
  const editableDays = p.days.filter((d) => !d.past && d.assignmentId).map((d) => ({ id: d.date, label: dayLabel(d.date, locale, { weekday: 'long', day: 'numeric', month: 'short' }) }));
  const inv = { invalidate: [ALL] };
  const after = (np: AssistantPlan | undefined) => {
    if (np) setWeek(np.weekStart);
  };
  const lastDay = p.days[p.days.length - 1]?.date ?? addDays(ws, 4);

  return (
    <div className="cc-stack">
      <div className="cc-row cc-noprint">
        <Button onPress={() => setWeek(addDays(ws, -7))}>
          <IconPrev />
          {t('assistant.prevWeek')}
        </Button>
        <strong>{t('assistant.weekOf', { from: dayLabel(ws, locale, { day: 'numeric', month: 'long' }), to: dayLabel(lastDay, locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}</strong>
        <Button onPress={() => setWeek(addDays(ws, 7))}>
          {t('assistant.nextWeek')}
          <IconNext />
        </Button>
      </div>
      <div className="cc-row cc-noprint">
        {!p.plan ? (
          <Button variant="primary" onPress={() => void run(() => call(A.generateAssistantPlan, { contextId, weekStart: ws }), { success: t('assistant.toast.planned'), ...inv }).then(after)}>
            <IconCalendar />
            {t('assistant.generate')}
          </Button>
        ) : p.plan.announcedAt ? (
          <span className="cc-chip cc-chip--success">{t('assistant.announcedOn', { date: formatDate(p.plan.announcedAt, locale, 'Europe/Istanbul', { day: 'numeric', month: 'long' }) })}</span>
        ) : (
          <>
            <span className="cc-chip cc-chip--info">{t('assistant.notAnnounced')}</span>
            <Button variant="primary" onPress={() => void run(() => call(A.announceAssistantPlan, { contextId, weekStart: ws }), { success: t('assistant.toast.announced'), ...inv })}>
              {t('assistant.announce')}
            </Button>
            <Button onPress={() => setConfirmRegen(true)}>
              <IconSync />
              {t('assistant.regenerate')}
            </Button>
          </>
        )}
        <Button className="cc-push-right" onPress={() => window.print()}>
          {t('assistant.print')}
        </Button>
      </div>
      <section className="cc-print-sheet" aria-labelledby="cc-assistant-week-title">
        <h2 id="cc-assistant-week-title" className="cc-h2">
          {t('assistant.weekTitle')}
        </h2>
        <DataTable
          caption={t('assistant.weekOf', { from: dayLabel(ws, locale, { day: 'numeric', month: 'long' }), to: dayLabel(lastDay, locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}
          rows={p.days}
          rowKey={(d) => d.date}
          emptyText={t('assistant.noDays')}
          columns={[
            { key: 'day', header: t('assistant.col.day'), render: (d) => <span>{dayLabel(d.date, locale)}{d.today ? ` · ${t('assistant.today')}` : ''}</span> },
            { key: 'who', header: t('assistant.col.assistant'), render: (d) => <Who s={d.assistant} /> },
            { key: 'planned', header: t('assistant.col.planned'), render: (d) => (d.actual ? <Who s={d.planned} /> : <span className="cc-muted">{t('assistant.asPlanned')}</span>) },
            { key: 'status', header: t('assistant.col.status'), render: (d) => (d.status ? <span>{t(statusKey(d.status))}{d.reason ? ` – ${reasonText(t, d.reason)}` : ''}</span> : '') },
          ]}
        />
      </section>
      {p.plan && editableDays.length >= 1 ? (
        <div className="cc-stack cc-noprint">
          {editableDays.length >= 2 ? (
            <div className="cc-row" style={{ alignItems: 'flex-end' }}>
              <Select label={t('assistant.swapA')} items={editableDays} value={swapA} onChange={setSwapA} placeholder={t('common.choose')} />
              <Select label={t('assistant.swapB')} items={editableDays} value={swapB} onChange={setSwapB} placeholder={t('common.choose')} />
              <Button
                isDisabled={!swapA || !swapB || swapA === swapB}
                onPress={() => void run(() => call(A.swapAssistants, { contextId, dateA: swapA, dateB: swapB }), { success: t('assistant.toast.swapped'), ...inv }).then(() => (setSwapA(''), setSwapB('')))}
              >
                <IconSwap />
                {t('assistant.swap')}
              </Button>
            </div>
          ) : null}
          <div className="cc-row" style={{ alignItems: 'flex-end' }}>
            <Select label={t('assistant.overrideDay')} items={editableDays} value={ovDay} onChange={setOvDay} placeholder={t('common.choose')} />
            <Select label={t('assistant.overrideStudent')} items={p.roster.map((s) => ({ id: s.id, label: s.fullName }))} value={ovStudent} onChange={setOvStudent} placeholder={t('common.choose')} />
            <TextField label={t('assistant.overrideReason')} value={ovReason} onChange={setOvReason} maxLength={200} />
            <Button
              isDisabled={!ovDay || !ovStudent}
              onPress={() =>
                void run(() => call(A.overrideAssistant, { contextId, date: ovDay, studentId: ovStudent, reason: ovReason.trim() || null }), { success: t('assistant.toast.overridden'), ...inv }).then(() => {
                  setOvDay('');
                  setOvStudent('');
                  setOvReason('');
                })
              }
            >
              {t('assistant.override')}
            </Button>
          </div>
        </div>
      ) : null}
      <Modal isOpen={confirmRegen} onOpenChange={setConfirmRegen} title={t('assistant.regenerateTitle')} role="alertdialog">
        <p>{t('assistant.regenerateBody')}</p>
        <DialogActions>
          <Button onPress={() => setConfirmRegen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onPress={() => {
              setConfirmRegen(false);
              void run(() => call(A.regenerateAssistantPlan, { contextId, weekStart: ws, confirm: true }), { success: t('assistant.toast.regenerated'), ...inv });
            }}
          >
            {t('assistant.regenerateConfirm')}
          </Button>
        </DialogActions>
      </Modal>
    </div>
  );
}

interface RespDraft {
  key: string;
  id?: string;
  en: string;
  tr: string;
}
let seq = 0;

function SettingsTab({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: settingsKey(contextId), queryFn: () => call(A.getAssistantSettings, { contextId }) });
  const [days, setDays] = useState<number[] | null>(null);
  const [resp, setResp] = useState<RespDraft[] | null>(null);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const curDays = days ?? q.data.schoolDays;
  const curResp = resp ?? q.data.responsibilities.map((r) => ({ key: `r${seq++}`, id: r.id, en: r.label.en ?? '', tr: r.label.tr ?? '' }));
  const valid = curDays.length > 0 && curResp.every((r) => r.en.trim() || r.tr.trim());
  const setRow = (i: number, patch: Partial<RespDraft>) => setResp(curResp.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    const r = await run(
      () =>
        call(A.setAssistantSettings, {
          contextId,
          schoolDays: curDays,
          responsibilities: curResp.map((x) => ({ ...(x.id ? { id: x.id } : {}), label: { ...(x.en.trim() ? { en: x.en.trim() } : {}), ...(x.tr.trim() ? { tr: x.tr.trim() } : {}) } })),
        }),
      { success: t('assistant.toast.settingsSaved'), invalidate: [ALL] },
    );
    if (r) {
      setDays(null);
      setResp(null);
    }
  };
  return (
    <div className="cc-stack">
      <fieldset className="cc-fieldset">
        <legend className="cc-h2">{t('assistant.schoolDays')}</legend>
        <p className="cc-muted">{t('assistant.schoolDaysHint')}</p>
        <div className="cc-row">
          {WEEKDAYS.map((d) => (
            <Toggle key={d} label={t(`weekday.${d}` as MessageKey)} isSelected={curDays.includes(d)} onChange={(v) => setDays(v ? [...curDays, d].sort() : curDays.filter((x) => x !== d))} />
          ))}
        </div>
      </fieldset>
      <fieldset className="cc-fieldset">
        <legend className="cc-h2">{t('assistant.responsibilities')}</legend>
        <p className="cc-muted">{t('assistant.responsibilitiesHint')}</p>
        <ol className="cc-stack">
          {curResp.map((r, i) => (
            <li key={r.key} className="cc-row" style={{ alignItems: 'flex-end' }}>
              <TextField label={t('assistant.respEn', { n: i + 1 })} value={r.en} onChange={(v) => setRow(i, { en: v })} maxLength={200} />
              <TextField label={t('assistant.respTr', { n: i + 1 })} value={r.tr} onChange={(v) => setRow(i, { tr: v })} maxLength={200} />
              <Button aria-label={t('assistant.respRemove', { n: i + 1 })} onPress={() => setResp(curResp.filter((_, j) => j !== i))}>
                <IconX />
              </Button>
            </li>
          ))}
        </ol>
        <div>
          <Button isDisabled={curResp.length >= 12} onPress={() => setResp([...curResp, { key: `r${seq++}`, en: '', tr: '' }])}>
            <IconPlus />
            {t('assistant.respAdd')}
          </Button>
        </div>
      </fieldset>
      {!valid ? <Alert kind="warning">{t('assistant.settingsInvalid')}</Alert> : null}
      <div>
        <Button variant="primary" isDisabled={!valid} onPress={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

function HistoryTab({ contextId }: { contextId: string }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: historyKey(contextId), queryFn: () => call(A.assistantHistory, { contextId }) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const d = (x: string | null) => (x ? dayLabel(x, locale, { day: 'numeric', month: 'short' }) : '–');
  return (
    <div className="cc-stack">
      <DataTable
        caption={t('assistant.historyStudents')}
        rows={q.data.students}
        rowKey={(r) => r.student.id}
        emptyText={t('assistant.historyEmpty')}
        columns={[
          { key: 'name', header: t('common.name'), render: (r) => <Who s={r.student} />, sortValue: (r) => r.student.fullName },
          { key: 'turns', header: t('assistant.col.turns'), render: (r) => r.turns, sortValue: (r) => r.turns },
          { key: 'missed', header: t('assistant.col.missed'), render: (r) => r.missed, sortValue: (r) => r.missed },
          { key: 'last', header: t('assistant.col.last'), render: (r) => d(r.lastDate), sortValue: (r) => r.lastDate ?? '' },
          { key: 'next', header: t('assistant.col.next'), render: (r) => d(r.nextDate), sortValue: (r) => r.nextDate ?? '' },
        ]}
      />
      <DataTable
        caption={t('assistant.historyDays')}
        rows={q.data.days}
        rowKey={(r) => r.date}
        emptyText={t('assistant.historyEmpty')}
        columns={[
          { key: 'day', header: t('assistant.col.day'), render: (r) => dayLabel(r.date, locale) },
          { key: 'planned', header: t('assistant.col.planned'), render: (r) => <Who s={r.planned} /> },
          { key: 'actual', header: t('assistant.col.actual'), render: (r) => (r.actual ? <Who s={r.actual} /> : <span className="cc-muted">{t('assistant.asPlanned')}</span>) },
          { key: 'status', header: t('assistant.col.status'), render: (r) => `${t(statusKey(r.status))}${r.reason ? ` – ${reasonText(t, r.reason)}` : ''}${r.absent.length ? ` (${t('assistant.absentNames', { names: r.absent.map((a) => a.fullName).join(', ') })})` : ''}` },
          { key: 'thanked', header: t('assistant.col.thanked'), render: (r) => (r.thanked ? t('common.yes') : t('common.no')) },
        ]}
      />
    </div>
  );
}

export function AssistantPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState<string>('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-stack" data-testid="assistant-page">
      <h1 className="cc-h1">{t('teacher.assistant')}</h1>
      {contexts.isSuccess && !ctx ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {ctx ? (
        <>
          <div className="cc-noprint">
            <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          </div>
          {ctx.modules.assistant === false ? <Alert kind="warning">{t('assistant.moduleOff')}</Alert> : null}
          <Tabs
            key={ctx.id}
            label={t('teacher.assistant')}
            items={[
              { id: 'week', label: t('assistant.tab.week'), content: <WeekTab contextId={ctx.id} /> },
              { id: 'settings', label: t('assistant.tab.settings'), content: <SettingsTab contextId={ctx.id} /> },
              { id: 'history', label: t('assistant.tab.history'), content: <HistoryTab contextId={ctx.id} /> },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}
