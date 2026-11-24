/**
 * Forgotten lessons (S37, D-218): the sweep that ends them and the teacher home's notices.
 *
 * The end itself is `settleLesson` (service.ts): every read of lesson state calls it lazily, so a
 * server that was down or a sweep that was missed never leaves a lesson running; this sweep only makes
 * sure the reminder and the end also happen while nobody is looking (and the notifications go out).
 *
 * The notices are for the teacher of the lesson's class+subject (the only account that can end it,
 * `assertOwnsContext`), while that class+subject is still theirs.
 */
import { and, desc, eq, gte, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { addDays, localDate } from '../../../domain/dates.ts';
import { autoEndAt, reminderDue } from '../../../shared/lessonLimits.ts';
import type { LessonNotices } from '../../../shared/contracts/lessons.ts';
import { lessons, teachingContexts } from '../../db/schema.ts';
import { tx } from '../../db/client.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { assertOwnsContext, effectiveTimezone, getClass } from '../school/policy.ts';
import { endStepsFor } from './endSteps.ts';
import { lessonDayEnd, lessonFillInUntil, lessonStateOf, settleForRead, settleLesson } from './service.ts';

/** How often main.ts runs the sweep: a reminder or an end is at most this late while nobody reads. */
export const LESSON_SWEEP_MS = 5 * 60_000;

/** The notices look at lessons of the last this many days only (the fill-in window is a few days at most). */
export const NOTICE_LOOKBACK_DAYS = 60;

export interface SweepResult {
  ended: number;
  reminded: number;
  abandoned: number;
  failed: number;
}

/**
 * Settles every running lesson (the clock check is cheap and writes nothing for a lesson in use). One
 * lesson whose settle throws is reported through `onError` and the sweep goes on with the next.
 */
export function sweepForgottenLessons(deps: AppDeps, onError: (err: unknown, lessonId: string) => void = () => {}): SweepResult {
  const active = deps.db.select().from(lessons).where(eq(lessons.status, 'active')).all();
  const r: SweepResult = { ended: 0, reminded: 0, abandoned: 0, failed: 0 };
  for (const l of active) {
    try {
      const after = settleLesson(deps, l);
      if (after?.status === 'ended') r.ended += 1;
      else if (after?.status === 'abandoned') r.abandoned += 1;
      else if (after?.remindedAt !== null && l.remindedAt === null) r.reminded += 1;
    } catch (err) {
      r.failed += 1;
      onError(err, l.id);
    }
  }
  return r;
}

/** Lessons of the teacher's own current class+subjects matching `where`. */
const ownLessons = (ctx: RequestContext, where: SQL | undefined) =>
  ctx.db
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(teachingContexts, eq(teachingContexts.id, lessons.contextId))
    .where(and(eq(teachingContexts.teacherId, requireUser(ctx).id), isNull(teachingContexts.endedAt), where));

export function lessonNotices(ctx: RequestContext): LessonNotices {
  const running: LessonNotices['running'] = [];
  const active = ownLessons(ctx, eq(lessons.status, 'active')).all();
  // Reading the notices settles the lessons, so a lesson past its limit shows as ended, not running.
  for (const { lesson } of active) {
    const l = settleForRead(ctx, lesson);
    if (l.status !== 'active' || !reminderDue(l, ctx.now())) continue;
    const tz = effectiveTimezone(ctx.db, getClass(ctx.db, l.classId));
    running.push({ lessonId: l.id, contextId: l.contextId, className: l.classNameSnapshot, subjectName: l.subjectNameSnapshot, localDate: l.localDate, startedAt: l.startedAt, autoEndAt: autoEndAt(l, lessonDayEnd(ctx.db, l)), timezone: tz });
  }
  // Until Got it, a late End Lesson (which clears the mark) or the end of the fill-in window, whichever
  // comes first (no "Got it" needed then); lessons closed before S37 were abandoned, never marked.
  // Only recent lessons (NOTICE_LOOKBACK_DAYS): an old undismissed one is long closed, and every poll would scan its calendar.
  const since = addDays(localDate(ctx.now(), 'UTC'), -NOTICE_LOOKBACK_DAYS);
  const autoEnded = ownLessons(ctx, and(isNotNull(lessons.autoEndedAt), isNull(lessons.autoEndSeenAt), gte(lessons.localDate, since)))
    .orderBy(desc(lessons.endedAt))
    .all()
    .map(({ lesson: l }) => ({ l, fillInUntil: lessonFillInUntil(ctx.db, l) }))
    .filter(({ fillInUntil }) => ctx.now() < fillInUntil)
    .map(({ l, fillInUntil }) => ({
      lessonId: l.id,
      contextId: l.contextId,
      className: l.classNameSnapshot,
      subjectName: l.subjectNameSnapshot,
      localDate: l.localDate,
      startedAt: l.startedAt,
      endedAt: l.endedAt ?? l.autoEndedAt!,
      fillInUntil,
      timezone: effectiveTimezone(ctx.db, getClass(ctx.db, l.classId)),
    }));
  return { running: running.sort((a, b) => a.startedAt - b.startedAt), autoEnded };
}

/** "Got it": the notice of one automatically ended lesson of the teacher's own class+subject is gone. */
// Writes on an archived class or year too, without `assertClassWritable`: Got it only hides a notice
// for this account (not an edit of class data, DAT-1), and an archived class's notice must still go away.
export function dismissLessonNotice(ctx: RequestContext, lessonId: string) {
  return tx(ctx.db, () => {
    const row = ownLessons(ctx, eq(lessons.id, lessonId)).get();
    // Another teacher's lesson, or one that did not end by itself: not found (never a hint it exists).
    if (!row || row.lesson.autoEndedAt === null) throw notFound('Lesson');
    if (row.lesson.autoEndSeenAt === null) ctx.db.update(lessons).set({ autoEndSeenAt: ctx.now() }).where(eq(lessons.id, lessonId)).run();
    return { ok: true as const };
  });
}

/**
 * End Lesson for a lesson that ended by itself, opened from the teacher area (S37, D-218): only the
 * current teacher of its class+subject (as the notices), only while the window is open. Another
 * teacher's lesson, one that did not end by itself or was filled in already: not found (never a hint
 * that it exists). Past the window: LESSON_FILL_IN_CLOSED, so an old link says it is closed.
 */
export function lessonFillIn(ctx: RequestContext, lessonId: string) {
  const row = ownLessons(ctx, eq(lessons.id, lessonId)).get();
  if (!row || row.lesson.status !== 'ended' || row.lesson.autoEndedAt === null) throw notFound('Lesson');
  const l = row.lesson;
  const fillInUntil = lessonFillInUntil(ctx.db, l);
  if (ctx.now() >= fillInUntil) throw new AppError('CONFLICT', 'The time to fill in End Lesson for this lesson is over', { reason: 'LESSON_FILL_IN_CLOSED' });
  const context = assertOwnsContext(ctx, l.contextId);
  const cls = getClass(ctx.db, l.classId);
  const state = lessonStateOf(ctx, context, cls, l);
  return {
    state,
    contextId: l.contextId,
    className: l.classNameSnapshot,
    subjectName: l.subjectNameSnapshot,
    timezone: state.today.timezone,
    endedAt: l.endedAt ?? l.autoEndedAt!,
    fillInUntil,
    // Shown as "not available any more", never offered (the same rule `lateEnd` applies).
    notAvailable: endStepsFor(ctx.db, l.contextId, l)
      .filter((s) => s.canApplyLate && !s.canApplyLate(ctx.db, l))
      .map((s) => s.key),
  };
}
