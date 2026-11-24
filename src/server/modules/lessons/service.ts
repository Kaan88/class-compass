/**
 * Lesson lifecycle (LES-1..4, DSH-1/2/4, RTN-3). One active lesson per teaching context (DB-enforced).
 * Starting is an explicit, idempotent command; a second start resumes the running lesson instead of
 * creating another (LES-2). Every command names the lesson the device believed was active and is
 * refused with WRONG_LESSON otherwise, so a queued tap can never land on another class (LES-4).
 * A lesson left active past the end of its local day is abandoned (not ended, data kept) when the
 * next lesson starts in that context.
 *
 * Forgotten lessons (S37, D-218): a lesson nobody ended ends by itself once it is old enough and has
 * been quiet long enough, or at the end of its local day (`shared/lessonLimits.ts`). `settleLesson`
 * does it, called by every read of lesson state and by the sweep in main.ts, with the system as actor.
 * Only what needs no person is done: the lesson is closed at its last activity, its timer stopped, the
 * close hooks run. No End Lesson step runs; a teacher's End Lesson that arrives later still applies
 * its steps (`lateEnd`). Every accepted lesson command marks activity (`lessonForCommand`).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { endOfLocalDay, localDate, weekdayOf } from '../../../domain/dates.ts';
import { clampStage } from '../../../domain/routines.ts';
import { idleTimer, type TimerState } from '../../../domain/timer.ts';
import type { AssistantToday } from '../../../shared/contracts/assistant.ts';
import type { CountersLessonState } from '../../../shared/contracts/counters.ts';
import type { GroupingLessonState } from '../../../shared/contracts/grouping.ts';
import type { LessonGoalState } from '../../../shared/contracts/lessonGoals.ts';
import type { SecretLessonState } from '../../../shared/contracts/secret.ts';
import type { LessonCommands, LessonState, LessonSummary } from '../../../shared/contracts/lessons.ts';
import { autoEndAt, lastActivityOf, reminderDue } from '../../../shared/lessonLimits.ts';
import { lessons, subjects, teachingContexts } from '../../db/schema.ts';
import { tx, type Db } from '../../db/client.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireUser, type Actor, type AppDeps, type RequestContext } from '../../lib/context.ts';
import { notify, resolveNotifications } from '../../lib/notify.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { attendanceStamp, dailyFor, lessonAttendanceCounts, markAllPresentCore, rosterWithAttendance, setDailyCore } from '../attendance/service.ts';
import { closureOn } from '../school/closures.ts';
import { assertModuleEnabled, isModuleEnabled } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, effectiveTimezone, getClass, todayFor, type ClassRow, type ContextRow } from '../school/policy.ts';
import { endStepsFor, type LessonRow } from './endSteps.ts';
import { defaultTemplateId, resolveRoutine, usableTemplates } from './routines.ts';
import { runStartSteps } from './startSteps.ts';
import { plannedTopics, usableTopicSnapshots } from './topics.ts';

type P<T extends keyof typeof LessonCommands> = z.infer<(typeof LessonCommands)[T]>;

export function getActiveLesson(db: Db, contextId: string): LessonRow | undefined {
  return db
    .select()
    .from(lessons)
    .where(and(eq(lessons.contextId, contextId), eq(lessons.status, 'active')))
    .get();
}

/** Active, and started on the class's current local day (a lesson from yesterday is not resumed). */
const isCurrent = (deps: Pick<RequestContext, 'db' | 'now'>, lesson: LessonRow, cls: ClassRow) => lesson.localDate >= todayFor(deps, cls);

/** The end of the local day a lesson started on, in its class's timezone (the automatic end's cap). */
export const lessonDayEnd = (db: Db, l: LessonRow): number => endOfLocalDay(l.localDate, effectiveTimezone(db, getClass(db, l.classId)));

export function lessonDto(db: Db, l: LessonRow, now: number): LessonState {
  return {
    id: l.id,
    contextId: l.contextId,
    status: l.status,
    startedAt: l.startedAt,
    endedAt: l.endedAt,
    localDate: l.localDate,
    version: l.version,
    className: l.classNameSnapshot,
    subjectName: l.subjectNameSnapshot,
    routine: { templateId: l.routineTemplateId, name: l.routineNameJson, stages: l.routineSnapshotJson },
    stageIndex: l.stageIndex,
    timer: l.timerJson,
    topics: l.topicsJson.map((t) => ({ id: t.id, name: t.name, icon: (t.icon as LessonState['topics'][number]['icon']) ?? null })),
    display: { assistantVisible: l.displayJson.assistantVisible ?? null },
    endSteps: endStepsFor(db, l.contextId, l).map((s) => s.key),
    overdue: l.status === 'active' && reminderDue(l, now),
    autoEndAt: autoEndAt(l, lessonDayEnd(db, l)),
  };
}

