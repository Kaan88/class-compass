/**
 * When a forgotten lesson ends itself (S37, D-218). A lesson has no planned end or length in the data
 * model (only `startedAt`; the timer is a countdown for a task, not the lesson), and a lesson in use must
 * never be cut off (owner's decision), so the rule combines its age with how long nothing has happened
 * in it (`lastActivityAt`: every accepted lesson command, "Still teaching", End Lesson open):
 *
 * - reminder: at least LESSON_REMINDER_AFTER_MS old AND quiet for LESSON_REMINDER_QUIET_MS. The teacher
 *   home and the board then say it is still running (with "Still teaching"); the notification goes out
 *   once per lesson. 90 minutes: a double lesson (2 × 40 minutes and a break) is over by then;
 * - automatic end: at least LESSON_AUTO_END_AFTER_MS old AND quiet for LESSON_IDLE_BEFORE_AUTO_END_MS,
 *   or the end of the local day it started on (the class timezone), whichever comes first. Its
 *   `endedAt` is the last activity: the honest end of teaching.
 */
export const LESSON_REMINDER_AFTER_MS = 90 * 60_000;
export const LESSON_REMINDER_QUIET_MS = 15 * 60_000;
export const LESSON_AUTO_END_AFTER_MS = 2 * 60 * 60_000;
export const LESSON_IDLE_BEFORE_AUTO_END_MS = 30 * 60_000;

export interface LessonClock {
  startedAt: number;
  /** Null for a lesson started before S37: read as its start. */
  lastActivityAt: number | null;
}

export const lastActivityOf = (l: LessonClock): number => l.lastActivityAt ?? l.startedAt;

/** When the lesson ends by itself if nothing more happens; `dayEnd` = the end of its local day. */
export const autoEndAt = (l: LessonClock, dayEnd: number): number => Math.min(dayEnd, Math.max(l.startedAt + LESSON_AUTO_END_AFTER_MS, lastActivityOf(l) + LESSON_IDLE_BEFORE_AUTO_END_MS));

/** Is the "still running" reminder shown now? */
export const reminderDue = (l: LessonClock, now: number): boolean => now >= l.startedAt + LESSON_REMINDER_AFTER_MS && now - lastActivityOf(l) >= LESSON_REMINDER_QUIET_MS;
