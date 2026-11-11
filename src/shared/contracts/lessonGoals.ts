/**
 * Lesson goals (S25d, D-188): the optional goal sentence of a lesson in a class+subject where the
 * Lesson goals module is on (opt-in per class+subject, off by default). Set at Start Lesson (start step
 * `lessonGoal`) or on the classroom board ('lessonGoals.set', an outbox command naming the lesson),
 * reviewed at End Lesson (end step `lessonGoal`). The text is the teacher's and is shown to the class.
 */
import { z } from 'zod';
import { LESSON_GOAL_OUTCOMES, MAX_LESSON_GOAL_LENGTH } from '../lessonGoals.ts';
import { pii } from './define.ts';
import { Id } from './school.ts';

export const LessonGoalOutcome = z.enum(LESSON_GOAL_OUTCOMES);

/** The goal of the running lesson as every classroom device sees it (polled lesson state). */
export const LessonGoalState = z.object({
  /** The goal sentence; null = no goal set for this lesson (the board offers "Set a goal"). */
  text: z.string().nullable().meta(pii('teacherText')),
  /** Set by the End Lesson review only; null while the lesson runs. */
  outcome: LessonGoalOutcome.nullable(),
});
export type LessonGoalState = z.infer<typeof LessonGoalState>;

const GoalText = z.string().trim().max(MAX_LESSON_GOAL_LENGTH);

export const LessonGoalCommands = {
  /** Set, change or (with an empty text) clear the running lesson's goal. Classroom-safe. */
  'lessonGoals.set': z.object({ contextId: Id, lessonId: Id, text: GoalText }),
} as const;
export type LessonGoalCommandType = keyof typeof LessonGoalCommands;
export type LessonGoalCommandPayload<T extends LessonGoalCommandType> = z.input<(typeof LessonGoalCommands)[T]>;

/** Start Lesson step `lessonGoal` (`lesson.start` `steps.lessonGoal`): sent only when a goal was typed. */
export const LessonGoalStartInput = z.object({ text: GoalText.min(1) });

/** End Lesson step `lessonGoal`: did we reach it? null = not reviewed (the teacher skipped it). */
export const LessonGoalEndInput = z.object({ outcome: LessonGoalOutcome.nullable().default(null) });
