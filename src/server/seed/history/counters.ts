/**
 * Counters history (module 'counters'): the English reminder preset (created on first use, CNT-1)
 * plus one custom counter per other subject and a class "team points" counter in the biggest class.
 * Taps follow each child's fictional habits and fall slowly over the weeks; a few taps are undone,
 * and a full team bar with the "start again" response is reset.
 */
import { createCounter as createCounterEp } from '../../../shared/contracts/counters.ts';
import { createCounter, ensureDefaultCounters } from '../../modules/counters/service.ts';
import type { HistoryGenerator, HistoryRun, LessonRun } from './types.ts';

const KEY = 'counters';

/** How often a child gets a reminder: a few often, most sometimes, some hardly ever. */
function weightOf(h: HistoryRun, studentId: string): number {
  const weights = h.memo(`${KEY}:weights`, () => new Map<string, number>());
  let w = weights.get(studentId);
  if (w === undefined) {
    const r = h.rand();
    w = r < 0.15 ? 4 : r < 0.65 ? 1 : 0.25;
    weights.set(studentId, w);
  }
  return w;
}

function weightedPick(h: HistoryRun, ids: readonly string[]): string {
  const total = ids.reduce((s, id) => s + weightOf(h, id), 0);
  let r = h.rand() * total;
  for (const id of ids) {
    r -= weightOf(h, id);
    if (r <= 0) return id;
  }
  return ids[ids.length - 1]!;
}

function tapTimes(h: HistoryRun, n: number): number[] {
  return Array.from({ length: n }, () => 0.25 + h.rand() * 0.7).sort((a, b) => a - b);
}

export const countersGenerator: HistoryGenerator = {
  key: KEY,
  module: 'counters',
  setup(h, plan) {
    const ctx = plan.ctx;
    const contextId = plan.context.id;
    if (plan.subject === 'english') {
      ensureDefaultCounters(ctx, plan.context, plan.cls);
      if (plan.students.length >= 30) {
        h.call(createCounterEp, createCounter, ctx, {
          contextId,
          name: { en: 'Team points', tr: 'Takım puanı' },
          scope: 'lesson',
          barSegments: 8,
          colour: 'leaf',
          responses: [{ id: 'team-again', label: { en: 'Start again', tr: 'Yeniden başla' }, message: { en: 'Super team! Let us fill it again.', tr: 'Süper takım! Yeniden dolduralım.' }, mascot: true, kind: 'class_reset' }],
          activeResponseId: 'team-again',
        });
        h.count(KEY, 'custom counters');
      }
    } else if (plan.subject === 'mathematics') {
      h.call(createCounterEp, createCounter, ctx, {
        contextId,
        name: { en: 'Calling out', tr: 'Söz almadan konuşma' },
        scope: 'both',
        barSegments: 8,
        colour: 'teal',
        thresholds: [2, 4, 6],
        responses: [{ id: 'quiet-minute', label: { en: 'Quiet minute', tr: 'Sessiz dakika' }, message: { en: 'Let us take a quiet minute.', tr: 'Bir dakika sessiz olalım.' }, mascot: true, kind: 'message' }],
        activeResponseId: 'quiet-minute',
      });
      h.count(KEY, 'custom counters');
    } else {
      h.call(createCounterEp, createCounter, ctx, {
        contextId,
        name: { en: 'Safety reminders', tr: 'Güvenlik hatırlatmaları' },
        scope: 'student',
        resetPeriod: 'term',
        colour: 'rust',
        thresholds: [2, 4],
      });
      h.count(KEY, 'custom counters');
    }
  },
  duringLesson(h, lesson: LessonRun) {
    const list = lesson.state.counters?.counters ?? [];
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    const here = h.present(lesson);
    // Reminders get fewer over the weeks (the class is learning the routine).
    const trend = Math.max(0.35, 1 - lesson.week.index * 0.07);
    for (const c of list) {
      if (c.scope === 'lesson') {
        const n = h.int(2, 12);
        for (const f of tapTimes(h, n)) {
          h.during(lesson, f);
          const r = h.command(lesson.plan.ctx, 'counter.tap', { ...ref, counterId: c.id });
          h.count(KEY, 'class taps');
          if (r.result?.reached && c.activeResponse?.kind === 'class_reset') {
            h.command(lesson.plan.ctx, 'counter.resetLessonBar', { ...ref, counterId: c.id });
            h.count(KEY, 'bar resets');
          }
        }
        continue;
      }
      if (!here.length) continue;
      const base = c.kind === 'english_reminders' ? 7 : 3;
      const n = h.chance(0.12) ? 0 : Math.round(h.rand() * 2 * base * trend);
      for (const f of tapTimes(h, n)) {
        h.during(lesson, f);
        const r = h.command(lesson.plan.ctx, 'counter.tap', { ...ref, counterId: c.id, studentId: weightedPick(h, here) });
        h.count(KEY, 'student taps');
        // A mistaken tap is undone straight away (CNT-4: the event is voided, not deleted).
        if (h.chance(0.05)) {
          h.command(lesson.plan.ctx, 'counter.void', { ...ref, eventId: r.result.eventId });
          h.count(KEY, 'taps undone');
        }
      }
    }
  },
};
