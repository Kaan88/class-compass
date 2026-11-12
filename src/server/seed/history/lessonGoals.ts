/**
 * Lesson goals history (module 'lessonGoals', S28a, D-197). Lesson goals is opt-in per class+subject
 * (catalogue `contextDefault: 'off'`, D-188), so this generator first switches it on, through the
 * teacher's own endpoint, in a few demo class+subjects: 3-B and 4-C English (the English teacher) and
 * 3-A Mathematics (the class teacher). 3-A English stays as seed:demo left it, because the guide
 * screenshots and the e2e tests switch the module on and off there themselves.
 *
 * Where it is on, a little over half of the lessons get a goal at Start Lesson (start step
 * `lessonGoal`) and some more on the board during the lesson ('lessonGoals.set'), now and then
 * reworded. Most goals are answered at End Lesson (Yes, we did! / Partly / Not yet); some are left
 * unanswered, and an abandoned lesson's goal stays unanswered, so the report shows "not recorded" too.
 * Fictional text only.
 */
import { setContextModule as setContextModuleEp } from '../../../shared/contracts/school.ts';
import type { LessonGoalOutcome } from '../../../shared/lessonGoals.ts';
import { setContextModule } from '../../modules/school/service.ts';
import { LESSON_GOALS } from './text.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun } from './types.ts';

const KEY = 'lessonGoals';
/** The demo class+subjects (class name, lower-case English subject, teacher login) that use lesson goals. */
export const LESSON_GOAL_CONTEXTS: ReadonlyArray<{ cls: string; subject: string; teacher: string }> = [
  { cls: '3-B', subject: 'english', teacher: 'english' },
  { cls: '4-C', subject: 'english', teacher: 'english' },
  { cls: '3-A', subject: 'mathematics', teacher: 'classroom3a' },
];

const goalsOf = (plan: ContextPlan) => LESSON_GOALS[plan.subject] ?? LESSON_GOALS.english!;
/** The goal a lesson starts with, by class+subject, handed from `startInput` to `duringLesson`. */
const pending = (h: HistoryRun) => h.memo(`${KEY}:pending`, () => new Map<string, string>());

function outcome(h: HistoryRun): LessonGoalOutcome | null {
  const r = h.rand();
  return r < 0.12 ? null : r < 0.6 ? 'reached' : r < 0.86 ? 'partly' : 'notYet';
}

export const lessonGoalsGenerator: HistoryGenerator = {
  key: KEY,
  module: 'lessonGoals',
  setupSchool(h) {
    for (const plan of h.plans) {
      if (!LESSON_GOAL_CONTEXTS.some((c) => c.cls === plan.cls.name && c.subject === plan.subject && c.teacher === plan.teacher.login)) continue;
      h.call(setContextModuleEp, setContextModule, plan.ctx, { contextId: plan.context.id, module: 'lessonGoals', enabled: true });
      h.count(KEY, 'class+subjects switched on');
    }
  },
  startInput(h, plan) {
    pending(h).delete(plan.context.id);
    if (!h.chance(0.55)) return {};
    const text = h.pick(goalsOf(plan));
    pending(h).set(plan.context.id, text);
    return { steps: { lessonGoal: { text } } };
  },
  duringLesson(h, lesson) {
    const plan = lesson.plan;
    const ref = { contextId: plan.context.id, lessonId: lesson.lessonId };
    let goal = pending(h).get(plan.context.id) ?? null;
    pending(h).delete(plan.context.id);
    if (goal) h.count(KEY, 'goals set at the start');
    if (!goal && h.chance(0.25)) {
      // Set on the board a few minutes in ("Set a goal").
      h.during(lesson, 0.1);
      goal = h.pick(goalsOf(plan));
      h.command(plan.ctx, 'lessonGoals.set', { ...ref, text: goal });
      h.count(KEY, 'goals set on the board');
    } else if (goal && h.chance(0.06)) {
      // Reworded during the lesson.
      const other = goalsOf(plan).find((g) => g !== goal);
      if (other) {
        h.during(lesson, 0.45);
        goal = other;
        h.command(plan.ctx, 'lessonGoals.set', { ...ref, text: goal });
        h.count(KEY, 'goals changed');
      }
    }
    lesson.scratch[KEY] = goal;
  },
  endSteps(h, lesson) {
    if (!lesson.scratch[KEY]) return {};
    const o = outcome(h);
    h.count(KEY, o ? 'goals answered' : 'goals left unanswered');
    return o ? { lessonGoal: { outcome: o } } : {};
  },
};
