/**
 * Lesson goals in the polled lesson state (S25d, D-188): the running lesson's goal sentence and review,
 * only while the module is on for the class+subject. The module has no HTTP endpoints of its own: the
 * goal is written by the outbox command and the lesson steps, and read through the lesson state and
 * the reports.
 */
import type { LessonStateContributor } from '../lessons/service.ts';
import { isModuleEnabled } from '../school/modules.ts';
import { goalStamp, goalState } from './service.ts';

export const lessonGoalLessonState: LessonStateContributor = {
  key: 'lessonGoal',
  stamp: (ctx, context, lesson) => (isModuleEnabled(ctx.db, context.id, 'lessonGoals') ? goalStamp(ctx.db, lesson) : 'off'),
  body: (ctx, context, lesson) => (lesson && isModuleEnabled(ctx.db, context.id, 'lessonGoals') ? goalState(ctx.db, lesson) : null),
};
