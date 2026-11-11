/**
 * School calendar of the demo history: weekends and the school's holiday calendar (S25b, D-186) have
 * no school. The history adds the built-in Turkish fixed-date holidays to the demo year first (as an
 * administrator pressing "Add Turkish public holidays" would), so it skips exactly the days the reports
 * leave out.
 */
import { isSchoolDayOn } from '../../../domain/holidays.ts';

/** True when the local date `YYYY-MM-DD` is a school day: Monday–Friday and not a closure day. */
export function isSchoolDay(date: string, closed: ReadonlySet<string>): boolean {
  return isSchoolDayOn(date, closed);
}
