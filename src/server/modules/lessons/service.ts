/**
 * Lesson lifecycle (LES-1..4, DSH-1/2/4, RTN-3). One active lesson per teaching context (DB-enforced).
 * Starting is an explicit, idempotent command; a second start resumes the running lesson instead of
 * creating another (LES-2). Every command names the lesson the device believed was active and is
 * refused with WRONG_LESSON otherwise, so a queued tap can never land on another class (LES-4).
 * A lesson left active past the end of its local day is abandoned (not ended, data kept) when the
 * next lesson starts in that context.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { localDate, weekdayOf } from '../../../domain/dates.ts';
import { clampStage } from '../../../domain/routines.ts';
import { idleTimer, type TimerState } from '../../../domain/timer.ts';
import type { AssistantToday } from '../../../shared/contracts/assistant.ts';
import type { CountersLessonState } from '../../../shared/contracts/counters.ts';
import type { GroupingLessonState } from '../../../shared/contracts/grouping.ts';
import type { LessonGoalState } from '../../../shared/contracts/lessonGoals.ts';
import type { SecretLessonState } from '../../../shared/contracts/secret.ts';
import type { LessonCommands, LessonState, LessonSummary } from '../../../shared/contracts/lessons.ts';
import { lessons, subjects, teachingContexts } from '../../db/schema.ts';
import type { Db } from '../../db/client.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
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

export function lessonDto(db: Db, l: LessonRow): LessonState {
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
      throw new AppError('CONFLICT', 'This lesson has already ended', { reason: 'LESSON_ENDED' });
    }
    wrongLesson();
  }
  return { context, cls, lesson };
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

// ---------------------------------------------------------------- reads
export function lessonState(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const tz = effectiveTimezone(ctx.db, cls);
  const now = ctx.now();
  const today = localDate(now, tz);
  const active = getActiveLesson(ctx.db, context.id);
  const lesson = active && active.localDate >= today ? active : null;
  const stamp = isModuleEnabled(ctx.db, context.id, 'attendance') ? attendanceStamp(ctx.db, cls.id, lesson?.localDate ?? today, lesson?.id ?? null) : 'off';
  const extra = contributors.map((c) => c.stamp(ctx, context, lesson)).join('.');
  // Today's closure (holiday calendar, D-186) is in the ETag, so a holiday added for today shows its note.
  const closure = closureOn(ctx.db, cls.schoolYearId, today);
  const etag = `"${lesson ? `${lesson.id}.${lesson.version}` : 'none'}.${today}.${stamp}.${extra}.${closure ? `c-${closure.id}-${closure.updatedAt}` : 'open'}"`;
  const bodies = Object.fromEntries(contributors.map((c) => [c.key, c.body(ctx, context, lesson)]));
  return {
    etag,
    body: {
      lesson: lesson ? lessonDto(ctx.db, lesson) : null,
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
      .filter(({ lesson }) => isCurrent(ctx, lesson, getClass(ctx.db, lesson.classId)))
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
  const existing = getActiveLesson(ctx.db, context.id);
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
  const timer = fn(lesson.timerJson, ctx.now());
  const next = updateLesson(ctx, lesson, { timerJson: timer });
  return { timer, version: next.version };
}

export function endLesson(ctx: RequestContext, p: P<'lesson.end'>, meta: CommandMeta) {
  const { lesson } = lessonForCommand(ctx, p, meta);
  // Module steps first (S7: Secret Student reveal/outcomes, assistant thanks), then the core reflection (LES-3).
  for (const step of endStepsFor(ctx.db, lesson.contextId, lesson)) {
    const parsed = step.input.safeParse(p.steps[step.key] ?? {});
    if (!parsed.success) throw new AppError('VALIDATION', `Invalid input for step ${step.key}`, { reason: 'END_STEP_INVALID', step: step.key });
    step.apply(ctx, lesson, parsed.data);
  }
  const now = ctx.now();
  const fresh = ctx.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!;
  const ended = updateLesson(ctx, fresh, {
    status: 'ended',
    endedAt: now,
    timerJson: { ...fresh.timerJson, running: false, startedAt: null, remainingMs: fresh.timerJson.running ? Math.max(0, fresh.timerJson.remainingMs - (now - (fresh.timerJson.startedAt ?? now))) : fresh.timerJson.remainingMs },
  });
  runCloseHooks(ctx, ended, 'ended');
  audit(ctx.db, ctx.actor, { action: 'lesson.end', entity: 'lesson', entityId: lesson.id, after: { stageReached: ended.stageIndex, reflection: ended.reflectionJson?.rating ?? null }, opId: meta.opId }, now);
  return summaryOf(ctx.db, ended);
}