function wrongLesson(): never {
  throw new AppError('CONFLICT', 'This action belongs to another lesson', { reason: 'WRONG_LESSON' });
}

export interface LessonTarget {
  context: ContextRow;
  cls: ClassRow;
  lesson: LessonRow;
}

/**
 * Authorise a lesson command: the teacher owns the context, the class is writable, and `lessonId`
 * is the context's ACTIVE lesson. A lesson that has ended answers LESSON_ENDED; any other mismatch
 * (including envelope meta that disagrees with the payload) answers WRONG_LESSON (LES-4).
 */
export function lessonForCommand(ctx: RequestContext, p: { contextId: string; lessonId: string }, meta: CommandMeta): LessonTarget {
  if ((meta.contextId && meta.contextId !== p.contextId) || (meta.lessonId && meta.lessonId !== p.lessonId)) wrongLesson();
  const context = assertOwnsContext(ctx, p.contextId);
  const cls = getClass(ctx.db, context.classId);
  assertClassWritable(ctx.db, cls);
  const lesson = getActiveLesson(ctx.db, context.id);
  if (!lesson || lesson.id !== p.lessonId) {
    const other = ctx.db.select().from(lessons).where(eq(lessons.id, p.lessonId)).get();
    if (other && other.contextId === context.id && other.status !== 'active') {
      if (happenedWhileRunning(ctx, other, cls, meta)) return { context, cls, lesson: lateTarget(ctx, other, meta.clientTime!) };
      throw new AppError('CONFLICT', 'This lesson has already ended', { reason: 'LESSON_ENDED' });
    }
    wrongLesson();
  }
  // Something happened in the lesson (S37, D-218): it is in use. No version bump (nothing on screen changes).
  ctx.db.update(lessons).set({ lastActivityAt: ctx.now() }).where(eq(lessons.id, lesson.id)).run();
  return { context, cls, lesson: { ...lesson, lastActivityAt: ctx.now() } };
}

/**
 * For commands that only make sense while the lesson runs (the Secret Student game, whose round the
 * close already settled): a late offline command is refused with LESSON_ENDED, as before S37.
 */
export function assertLessonRunning(l: LessonRow): void {
  if (l.status !== 'active') throw new AppError('CONFLICT', 'This lesson has already ended', { reason: 'LESSON_ENDED' });
}

/**
 * A command queued on an offline device and sent after the lesson ended (S37, D-218): accepted when
 * the device made it while the lesson ran (its `clientTime` before the end: for an automatic end, before
 * the server wrote it, since the server could not know about the device's work), on the lesson's own
 * local day and not in the future. An abandoned lesson accepts nothing.
 */
function happenedWhileRunning(ctx: RequestContext, l: LessonRow, cls: ClassRow, meta: CommandMeta): boolean {
  const at = meta.clientTime;
  if (at === undefined || l.status !== 'ended' || l.endedAt === null || at > ctx.now()) return false;
  const end = l.autoEndedAt ?? l.endedAt;
  return at < end && localDate(at, effectiveTimezone(ctx.db, cls)) === l.localDate;
}

/** An automatically ended lesson in which a late command happened ends no earlier than that command. */
function lateTarget(ctx: RequestContext, l: LessonRow, at: number): LessonRow {
  if (l.autoEndedAt === null || l.endedAt === null || at <= l.endedAt) return l;
  return updateLesson(ctx, l, { endedAt: at, lastActivityAt: at });
}

/** Apply a change to the lesson row and bump its version (ETag for polling). */
export function updateLesson(ctx: RequestContext, lesson: LessonRow, patch: Partial<LessonRow>): LessonRow {
  const next = { ...patch, version: lesson.version + 1, updatedAt: ctx.now() };
  ctx.db.update(lessons).set(next).where(eq(lessons.id, lesson.id)).run();
  return { ...lesson, ...next };
}

