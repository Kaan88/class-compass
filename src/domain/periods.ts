/**
 * Report periods (RPT-2): presets daily / weekly / monthly / term / school year, or a custom range.
 * Pure: local calendar dates 'YYYY-MM-DD' in the class timezone; `today` comes from the injected clock.
 * Every preset is clamped to the school year, so a report never runs over the summer into another year.
 */
import { addDays, weekdayOf } from './dates.ts';

export const PERIOD_PRESETS = ['day', 'week', 'month', 'term', 'year', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodCalendar {
  /** Today in the class timezone. */
  today: string;
  /** 0 = Sunday … 6 = Saturday (school setting, default Monday = 1, D-003). */
  weekStartsOn: number;
  year: DateRange;
  terms: readonly DateRange[];
}

/** First day of the week containing `date`. */
export function weekStartOf(date: string, weekStartsOn: number): string {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}

function lastDayOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const clamp = (r: DateRange, to: DateRange): DateRange => ({ from: r.from < to.from ? to.from : r.from, to: r.to > to.to ? to.to : r.to });

/**
 * The range of a preset. `anchor` (default: today, or the year's last day for a past year) picks
 * which day/week/month/term. A custom range is returned as given (ordered), clamped to the year.
 */
export function presetRange(preset: PeriodPreset, cal: PeriodCalendar, anchor?: string, custom?: DateRange): DateRange {
  const ref = anchor ?? (cal.today > cal.year.to ? cal.year.to : cal.today < cal.year.from ? cal.year.from : cal.today);
  let r: DateRange;
  switch (preset) {
    case 'day':
      r = { from: ref, to: ref };
      break;
    case 'week': {
      const from = weekStartOf(ref, cal.weekStartsOn);
      r = { from, to: addDays(from, 6) };
      break;
    }
    case 'month':
      r = { from: `${ref.slice(0, 7)}-01`, to: lastDayOfMonth(ref) };
      break;
    case 'term': {
      const term = cal.terms.find((t) => t.from <= ref && ref <= t.to) ?? [...cal.terms].reverse().find((t) => t.from <= ref) ?? cal.terms[0];
      r = term ? { from: term.from, to: term.to } : { ...cal.year };
      break;
    }
    case 'year':
      r = { ...cal.year };
      break;
    case 'custom': {
      const c = custom ?? { from: ref, to: ref };
      r = c.from <= c.to ? { ...c } : { from: c.to, to: c.from };
      break;
    }
  }
  return clamp(r, cal.year);
}

/** Every calendar date from `from` to `to` inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 4000; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * School days of a range for attendance coverage (RPT-5): the given weekdays (default Monday–Friday)
 * from `from` to `min(to, today)`, inside the school year, without the closure days of the school's
 * holiday calendar (S25b, D-186: a closure day is "no school", never a day without a record).
 */
export function schoolDaysBetween(range: DateRange, today: string, weekdays: readonly number[] = [1, 2, 3, 4, 5], closed: ReadonlySet<string> = new Set<string>()): string[] {
  const end = range.to < today ? range.to : today;
  return datesBetween(range.from, end).filter((d) => weekdays.includes(weekdayOf(d)) && !closed.has(d));
}

/** Week starts covering a range (for weekly trends), oldest first. */
export function weekStartsBetween(range: DateRange, weekStartsOn: number): string[] {
  const out: string[] = [];
  for (let w = weekStartOf(range.from, weekStartsOn); w <= range.to && out.length < 120; w = addDays(w, 7)) out.push(w);
  return out;
}

/** Whole days between two local dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
