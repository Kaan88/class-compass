/**
 * School holiday calendar (S25b, D-186): closures are named date ranges of a school year on which there
 * is no school (semester break, national holidays). Pure: local calendar dates 'YYYY-MM-DD'.
 *
 * - A closure day is "no school": it is never a school day, so it is never "not recorded" and never 0
 *   in a coverage count (RPT-5). Weekends are not school days either way (Monday–Friday, D-091).
 * - The built-in Turkish list holds the fixed-date national holidays only. Religious holidays (Ramazan
 *   and Kurban Bayramı) move every year and are added by hand; nothing is looked up on the network.
 */
import { addDays, weekdayOf } from './dates.ts';

export interface DateSpan {
  from: string;
  to: string;
}

/** Monday–Friday (0 = Sunday … 6 = Saturday). */
export const SCHOOL_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

const NO_DAYS: ReadonlySet<string> = new Set<string>();
export const noClosures = (): ReadonlySet<string> => NO_DAYS;

/**
 * Every date covered by the closures, limited to `within` when given (a closure that runs past the
 * school year or the report period is cut at its edge). Overlapping closures count each date once.
 */
export function closedDates(closures: readonly DateSpan[], within?: DateSpan): Set<string> {
  const out = new Set<string>();
  for (const c of closures) {
    const from = within && c.from < within.from ? within.from : c.from;
    const to = within && c.to > within.to ? within.to : c.to;
    // A closure is at most a school year long; the cap only guards against a broken row.
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i += 1) out.add(d);
  }
  return out;
}

/** A school day: one of the school weekdays and not a closure day. */
export const isSchoolDayOn = (date: string, closed: ReadonlySet<string>, weekdays: readonly number[] = SCHOOL_WEEKDAYS): boolean => weekdays.includes(weekdayOf(date)) && !closed.has(date);

/**
 * What a week (seven days from `weekStart`) is inside `range`: 'school' when at least one school weekday
 * in the range is not a closure, 'closed' when every school weekday in the range is a closure day (a
 * week of holidays: "no school", never 0 or "not recorded"), 'none' when the range has no school weekday
 * of this week at all (it starts on a Saturday, say).
 */
export function weekKind(weekStart: string, range: DateSpan, closed: ReadonlySet<string>, weekdays: readonly number[] = SCHOOL_WEEKDAYS): 'school' | 'closed' | 'none' {
  let closedDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(weekStart, i);
    if (d < range.from || d > range.to || !weekdays.includes(weekdayOf(d))) continue;
    if (!closed.has(d)) return 'school';
    closedDays += 1;
  }
  return closedDays ? 'closed' : 'none';
}

/** A built-in public holiday: month-day and its name in both languages. */
export interface FixedHoliday {
  monthDay: string;
  name: { en: string; tr: string };
}

/**
 * Fixed-date national holidays of Türkiye (official days off). Half days (the afternoon of 28 October,
 * the eves of the religious holidays) are out of scope; Ramazan and Kurban Bayramı are added by hand.
 */
export const TR_FIXED_HOLIDAYS: readonly FixedHoliday[] = [
  { monthDay: '01-01', name: { en: 'New Year’s Day', tr: 'Yılbaşı' } },
  { monthDay: '04-23', name: { en: 'National Sovereignty and Children’s Day', tr: '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı' } },
  { monthDay: '05-01', name: { en: 'Labour and Solidarity Day', tr: '1 Mayıs Emek ve Dayanışma Günü' } },
  { monthDay: '05-19', name: { en: 'Commemoration of Atatürk, Youth and Sports Day', tr: '19 Mayıs Atatürk’ü Anma, Gençlik ve Spor Bayramı' } },
  { monthDay: '07-15', name: { en: 'Democracy and National Unity Day', tr: '15 Temmuz Demokrasi ve Millî Birlik Günü' } },
  { monthDay: '08-30', name: { en: 'Victory Day', tr: '30 Ağustos Zafer Bayramı' } },
  { monthDay: '10-29', name: { en: 'Republic Day', tr: '29 Ekim Cumhuriyet Bayramı' } },
];

/** The fixed holidays that fall inside a school year, as one-day closures in date order. */
export function fixedHolidaysIn(year: DateSpan, list: readonly FixedHoliday[] = TR_FIXED_HOLIDAYS): Array<{ date: string; name: { en: string; tr: string } }> {
  const out: Array<{ date: string; name: { en: string; tr: string } }> = [];
  const firstYear = Number(year.from.slice(0, 4));
  const lastYear = Number(year.to.slice(0, 4));
  for (let y = firstYear; y <= lastYear; y += 1) {
    for (const h of list) {
      const date = `${String(y).padStart(4, '0')}-${h.monthDay}`;
      if (date >= year.from && date <= year.to) out.push({ date, name: h.name });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The school weekdays of a range that are closure days (how many days a closure takes off school). */
export function closedSchoolDays(span: DateSpan, closed: ReadonlySet<string>, weekdays: readonly number[] = SCHOOL_WEEKDAYS): number {
  let n = 0;
  for (let d = span.from, i = 0; d <= span.to && i < 400; d = addDays(d, 1), i += 1) if (closed.has(d) && weekdays.includes(weekdayOf(d))) n += 1;
  return n;
}
