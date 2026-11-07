/** Lesson/attendance constants shared by contracts, domain logic, server and client. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export const DEFAULT_ROUTINE_ID = 'builtin:default';
export const MAX_STAGES = 20;
export const MAX_TIMER_MS = 3 * 60 * 60 * 1000;
