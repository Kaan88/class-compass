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
import { and, desc, eq, gte, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import { AUTO_END_NOTICE_MS, autoEndAt, LESSON_REMINDER_AFTER_MS } from '../../../shared/lessonLimits.ts';
import type { LessonNotices } from '../../../shared/contracts/lessons.ts';
import { lessons, teachingContexts } from '../../db/schema.ts';
import { tx } from '../../db/client.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { notFound } from '../../lib/errors.ts';
import { effectiveTimezone, getClass } from '../school/policy.ts';
import { settleLesson } from './service.ts';

/** How often main.ts runs the sweep: a reminder or an end is at most this late while nobody reads. */
export const LESSON_SWEEP_MS = 5 * 60_000;

/** Settles every running lesson past its reminder point. Returns how many it ended. */
export function sweepForgottenLessons(deps: AppDeps): { ended: number; reminded: number } {
  const due = deps.db
    .select({ id: lessons.id, remindedAt: lessons.remindedAt })
    .from(lessons)
    .where(and(eq(lessons.status, 'active'), lte(lessons.startedAt, deps.now() - LESSON_REMINDER_AFTER_MS)))
    .all();
  let ended = 0;
  let reminded = 0;
  for (const d of due) {
    const after = settleLesson(deps, d.id);
    if (after?.status === 'ended') ended += 1;
    else if (after?.remindedAt !== null && d.remindedAt === null) reminded += 1;
  }
  return { ended, reminded };
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
    const l = settleLesson(ctx, lesson.id);
    if (!l || l.status !== 'active' || l.remindedAt === null) continue;
    const tz = effectiveTimezone(ctx.db, getClass(ctx.db, l.classId));
    running.push({ lessonId: l.id, contextId: l.contextId, className: l.classNameSnapshot, subjectName: l.subjectNameSnapshot, localDate: l.localDate, startedAt: l.startedAt, autoEndAt: autoEndAt(l.startedAt), timezone: tz });
  }
  const since = ctx.now() - AUTO_END_NOTICE_MS;
  const autoEnded = ownLessons(ctx, and(isNotNull(lessons.autoEndedAt), isNull(lessons.autoEndSeenAt), gte(lessons.endedAt, since)))
    .orderBy(desc(lessons.endedAt))
    .all()
    .map(({ lesson: l }) => ({
      lessonId: l.id,
      contextId: l.contextId,
      className: l.classNameSnapshot,
      subjectName: l.subjectNameSnapshot,
      localDate: l.localDate,
      startedAt: l.startedAt,
      endedAt: l.endedAt ?? autoEndAt(l.startedAt),
      timezone: effectiveTimezone(ctx.db, getClass(ctx.db, l.classId)),
    }));
  return { running: running.sort((a, b) => a.startedAt - b.startedAt), autoEnded };
}

/** "Got it": the notice of one automatically ended lesson of the teacher's own class+subject is gone. */
export function dismissLessonNotice(ctx: RequestContext, lessonId: string) {
  return tx(ctx.db, () => {
    const row = ownLessons(ctx, eq(lessons.id, lessonId)).get();
    // Another teacher's lesson, or one that did not end by itself: not found (never a hint it exists).
    if (!row || row.lesson.autoEndedAt === null) throw notFound('Lesson');
    if (row.lesson.autoEndSeenAt === null) ctx.db.update(lessons).set({ autoEndSeenAt: ctx.now() }).where(eq(lessons.id, lessonId)).run();
    return { ok: true as const };
  });
}
