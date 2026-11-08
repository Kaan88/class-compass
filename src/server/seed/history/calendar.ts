/** School calendar of the demo history: weekends and a few fictional fixed holidays have no school. */
import { weekdayOf } from '../../../domain/dates.ts';

/** Days without lessons (MM-DD): fictional fixed holidays (Republic Day, New Year, …). */
export const HOLIDAYS: ReadonlySet<string> = new Set(['10-29', '01-01', '04-23', '05-01', '05-19']);

/** True when the local date `YYYY-MM-DD` is a school day (not a weekend, not a holiday). */
export function isSchoolDay(date: string): boolean {
  const wd = weekdayOf(date);
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(date.slice(5));
}