// ---------------------------------------------------------------- lesson state contributors
/**
 * Modules that add classroom-safe data to the polled lesson state (S6 counters). `stamp` must change
 * whenever `body` would change for reasons that do not bump the lesson version (settings edits);
 * changes made by lesson commands bump the version through `updateLesson` already.
 */
export interface LessonStateContributor {
  key: 'counters' | 'secret' | 'assistant' | 'grouping' | 'lessonGoal';
  stamp: (ctx: RequestContext, context: ContextRow, lesson: LessonRow | null) => string;
  body: (ctx: RequestContext, context: ContextRow, lesson: LessonRow | null) => unknown;
}
const contributors: LessonStateContributor[] = [];
export function registerLessonStateContributor(c: LessonStateContributor) {
  if (!contributors.some((x) => x.key === c.key)) contributors.push(c);
}

// ---------------------------------------------------------------- lesson summary contributors
/**
 * Modules that add classroom-safe data to the "Lesson saved" summary (S28a, D-197: today's goal and the
 * class's answer). `build` returns null when there is nothing to show, also when the module is off for
 * the class+subject (its data is kept, CFG-2). The key is a field of the shared `LessonSummary`.
 */
export interface LessonSummaryContributor {
  key: 'lessonGoal';
  build: (db: Db, lesson: LessonRow) => unknown;
}
const summaryContributors: LessonSummaryContributor[] = [];
export function registerLessonSummaryContributor(c: LessonSummaryContributor) {
  if (!summaryContributors.some((x) => x.key === c.key)) summaryContributors.push(c);
}

// ---------------------------------------------------------------- lesson close hooks
/**
 * Modules that must react when a lesson closes, whether or not they are enabled for the context
 * (S7: an unrevealed Secret Student round of an abandoned lesson becomes `unrevealed_abandoned`,
 * D-010). Runs inside the closing transaction, after the End Lesson steps.
 */
export type LessonCloseHook = (ctx: RequestContext, lesson: LessonRow, outcome: 'ended' | 'abandoned') => void;
const closeHooks: LessonCloseHook[] = [];
export function registerLessonCloseHook(fn: LessonCloseHook) {
  if (!closeHooks.includes(fn)) closeHooks.push(fn);
}
const runCloseHooks = (ctx: RequestContext, lesson: LessonRow, outcome: 'ended' | 'abandoned') => closeHooks.forEach((h) => h(ctx, lesson, outcome));

// ---------------------------------------------------------------- forgotten lessons (S37, D-218)
const SYSTEM: Actor = { type: 'system', id: null };

/** Where a settle that failed is reported (main.ts points it at the server log). */
let reportSettleError: (err: unknown, lessonId: string) => void = (err, lessonId) => console.error(`lesson ${lessonId}: settle failed`, err);
export function setSettleErrorReporter(fn: (err: unknown, lessonId: string) => void) {
  reportSettleError = fn;
}

/** The notices about a lesson that is closed now are done: the bell keeps them as read (no dead "End lesson" link). */
const closeLessonNotices = (deps: AppDeps, lessonId: string, categories: Array<'lessonStillRunning' | 'lessonAutoEnded'>) => resolveNotifications(deps, { categories, entityId: lessonId });

/** A context for work the server does by itself (the automatic end): the system is the actor. */
export const systemContext = (deps: AppDeps): RequestContext => ({ ...deps, ip: 'system', session: null, user: null, student: null, actor: SYSTEM });

/** The timer as End Lesson leaves it: stopped at `at`, with the time it had left then. */
function stoppedTimer(t: TimerState, at: number): TimerState {
  return { ...t, running: false, startedAt: null, remainingMs: t.running ? Math.max(0, t.remainingMs - Math.max(0, at - (t.startedAt ?? at))) : t.remainingMs };
}

type Due = 'abandon' | 'end' | 'remind' | null;

/** What the clock asks of an active lesson now (reads only). */
function dueFor(db: Db, l: LessonRow, now: number): Due {
  if (l.status !== 'active') return null;
  const tz = effectiveTimezone(db, getClass(db, l.classId));
  // Started before S37 (no activity column) on an earlier day: closed exactly as the old code did at the
  // next start, abandoned, never a held lesson and never a notice (the first deploy).
  if (l.lastActivityAt === null && l.localDate < localDate(now, tz)) return 'abandon';
  if (now >= autoEndAt(l, endOfLocalDay(l.localDate, tz))) return 'end';
  if (l.remindedAt === null && reminderDue(l, now)) return 'remind';
  return null;
}

