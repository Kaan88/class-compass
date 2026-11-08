/**
 * Homework in the teacher area (PIN-gated in classroom mode): HW-1..4, ATT-1, RPT-5, D-074, D-075.
 * - Assignments: daily / weekly / monthly lists by due or assigned date in the class timezone;
 *   create, edit, archive; open the checking grid (bulk actions, corrections, undo, private notes).
 * - Outstanding: due assignments with students marked missing or partly completed, and how many are
 *   still not checked (never counted as missing).
 * - Settings: the status list (editable labels, custom statuses) and whether checking is allowed on
 *   the classroom screen. Also shown as the module's panel on the class settings page.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from '../../../domain/dates.ts';
import * as H from '../../../shared/contracts/homework.ts';
import type { HomeworkAssignment, HomeworkCheck, HomeworkStatusDef } from '../../../shared/contracts/homework.ts';
import * as School from '../../../shared/contracts/school.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { CheckGrid, StatusSummary, statusLabel, type CheckActions } from '../../modules/homework/CheckGrid.tsx';
import { dayText } from '../../modules/homework/HomeworkPanel.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconArchive, IconCheck, IconNext, IconPlus, IconPrev, IconUndo, IconX } from '../../ui/icons.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { Tabs } from '../../ui/Tabs.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'homework'] as const;
const checkKey = (assignmentId: string) => [...ALL, 'check', assignmentId] as const;
type View = (typeof H.HOMEWORK_VIEWS)[number];
const STEP: Record<View, number> = { day: 1, week: 7, month: 0 };

function shiftMonth(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return d.toISOString().slice(0, 10);
}

function AssignmentForm({ contextId, initial, onDone }: { contextId: string; initial?: HomeworkAssignment; onDone: () => void }) {
  const { t } = useI18n();
  const run = useRun();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [details, setDetails] = useState(initial?.details ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [assignedOn, setAssignedOn] = useState(initial?.assignedOn ?? '');
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? '');
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const valid = Boolean(title.trim()) && iso.test(dueOn) && (!assignedOn || iso.test(assignedOn));
  const save = () =>
    void run(
      () =>
        initial
          ? call(H.updateHomework, { assignmentId: initial.id, title: title.trim(), details: details.trim() || null, notes: notes.trim() || null, dueOn, ...(assignedOn ? { assignedOn } : {}) })
          : call(H.createHomework, { contextId, title: title.trim(), details: details.trim() || null, notes: notes.trim() || null, dueOn, ...(assignedOn ? { assignedOn } : {}) }),
      { success: initial ? t('homework.toast.saved') : t('homework.toast.created'), invalidate: [ALL] },
    ).then((r) => r && onDone());
  return (
    <div className="cc-stack" data-testid="homework-form">
      <TextField label={t('homework.field.title')} value={title} onChange={setTitle} />
      <TextField label={t('homework.field.details')} value={details} onChange={setDetails} />
      <div className="cc-row">
        <TextField label={t('homework.field.assignedOn')} description={t('homework.field.dateHint')} type="date" value={assignedOn} onChange={setAssignedOn} />
        <TextField label={t('homework.field.dueOn')} description={t('homework.field.dateHint')} type="date" value={dueOn} onChange={setDueOn} />
      </div>
      <TextField label={t('homework.field.notes')} description={t('homework.field.notesHint')} value={notes} onChange={setNotes} />
      <div className="cc-row">
        <Button variant="primary" isDisabled={!valid} onPress={save}>
          {initial ? t('common.save') : t('homework.create')}
        </Button>
        {initial ? <Button onPress={onDone}>{t('common.cancel')}</Button> : null}
      </div>
    </div>
  );
}

function CheckSection({ assignmentId }: { assignmentId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: checkKey(assignmentId), queryFn: () => call(H.homeworkCheck, { assignmentId }) });
  const actions: CheckActions = {
    set: (batchId, changes) => call(H.setHomeworkMarks, { assignmentId, batchId, changes }),
    remaining: (batchId, status) => call(H.markRemainingHomework, { assignmentId, batchId, status }),
    undo: (batchId) => call(H.undoHomeworkMarks, { assignmentId, batchId }),
  };
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  return (
    <CheckGrid
      check={q.data}
      actions={actions}
      withNotes
      scope="sensitive"
      onCheck={(c) => {
        qc.setQueryData(checkKey(assignmentId), c as HomeworkCheck);
        void qc.invalidateQueries({ queryKey: [...ALL, 'list'] });
        void qc.invalidateQueries({ queryKey: [...ALL, 'outstanding'] });
      }}
    />
  );
}

function AssignmentCard({ a, contextId, today }: { a: HomeworkAssignment; contextId: string; today: string }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [mode, setMode] = useState<'view' | 'edit' | 'check'>('view');
  return (
    <li className="cc-card cc-stack" data-testid="homework-item">
      <div className="cc-row">
        <h2 className="cc-h2">{a.title}</h2>
        <span className="cc-chip">{t('homework.assignedOnShort', { date: dayText(a.assignedOn, locale) })}</span>
        <span className="cc-chip">{a.dueOn === today ? t('homework.dueToday') : t('homework.dueOn', { date: dayText(a.dueOn, locale) })}</span>
        {a.archived ? <span className="cc-chip">{t('homework.archived')}</span> : null}
      </div>
      {a.details ? <p>{a.details}</p> : null}
      {a.notes ? <p className="cc-muted">{t('homework.privateNote', { note: a.notes })}</p> : null}
      {/* While checking, the grid shows the same counts at the top of its bar (no second copy). */}
      {mode === 'check' ? null : <StatusSummary statuses={a.statuses} byStatus={a.counts.byStatus} />}
      {mode === 'edit' ? <AssignmentForm contextId={contextId} initial={a} onDone={() => setMode('view')} /> : null}
      {mode === 'check' ? <CheckSection assignmentId={a.id} /> : null}
      <div className="cc-row">
        {!a.archived ? (
          <>
            <Button variant={mode === 'check' ? 'secondary' : 'primary'} onPress={() => setMode(mode === 'check' ? 'view' : 'check')}>
              {mode === 'check' ? <IconX /> : <IconCheck />}
              {mode === 'check' ? t('homework.closeCheck') : t('homework.checkThis', { title: a.title })}
            </Button>
            <Button onPress={() => setMode(mode === 'edit' ? 'view' : 'edit')}>{t('homework.edit')}</Button>
          </>
        ) : null}
        <Button className="cc-push-right" onPress={() => void run(() => call(H.archiveHomework, { assignmentId: a.id, archived: !a.archived }), { invalidate: [ALL] })}>
          {a.archived ? <IconUndo /> : <IconArchive />}
          {a.archived ? t('homework.restore') : t('homework.archive')}
        </Button>
      </div>
    </li>
  );
}

