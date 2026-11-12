/**
 * "My goals" (S14d, D-151; GOL-2..5): each goal with its category, words, practice ideas, review date,
 * the teacher's outcome and what was written about it, then the teacher's feedback (read-only).
 * A student changes only what they wrote: "I did it!", "Delete goal" and deleting their own words ask
 * first in the page (`InlineConfirmButton`, never `window.confirm`). Hidden items never arrive here.
 * S22b (D-176): "Change my words" on their own goal and on what they wrote about a goal opens the
 * editor in place (lazy-loaded, with the sentence starters); the focus comes back to the button after.
 * S27b (D-194): "Add my work" on each goal the child can still work on opens the shared `EvidenceAdder`
 * (the same choices and media flags as "Show my work") for that goal, as steps in the page address
 * (`goal` + `step` 2 how, 3 the work; Back works). After Save the child is back at the goal: the
 * focus returns to its "Add my work" button, a calm note says the work is there, and the goal lists
 * its work (with the child's own delete, as on "Show my work"; deleting work there clears the note).
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import * as G from '../../../shared/contracts/goals.ts';
import type { GoalEntry, StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { call, upload } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { EvidenceAdder } from '../../modules/goals/EvidenceAdder.tsx';
import { EntryLine, EvidenceView, FeedbackLine, GoalSummary, goalText } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconCheck, IconFace, IconPencil, IconPlus, IconTrash, IconUpload } from '../../ui/icons.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { startersOf, useSaveCheck, useStudentRun } from '../common.tsx';
import { SentenceStarters } from '../SentenceStarters.tsx';
import type { ScreenProps } from '../sections.tsx';

/** The editor is loaded only when a child opens it (student page size budget, D-151). */
const EditWords = lazy(() => import('./EditWords.tsx'));

/** What a student wrote about a goal: its text check and its sentence starters (as when it was written). */
const ENTRY_KINDS = { reflection: 'reflection', note: 'note', self_assessment: 'selfAssessment', progress: 'note' } as const satisfies Record<GoalEntry['kind'], string>;

/** The first step of "Add my work" in the page address (step 1 is the goal list). */
export const ADD_WORK_FIRST_STEP = 2;

