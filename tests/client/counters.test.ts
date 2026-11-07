/**
 * Client counter logic (CNT-5, CNT-10, CNT-11, D-004): the 700 ms double-tap guard and the
 * optimistic tap/undo/reset effects mirror the server rules.
 */
import { describe, expect, it } from 'vitest';
import { applyDelta, applyReset, createTapGuard, opensCrossing, tapToastText } from '../../src/client/modules/counters/countersClient.ts';
import { translate } from '../../src/shared/i18n/index.ts';
import type { CounterLessonState } from '../../src/shared/contracts/counters.ts';

describe('double-tap guard (CNT-5)', () => {
  it('ignores a second tap on the same student within 700 ms of the last recorded one, per student and counter', () => {
    let now = 1000;
    const g = createTapGuard(700, () => now);
    expect(g.accept('c1:ece')).toBe(true);
    now += 300;
    expect(g.accept('c1:ece')).toBe(false); // "Already counted – tap again to add another"
    expect(g.accept('c1:arda')).toBe(true); // another student is independent
    expect(g.accept('c2:ece')).toBe(true); // another counter is independent
    now += 450; // 750 ms after the recorded tap
    expect(g.accept('c1:ece')).toBe(true);
    now += 100;
    g.forget('c1:ece'); // undo clears the window
    expect(g.accept('c1:ece')).toBe(true);
  });
});

const base: CounterLessonState = {
  id: 'c1',
  kind: 'english_reminders',
  labels: { main: { en: 'Our English Time' }, supporting: {}, individual: {} },
  scope: 'both',
  barSegments: 3,
  colour: 'accent',
  resetPeriod: 'week',
  thresholds: [2, 4, 6],
  lessonTotal: 1,
  barValue: 1,
  reached: false,
  crossingSeq: null,
  crossingCount: 0,
  crossedAt: null,
  activeResponse: null,
  period: { from: '2026-11-09', to: '2026-11-15' },
  students: [
    { studentId: 'a', count: 1, level: 0 },
    { studentId: 'b', count: 0, level: 0 },
  ],
};

describe('optimistic counter updates (D-004)', () => {
  it('a tap raises the bar, the lesson total and the student count with its level; reaching the limit opens the next crossing', () => {
    const one = applyDelta(base, 'a', 1, 5000);
    expect(one).toMatchObject({ lessonTotal: 2, barValue: 2, reached: false });
    expect(one.students[0]).toEqual({ studentId: 'a', count: 2, level: 1 });
    const two = applyDelta(one, null, 1, 6000);
    expect(two).toMatchObject({ barValue: 3, reached: true, crossingSeq: 1, crossingCount: 1, crossedAt: 6000 });
    // CNT-10: keeps counting, same crossing.
    const three = applyDelta(two, 'b', 1, 7000);
    expect(three).toMatchObject({ barValue: 4, reached: true, crossingSeq: 1, crossedAt: 6000 });
    // Undo below the limit clears "reached"; the next crossing gets the next number.
    const down = applyDelta(applyDelta(three, 'b', -1), null, -1);
    expect(down).toMatchObject({ barValue: 2, reached: false, crossingSeq: null, crossingCount: 1 });
    expect(applyDelta(down, null, 1, 9000)).toMatchObject({ reached: true, crossingSeq: 2 });
  });

  it('a per-student counter has no bar; a class reset empties the bar but keeps totals', () => {
    const st = applyDelta({ ...base, scope: 'student', barValue: 0 }, 'a', 1);
    expect(st).toMatchObject({ barValue: 0, reached: false, lessonTotal: 2 });
    const full = applyReset({ ...base, barValue: 5, lessonTotal: 5, reached: true, crossingSeq: 1 });
    expect(full).toMatchObject({ barValue: 0, lessonTotal: 5, reached: false, crossingSeq: null });
  });
});

describe('undo toast after a tap (UX-9, CNT-9, D-059)', () => {
  const t = (key: Parameters<typeof translate>[1], vars: Record<string, string>) => translate('en', key, vars);
  it('names class and student normally, but not for the tap that fills the class bar while the overlay opens', () => {
    const args = { cls: '3-A · English', label: 'Turkish reminders', studentName: 'Ece Deniz Kaya' };
    expect(tapToastText(t, { ...args, crossed: false })).toBe('3-A · English: +1 Turkish reminders – Ece Deniz Kaya');
    const hidden = tapToastText(t, { ...args, crossed: true });
    expect(hidden).toBe('3-A · English: +1 Turkish reminders');
    expect(hidden).not.toContain('Ece');
    expect(translate('tr', 'counter.toast.addedHidden', { cls: '3-A · İngilizce', counter: 'Türkçe hatırlatma' })).not.toContain('{name}');
    expect(tapToastText(t, { ...args, studentName: null, crossed: true })).toBe('3-A · English: +1 Turkish reminders – whole class');
  });

  it('knows which tap opens a crossing: the one that brings the bar to the limit, not later ones (CNT-10)', () => {
    expect(opensCrossing({ ...base, barValue: 1 })).toBe(false);
    expect(opensCrossing({ ...base, barValue: 2 })).toBe(true);
    const reached = applyDelta({ ...base, barValue: 2 }, 'a', 1);
    expect(opensCrossing(reached)).toBe(false);
    expect(opensCrossing({ ...base, scope: 'student', barValue: 2 })).toBe(false);
  });
});