function AssignmentsTab({ contextId }: { contextId: string }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>('week');
  const [by, setBy] = useState<'due' | 'assigned'>('due');
  const [date, setDate] = useState<string | undefined>(undefined);
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: [...ALL, 'list', contextId, view, by, date ?? 'today', archived],
    queryFn: () => call(H.listHomework, { contextId, view, by, ...(date ? { date } : {}), ...(archived ? { includeArchived: '1' as const } : {}) }),
  });
  const base = date ?? q.data?.today;
  const go = (n: number) => base && setDate(view === 'month' ? shiftMonth(base, n) : addDays(base, n * STEP[view]));
  return (
    <div className="cc-stack">
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select label={t('homework.view')} items={H.HOMEWORK_VIEWS.map((v) => ({ id: v, label: t(`homework.view.${v}`) }))} value={view} onChange={(v) => setView(v as View)} />
        <Select label={t('homework.by')} items={[{ id: 'due', label: t('homework.by.due') }, { id: 'assigned', label: t('homework.by.assigned') }]} value={by} onChange={(v) => setBy(v as 'due' | 'assigned')} />
        <Button onPress={() => go(-1)} aria-label={t('homework.previous')}>
          <IconPrev />
        </Button>
        <Button onPress={() => setDate(undefined)}>{t('homework.today')}</Button>
        <Button onPress={() => go(1)} aria-label={t('homework.next')}>
          <IconNext />
        </Button>
        <Toggle label={t('homework.showArchived')} isSelected={archived} onChange={setArchived} />
      </div>
      {q.data ? (
        <p className="cc-muted" data-testid="homework-range">
          {q.data.range.from === q.data.range.to ? t('homework.rangeDay', { date: dayText(q.data.range.from, locale) }) : t('homework.range', { from: dayText(q.data.range.from, locale), to: dayText(q.data.range.to, locale) })}
        </p>
      ) : null}
      {adding ? (
        <section className="cc-card cc-stack" aria-label={t('homework.new')}>
          <AssignmentForm contextId={contextId} onDone={() => setAdding(false)} />
          <div>
            <Button onPress={() => setAdding(false)}>{t('common.cancel')}</Button>
          </div>
        </section>
      ) : (
        <div>
          <Button variant="primary" onPress={() => setAdding(true)}>
            <IconPlus />
            {t('homework.new')}
          </Button>
        </div>
      )}
      {q.data ? (
        q.data.assignments.length ? (
          <ul className="cc-stack">
            {q.data.assignments.map((a) => (
              <AssignmentCard key={a.id} a={a} contextId={contextId} today={q.data.today} />
            ))}
          </ul>
        ) : (
          <p className="cc-muted">{t('homework.noneInRange')}</p>
        )
      ) : (
        <p className="cc-muted">{t('common.loading')}</p>
      )}
    </div>
  );
}

