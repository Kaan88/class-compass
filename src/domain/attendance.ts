/**
 * Attendance rules (ACC-8, ATT-2). Daily attendance is shared by every teacher of the class; a
 * lesson may override it for one student (exception). Effective status for a lesson:
 * exception › daily › not recorded. Attendance is independent of homework (ATT-1).
 */
import { ATTENDANCE_STATUSES } from '../shared/lessons.ts';

export { ATTENDANCE_STATUSES };
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export type EffectiveAttendance = AttendanceStatus | 'not_recorded';

export function effectiveAttendance(exception: AttendanceStatus | null | undefined, daily: AttendanceStatus | null | undefined): EffectiveAttendance {
  return exception ?? daily ?? 'not_recorded';
}

/** One tap cycles present → absent → late → excused → present (UX-8). Not recorded starts at absent. */
export function nextStatus(s: EffectiveAttendance): AttendanceStatus {
  switch (s) {
    case 'present':
      return 'absent';
    case 'absent':
      return 'late';
    case 'late':
      return 'excused';
    case 'excused':
      return 'present';
    default:
      return 'absent';
  }
}

/** Students who are not in the room for this lesson (absent or excused). Late students are present. */
export const isAway = (s: EffectiveAttendance) => s === 'absent' || s === 'excused';

export type AttendanceCounts = Record<EffectiveAttendance, number>;

export function countAttendance(list: readonly EffectiveAttendance[]): AttendanceCounts {
  const out: AttendanceCounts = { present: 0, absent: 0, late: 0, excused: 0, not_recorded: 0 };
  for (const s of list) out[s] += 1;
  return out;
}