/**
 * Brings one lesson up to date with the clock (S37, D-218). The row's clock values are checked first
 * and a write transaction is opened only when something is due (a poll of a lesson in use writes
 * nothing). Inside it the row is read again, so a sweep, a poll and a teacher's End Lesson never close
 * a lesson twice: whoever comes second sees it closed. Writes to a lesson of an archived class or year
 * without `assertClassWritable` on purpose: closing must work there too (DAT-1 is about people's edits).
 */
export function settleLesson(deps: AppDeps, row: LessonRow | string): LessonRow | null {
  const first = typeof row === 'string' ? deps.db.select().from(lessons).where(eq(lessons.id, row)).get() : row;
  if (!first || !dueFor(deps.db, first, deps.now())) return first ?? null;
  return tx(deps.db, () => {
    const lesson = deps.db.select().from(lessons).where(eq(lessons.id, first.id)).get()!;
    const now = deps.now();
    const due = dueFor(deps.db, lesson, now);
    const ctx = systemContext(deps);
    if (due === 'abandon') {
      const abandoned = updateLesson(ctx, lesson, { status: 'abandoned', timerJson: stoppedTimer(lesson.timerJson, now) });
      runCloseHooks(ctx, abandoned, 'abandoned');
      audit(deps.db, SYSTEM, { action: 'lesson.abandon', entity: 'lesson', entityId: lesson.id, after: { localDate: lesson.localDate, reason: 'before_auto_end' } }, now);
      closeLessonNotices(deps, lesson.id, ['lessonStillRunning']);
      return abandoned;
    }
    if (due === 'end') {
      // Nothing that needs a person is done: no End Lesson step runs, so what they record stays empty.
      // Ended at the last activity, the honest end of teaching.
      const endAt = Math.min(now, lastActivityOf(lesson));
      const skipped = endStepsFor(deps.db, lesson.contextId, lesson).map((s) => s.key);
      const ended = updateLesson(ctx, lesson, { status: 'ended', endedAt: endAt, autoEndedAt: now, timerJson: stoppedTimer(lesson.timerJson, endAt) });
      runCloseHooks(ctx, ended, 'ended');
      audit(deps.db, SYSTEM, { action: 'lesson.auto_end', entity: 'lesson', entityId: lesson.id, after: { contextId: lesson.contextId, localDate: lesson.localDate, endedAt: endAt, stageReached: ended.stageIndex, skippedSteps: skipped } }, now);
      closeLessonNotices(deps, lesson.id, ['lessonStillRunning']);
      notify(deps, { category: 'lessonAutoEnded', studentId: null, subjectId: null, contextId: lesson.contextId, entity: 'lesson', entityId: lesson.id });
      return ended;
    }
    if (due === 'remind') {
      // The notification goes out once per lesson; the note on screen follows the clock (in the ETag).
      deps.db.update(lessons).set({ remindedAt: now }).where(eq(lessons.id, lesson.id)).run();
      notify(deps, { category: 'lessonStillRunning', studentId: null, subjectId: null, contextId: lesson.contextId, entity: 'lesson', entityId: lesson.id });
      return { ...lesson, remindedAt: now };
    }
    return lesson;
  });
}

/** `settleLesson` for a read: a failure is reported and the lesson served as it is, never a 500. */
export function settleForRead(deps: AppDeps, row: LessonRow): LessonRow {
  try {
    return settleLesson(deps, row) ?? row;
  } catch (err) {
    reportSettleError(err, row.id);
    return row;
  }
}

/** The context's running lesson after settling (undefined when there is none, or it just closed). */
function activeSettled(deps: AppDeps, contextId: string): LessonRow | undefined {
  const active = getActiveLesson(deps.db, contextId);
  if (!active) return undefined;
  const settled = settleForRead(deps, active);
  return settled.status === 'active' ? settled : undefined;
}

