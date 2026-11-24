/**
 * Pure calendar helpers (no I/O). Local calendar dates are 'YYYY-MM-DD' strings in a given IANA
 * timezone (DSH-2, D-003). Never hard-code dates; always derive them from an injected clock.
 */
export { isIsoDate, isValidTimeZone } from '../shared/dates.ts';
import { dateTimeFormat } from '../shared/intl.ts';

const LOCAL_DATE_OPTIONS = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;

/** Local calendar date of instant `ms` in timezone `tz`. */
export function localDate(ms: number, tz: string): string {
  // en-CA formats as YYYY-MM-DD. One cached formatter per timezone (S15a, D-162): building one per
  // call made whole-year reports slow and left hundreds of MB of ICU memory behind.
  return dateTimeFormat('en-CA', { timeZone: tz, ...LOCAL_DATE_OPTIONS }).format(ms);
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

/** `date` ('YYYY-MM-DD') plus `n` calendar days (n may be negative). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WALL_OPTIONS = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } as const;
/** The wall-clock time of `ms` in `tz`, as if it were UTC (for offset arithmetic). */
function wallClock(ms: number, tz: string): number {
  const p = Object.fromEntries(dateTimeFormat('en-CA', { timeZone: tz, ...WALL_OPTIONS }).formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
}

/** The instant local day `date` ends in `tz` (00:00 of the next local day; S37, D-218). */
export function endOfLocalDay(date: string, tz: string): number {
  const [y, m, d] = addDays(date, 1).split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d);
  let t = target;
  for (let i = 0; i < 3; i += 1) {
    const diff = wallClock(t, tz) - target;
    if (diff === 0) break;
    t -= diff;
  }
  return t;
}
