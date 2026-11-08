/**
 * Grouping history (module 'grouping'): subject levels for most children, one "keep apart" pair
 * rule in bigger classes, the four default options, and groups used in a good share of lessons
 * (sometimes shuffled, a child moved, then taken off the display).
 */
import { createPairRule, getGrouping } from '../../../shared/contracts/grouping.ts';
import { setContextLevels as setContextLevelsEp } from '../../../shared/contracts/students.ts';
import { createRule, groupingLessonState, overview } from '../../modules/grouping/service.ts';
import { getActiveLesson } from '../../modules/lessons/service.ts';
import { setContextLevels } from '../../modules/students/service.ts';
import { LEVELS } from './text.ts';
import type { HistoryGenerator } from './types.ts';

const KEY = 'grouping';

export const groupingGenerator: HistoryGenerator = {
  key: KEY,
  module: 'grouping',
  setup(h, plan) {
    const ctx = plan.ctx;
    const contextId = plan.context.id;
    if (plan.students.length) {
      const levels = plan.students.map((s) => ({ studentId: s.id, level: h.chance(0.1) ? null : h.pick(LEVELS) }));
      h.call(setContextLevelsEp, setContextLevels, ctx, { contextId, levels });
      h.count(KEY, 'levels set', levels.filter((l) => l.level).length);
    }
    if (plan.students.length >= 10) {
      const [a, b] = h.shuffle(plan.students);
      h.call(createPairRule, createRule, ctx, { contextId, studentA: a!.id, studentB: b!.id, kind: 'apart', note: 'Chat a lot when together.' });
      h.count(KEY, 'pair rules');
    }
    // Opening the grouping page creates the default options (GRP-1).
    const o = h.call(getGrouping, (c, i) => overview(c, i.contextId, false), ctx, { contextId });
    h.memo(`${KEY}:templates`, () => new Map<string, string[]>()).set(
      contextId,
      o.templates.filter((t) => !t.archived).map((t) => t.id),
    );
    h.count(KEY, 'options', o.templates.length);
  },
  duringLesson(h, lesson) {
    const templates = h.memo(`${KEY}:templates`, () => new Map<string, string[]>()).get(lesson.plan.context.id) ?? [];
    if (!templates.length || h.present(lesson).length < 2 || !h.chance(0.45)) return;
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    const ctx = lesson.plan.ctx;
    h.during(lesson, 0.35);
    h.command(ctx, 'grouping.apply', { ...ref, templateId: h.pick(templates) });
    h.count(KEY, 'groupings used');
    if (h.chance(0.25)) {
      h.during(lesson, 0.37);
      h.command(ctx, 'grouping.shuffle', ref);
      h.count(KEY, 'shuffles');
    }
    if (h.chance(0.2)) {
      const live = groupingLessonState(h.deps.db, getActiveLesson(h.deps.db, lesson.plan.context.id)!);
      const from = live.groups.find((g) => g.members.length > 1);
      const to = live.groups.find((g) => g !== from);
      if (from && to) {
        h.during(lesson, 0.39);
        h.command(ctx, 'grouping.move', { ...ref, studentId: from.members[0]!.id, toGroupId: to.id });
        h.count(KEY, 'moves');
      }
    }
    if (h.chance(0.7)) {
      h.during(lesson, 0.75);
      h.command(ctx, 'grouping.clear', ref);
    }
  },
};