// ---------------------------------------------------------------- reads
export function lessonState(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const tz = effectiveTimezone(ctx.db, cls);
  const now = ctx.now();
  const today = localDate(now, tz);
  // A lesson past its limit is ended here, so a board that has been polling shows the end (S37, D-218).
  const active = activeSettled(ctx, context.id);
  const lesson = active && active.localDate >= today ? active : null;
  const stamp = isModuleEnabled(ctx.db, context.id, 'attendance') ? attendanceStamp(ctx.db, cls.id, lesson?.localDate ?? today, lesson?.id ?? null) : 'off';
  const extra = contributors.map((c) => c.stamp(ctx, context, lesson)).join('.');
  // Today's closure (holiday calendar, D-186) is in the ETag, so a holiday added for today shows its note.
  const closure = closureOn(ctx.db, cls.schoolYearId, today);
  const dto = lesson ? lessonDto(ctx.db, lesson, now) : null;
  // The reminder follows the clock and the last activity, not the version (S37, D-218): it is in the ETag.
  const etag = `"${lesson ? `${lesson.id}.${lesson.version}.${dto!.overdue ? 'o' : 'r'}.${dto!.autoEndAt}` : 'none'}.${today}.${stamp}.${extra}.${closure ? `c-${closure.id}-${closure.updatedAt}` : 'open'}"`;
  const bodies = Object.fromEntries(contributors.map((c) => [c.key, c.body(ctx, context, lesson)]));
  return {
    etag,
    body: {
      lesson: dto,
      today: { localDate: today, weekday: weekdayOf(today), timezone: tz, closure: closure ? { name: closure.name } : null },
      serverNow: now,
      attendanceStamp: stamp,
      counters: (bodies.counters ?? null) as CountersLessonState | null,
      secret: (bodies.secret ?? null) as SecretLessonState | null,
      assistant: (bodies.assistant ?? null) as AssistantToday | null,
      grouping: (bodies.grouping ?? null) as GroupingLessonState | null,
      lessonGoal: (bodies.lessonGoal ?? null) as LessonGoalState | null,
    },
  };
}

export function activeLessons(ctx: RequestContext) {
  const rows = ctx.db
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(teachingContexts, eq(teachingContexts.id, lessons.contextId))
    .where(and(eq(lessons.teacherId, requireUser(ctx).id), eq(lessons.status, 'active'), isNull(teachingContexts.endedAt)))
    .all();
  return {
    lessons: rows
      .map(({ lesson }) => ({ lesson: settleForRead(ctx, lesson) }))
      .filter(({ lesson }) => lesson.status === 'active' && isCurrent(ctx, lesson, getClass(ctx.db, lesson.classId)))
      .map(({ lesson }) => ({ contextId: lesson.contextId, lessonId: lesson.id, startedAt: lesson.startedAt, stageIndex: lesson.stageIndex, stageCount: lesson.routineSnapshotJson.length })),
  };
}

export function lessonRoutines(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const tid = requireUser(ctx).id;
  return { enabled: isModuleEnabled(ctx.db, context.id, 'routines'), defaultTemplateId: defaultTemplateId(ctx.db, tid, context.id), templates: usableTemplates(ctx.db, tid, context.id) };
}

export function lessonRoster(ctx: RequestContext, contextId: string, lessonId?: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  let date = todayFor(ctx, cls);
  let lesson: LessonRow | null = null;
  if (lessonId) {
    lesson = ctx.db.select().from(lessons).where(eq(lessons.id, lessonId)).get() ?? null;
    if (!lesson || lesson.contextId !== context.id) throw notFound('Lesson');
    date = lesson.localDate;
  }
  const enabled = isModuleEnabled(ctx.db, context.id, 'attendance');
  return { localDate: date, attendanceEnabled: enabled, students: rosterWithAttendance(ctx.db, cls.id, date, lesson?.id ?? null, enabled) };
}

export function summaryOf(db: Db, l: LessonRow): LessonSummary {
  const extra = Object.fromEntries(summaryContributors.map((c) => [c.key, c.build(db, l)]));
  return {
    id: l.id,
    contextId: l.contextId,
    status: l.status,
    className: l.classNameSnapshot,
    subjectName: l.subjectNameSnapshot,
    localDate: l.localDate,
    startedAt: l.startedAt,
    endedAt: l.endedAt,
    routineName: l.routineNameJson,
    stageCount: l.routineSnapshotJson.length,
    stageReached: l.routineSnapshotJson.length ? l.stageIndex + 1 : 0,
    attendance: isModuleEnabled(db, l.contextId, 'attendance') ? lessonAttendanceCounts(db, l) : null,
    reflection: l.reflectionJson ?? null,
    lessonGoal: (extra.lessonGoal ?? null) as LessonGoalState | null,
    autoEnded: l.autoEndedAt !== null,
  };
}

/**
 * Classroom-access summary (shown right after End Lesson). Only for lessons of a context the teacher
 * still teaches, and the private reflection note only for a lesson of the class's current local day:
 * older notes are teacher-area data and must not be readable from a locked classroom device (PIN-1,
 * PIN-8).
 */
