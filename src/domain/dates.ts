/**
 * Pure calendar helpers (no I/O). Local calendar dates are 'YYYY-MM-DD' strings in a given IANA
 * timezone (DSH-2, D-003). Never hard-code dates; always derive them from an injected clock.
 */
export { isIsoDate, isValidTimeZone } from '../shared/dates.ts';

/** Local calendar date of instant `ms` in timezone `tz`. */
export function localDate(ms: number, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

export interface SchoolYearSpan {
  name: string;
  startsOn: string;
  endsOn: string;
}

/**
 * The school year containing instant `ms` (September–June). July and August already belong to the
 * year that starts in the coming September, so a demo seeded in summer is ready for the new year.
 */
export function schoolYearFor(ms: number, tz: string): SchoolYearSpan {
  const [y, m] = localDate(ms, tz).split('-').map(Number) as [number, number];
  const start = m >= 7 ? y : y - 1;
  return { name: `${start}–${start + 1}`, startsOn: `${start}-09-01`, endsOn: `${start + 1}-06-30` };
}

/** Day of the week (0 = Sunday … 6 = Saturday) of a local 'YYYY-MM-DD' date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
