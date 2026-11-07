/**
 * Goals in the teacher area (S10: GOL-1..6, RPT-5; PIN-gated in classroom mode).
 * - Overview: every student of the class with active/achieved goals, evidence and latest confidence.
 * - Student: set goals (preset or own words, practice choices, review date), progress updates,
 *   outcomes, feedback the student sees, evidence, and PRIVATE notes (lock icon, never shown to the
 *   student or anyone else, GOL-6).
 * - Library: the default categories and presets plus this teacher's own (rename/archive own).
 * - Settings: outcome labels (also the module's panel on the class settings page).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as G from '../../../shared/contracts/goals.ts';
import type { Goal, GoalLibrary, OutcomeDef, TeacherStudentGoals } from '../../../shared/contracts/goals.ts';
import * as School from '../../../shared/contracts/school.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { ConfidenceChip, EntryLine, EvidenceView, FeedbackLine, GoalSummary, whenText } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextArea, TextField } from '../../ui/Fields.tsx';
import { IconArchive, IconBack, IconLock, IconPlus, IconTrash, IconUndo } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { Tabs } from '../../ui/Tabs.tsx';

const CONTEXTS_KEY = ['classroom', 'contexts'] as const;
const ALL = [SENSITIVE, 'teacher', 'goals'] as const;
const OWN = '__own__';

const localized = (en: string, tr: string) => ({ ...(en.trim() ? { en: en.trim() } : {}), ...(tr.trim() ? { tr: tr.trim() } : {}) });

function NewGoalForm({ contextId, studentId, library }: { contextId: string; studentId: string; library: GoalLibrary }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const cats = library.categories.filter((c) => !c.archived);
  const [categoryId, setCategoryId] = useState(cats[0]?.id ?? '');
  const presets = library.presets.filter((p) => !p.archived && p.categoryId === categoryId);
  const [choice, setChoice] = useState(OWN);
  const [text, setText] = useState('');
  const [practice, setPractice] = useState('');
  const [reviewOn, setReviewOn] = useState('');
  const own = choice === OWN;
  const valid = Boolean(categoryId) && (own ? Boolean(text.trim()) : true) && (!reviewOn || /^\d{4}-\d{2}-\d{2}$/u.test(reviewOn));
  const save = () =>
    void run(
      () =>
        call(G.teacherCreateGoal, {
          contextId,
          studentId,
          categoryId,
          ...(own ? { text: text.trim() } : { presetId: choice }),
          practiceChoices: practice
            .split(/[\n,]/u)
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, G.MAX_PRACTICE_CHOICES),
          reviewOn: reviewOn || null,
        }),
      { success: t('goals.toast.goalAdded'), invalidate: [ALL] },
    ).then((r) => {
      if (r) {
        setText('');
        setPractice('');
        setReviewOn('');
      }
    });
  return (
    <section className="cc-card cc-stack" aria-labelledby="goals-new">
      <h3 id="goals-new" className="cc-h2">
        {t('goals.newGoal')}
      </h3>
      <div className="cc-row">
        <Select label={t('goals.category')} items={cats.map((c) => ({ id: c.id, label: pickText(c.name, locale) }))} value={categoryId} onChange={setCategoryId} />
        <Select label={t('goals.preset')} items={[{ id: OWN, label: t('goals.ownWords') }, ...presets.map((p) => ({ id: p.id, label: pickText(p.text, locale) }))]} value={choice} onChange={setChoice} />
      </div>
      {own ? <TextField label={t('goals.goalWords')} value={text} onChange={setText} maxLength={500} /> : null}
      <div className="cc-row">
        <TextField label={t('goals.practice')} description={t('goals.practiceHint')} value={practice} onChange={setPractice} />
        <TextField label={t('goals.reviewDate')} description={t('homework.field.dateHint')} type="date" value={reviewOn} onChange={setReviewOn} />
      </div>
      <div>
        <Button variant="primary" isDisabled={!valid} onPress={save}>
          <IconPlus />
          {t('goals.addGoal')}
        </Button>
      </div>
    </section>
  );
}

function GoalCard({ goal, outcomes }: { goal: Goal; outcomes: readonly OutcomeDef[] }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [progress, setProgress] = useState('');
  const [outcome, setOutcome] = useState('');
  const opts = { invalidate: [ALL] };
  return (
    <li className="cc-card cc-stack cc-goal" data-testid="teacher-goal">
      <GoalSummary goal={goal} outcomes={outcomes} />
      {goal.entries.length ? (
        <ul className="cc-stack">
          {goal.entries.map((e) => (
            <EntryLine key={e.id} entry={e} />
          ))}
        </ul>
      ) : null}
      {goal.assessments.length > 1 ? (
        <p className="cc-muted">
          {t('goals.outcomeHistory', {
            list: goal.assessments.map((a) => `${pickText(outcomes.find((o) => o.key === a.outcome)?.label, locale) || a.outcome} (${whenText(a.createdAt, locale)})`).join(', '),
          })}
        </p>
      ) : null}
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <TextField label={t('goals.progressUpdate')} value={progress} onChange={setProgress} maxLength={2000} />
        <Button isDisabled={!progress.trim()} onPress={() => void run(() => call(G.teacherAddProgress, { goalId: goal.id, body: progress.trim() }), opts).then((r) => r && setProgress(''))}>
          {t('goals.addProgress')}
        </Button>
      </div>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select label={t('goals.outcome')} placeholder={t('goals.chooseOutcome')} items={outcomes.map((o) => ({ id: o.key, label: pickText(o.label, locale) }))} value={outcome} onChange={setOutcome} />
        <Button isDisabled={!outcome} onPress={() => void run(() => call(G.teacherAssessGoal, { goalId: goal.id, outcome: outcome as G.GoalOutcome }), opts).then((r) => r && setOutcome(''))}>
          {t('goals.recordOutcome')}
        </Button>
        <Select
          label={t('goals.statusLabel')}
          items={G.GOAL_STATUSES.map((s) => ({ id: s, label: t(`goals.status.${s}` as MessageKey) }))}
          value={goal.status}
          onChange={(v) => void run(() => call(G.teacherUpdateGoal, { goalId: goal.id, status: v as G.GoalStatus }), opts)}
        />
        <TextField
          label={t('goals.reviewDate')}
          type="date"
          value={goal.reviewOn ?? ''}
          onChange={(v) => (v === '' || /^\d{4}-\d{2}-\d{2}$/u.test(v)) && void run(() => call(G.teacherUpdateGoal, { goalId: goal.id, reviewOn: v || null }), opts)}
        />
      </div>
    </li>
  );
}

function PrivateNotes({ contextId, data }: { contextId: string; data: TeacherStudentGoals }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const [body, setBody] = useState('');
  return (
    <section className="cc-card cc-stack cc-private" aria-labelledby="goals-private" data-testid="private-notes">
      <h3 id="goals-private" className="cc-h2 cc-row">
        <IconLock />
        {t('goals.privateNotes')}
      </h3>
      <p className="cc-muted">{t('goals.privateHint')}</p>
      <ul className="cc-stack">
        {data.privateNotes.map((n) => (
          <li key={n.id} className="cc-stack">
            <div className="cc-row">
              <span className="cc-muted">{whenText(n.createdAt, locale)}</span>
              <Button size="small" variant="ghost" onPress={() => void run(() => call(G.teacherDeletePrivateNote, { noteId: n.id }), { invalidate: [ALL] })}>
                <IconTrash />
                {t('goals.deleteNote')}
              </Button>
            </div>
            <p className="cc-entry__body">{n.body}</p>
          </li>
        ))}
      </ul>
      <TextArea label={t('goals.newPrivateNote')} rows={3} value={body} onChange={setBody} maxLength={2000} />
      <div>
        <Button isDisabled={!body.trim()} onPress={() => void run(() => call(G.teacherAddPrivateNote, { contextId, studentId: data.student.id, body: body.trim() }), { invalidate: [ALL] }).then((r) => r && setBody(''))}>
          <IconLock />
          {t('goals.savePrivateNote')}
        </Button>
      </div>
    </section>
  );
}

function StudentGoals({ contextId, studentId, onBack }: { contextId: string; studentId: string; onBack: () => void }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: [...ALL, 'student', contextId, studentId], queryFn: () => call(G.teacherStudentGoals, { contextId, studentId }) });
  const [feedback, setFeedback] = useState('');
  const [feedbackGoal, setFeedbackGoal] = useState('');
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const d = q.data;
  return (
    <div className="cc-stack" data-testid="teacher-student-goals">
      <div className="cc-row">
        <Button onPress={onBack}>
          <IconBack />
          {t('goals.backToClass')}
        </Button>
        <Avatar name={d.student.fullName} id={d.student.id} hue={d.student.avatarHue} initials={d.student.initials} />
        <h2 className="cc-h2">{d.student.fullName}</h2>
      </div>
      <NewGoalForm contextId={contextId} studentId={studentId} library={d.library} />
      <section className="cc-stack" aria-labelledby="goals-list">
        <h3 id="goals-list" className="cc-h2">
          {t('goals.goals')}
        </h3>
        {d.goals.length === 0 ? <p className="cc-muted">{t('goals.noGoals')}</p> : null}
        <ul className="cc-stack">
          {d.goals.map((g) => (
            <GoalCard key={g.id} goal={g} outcomes={d.library.outcomes} />
          ))}
        </ul>
      </section>
      <section className="cc-card cc-stack" aria-labelledby="goals-feedback">
        <h3 id="goals-feedback" className="cc-h2">
          {t('goals.feedback')}
        </h3>
        <p className="cc-muted">{t('goals.feedbackHint')}</p>
        <Select label={t('goals.feedbackFor')} items={[{ id: '', label: t('goals.feedbackGeneral') }, ...d.goals.map((g) => ({ id: g.id, label: g.text }))]} value={feedbackGoal} onChange={setFeedbackGoal} />
        <TextArea label={t('goals.feedbackWords')} rows={3} value={feedback} onChange={setFeedback} maxLength={2000} />
        <div>
          <Button
            variant="primary"
            isDisabled={!feedback.trim()}
            onPress={() =>
              void run(() => call(G.teacherAddFeedback, { contextId, studentId, body: feedback.trim(), ...(feedbackGoal ? { goalId: feedbackGoal } : {}) }), { success: t('goals.toast.feedbackSent'), invalidate: [ALL] }).then((r) => r && setFeedback(''))
            }
          >
            {t('goals.sendFeedback')}
          </Button>
        </div>
        <ul className="cc-stack">
          {d.feedback.map((f) => (
            <FeedbackLine
              key={f.id}
              item={f}
              actions={
                <div>
                  <Button size="small" variant="ghost" onPress={() => void run(() => call(G.teacherDeleteFeedback, { feedbackId: f.id }), { invalidate: [ALL] })}>
                    <IconTrash />
                    {t('goals.deleteFeedback')}
                  </Button>
                </div>
              }
            />
          ))}
        </ul>
      </section>
      <section className="cc-stack" aria-labelledby="goals-evidence">
        <h3 id="goals-evidence" className="cc-h2">
          {t('goals.evidence')}
        </h3>
        {d.evidence.length === 0 ? <p className="cc-muted">{t('goals.noEvidence')}</p> : null}
        <ul className="cc-stack">
          {d.evidence.map((e) => (
            <EvidenceView key={e.id} item={e} fileUrl={G.teacherFileUrl} />
          ))}
        </ul>
      </section>
      <PrivateNotes contextId={contextId} data={d} />
    </div>
  );
}

function Overview({ contextId, onOpen }: { contextId: string; onOpen: (studentId: string) => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: [...ALL, 'overview', contextId], queryFn: () => call(G.goalsOverview, { contextId }) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  return (
    <DataTable
      caption={t('goals.overviewCaption', { className: q.data.className })}
      emptyText={t('goals.noStudents')}
      rows={q.data.students}
      rowKey={(r) => r.id}
      columns={[
        {
          key: 'name',
          header: t('goals.col.student'),
          render: (r) => (
            <Button variant="ghost" onPress={() => onOpen(r.id)}>
              <Avatar name={r.fullName} id={r.id} hue={r.avatarHue} initials={r.initials} size="sm" />
              {r.fullName}
            </Button>
          ),
        },
        { key: 'active', header: t('goals.col.active'), render: (r) => String(r.activeGoals) },
        { key: 'achieved', header: t('goals.col.achieved'), render: (r) => String(r.achievedGoals) },
        { key: 'evidence', header: t('goals.col.evidence'), render: (r) => String(r.evidence) },
        { key: 'confidence', header: t('goals.col.confidence'), render: (r) => (r.lastConfidence === null ? t('goals.none') : <ConfidenceChip value={r.lastConfidence} />) },
        { key: 'last', header: t('goals.col.last'), render: (r) => (r.lastActivityAt === null ? t('goals.none') : whenText(r.lastActivityAt, locale)) },
      ]}
    />
  );
}

function LibraryTab({ contextId }: { contextId: string }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: [...ALL, 'library', contextId], queryFn: () => call(G.goalLibrary, { contextId }) });
  const [catEn, setCatEn] = useState('');
  const [catTr, setCatTr] = useState('');
  const [presetCat, setPresetCat] = useState('');
  const [presetEn, setPresetEn] = useState('');
  const [presetTr, setPresetTr] = useState('');
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const lib = q.data;
  const opts = { invalidate: [ALL] };
  const liveCats = lib.categories.filter((c) => !c.archived);
  const pc = presetCat || liveCats[0]?.id || '';
  return (
    <div className="cc-stack">
      <p className="cc-muted">{t('goals.libraryHint')}</p>
      <ul className="cc-stack">
        {lib.categories.map((c) => (
          <li key={c.id} className="cc-card cc-stack">
            <div className="cc-row">
              <h3 className="cc-h2">{pickText(c.name, locale)}</h3>
              {c.custom ? <span className="cc-chip">{t('goals.custom')}</span> : <span className="cc-chip">{t('goals.default')}</span>}
              {c.archived ? <span className="cc-chip">{t('goals.archived')}</span> : null}
              {c.custom ? (
                <Button size="small" className="cc-push-right" onPress={() => void run(() => call(G.updateCategory, { categoryId: c.id, archived: !c.archived }), opts)}>
                  {c.archived ? <IconUndo /> : <IconArchive />}
                  {c.archived ? t('goals.restore') : t('goals.archive')}
                </Button>
              ) : null}
            </div>
            <ul className="cc-stack">
              {lib.presets
                .filter((p) => p.categoryId === c.id)
                .map((p) => (
                  <li key={p.id} className="cc-row">
                    <span>{pickText(p.text, locale)}</span>
                    {p.archived ? <span className="cc-chip">{t('goals.archived')}</span> : null}
                    {p.custom ? (
                      <Button size="small" variant="ghost" onPress={() => void run(() => call(G.updatePreset, { presetId: p.id, archived: !p.archived }), opts)}>
                        {p.archived ? t('goals.restore') : t('goals.archive')}
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      <section className="cc-card cc-stack" aria-labelledby="goals-new-cat">
        <h3 id="goals-new-cat" className="cc-h2">
          {t('goals.newCategory')}
        </h3>
        <div className="cc-row">
          <TextField label={t('goals.nameEn')} value={catEn} onChange={setCatEn} />
          <TextField label={t('goals.nameTr')} value={catTr} onChange={setCatTr} />
        </div>
        <div>
          <Button
            isDisabled={!catEn.trim() && !catTr.trim()}
            onPress={() =>
              void run(() => call(G.createCategory, { contextId, name: localized(catEn, catTr) }), opts).then((r) => {
                if (r) {
                  setCatEn('');
                  setCatTr('');
                }
              })
            }
          >
            <IconPlus />
            {t('goals.addCategory')}
          </Button>
        </div>
      </section>
      <section className="cc-card cc-stack" aria-labelledby="goals-new-preset">
        <h3 id="goals-new-preset" className="cc-h2">
          {t('goals.newPreset')}
        </h3>
        <Select label={t('goals.category')} items={liveCats.map((c) => ({ id: c.id, label: pickText(c.name, locale) }))} value={pc} onChange={setPresetCat} />
        <div className="cc-row">
          <TextField label={t('goals.presetEn')} value={presetEn} onChange={setPresetEn} />
          <TextField label={t('goals.presetTr')} value={presetTr} onChange={setPresetTr} />
        </div>
        <div>
          <Button
            isDisabled={!pc || (!presetEn.trim() && !presetTr.trim())}
            onPress={() =>
              void run(() => call(G.createPreset, { contextId, categoryId: pc, text: localized(presetEn, presetTr) }), opts).then((r) => {
                if (r) {
                  setPresetEn('');
                  setPresetTr('');
                }
              })
            }
          >
            <IconPlus />
            {t('goals.addPreset')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Outcome labels (GOL-3), EN + TR. The module's panel on the class settings page. */
