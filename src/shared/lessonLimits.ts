/**
 * How long a forgotten lesson may run (S37, D-218). A lesson has no planned end or length in the data
 * model (only `startedAt`; the timer is a countdown the teacher sets for a task, not the lesson), so both
 * limits count from the start:
 *
 * - after LESSON_REMINDER_AFTER_MS the teacher home and the classroom board say the lesson is still
 *   running, and one "still running" notification goes out. 90 minutes: a double lesson (2 × 40 minutes)
 *   with its short break is over by then, so a lesson that is really being taught is not interrupted;
 * - after LESSON_AUTO_END_AFTER_MS the server ends it (the teacher's request: "within 2 hours"); its
 *   `endedAt` is that moment, whenever the server notices, so its length is never more than the limit.
 *
 * Notices about lessons ended automatically more than AUTO_END_NOTICE_MS ago are not shown or sent
 * (a lesson left running for weeks before this rule existed is closed quietly, still audited).
 */
export const LESSON_REMINDER_AFTER_MS = 90 * 60_000;
export const LESSON_AUTO_END_AFTER_MS = 2 * 60 * 60_000;
export const AUTO_END_NOTICE_MS = 7 * 24 * 60 * 60_000;

/** When a lesson that started at `startedAt` ends by itself. */
export const autoEndAt = (startedAt: number): number => startedAt + LESSON_AUTO_END_AFTER_MS;
/** When the teacher is reminded that it is still running. */
export const reminderAt = (startedAt: number): number => startedAt + LESSON_REMINDER_AFTER_MS;
