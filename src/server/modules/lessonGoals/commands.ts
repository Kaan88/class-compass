/**
 * Lesson goals commands and lesson steps (S25d, D-188). The command names its lesson and is refused for
 * any other (LES-4); the steps run inside the 'lesson.start' / 'lesson.end' command transactions.
 */
import { LessonGoalCommands, LessonGoalEndInput, LessonGoalStartInput } from '../../../shared/contracts/lessonGoals.ts';
import { command } from '../../lib/commands.ts';
import { endLessonStep } from '../lessons/endSteps.ts';
import { startLessonStep } from '../lessons/startSteps.ts';
import { applyEndGoal, applyStartGoal, lessonHasGoal, setGoal } from './service.ts';

/** Listed in the manifest; registered once by installModules() (D-069). */
export const lessonGoalsCommands = [command({ type: 'lessonGoals.set', payload: LessonGoalCommands['lessonGoals.set'], handle: (ctx, p, meta) => setGoal(ctx, p, meta) })];

/** The goal typed on the start screen; a start that resumes a running lesson keeps the goal it has. */
export const lessonGoalStartStep = startLessonStep({ key: 'lessonGoal', module: 'lessonGoals', order: 85, input: LessonGoalStartInput, apply: (ctx, lesson, data, info) => applyStartGoal(ctx, lesson, data, info) });

/** Before the core reflection (100), after the module steps about students (40–70). Only with a goal. */
export const lessonGoalEndStep = endLessonStep({ key: 'lessonGoal', module: 'lessonGoals', order: 90, input: LessonGoalEndInput, when: lessonHasGoal, apply: applyEndGoal });
