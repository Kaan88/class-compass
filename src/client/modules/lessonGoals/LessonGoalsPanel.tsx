/**
 * Lesson goals on the classroom device (S25d, D-188), only in a class+subject where the teacher turned
 * the module on (it is off by default):
 * - Start Lesson step "Today's goal": one optional sentence (empty = no goal today);
 * - the board box, right after today's focus in its row (BOX_CATALOGUE `nextTo`, so the student grid
 *   loses no height): the goal for the class to read, with "Change"; without a goal only a quiet
 *   "Set a goal" action stays (like "Choose a topic");
 * - End Lesson step "Our goal" (only when the lesson has a goal): Did we reach our goal? Yes, we did! /
 *   Partly / Not yet, optional (words and icons, never colour alone).
 * Every change is the outbox command 'lessonGoals.set' naming the lesson (LES-4), applied on screen first.
 */
import { useState } from 'react';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import type { LessonGoalState } from '../../../shared/contracts/lessonGoals.ts';
import { LESSON_GOAL_OUTCOMES, MAX_LESSON_GOAL_LENGTH, type LessonGoalOutcome } from '../../../shared/lessonGoals.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { TextField } from '../../ui/Fields.tsx';
import { IconCheck, IconPencil, IconTarget, IconTrash, IconUp } from '../../ui/icons.tsx';
import { lessonKey, useLessonState, type LessonQueryData } from '../lessons/lessonClient.ts';
import { endStepUi, startStep, type ClassroomContext, type DashboardSlot, type DashboardSlotProps, type StartStepProps } from '../types.ts';

/** Listed in the manifest: a goal change refreshes the lesson state. */
export const lessonGoalInvalidation: CommandInvalidation = {
  prefix: 'lessonGoals.',
  keys: (op) => (op.contextId ? [lessonKey(op.contextId)] : [['classroom', 'lesson']]),
};

/**
 * The End Lesson steps once the lesson has (or no longer has) a goal: the server asks "Did we reach our
 * goal?" only for a lesson with a goal (`lessonHasGoal`), before the core reflection. Kept in step on
 * screen so a goal set on the board offline, or just before End lesson, gets its review (S25d review).
 */
export function endStepsWithGoal(endSteps: readonly string[], hasGoal: boolean): string[] {
  const rest = endSteps.filter((k) => k !== 'lessonGoal');
  if (!hasGoal) return rest;
  const at = rest.indexOf('reflection');
  return at < 0 ? [...rest, 'lessonGoal'] : [...rest.slice(0, at), 'lessonGoal', ...rest.slice(at)];
}

/** Show the new goal at once and queue the command before awaiting anything (D-045). */
function sendGoal(lesson: LessonState, text: string): void {
  const clean = text.trim();
  queryClient.setQueryData<LessonQueryData>(lessonKey(lesson.contextId), (q) =>
    q
      ? {
          etag: null,
          data: { ...q.data, lesson: q.data.lesson ? { ...q.data.lesson, endSteps: endStepsWithGoal(q.data.lesson.endSteps, Boolean(clean)) } : q.data.lesson, lessonGoal: { text: clean || null, outcome: null } },
        }
      : q,
  );
  getOutbox().enqueue('lessonGoals.set', { contextId: lesson.contextId, lessonId: lesson.id, text: clean }, { contextId: lesson.contextId, lessonId: lesson.id });
  void queryClient.cancelQueries({ queryKey: lessonKey(lesson.contextId) });
}

// ---------------------------------------------------------------- Start Lesson step
function GoalStartStep({ value, onChange }: StartStepProps<string>) {
  const { t } = useI18n();
  return (
    <div className="cc-stack" data-testid="lesson-goal-step">
      <TextField label={t('lessonGoals.field')} description={t('lessonGoals.fieldHint')} value={value} onChange={(v) => onChange(() => v)} maxLength={MAX_LESSON_GOAL_LENGTH} />
    </div>
  );
}

function useGoalContribution(_context: ClassroomContext, value: string, enabled: boolean) {
  const text = (value ?? '').trim();
  if (!enabled || !text) return { input: {}, ready: true };
  return { input: { steps: { lessonGoal: { text } } }, ready: true };
}

export const lessonGoalStartStep = startStep<string>({
  key: 'lessonGoal',
  module: 'lessonGoals',
  order: 85,
  title: 'lessonGoals.step',
  initial: () => '',
  Component: GoalStartStep,
  useContribution: useGoalContribution,
});

