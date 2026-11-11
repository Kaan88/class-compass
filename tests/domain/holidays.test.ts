/**
 * School holiday calendar week maths (S25b, D-186; RPT-5, AST-1). Pure domain: no database.
 * 2026-11-02 and 2026-11-09 are Mondays; the school year runs 2026-09-01 to 2027-06-30.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { weekDates } from '../../src/domain/assistant.ts';
import { addDays, weekdayOf } from '../../src/domain/dates.ts';
import { closedDates, closedSchoolDays, fixedHolidaysIn, isSchoolDayOn, TR_FIXED_HOLIDAYS, weekKind } from '../../src/domain/holidays.ts';
import { schoolDaysBetween, weekStartsBetween } from '../../src/domain/periods.ts';

const year = { from: '2026-09-01', to: '2027-06-30' };

describe('closure days (D-186)', () => {
  it('a closure across a weekend covers its weekend days but takes off only the weekdays', () => {
    const span = { from: '2026-10-30', to: '2026-11-03' }; // Friday to Tuesday
    const closed = closedDates([span]);
    expect([...closed]).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
    expect(closedSchoolDays(span, closed)).toBe(3);
    expect(schoolDaysBetween({ from: '2026-10-26', to: '2026-11-06' }, '2026-11-11', undefined, closed)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(isSchoolDayOn('2026-11-02', closed)).toBe(false);
    expect(isSchoolDayOn('2026-11-04', closed)).toBe(true);
    expect(isSchoolDayOn('2026-11-07', new Set())).toBe(false); // a Saturday
  });

  it('a week of only closures is "closed", never a school week; one open weekday makes it a school week', () => {
    const range = { from: '2026-10-26', to: '2026-11-15' };
    const wholeWeek = closedDates([{ from: '2026-11-02', to: '2026-11-06' }]);
    expect(weekKind('2026-11-02', range, wholeWeek)).toBe('closed');
    expect(weekKind('2026-10-26', range, wholeWeek)).toBe('school');
    expect(schoolDaysBetween({ from: '2026-11-02', to: '2026-11-08' }, '2026-11-30', undefined, wholeWeek)).toEqual([]);
    const fourDays = closedDates([{ from: '2026-11-02', to: '2026-11-05' }]);
    expect(weekKind('2026-11-02', range, fourDays)).toBe('school');
    // A range that has no weekday of the week at all is "none" (nothing to show), not "closed".
    expect(weekKind('2026-11-02', { from: '2026-11-07', to: '2026-11-08' }, wholeWeek)).toBe('none');
    // Only the part of the week inside the range counts: Thursday and Friday off, the range starts Thursday.
    expect(weekKind('2026-11-02', { from: '2026-11-05', to: '2026-11-08' }, closedDates([{ from: '2026-11-05', to: '2026-11-06' }]))).toBe('closed');
  });

  it('year boundaries: closures are cut at the range, a week across New Year and the year’s first and last weeks', () => {
    // Cut to the school year (a broken row or a report period never runs past its edge).
    const cut = closedDates([{ from: '2027-06-28', to: '2027-07-09' }], year);
    expect([...cut]).toEqual(['2027-06-28', '2027-06-29', '2027-06-30']);
    // The week of New Year: 28 Dec 2026 (Mon) to 3 Jan 2027, closed from 31 Dec to 1 Jan.
    const newYear = closedDates([{ from: '2026-12-31', to: '2027-01-01' }]);
    expect(schoolDaysBetween({ from: '2026-12-28', to: '2027-01-03' }, '2027-02-01', undefined, newYear)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30']);
    expect(weekKind('2026-12-28', year, newYear)).toBe('school');
    // The year starts on a Tuesday: a closure on the first school days makes that first week "closed".
    const firstDays = closedDates([{ from: '2026-09-01', to: '2026-09-04' }]);
    expect(weekKind(weekStartsBetween(year, 1)[0]!, year, firstDays)).toBe('closed');
    expect(weekDates('2026-08-31', [1, 2, 3, 4, 5], year.from, year.to, firstDays)).toEqual([]);
    // The assistant's week skips closure days and stays inside the year.
    expect(weekDates('2026-11-09', [1, 2, 3, 4, 5], year.from, year.to, closedDates([{ from: '2026-11-10', to: '2026-11-10' }]))).toEqual(['2026-11-09', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(weekDates('2027-06-28', [1, 2, 3, 4, 5], year.from, year.to, new Set())).toEqual(['2027-06-28', '2027-06-29', '2027-06-30']);
  });

  it('the built-in Turkish list is the seven fixed-date holidays; only those inside the year are added', () => {
    expect(TR_FIXED_HOLIDAYS.map((h) => h.monthDay)).toEqual(['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']);
    expect(JSON.stringify(TR_FIXED_HOLIDAYS)).not.toMatch(/Ramazan|Kurban/u);
    expect(fixedHolidaysIn(year).map((h) => h.date)).toEqual(['2026-10-29', '2027-01-01', '2027-04-23', '2027-05-01', '2027-05-19']);
    // A calendar year school year (a southern-hemisphere style or a test) gets all seven.
    expect(fixedHolidaysIn({ from: '2027-01-01', to: '2027-12-31' })).toHaveLength(7);
    expect(fixedHolidaysIn({ from: '2026-10-30', to: '2026-12-31' })).toEqual([]);
  });

  it('property: school days never include a closure day or a weekend, and closures only ever remove days', () => {
    const day = fc.integer({ min: 0, max: 300 }).map((n) => addDays(year.from, n));
    fc.assert(
      fc.property(fc.array(fc.tuple(day, fc.integer({ min: 0, max: 12 })), { maxLength: 6 }), day, (spans, today) => {
        const closures = spans.map(([from, len]) => ({ from, to: addDays(from, len) }));
        const closed = closedDates(closures, year);
        const all = schoolDaysBetween(year, today);
        const open = schoolDaysBetween(year, today, undefined, closed);
        for (const d of open) {
          expect(closed.has(d)).toBe(false);
          expect([0, 6]).not.toContain(weekdayOf(d));
        }
        expect(all.filter((d) => !closed.has(d))).toEqual(open);
      }),
      { numRuns: 60 },
    );
  });
});