export function lessonSummary(ctx: RequestContext, lessonId: string): LessonSummary {
  const l = ctx.db.select().from(lessons).where(eq(lessons.id, lessonId)).get();
  if (!l || l.teacherId !== requireUser(ctx).id) throw notFound('Lesson');
  const context = ctx.db.select().from(teachingContexts).where(eq(teachingContexts.id, l.contextId)).get();
  if (!context || context.endedAt !== null) throw notFound('Lesson');
  const summary = summaryOf(ctx.db, l);
  if (summary.reflection && l.localDate < todayFor(ctx, getClass(ctx.db, l.classId))) summary.reflection = { ...summary.reflection, note: null };
  return summary;
}

// ---------------------------------------------------------------- commands
export function startLesson(ctx: RequestContext, p: P<'lesson.start'>, meta: CommandMeta) {
  if (meta.contextId && meta.contextId !== p.contextId) wrongLesson();
  const context = assertOwnsContext(ctx, p.contextId);
  const cls = getClass(ctx.db, context.classId);
  assertClassWritable(ctx.db, cls);
  const now = ctx.now();
  const today = todayFor(ctx, cls);
  // A start queued offline and sent on a later day (D-190): its attendance and duty ticks are that
  // day's, so it neither starts a lesson today nor writes them onto today (AUDIT). Old clients send no
  // date; a later date can only be a device clock running ahead and is today for the teacher.
  if (p.localDate !== undefined && p.localDate < today) throw new AppError('CONFLICT', 'This start was made on another day', { reason: 'START_STALE' });
  // A forgotten lesson past its limit is ended first (S37, D-218), so the next start is a normal one.
  const existing = activeSettled(ctx, context.id);
  if (existing) {
    // LES-2: never a second lesson. The client resumes the running one. The attendance the teacher
    // just confirmed is shared daily data for today and is still applied (D-053), never dropped.
    if (existing.localDate >= today) {
      const attendanceKept = applyStartAttendance(ctx, context.id, cls, today, p, meta.opId);
      // Only the steps that record per-day data run on a resume (S14b, D-149: the duty ticks).
      const notes = runStartSteps(ctx, existing, p.steps, { resumed: true, opId: meta.opId });
      return { started: false, reason: 'LESSON_ALREADY_ACTIVE' as const, lessonId: existing.id, attendanceKept, ...notes };
    }
    // Left running past the end of its day: abandon it (keep its data) and start fresh.
    const abandoned = updateLesson(ctx, existing, { status: 'abandoned', timerJson: { ...existing.timerJson, running: false, startedAt: null } });
    runCloseHooks(ctx, abandoned, 'abandoned');
    closeLessonNotices(ctx, existing.id, ['lessonStillRunning']);
    audit(ctx.db, ctx.actor, { action: 'lesson.abandon', entity: 'lesson', entityId: existing.id, after: { localDate: existing.localDate, reason: 'next_day' }, opId: meta.opId }, now);
  }
  const tid = requireUser(ctx).id;
  const routinesOn = isModuleEnabled(ctx.db, context.id, 'routines');
  const routine = routinesOn ? resolveRoutine(ctx.db, tid, context.id, p.routineTemplateId) : { templateId: null, name: {}, stages: [] };
  const subject = ctx.db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, context.subjectId)).get();
  const startTopics = usableTopicSnapshots(ctx.db, context, p.topicIds ?? plannedTopics(ctx.db, context, today));
  const row: LessonRow = {
    id: meta.opId,
    contextId: context.id,
    teacherId: tid,
    classId: cls.id,
    status: 'active',
    startedAt: now,
    endedAt: null,
    localDate: today,
    routineTemplateId: routine.templateId,
    routineNameJson: routine.name,
    routineSnapshotJson: routine.stages,
    stageIndex: 0,
    timerJson: idleTimer(),
    reflectionJson: null,
    // Today's topic(s): as chosen on the start screen, otherwise the weekly plan's (S13a, D-101).
    // A topic archived since the device cached its choices is dropped (audited), never a failed start.
    topicsJson: startTopics.topics,
    displayJson: {},
    version: 1,
    classNameSnapshot: cls.name,
    subjectNameSnapshot: subject?.name ?? {},
    updatedAt: now,
    lastActivityAt: now,
    autoEndedAt: null,
    remindedAt: null,
    autoEndSeenAt: null,
  };
  ctx.db.insert(lessons).values(row).run();
  const attendanceKept = applyStartAttendance(ctx, context.id, cls, today, p, meta.opId);
  // Module start steps after attendance, so they see who is in the room (S14b, D-149).
  const notes = runStartSteps(ctx, row, p.steps, { resumed: false, opId: meta.opId });
  audit(ctx.db, ctx.actor, { action: 'lesson.start', entity: 'lesson', entityId: row.id, after: { contextId: context.id, localDate: today, routine: routine.templateId, stages: routine.stages.length, ...(startTopics.dropped.length ? { droppedTopics: startTopics.dropped } : {}) }, opId: meta.opId }, now);
  return { started: true, lessonId: row.id, attendanceKept, ...notes };
}