export function GoalsSettingsPanel({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: [...ALL, 'settings', contextId], queryFn: () => call(G.goalSettings, { contextId }) });
  const [draft, setDraft] = useState<Array<{ key: G.GoalOutcome; en: string; tr: string }> | null>(null);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const list = draft ?? q.data.outcomes.map((o) => ({ key: o.key, en: o.label.en ?? '', tr: o.label.tr ?? '' }));
  const patch = (i: number, p: Partial<(typeof list)[number]>) => setDraft(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const valid = list.every((o) => o.en.trim() || o.tr.trim());
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-goals-settings">
      <h2 id="cc-goals-settings" className="cc-h2">
        {t('goals.settingsTitle')}
      </h2>
      <p className="cc-muted">{t('goals.outcomesHint')}</p>
      <ul className="cc-stack">
        {list.map((o, i) => (
          <li key={o.key} className="cc-row">
            <TextField label={t('goals.outcomeEn', { n: i + 1 })} value={o.en} onChange={(v) => patch(i, { en: v })} />
            <TextField label={t('goals.outcomeTr', { n: i + 1 })} value={o.tr} onChange={(v) => patch(i, { tr: v })} />
          </li>
        ))}
      </ul>
      <div className="cc-row">
        <Button
          variant="primary"
          isDisabled={!draft || !valid}
          onPress={() =>
            void run(() => call(G.setGoalSettings, { contextId, outcomes: list.map((o) => ({ key: o.key, label: localized(o.en, o.tr) })) }), { success: t('goals.toast.settingsSaved'), invalidate: [ALL] }).then((r) => r && setDraft(null))
          }
        >
          {t('common.save')}
        </Button>
        {draft ? <Button onPress={() => setDraft(null)}>{t('common.cancel')}</Button> : null}
      </div>
    </section>
  );
}

function ClassGoals({ contextId }: { contextId: string }) {
  const [studentId, setStudentId] = useState<string | null>(null);
  return studentId ? <StudentGoals contextId={contextId} studentId={studentId} onBack={() => setStudentId(null)} /> : <Overview contextId={contextId} onOpen={setStudentId} />;
}

export function GoalsPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-stack" data-testid="goals-page">
      <h1 className="cc-h1">{t('teacher.goals')}</h1>
      <p className="cc-muted">{t('goals.teacherIntro')}</p>
      {contexts.isSuccess && !ctx ? <EmptyState title={t('classroom.noClasses.title')} /> : null}
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          {ctx.modules.goals === false ? <Alert kind="warning">{t('goals.moduleOff')}</Alert> : null}
          <Tabs
            key={ctx.id}
            label={t('teacher.goals')}
            items={[
              { id: 'students', label: t('goals.tab.students'), content: <ClassGoals contextId={ctx.id} /> },
              { id: 'library', label: t('goals.tab.library'), content: <LibraryTab contextId={ctx.id} /> },
              { id: 'settings', label: t('goals.tab.settings'), content: <GoalsSettingsPanel contextId={ctx.id} /> },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}
