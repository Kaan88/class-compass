/**
 * Counter rules (CNT-2, CNT-6..11, D-003, D-004): week boundaries in the class timezone (property
 * tests), visual levels, lesson totals after voids/resets and the threshold crossing state machine.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossingTransition, historyCell, lessonCounts, levelFor, weekEndOf, weekStartOf, weekStartOfDate } from '../../src/domain/counters.ts';
import { addDays, localDate, weekdayOf } from '../../src/domain/dates.ts';
import { fillCounterText, isEnglishSubject, validThresholds } from '../../src/shared/counters.ts';

const H = 3600_000;
/** Europe/Istanbul has been UTC+3 all year since 2016: local midnight = 21:00 UTC the day before. */
const istanbulMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`) - 3 * H;

describe('week boundary (D-003, CNT-7)', () => {
  it('Sunday 23:59 belongs to the old week, Monday 00:00 Istanbul starts the new one', () => {
    const mondayMidnight = istanbulMidnight('2026-11-16');
    expect(weekStartOf(mondayMidnight - 60_000, 'Europe/Istanbul')).toBe('2026-11-09'); // Sun 15 Nov 23:59
    expect(weekStartOf(mondayMidnight - 1, 'Europe/Istanbul')).toBe('2026-11-09');
    expect(weekStartOf(mondayMidnight, 'Europe/Istanbul')).toBe('2026-11-16'); // Mon 16 Nov 00:00
    // UTC offset case: Sunday 21:30 UTC is already Monday 00:30 in Istanbul.
    expect(weekStartOf(Date.UTC(2026, 10, 15, 21, 30), 'Europe/Istanbul')).toBe('2026-11-16');
    expect(weekStartOf(Date.UTC(2026, 10, 15, 21, 30), 'UTC')).toBe('2026-11-09');
    // ... and Monday 01:00 UTC is still Monday in Istanbul, but Sunday evening in New York.
    expect(weekStartOf(Date.UTC(2026, 10, 16, 1, 0), 'America/New_York')).toBe('2026-11-09');
    expect(weekEndOf('2026-11-09')).toBe('2026-11-15');
  });

  it('property: the week of every Istanbul instant starts on the Monday at or before its local day', () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) }), (ms) => {
        const ws = weekStartOf(ms, 'Europe/Istanbul');
        const day = localDate(ms, 'Europe/Istanbul');
        expect(weekdayOf(ws)).toBe(1);
        expect(ws <= day).toBe(true);
        expect(addDays(ws, 6) >= day).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('property: one millisecond before local Monday 00:00 is the previous week, Monday 00:00 is the new week', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 52 * 15 }), (n) => {
        const monday = addDays('2020-01-06', n * 7); // a Monday
        const t = istanbulMidnight(monday);
        expect(weekStartOf(t, 'Europe/Istanbul')).toBe(monday);
        expect(weekStartOf(t - 1, 'Europe/Istanbul')).toBe(addDays(monday, -7));
        expect(weekStartOf(t + 7 * 24 * H - 1, 'Europe/Istanbul')).toBe(monday);
      }),
      { numRuns: 300 },
    );
  });

  it('property: week starts never go backwards in time, in any timezone (incl. DST changes)', () => {
    const zones = ['Europe/Istanbul', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'UTC'];
    fc.assert(
      fc.property(fc.constantFrom(...zones), fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) }), fc.integer({ min: 0, max: 30 * 24 * H }), (tz, a, d) => {
        const w1 = weekStartOf(a, tz);
        const w2 = weekStartOf(a + d, tz);
        expect(w1 <= w2).toBe(true);
        expect(weekdayOf(w1)).toBe(1);
      }),
      { numRuns: 500 },
    );
  });

  it('a configurable week start (e.g. Sunday) is respected', () => {
    expect(weekStartOfDate('2026-11-15', 0)).toBe('2026-11-15'); // Sunday
    expect(weekStartOfDate('2026-11-14', 0)).toBe('2026-11-08');
    expect(weekStartOfDate('2026-11-15', 1)).toBe('2026-11-09');
  });
});

describe('levels (CNT-6)', () => {
  it('maps the English default thresholds 2/4/6 to neutral, amber, deeper amber, red', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => levelFor(n, [2, 4, 6]))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(levelFor(50, [])).toBe(0);
    expect(levelFor(3, [3])).toBe(1);
  });
  it('validates thresholds', () => {
    expect(validThresholds([2, 4, 6])).toBe(true);
    expect(validThresholds([])).toBe(true);
    expect(validThresholds([4, 2])).toBe(false);
    expect(validThresholds([2, 2])).toBe(false);
    expect(validThresholds([0])).toBe(false);
    expect(validThresholds([1, 2, 3, 4])).toBe(false);
  });
});

describe('lesson bar and crossings (CNT-8, CNT-10, CNT-11, D-004)', () => {
  it('lesson total counts live events; the bar counts live events after the last reset', () => {
    const ev = [1, 2, 3, 4, 5].map((seq) => ({ seq, voided: seq === 2 }));
    expect(lessonCounts(ev, null)).toEqual({ lessonTotal: 4, barValue: 4 });
    expect(lessonCounts(ev, 3)).toEqual({ lessonTotal: 4, barValue: 2 });
  });

  it('opens a crossing on reaching the limit, clears it below, re-opens with the next sequence number', () => {
    expect(crossingTransition(9, 10, null, 0)).toEqual({ kind: 'none' });
    expect(crossingTransition(10, 10, null, 0)).toEqual({ kind: 'open', seq: 1 });
    expect(crossingTransition(12, 10, 1, 1)).toEqual({ kind: 'none' }); // CNT-10: counting on, no re-fire
    expect(crossingTransition(9, 10, 1, 1)).toEqual({ kind: 'clear' });
    expect(crossingTransition(10, 10, null, 1)).toEqual({ kind: 'open', seq: 2 });
  });

  it('property: replaying any tap/void sequence fires at most once per crossing and only on upward crossings', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.array(fc.boolean(), { maxLength: 60 }), (limit, ops) => {
        let bar = 0;
        let open: number | null = null;
        let last = 0;
        let fired = 0;
        let upward = 0;
        for (const isTap of ops) {
          const before = bar;
          bar = isTap ? bar + 1 : Math.max(0, bar - 1);
          if (before < limit && bar >= limit) upward += 1;
          const a = crossingTransition(bar, limit, open, last);
          if (a.kind === 'open') {
            fired += 1;
            open = a.seq;
            last = a.seq;
          } else if (a.kind === 'clear') open = null;
          expect(open !== null).toBe(bar >= limit);
        }
        expect(fired).toBe(upward);
        expect(last).toBe(fired);
      }),
    );
  });
});

describe('labels', () => {
  it('fills {count} and {limit}; detects the English subject in either language', () => {
    expect(fillCounterText('{count} / {limit} Turkish reminders', { count: 3, limit: 10 })).toBe('3 / 10 Turkish reminders');
    expect(isEnglishSubject({ en: 'English', tr: 'İngilizce' })).toBe(true);
    expect(isEnglishSubject({ tr: 'İngilizce' })).toBe(true);
    expect(isEnglishSubject({ en: 'Mathematics' })).toBe(false);
  });
});

describe('weekly history cells (RPT-5, CNT-7)', () => {
  it('tells a real zero apart from "not enrolled" and "not recorded" (no lesson that week)', () => {
    const week = { lessons: 2, counts: { a: 3 }, enrolled: ['a', 'b'] };
    expect(historyCell(week, 'a')).toEqual({ kind: 'count', value: 3 });
    expect(historyCell(week, 'b')).toEqual({ kind: 'count', value: 0 });
    expect(historyCell(week, 'c')).toEqual({ kind: 'not_enrolled' });
    const noLesson = { lessons: 0, counts: {}, enrolled: ['a', 'b'] };
    expect(historyCell(noLesson, 'a')).toEqual({ kind: 'not_recorded' });
    expect(historyCell(noLesson, 'c')).toEqual({ kind: 'not_enrolled' });
    // Taps that were recorded are always shown, even for a student who left the class that week.
    expect(historyCell({ lessons: 1, counts: { c: 1 }, enrolled: [] }, 'c')).toEqual({ kind: 'count', value: 1 });
  });
});
