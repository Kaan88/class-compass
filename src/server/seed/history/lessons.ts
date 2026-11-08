/**
 * Core lesson history (module null, always on): subject skill categories for topics, the weekly
 * topic plan, the lesson timer, topic changes and the End Lesson reflection. The lesson itself is
 * started and ended by the run (`seed/history.ts`) through 'lesson.start' / 'lesson.end'.
 */
import { createCategory as createCategoryEp } from '../../../shared/contracts/goals.ts';
import { setTopicPlan } from '../../../shared/contracts/lessons.ts';
import type { TopicPlan } from '../../../shared/contracts/lessons.ts';
import { createCategory } from '../../modules/goals/teacher.ts';
import { setPlan, topicChoices } from '../../modules/lessons/topics.ts';
import { LESSON_NOTES, SUBJECT_CATEGORIES } from './text.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun } from './types.ts';

const KEY = 'lessons';
/** The school-wide default skill categories have fixed ids with this prefix (goals/library.ts). */
const DEFAULT_ID_PREFIX = '00000000-0000-7000-8000-';

/** Topic ids that fit the subject: the default English skills, or the subject's own categories. */
function subjectTopics(h: HistoryRun, plan: ContextPlan): string[] {
  const own = new Set((SUBJECT_CATEGORIES[plan.subject] ?? []).map((c) => c.name.en));
  const all = topicChoices(h.deps.db, plan.context);
  return (plan.subject === 'english' ? all.filter((t) => t.id.startsWith(DEFAULT_ID_PREFIX)) : all.filter((t) => own.has(t.name.en ?? ''))).map((t) => t.id);
}

export const lessonsGenerator: HistoryGenerator = {
  key: KEY,
  module: null,
  setup(h, plan) {
    // A subject without its own skill categories gets a few (once per teacher and subject), so its
    // lessons can show a topic and its goals a category.
    const done = h.memo(`${KEY}:categories`, () => new Set<string>());
    const cats = SUBJECT_CATEGORIES[plan.subject];
    const key = `${plan.teacher.id}:${plan.context.subjectId}`;
    if (cats && !done.has(key)) {
      done.add(key);
      for (const c of cats) h.call(createCategoryEp, createCategory, plan.ctx, { contextId: plan.context.id, name: c.name, icon: c.icon });
      h.count(KEY, 'skill categories', cats.length);
    }
    const topics = subjectTopics(h, plan);
    h.memo(`${KEY}:topics`, () => new Map<string, string[]>()).set(plan.context.id, topics);
    if (!topics.length) return;
    const weekly: TopicPlan = {};
    for (const day of plan.timetable.keys()) weekly[String(day) as keyof TopicPlan] = h.chance(0.2) ? h.shuffle(topics).slice(0, 2) : [h.pick(topics)];
    h.call(setTopicPlan, (ctx, i) => setPlan(ctx, i.contextId, i.plan), plan.ctx, { contextId: plan.context.id, plan: weekly });
    h.count(KEY, 'weekly topic plans');
  },
  startInput(h, plan) {
    // Most lessons take the weekly plan's topic; sometimes the teacher picks another one at the start.
    const topics = h.memo(`${KEY}:topics`, () => new Map<string, string[]>()).get(plan.context.id) ?? [];
    if (topics.length && h.chance(0.15)) return { topicIds: [h.pick(topics)] };
    return {};
  },
  duringLesson(h, lesson) {
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    const ctx = lesson.plan.ctx;
    if (h.chance(0.6)) {
      h.during(lesson, 0.3);
      h.command(ctx, 'lesson.timer.set', { ...ref, durationMs: h.int(3, 10) * 60_000 });
      h.command(ctx, 'lesson.timer.start', ref);
      if (h.chance(0.25)) {
        h.during(lesson, 0.4);
        h.command(ctx, 'lesson.timer.pause', ref);
      }
      h.count(KEY, 'timer runs');
    }
    const topics = h.memo(`${KEY}:topics`, () => new Map<string, string[]>()).get(lesson.plan.context.id) ?? [];
    const current = lesson.state.lesson?.topics.map((t) => t.id) ?? [];
    if (topics.length > 1 && h.chance(0.08)) {
      h.during(lesson, 0.5);
      const extra = topics.find((t) => !current.includes(t));
      if (extra) {
        h.command(ctx, 'lesson.setTopics', { ...ref, topicIds: [...current, extra].slice(0, 3) });
        h.count(KEY, 'topic changes');
      }
    }
  },
  endSteps(h) {
    const r = h.rand();
    const rating = r < 0.12 ? null : r < 0.2 ? 2 : r < 0.25 ? 1 : r < 0.6 ? 3 : 4;
    const note = h.chance(0.3) ? h.pick(LESSON_NOTES) : null;
    h.count(KEY, 'reflections', rating !== null || note ? 1 : 0);
    return { reflection: { rating, note } };
  },
};