/**
 * Daily attendance from the start screen (LES-1, ACC-8, D-053). Entries carrying `expected` are
 * written only if the record still has that status (a colleague's newer record wins and is
 * counted in the result); `othersPresent` then marks everyone still without a record present.
 * Returns how many entries were kept unchanged because the record had changed.
 */
function applyStartAttendance(ctx: RequestContext, contextId: string, cls: ClassRow, today: string, p: P<'lesson.start'>, opId: string): number {
  if (!isModuleEnabled(ctx.db, contextId, 'attendance')) return 0;
  let kept = 0;
  if (p.attendance?.length) {
    const daily = dailyFor(ctx.db, cls.id, today);
    for (const a of p.attendance) {
      const current = daily.get(a.studentId)?.status ?? null;
      if (a.expected !== undefined && current !== a.expected && current !== a.status) {
        kept += 1;
        continue;
      }
      setDailyCore(ctx, cls, today, a.studentId, a.status, undefined, opId);
    }
  }
  if (p.othersPresent) markAllPresentCore(ctx, cls, today, opId);
  return kept;
}

export function setStage(ctx: RequestContext, p: P<'lesson.setStage'>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'routines');
  const count = lesson.routineSnapshotJson.length;
  if (p.stageIndex >= Math.max(1, count)) throw new AppError('VALIDATION', 'No such stage', { reason: 'STAGE_OUT_OF_RANGE' });
  const index = clampStage(p.stageIndex, count);
  if (index === lesson.stageIndex) return { stageIndex: index, version: lesson.version };
  const next = updateLesson(ctx, lesson, { stageIndex: index });
  return { stageIndex: index, version: next.version };
}

/** 'lesson.setTopics' (S13a): change today's topic(s) during the lesson; snapshots kept (DAT-6). */
export function setTopics(ctx: RequestContext, p: P<'lesson.setTopics'>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  // A topic archived since the device cached its choices is dropped (audited), not a rejected command.
  const { topics, dropped } = usableTopicSnapshots(ctx.db, context, p.topicIds);
  if (JSON.stringify(topics.map((t) => t.id)) === JSON.stringify(lesson.topicsJson.map((t) => t.id))) return { changed: false, version: lesson.version };
  const next = updateLesson(ctx, lesson, { topicsJson: topics });
  audit(ctx.db, ctx.actor, { action: 'lesson.topics', entity: 'lesson', entityId: lesson.id, opId: meta.opId, before: { topics: lesson.topicsJson.map((t) => t.id) }, after: { topics: topics.map((t) => t.id), ...(dropped.length ? { droppedTopics: dropped } : {}) } }, ctx.now());
  return { changed: true, version: next.version };
}

/** 'lesson.setDisplay' (S13a): per-lesson display choices shared by every device of the lesson. */
export function setDisplay(ctx: RequestContext, p: P<'lesson.setDisplay'>, meta: CommandMeta) {
  const { lesson } = lessonForCommand(ctx, p, meta);
  const display = { ...lesson.displayJson };
  if (p.assistantVisible === null) delete display.assistantVisible;
  else display.assistantVisible = p.assistantVisible;
  const next = updateLesson(ctx, lesson, { displayJson: display });
  return { version: next.version };
}

export function changeTimer(ctx: RequestContext, p: { contextId: string; lessonId: string }, meta: CommandMeta, fn: (t: TimerState, now: number) => TimerState) {
  const { lesson } = lessonForCommand(ctx, p, meta);
  // A timer tap that arrives after the lesson ended (S37, D-218: queued offline) changes nothing.
  if (lesson.status !== 'active') return { timer: lesson.timerJson, version: lesson.version };
  const timer = fn(lesson.timerJson, ctx.now());
  const next = updateLesson(ctx, lesson, { timerJson: timer });
  return { timer, version: next.version };
}

