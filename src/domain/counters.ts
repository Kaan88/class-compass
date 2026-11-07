/**
 * Counter rules (CNT-2, CNT-6..11, D-003, D-004, D-057). Pure functions, no I/O.
 *
 * - Week boundary: the week containing an instant starts on `weekStartsOn` (default 1 = Monday) at
 *   00:00 in the class timezone; it is computed when the event is written and stored with it.
 * - Lesson total = live (non-voided) events of that lesson. The class bar shows the live events
 *   after the last class reset marker of the lesson (equal to the lesson total when never reset).
 * - Threshold state is derived from the bar value: reached when bar >= limit. Each time the bar goes
 *   from below to at/above the limit a new crossing opens (crossingSeq + 1) and the response fires
 *   once; dropping below (void) or a class reset clears the open crossing. Individual counts keep
 *   counting beyond the bar (CNT-10).
 */
import { addDays, localDate, weekdayOf } from './dates.ts';

/** First local day ('YYYY-MM-DD') of the week containing instant `ms` in timezone `tz`. */
export function weekStartOf(ms: number, tz: string, weekStartsOn = 1): string {
  return weekStartOfDate(localDate(ms, tz), weekStartsOn);
}

/** First day of the week containing local date `date`. */
export function weekStartOfDate(date: string, weekStartsOn = 1): string {
  const diff = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

/** Last local day of the week starting on `weekStart` (inclusive). */
export const weekEndOf = (weekStart: string) => addDays(weekStart, 6);

/**
 * Visual level of an individual count for ascending thresholds (`[2, 4, 6]` → 0 below 2, 1 from 2,
 * 2 from 4, 3 from 6). Colour is supplementary: the number is always shown (CNT-6, UX-7).
 */
export function levelFor(count: number, thresholds: readonly number[]): 0 | 1 | 2 | 3 {
  let level = 0;
  for (const t of thresholds) if (count >= t) level += 1;
  return Math.min(3, level) as 0 | 1 | 2 | 3;
}

export { validThresholds } from '../shared/counters.ts';

export type CrossingAction = { kind: 'none' } | { kind: 'open'; seq: number } | { kind: 'clear' };

/**
 * What happens to the lesson's threshold state after the bar changed (D-004):
 * open a new crossing when the bar reaches the limit and none is open, clear the open one when the
 * bar falls below the limit, otherwise nothing. `lastSeq` is the highest crossingSeq so far (0 = none).
 */
export function crossingTransition(barValue: number, limit: number, openSeq: number | null, lastSeq: number): CrossingAction {
  if (barValue >= limit && openSeq === null) return { kind: 'open', seq: lastSeq + 1 };
  if (barValue < limit && openSeq !== null) return { kind: 'clear' };
  return { kind: 'none' };
}

export interface BarEvent {
  seq: number;
  voided: boolean;
}

/** Live events of a lesson (CNT-8) and the bar value after the last reset marker (`afterSeq`). */
export function lessonCounts(events: readonly BarEvent[], resetAfterSeq: number | null): { lessonTotal: number; barValue: number } {
  let lessonTotal = 0;
  let barValue = 0;
  for (const e of events) {
    if (e.voided) continue;
    lessonTotal += 1;
    if (resetAfterSeq === null || e.seq > resetAfterSeq) barValue += 1;
  }
  return { lessonTotal, barValue };
}

/**
 * What one student's cell in the weekly history shows (RPT-5: zero ≠ not enrolled ≠ not recorded).
 * Recorded taps are always shown; otherwise a student outside the class that week is "not enrolled",
 * a week without any lesson of this class+subject is "not recorded", and only then is the count a real 0.
 */
export type HistoryCell = { kind: 'count'; value: number } | { kind: 'not_enrolled' } | { kind: 'not_recorded' };
export function historyCell(week: { lessons: number; counts: Readonly<Record<string, number>>; enrolled: readonly string[] }, studentId: string): HistoryCell {
  const n = week.counts[studentId] ?? 0;
  if (n > 0) return { kind: 'count', value: n };
  if (!week.enrolled.includes(studentId)) return { kind: 'not_enrolled' };
  if (week.lessons === 0) return { kind: 'not_recorded' };
  return { kind: 'count', value: 0 };
}
