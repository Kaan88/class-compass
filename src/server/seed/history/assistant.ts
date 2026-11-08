/**
 * Daily assistant history (module 'assistant'): each week's plan is made and usually announced on
 * Monday morning (sometimes two days are swapped), the assistant ticks their duties during the
 * lesson, and is thanked at the end of most lessons. Absent assistants are replaced by the module.
 */
import { announceAssistantPlan, generateAssistantPlan, getAssistantSettings, swapAssistants } from '../../../shared/contracts/assistant.ts';
import { announce, generate, getSettings, swap } from '../../modules/assistant/service.ts';
import type { HistoryGenerator } from './types.ts';

const KEY = 'assistant';

export const assistantGenerator: HistoryGenerator = {
  key: KEY,
  module: 'assistant',
  setup(h, plan) {
    // Opening the settings creates the default responsibilities (AST-6).
    h.call(getAssistantSettings, (ctx, i) => getSettings(ctx, i.contextId), plan.ctx, { contextId: plan.context.id });
  },
  startOfWeek(h, plan, week) {
    if (!week.days.some((d) => plan.lessonDates.includes(d))) return;
    h.setTime(h.at(week.days[0]!, '07:45'));
    const input = { contextId: plan.context.id, weekStart: week.weekStart };
    const p = h.call(generateAssistantPlan, generate, plan.ctx, input);
    h.count(KEY, 'weekly plans');
    if (h.chance(0.85)) {
      h.call(announceAssistantPlan, announce, plan.ctx, input);
      h.count(KEY, 'plans announced');
    }
    const later = p.days.map((d) => d.date).filter((d) => d > week.days[0]! && plan.lessonDates.includes(d));
    if (later.length >= 2 && h.chance(0.15)) {
      const [a, b] = h.shuffle(later);
      if (h.attempt(() => h.call(swapAssistants, swap, plan.ctx, { contextId: plan.context.id, dateA: a!, dateB: b! }))) h.count(KEY, 'swaps');
    }
  },
  duringLesson(h, lesson) {
    const today = lesson.state.assistant;
    if (!today?.assistant || !today.responsibilities.length) return;
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    const done = h.shuffle(today.responsibilities).slice(0, h.int(1, today.responsibilities.length));
    done.forEach((r, i) => {
      h.during(lesson, 0.82 + i * 0.03);
      h.command(lesson.plan.ctx, 'assistant.checkDuty', { ...ref, responsibilityId: r.id, checked: true });
      h.count(KEY, 'duty ticks');
    });
    // A tick by mistake, taken back.
    if (done.length && h.chance(0.05)) {
      h.command(lesson.plan.ctx, 'assistant.checkDuty', { ...ref, responsibilityId: done[0]!.id, checked: false });
      h.count(KEY, 'duty unticks');
    }
  },
  endSteps(h, lesson) {
    const thanked = Boolean(lesson.state.assistant?.assistant) && h.chance(0.8);
    if (thanked) h.count(KEY, 'thank-yous');
    return { assistantThanks: { thanked } };
  },
};