/** "Still teaching" (S37, D-218): the reminder's button, and End Lesson while it is open. Activity only. */
export function stillTeaching(ctx: RequestContext, p: P<'lesson.stillTeaching'>, meta: CommandMeta) {
  const { lesson } = lessonForCommand(ctx, p, meta);
  return { active: lesson.status === 'active' };
}

/**
 * End Lesson on a lesson the server already ended (S37, D-218): what the teacher answered is kept.
 * Every step runs where it still can; a step that declares `canApplyLate` and answers false (the Secret
 * Student round was closed unrevealed) is skipped and named in `notApplied`. The lesson then counts as
 * ended by the teacher (the automatic mark is cleared, `endedAt` stays the last activity, the close
 * hooks already ran) and its "ended automatically" notice is gone.
 */
function lateEnd(ctx: RequestContext, l: LessonRow, p: P<'lesson.end'>, meta: CommandMeta) {
  assertClassWritable(ctx.db, getClass(ctx.db, l.classId));
  const notApplied: string[] = [];
  for (const step of endStepsFor(ctx.db, l.contextId, l)) {
    const parsed = step.input.safeParse(p.steps[step.key] ?? {});
    if (!parsed.success) throw new AppError('VALIDATION', `Invalid input for step ${step.key}`, { reason: 'END_STEP_INVALID', step: step.key });
    if (step.canApplyLate && !step.canApplyLate(ctx.db, l)) notApplied.push(step.key);
    else step.apply(ctx, l, parsed.data);
  }
  const fresh = ctx.db.select().from(lessons).where(eq(lessons.id, l.id)).get()!;
  const ended = updateLesson(ctx, fresh, { autoEndedAt: null, autoEndSeenAt: null });
  audit(ctx.db, ctx.actor, { action: 'lesson.end', entity: 'lesson', entityId: l.id, after: { stageReached: ended.stageIndex, reflection: ended.reflectionJson?.rating ?? null, late: true, autoEndedAt: l.autoEndedAt, notApplied }, opId: meta.opId }, ctx.now());
  closeLessonNotices(ctx, l.id, ['lessonStillRunning', 'lessonAutoEnded']);
  return { ...summaryOf(ctx.db, ended), notApplied };
}

export function endLesson(ctx: RequestContext, p: P<'lesson.end'>, meta: CommandMeta) {
  if ((meta.contextId && meta.contextId !== p.contextId) || (meta.lessonId && meta.lessonId !== p.lessonId)) wrongLesson();
  const prior = ctx.db.select().from(lessons).where(eq(lessons.id, p.lessonId)).get();
  if (prior && prior.autoEndedAt !== null && prior.contextId === p.contextId) {
    assertOwnsContext(ctx, p.contextId);
    return lateEnd(ctx, prior, p, meta);
  }
  const { lesson } = lessonForCommand(ctx, p, meta);
  // A second End Lesson queued offline for a lesson a teacher already ended keeps its old answer.
  if (lesson.status !== 'active') throw new AppError('CONFLICT', 'This lesson has already ended', { reason: 'LESSON_ENDED' });
  // Module steps first (S7: Secret Student reveal/outcomes, assistant thanks), then the core reflection (LES-3).
  for (const step of endStepsFor(ctx.db, lesson.contextId, lesson)) {
    const parsed = step.input.safeParse(p.steps[step.key] ?? {});
    if (!parsed.success) throw new AppError('VALIDATION', `Invalid input for step ${step.key}`, { reason: 'END_STEP_INVALID', step: step.key });
    step.apply(ctx, lesson, parsed.data);
  }
  const now = ctx.now();
  const fresh = ctx.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!;
  const ended = updateLesson(ctx, fresh, { status: 'ended', endedAt: now, timerJson: stoppedTimer(fresh.timerJson, now) });
  runCloseHooks(ctx, ended, 'ended');
  audit(ctx.db, ctx.actor, { action: 'lesson.end', entity: 'lesson', entityId: lesson.id, after: { stageReached: ended.stageIndex, reflection: ended.reflectionJson?.rating ?? null }, opId: meta.opId }, now);
  closeLessonNotices(ctx, lesson.id, ['lessonStillRunning']);
  return summaryOf(ctx.db, ended);
}
