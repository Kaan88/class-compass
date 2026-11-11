/**
 * "My goals" (S14d, D-151; GOL-2..5): each goal with its category, words, practice ideas, review date,
 * the teacher's outcome and what was written about it, then the teacher's feedback (read-only).
 * A student changes only what they wrote: "I did it!", "Delete goal" and deleting their own words ask
 * first in the page (`InlineConfirmButton`, never `window.confirm`). Hidden items never arrive here.
 * S22b (D-176): "Change my words" on their own goal and on what they wrote about a goal opens the
 * editor in place (lazy-loaded, with the sentence starters); the focus comes back to the button after.
 */
import { lazy, Suspense, useRef, useState } from 'react';
import * as G from '../../../shared/contracts/goals.ts';
import type { GoalEntry, StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { EntryLine, FeedbackLine, GoalSummary, goalText } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconCheck, IconFace, IconPencil, IconPlus, IconTrash } from '../../ui/icons.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { useStudentRun } from '../common.tsx';
import type { ScreenProps } from '../sections.tsx';

/** The editor is loaded only when a child opens it (student page size budget, D-151). */
const EditWords = lazy(() => import('./EditWords.tsx'));

/** What a student wrote about a goal: its text check and its sentence starters (as when it was written). */
const ENTRY_KINDS = { reflection: 'reflection', note: 'note', self_assessment: 'selfAssessment', progress: 'note' } as const satisfies Record<GoalEntry['kind'], string>;

export function MyGoals({ data, subjectId, go }: ScreenProps<StudentGoalsSection>) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
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
              {data.canWrite ? (
                <div className="cc-row">
                  {g.status !== 'archived' ? (
                    <Button variant="primary" onPress={() => go({ screen: 'howIsItGoing', subject: subjectId, goal: g.id, step: 2 })}>
                      <IconFace level={4} />
                      {t('student.goals.tell')}
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