// ---------------------------------------------------------------- board box
function GoalDialog({ open, onOpenChange, lesson, current }: { open: boolean; onOpenChange: (v: boolean) => void; lesson: LessonState; current: string | null }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(current ?? '');
  const save = (text: string) => {
    sendGoal(lesson, text);
    onOpenChange(false);
  };
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange} title={t('lessonGoals.title')} testId="lesson-goal-dialog">
      <TextField label={t('lessonGoals.field')} description={t('lessonGoals.fieldHint')} value={draft} onChange={setDraft} maxLength={MAX_LESSON_GOAL_LENGTH} />
      <DialogActions>
        {current ? (
          <Button variant="danger-outline" onPress={() => save('')}>
            <IconTrash />
            {t('lessonGoals.remove')}
          </Button>
        ) : null}
        <Button onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onPress={() => save(draft)} isDisabled={!draft.trim() || draft.trim() === current}>
          <IconCheck />
          {t('lessonGoals.save')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function LessonGoalBox({ context, lesson }: DashboardSlotProps) {
  const { t } = useI18n();
  const goal: LessonGoalState | null = useLessonState(context.id).data?.data.lessonGoal ?? null;
  const [open, setOpen] = useState(false);
  if (!goal) return null;
  // The dialog is mounted only while open, so it starts from the goal shown now.
  const dialog = open ? <GoalDialog open onOpenChange={setOpen} lesson={lesson} current={goal.text} /> : null;
  if (!goal.text)
    return (
      <div className="cc-focus-empty" data-testid="lesson-goal-empty">
        <Button size="small" variant="ghost" onPress={() => setOpen(true)}>
          <IconTarget />
          {t('lessonGoals.set')}
        </Button>
        {dialog}
      </div>
    );
  // It shares the second row with today's focus and the counters (D-188 review): the heading runs inline
  // before the sentence, a longer sentence is set smaller, and Change is an icon with its name for
  // screen readers, so even the longest goal stays within the row and the student grid keeps its height.
  const length = goal.text.length > 90 ? 'long' : goal.text.length > 45 ? 'mid' : undefined;
  return (
    <section className="cc-lesson-goal" aria-labelledby="cc-goal-title" data-testid="lesson-goal" data-length={length}>
      <IconTarget />
      <div className="cc-lesson-goal__body">
        <h2 id="cc-goal-title" className="cc-lesson-goal__title">
          {t('lessonGoals.title')}
        </h2>
        <span className="cc-lesson-goal__text">{goal.text}</span>
      </div>
      <IconButton size="small" icon={<IconPencil />} label={t('lessonGoals.change')} hideLabel onPress={() => setOpen(true)} />
      {dialog}
    </section>
  );
}

export const lessonGoalDashboardSlot: DashboardSlot = { key: 'lessonGoal', module: 'lessonGoals', order: 8, dock: { Icon: IconTarget, label: 'lessonGoals.title' }, Component: LessonGoalBox };

// ---------------------------------------------------------------- End Lesson step
type ReviewValue = { outcome: LessonGoalOutcome | null };
const OUTCOME_ICON = { reached: IconCheck, partly: IconTarget, notYet: IconUp } as const;

function GoalReviewStep({ lesson, value, onChange }: { lesson: LessonState; value: ReviewValue; onChange: (v: ReviewValue) => void }) {
  const { t } = useI18n();
  const goal = useLessonState(lesson.contextId).data?.data.lessonGoal ?? null;
  return (
    <div className="cc-stack" data-testid="lesson-goal-review">
      {goal?.text ? (
        <p className="cc-lesson-goal-review__goal">
          <IconTarget />
          <span>{goal.text}</span>
        </p>
      ) : null}
      <p className="cc-h3" id="cc-goal-question">
        {t('lessonGoals.question')}
      </p>
      <div className="cc-reflect" role="radiogroup" aria-labelledby="cc-goal-question">
        {LESSON_GOAL_OUTCOMES.map((o) => {
          const Icon = OUTCOME_ICON[o];
          return (
            <button key={o} type="button" role="radio" aria-checked={value.outcome === o} className="cc-reflect__option" onClick={() => onChange({ outcome: value.outcome === o ? null : o })}>
              <Icon />
              <span>{t(`lessonGoals.outcome.${o}`)}</span>
            </button>
          );
        })}
      </div>
      <p className="cc-muted">{t('lessonGoals.questionHint')}</p>
    </div>
  );
}

export const lessonGoalEndStepUi = endStepUi<ReviewValue>({ key: 'lessonGoal', title: 'lessonGoals.review', initial: () => ({ outcome: null }), Component: GoalReviewStep });

// ---------------------------------------------------------------- Class settings (under the module switch)
export function LessonGoalsSettingsPanel() {
  const { t } = useI18n();
  return <p className="cc-muted">{t('lessonGoals.settingsHint')}</p>;
}
