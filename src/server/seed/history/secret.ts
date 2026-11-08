/**
 * Secret Students history (module 'secretStudents'): most lessons draw a round early (the module's
 * own fair draw), and End Lesson reveals it ('secret.reveal', as the End Lesson screen does) and
 * records the outcomes, sometimes with a note or a celebration. The generator only sees what the
 * reveal returns; it never reads the selections itself (D-064).
 */
import { SECRET_NOTES } from './text.ts';
import type { HistoryGenerator } from './types.ts';

const KEY = 'secretStudents';

interface RevealResult {
  selections: Array<{ selectionId: string }>;
}

export const secretGenerator: HistoryGenerator = {
  key: KEY,
  module: 'secretStudents',
  duringLesson(h, lesson) {
    if (!h.chance(0.85) || !h.present(lesson).length) return;
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    h.during(lesson, 0.06);
    h.command(lesson.plan.ctx, 'secret.draw', ref);
    h.count(KEY, 'rounds drawn');
    // A lesson that is never ended keeps its round sealed (closed as unrevealed, D-010).
    if (!lesson.ends) return;
    h.during(lesson, 0.97);
    const reveal = h.command(lesson.plan.ctx, 'secret.reveal', ref).result as RevealResult;
    lesson.scratch[KEY] = reveal.selections.map((s) => {
      const r = h.rand();
      const outcome = r < 0.6 ? 'goal_met' : r < 0.9 ? 'still_practising' : 'not_assessed';
      h.count(KEY, `outcome ${outcome}`);
      return { selectionId: s.selectionId, outcome, note: h.chance(0.25) ? h.pick(SECRET_NOTES) : null, celebration: outcome === 'goal_met' && h.chance(0.4) };
    });
  },
  endSteps(_h, lesson) {
    const outcomes = lesson.scratch[KEY];
    return outcomes ? { secretStudents: { outcomes } } : {};
  },
};