export function MyGoals({ data, subjectId, media, nav, go, finish }: ScreenProps<StudentGoalsSection>) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const check = useSaveCheck(data);
  /** The goal the child is adding work to (from the page address), while it can still take work. */
  const addingTo = data.canWrite && nav.goal && nav.step >= ADD_WORK_FIRST_STEP ? data.goals.find((g) => g.id === nav.goal && g.status !== 'archived') : undefined;
  /** The goal that has just been given work (a calm note there until the child leaves the screen). */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // A step address for a goal that is gone (deleted, archived, a stale bookmark): back to the list.
  const stale = nav.goal !== null && nav.step >= ADD_WORK_FIRST_STEP && !addingTo;
  useEffect(() => {
    if (stale) go({ screen: 'goals', subject: subjectId }, { replace: true });
  }, [stale, go, subjectId]);
  // Back at the list after a save: the focus goes to that goal's "Add my work" (after the page has
  // put it on the screen's title), so the child sees the goal with its new work.
  useEffect(() => {
    if (addingTo || !justAdded) return;
    const frame = requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-add-work-for="${justAdded}"]`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [addingTo, justAdded]);
  const confirm = { message: t('student.confirm.delete'), confirmLabel: t('student.confirm.yes'), cancelLabel: t('student.confirm.no') };
  /** The goal or entry whose words are being changed. */
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const stopEditing = (id: string) => {
    setEditing(null);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-edit-for="${id}"]`)?.focus());
  };
  const editButton = (id: string) => (
    <Button variant="ghost" data-edit-for={id} onPress={() => setEditing(id)}>
      <IconPencil />
      {t('student.edit.change')}
    </Button>
  );
  const saved = async (id: string, send: () => Promise<unknown>) => {
    const r = await run(send, t('student.toast.changed'));
    if (r) stopEditing(id);
    return Boolean(r);
  };
  if (addingTo) {
    const label = goalText(addingTo, locale);
    return (
      <div className="cc-stack" data-testid="student-goal-add-work">
        <EvidenceAdder
          layout="steps"
          step={nav.step - 1}
          onStep={(n, replace) => go({ screen: 'goals', subject: subjectId, goal: addingTo.id, step: n + 1 }, { replace })}
          onDone={() => {
            setJustAdded(addingTo.id);
            finish({ screen: 'goals', subject: subjectId });
          }}
          idPrefix={`goal-work-${addingTo.id}`}
          goals={[]}
          fixedGoal={{ id: addingTo.id, label }}
          media={media}
          upload={(kind, file, name) => upload(G.studentUploadFile, { kind }, file, name)}
          add={(input) => call(G.studentAddEvidence, { subjectId, ...input })}
          run={(fn, success) => run(fn, success)}
          check={check}
          starters={({ kind, value, onChange, target }) => (
            <SentenceStarters starters={startersOf(data, kind, locale, addingTo.category.id)} value={value} onChange={onChange} target={target} />
          )}
        />
      </div>
    );
  }
  return (
    <div className="cc-stack" data-testid="student-goals">
      {!data.canWrite ? <p className="cc-card cc-muted">{t('student.readOnly')}</p> : null}
      {data.goals.length === 0 ? (
        <div className="cc-card cc-stack">
          <p>{t('student.goals.none')}</p>
          {data.canWrite ? (
            <div>
              <Button variant="primary" size="big" onPress={() => go({ screen: 'newGoal', subject: subjectId })}>
                <IconPlus />
                {t('student.tile.newGoal')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="cc-stack" ref={list}>
        {data.goals.map((g) => {
          const mine = data.canWrite && g.authorType === 'student';
          const canEditGoal = mine && g.status !== 'archived';
          const work = data.evidence.filter((e) => e.goalId === g.id);
          return (
            <li key={g.id} className="cc-card cc-stack cc-goal" data-testid="student-goal">
              <GoalSummary goal={g} outcomes={data.outcomes} />
              {editing === g.id ? (
                <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
                  <EditWords
                    data={data}
                    initial={goalText(g, locale)}
                    label={t('student.myGoalWords')}
                    textKind="goal"
                    starterKind="goal"
                    categoryId={g.category.id}
                    maxLength={500}
                    onSave={(text) => saved(g.id, () => call(G.studentUpdateGoal, { goalId: g.id, text }))}
                    onCancel={() => stopEditing(g.id)}
                  />
                </Suspense>
              ) : null}
              {g.entries.length ? (
                <ul className="cc-stack" aria-label={t('student.goals.written')}>
                  {g.entries.map((e) => (
                    <EntryLine
                      key={e.id}
                      entry={e}
                      actions={
                        data.canWrite && e.authorType === 'student' ? (
                          editing === e.id ? (
                            <Suspense fallback={<p className="cc-muted">{t('common.loading')}</p>}>
                              <EditWords
                                data={data}
                                initial={e.body}
                                label={t('student.reflectionWords')}
                                textKind={ENTRY_KINDS[e.kind]}
                                starterKind={ENTRY_KINDS[e.kind]}
                                categoryId={g.category.id}
                                maxLength={2000}
                                onSave={(body) => saved(e.id, () => call(G.studentUpdateEntry, { entryId: e.id, body }))}
                                onCancel={() => stopEditing(e.id)}
                              />
                            </Suspense>
                          ) : (
                            <div className="cc-row">
                              {editButton(e.id)}
                              <InlineConfirmButton size="small" variant="ghost" {...confirm} onConfirm={() => void run(() => call(G.studentDeleteEntry, { entryId: e.id }), t('student.toast.deleted'))}>
                                <IconTrash />
                                {t('student.delete')}
                              </InlineConfirmButton>
                            </div>
                          )
                        ) : null
                      }
                    />
                  ))}
                </ul>
              ) : null}
              {work.length ? (
                <ul className="cc-stack" aria-label={t('student.goals.work')} data-testid="student-goal-work">
                  {work.map((e) => (
                    <EvidenceView
                      key={e.id}
                      item={e}
                      fileUrl={G.studentFileUrl}
                      actions={
                        data.canWrite && e.authorType === 'student' ? (
                          <div>
                            <InlineConfirmButton size="small" variant="ghost" {...confirm} onConfirm={() => {
                                // The "saved with this goal" note would contradict the deleted work.
                                if (justAdded === g.id) setJustAdded(null);
                                void run(() => call(G.studentDeleteEvidence, { evidenceId: e.id }), t('student.toast.deleted'));
                              }}
                            >
                              <IconTrash />
                              {t('student.delete')}
                            </InlineConfirmButton>
                          </div>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              ) : null}
              {justAdded === g.id ? <Alert kind="success">{t('student.goals.workAdded')}</Alert> : null}
              {data.canWrite ? (
                <div className="cc-row">
                  {g.status !== 'archived' ? (
                    <Button variant="primary" onPress={() => go({ screen: 'howIsItGoing', subject: subjectId, goal: g.id, step: 2 })}>
                      <IconFace level={4} />
                      {t('student.goals.tell')}
                    </Button>
                  ) : null}
                  {g.status !== 'archived' ? (
                    <Button
                      data-add-work-for={g.id}
                      aria-label={t('student.goals.addWorkFor', { goal: goalText(g, locale) })}
                      onPress={() => {
                        setJustAdded(null);
                        go({ screen: 'goals', subject: subjectId, goal: g.id, step: ADD_WORK_FIRST_STEP });
                      }}
                    >
                      <IconUpload />
                      {t('student.goals.addWork')}
                    </Button>
                  ) : null}
                  {canEditGoal && editing !== g.id ? editButton(g.id) : null}
                  {mine && g.status === 'active' ? (
                    <Button onPress={() => void run(() => call(G.studentUpdateGoal, { goalId: g.id, status: 'achieved' }), t('student.toast.achieved'))}>
                      <IconCheck />
                      {t('student.markAchieved')}
                    </Button>
                  ) : null}
                  {mine ? (
                    <InlineConfirmButton variant="ghost" {...confirm} onConfirm={() => void run(() => call(G.studentDeleteGoal, { goalId: g.id }), t('student.toast.deleted'))}>
                      <IconTrash />
                      {t('student.deleteGoal')}
                    </InlineConfirmButton>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <section className="cc-stack" aria-labelledby={`feedback-${subjectId}`}>
        <h2 id={`feedback-${subjectId}`} className="cc-h2">
          {t('student.goals.fromTeacher')}
        </h2>
        {data.feedback.length === 0 ? <p className="cc-muted">{t('student.noFeedback')}</p> : null}
        <ul className="cc-stack" data-testid="student-feedback">
          {data.feedback.map((f) => (
            <FeedbackLine key={f.id} item={f} />
          ))}
        </ul>
      </section>
    </div>
  );
}
