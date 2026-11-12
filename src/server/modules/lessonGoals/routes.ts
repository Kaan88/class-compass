/**
 * Lesson goals in the polled lesson state (S25d, D-188): the running lesson's goal sentence and review,
 * only while the module is on for the class+subject. The module has no HTTP endpoints of its own: the
 * goal is written by the outbox command and the lesson steps, and read through the lesson state and
 * the reports. The "Lesson saved" summary gets the goal through `lessonGoalSummary` (S28a, D-197).
 */
import type { LessonStateContributor, LessonSummaryContributor } from '../lessons/service.ts';
import { isModuleEnabled } from '../school/modules.ts';
import { goalOf, goalStamp, goalState } from './service.ts';

export const lessonGoalLessonState: LessonStateContributor = {
  key: 'lessonGoal',
  stamp: (ctx, context, lesson) => (isModuleEnabled(ctx.db, context.id, 'lessonGoals') ? goalStamp(ctx.db, lesson) : 'off'),
  body: (ctx, context, lesson) => (lesson && isModuleEnabled(ctx.db, context.id, 'lessonGoals') ? goalState(ctx.db, lesson) : null),
};

/**
 * Today's goal and the class's answer on the "Lesson saved" summary (S28a, D-197): only for a lesson
 * that had a goal, and only while the module is on for the class+subject (switched off, the goal is
 * kept but not shown, CFG-2). An unanswered goal has `outcome: null` ("not answered" on screen).
 */
export const lessonGoalSummary: LessonSummaryContributor = {
  key: 'lessonGoal',
  build: (db, lesson) => {
    if (!isModuleEnabled(db, lesson.contextId, 'lessonGoals')) return null;
    const row = goalOf(db, lesson.id);
    return row ? { text: row.text, outcome: row.outcome ?? null } : null;
  },
};
