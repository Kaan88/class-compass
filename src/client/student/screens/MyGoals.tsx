/**
 * "My goals" (S14d, D-151; GOL-2..5): each goal with its category, words, practice ideas, review date,
 * the teacher's outcome and what was written about it, then the teacher's feedback (read-only).
 * A student changes only what they wrote: "I did it!", "Delete goal" and deleting their own words ask
 * first in the page (`InlineConfirmButton`, never `window.confirm`). Hidden items never arrive here.
 */
import * as G from '../../../shared/contracts/goals.ts';
import type { StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { EntryLine, FeedbackLine, GoalSummary } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconCheck, IconFace, IconPlus, IconTrash } from '../../ui/icons.tsx';
import { InlineConfirmButton } from '../../ui/InlineConfirm.tsx';
import { useStudentRun } from '../common.tsx';
import type { ScreenProps } from '../sections.tsx';

export function MyGoals({ data, subjectId, go }: ScreenProps<StudentGoalsSection>) {
  const { t } = useI18n();
  const run = useStudentRun();
  const confirm = { message: t('student.confirm.delete'), confirmLabel: t('student.confirm.yes'), cancelLabel: t('student.confirm.no') };
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
      <ul className="cc-stack">
        {data.goals.map((g) => {
          const mine = data.canWrite && g.authorType === 'student';
          return (
            <li key={g.id} className="cc-card cc-stack cc-goal" data-testid="student-goal">
              <GoalSummary goal={g} outcomes={data.outcomes} />
              {g.entries.length ? (
                <ul className="cc-stack" aria-label={t('student.goals.written')}>
                  {g.entries.map((e) => (
                    <EntryLine
                      key={e.id}
                      entry={e}
                      actions={
                        data.canWrite && e.authorType === 'student' ? (
                          <InlineConfirmButton size="small" variant="ghost" {...confirm} onConfirm={() => void run(() => call(G.studentDeleteEntry, { entryId: e.id }), t('student.toast.deleted'))}>
                            <IconTrash />
                            {t('student.delete')}
                          </InlineConfirmButton>
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