function OutstandingTab({ contextId }: { contextId: string }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: [...ALL, 'outstanding', contextId], queryFn: () => call(H.outstandingHomework, { contextId }) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  if (!q.data.items.length) return <p className="cc-muted">{t('homework.noOutstanding')}</p>;
  return (
    <ul className="cc-stack" data-testid="homework-outstanding">
      {q.data.items.map((i) => (
        <li key={i.assignment.id} className="cc-card cc-stack">
          <div className="cc-row">
            <h2 className="cc-h2">{i.assignment.title}</h2>
            <span className="cc-chip">{t('homework.dueOn', { date: dayText(i.assignment.dueOn, locale) })}</span>
            {i.notChecked ? <span className="cc-chip">{t('homework.notCheckedCount', { count: i.notChecked, total: i.total })}</span> : null}
          </div>
          <ul className="cc-stack">
            {i.students.map((s) => (
              <li key={s.student.id} className="cc-row">
                <Avatar name={s.student.fullName} id={s.student.id} hue={s.student.avatarHue} initials={s.student.initials} size="sm" />
                <span>{s.student.fullName}</span>
                <span className="cc-chip">{statusLabel(i.statuses, s.status, locale)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Leaves an empty language out, so the other one is shown instead of an empty label. */
const localized = (en: string, tr: string) => ({ ...(en.trim() ? { en: en.trim() } : {}), ...(tr.trim() ? { tr: tr.trim() } : {}) });

type DraftStatus = { key: string; kind: HomeworkStatusDef['kind']; en: string; tr: string };

/** Status list + "allow checking on the classroom screen" (HW-2, D-075). The module's settings panel. */
export function HomeworkSettingsPanel({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: [...ALL, 'settings', contextId], queryFn: () => call(H.getHomeworkSettings, { contextId }) });
  const [draft, setDraft] = useState<DraftStatus[] | null>(null);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const list = draft ?? q.data.statuses.map((s) => ({ key: s.key, kind: s.kind, en: s.label.en ?? '', tr: s.label.tr ?? '' }));
  const patch = (i: number, p: Partial<DraftStatus>) => setDraft(list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const valid = list.every((s) => s.en.trim() || s.tr.trim());
  const nextKey = () => {
    let n = 1;
    while (list.some((s) => s.key === `custom_${n}`)) n++;
    return `custom_${n}`;
  };
  const kinds = H.HOMEWORK_STATUS_KINDS.filter((k) => k !== 'not_checked').map((k) => ({ id: k, label: t(`homework.kind.${k}` as MessageKey) }));
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-homework-settings">
      <h2 id="cc-homework-settings" className="cc-h2">
        {t('homework.settingsTitle')}
      </h2>
      <Toggle
        label={t('homework.checkingInClassroom')}
        description={t('homework.checkingInClassroomHint')}
        isSelected={q.data.checkingInClassroom}
        onChange={(v) => void run(() => call(H.setHomeworkSettings, { contextId, checkingInClassroom: v }), { success: t('homework.toast.settingsSaved'), invalidate: [ALL] })}
      />
      <h3 className="cc-h2">{t('homework.statuses')}</h3>
      <p className="cc-muted">{t('homework.statusesHint')}</p>
      <ul className="cc-stack">
        {list.map((s, i) => (
          <li key={s.key} className="cc-row" style={{ alignItems: 'flex-end' }}>
            <TextField label={t('homework.statusEn', { n: i + 1 })} value={s.en} onChange={(v) => patch(i, { en: v })} />
            <TextField label={t('homework.statusTr', { n: i + 1 })} value={s.tr} onChange={(v) => patch(i, { tr: v })} />
            {i === 0 ? (
              <span className="cc-chip">{t('homework.kind.not_checked')}</span>
            ) : (
              <>
                <Select label={t('homework.statusKind', { n: i + 1 })} items={kinds} value={s.kind} onChange={(v) => patch(i, { kind: v as DraftStatus['kind'] })} />
                <Button onPress={() => setDraft(list.filter((_, j) => j !== i))}>
                  <IconX />
                  {t('homework.removeStatus', { n: i + 1 })}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="cc-row">
        <Button isDisabled={list.length >= H.MAX_STATUSES} onPress={() => setDraft([...list, { key: nextKey(), kind: 'other', en: '', tr: '' }])}>
          <IconPlus />
          {t('homework.addStatus')}
        </Button>
        <Button
          variant="primary"
          isDisabled={!draft || !valid}
          onPress={() =>
            void run(() => call(H.setHomeworkSettings, { contextId, statuses: list.map((s) => ({ key: s.key, kind: s.kind, label: localized(s.en, s.tr) })) }), {
              success: t('homework.toast.settingsSaved'),
              invalidate: [ALL],
            }).then((r) => r && setDraft(null))
          }
        >
          {t('common.save')}
        </Button>
        {draft ? <Button onPress={() => setDraft(null)}>{t('common.cancel')}</Button> : null}
      </div>
    </section>
  );
}

export function HomeworkPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-stack" data-testid="homework-page">
      <h1 className="cc-h1">{t('teacher.homework')}</h1>
      <p className="cc-muted">{t('homework.teacherIntro')}</p>
      {contexts.isSuccess && !ctx ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          {ctx.modules.homework === false ? <Alert kind="warning">{t('homework.moduleOff')}</Alert> : null}
          <Tabs
            key={ctx.id}
            label={t('teacher.homework')}
            items={[
              { id: 'assignments', label: t('homework.tab.assignments'), content: <AssignmentsTab contextId={ctx.id} /> },
              { id: 'outstanding', label: t('homework.tab.outstanding'), content: <OutstandingTab contextId={ctx.id} /> },
              { id: 'settings', label: t('homework.tab.settings'), content: <HomeworkSettingsPanel contextId={ctx.id} /> },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}
