/**
 * Attendance (ACC-8/9, ATT-1/2). Daily attendance is shared class data: any teacher with an active
 * context in the class may change it, and every change is audited with its actor. Lesson exceptions
 * belong to the lesson (context-owned, ACC-10). Effective status for a lesson:
 * exception › daily › not recorded. Stored completely separately from homework (ATT-1).
 */
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { countAttendance, effectiveAttendance, type AttendanceStatus, type EffectiveAttendance } from '../../../domain/attendance.ts';
import type * as C from '../../../shared/contracts/lessons.ts';
import { initials } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { attendanceDaily, attendanceLessonExceptions, auditEvents, lessons, students, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId, sha256 } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { assertClassWritable, assertTeachesClass, getClass, getYear, todayFor, type ClassRow } from '../school/policy.ts';
import { rosterRowsOn } from '../students/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type DailyRowDb = typeof attendanceDaily.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;

export function dailyFor(db: Db, classId: string, date: string): Map<string, DailyRowDb> {
  const ids = rosterRowsOn(db, classId, date).map((r) => r.student.id);
  if (ids.length === 0) return new Map();
  const rows = db
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.localDate, date), inArray(attendanceDaily.studentId, ids)))
    .all();
  return new Map(rows.map((r) => [r.studentId, r]));
}

export function exceptionsFor(db: Db, lessonId: string) {
  const rows = db.select().from(attendanceLessonExceptions).where(eq(attendanceLessonExceptions.lessonId, lessonId)).all();
  return new Map(rows.map((r) => [r.studentId, r]));
}

/**
 * Changes whenever anything that affects a lesson's attendance view changes (daily rows of the class
 * and date, the lesson's exceptions). Part of the lesson-state ETag, so another teacher's daily
 * change reaches every classroom device within one poll.
 */
export function attendanceStamp(db: Db, classId: string, date: string, lessonId: string | null): string {
  const daily = [...dailyFor(db, classId, date).values()].map((r) => `${r.studentId}:${r.status}:${r.updatedAt}`).sort();
  const exc = lessonId ? [...exceptionsFor(db, lessonId).values()].map((r) => `${r.studentId}:${r.status}:${r.updatedAt}`).sort() : [];
  return sha256(`${daily.join(',')}|${exc.join(',')}`).slice(0, 16);
}

function assertOnRoster(db: Db, classId: string, date: string, studentId: string) {
  if (!rosterRowsOn(db, classId, date).some((r) => r.student.id === studentId)) {
    throw new AppError('CONFLICT', 'This student is not in the class on this day', { reason: 'STUDENT_NOT_IN_CLASS' });
  }
}

/**
 * Set (or clear with `status: null`) one student's daily attendance. Audited (ACC-9). Writing the
 * same status again is a no-op. Must run inside a transaction.
 */
export function setDailyCore(
  ctx: RequestContext,
  cls: ClassRow,
  date: string,
  studentId: string,
  status: AttendanceStatus | null,
  note: string | null | undefined,
  opId: string | null = null,
): DailyRowDb | null {
  assertOnRoster(ctx.db, cls.id, date, studentId);
  const uid = requireUser(ctx).id;
  const now = ctx.now();
  const existing = ctx.db
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.studentId, studentId), eq(attendanceDaily.localDate, date)))
    .get();
  const snap = (r: DailyRowDb | null | undefined) => (r ? { studentId, classId: r.classId, date, status: r.status, note: r.note } : { studentId, classId: cls.id, date, status: null, note: null });
  if (status === null) {
    if (!existing) return null;
    ctx.db.delete(attendanceDaily).where(eq(attendanceDaily.id, existing.id)).run();
    audit(ctx.db, ctx.actor, { action: 'attendance.clear_daily', entity: 'attendance_daily', entityId: existing.id, before: snap(existing), after: snap(null), opId }, now);
    return null;
  }
  const nextNote = note === undefined ? (existing?.note ?? null) : note?.trim() ? note.trim() : null;
  if (existing && existing.status === status && existing.note === nextNote && existing.classId === cls.id) return existing;
  let row: DailyRowDb;
  if (existing) {
    ctx.db.update(attendanceDaily).set({ status, note: nextNote, classId: cls.id, recordedBy: uid, updatedAt: now }).where(eq(attendanceDaily.id, existing.id)).run();
    row = { ...existing, status, note: nextNote, classId: cls.id, recordedBy: uid, updatedAt: now };
  } else {
    row = { id: newId(), studentId, classId: cls.id, localDate: date, status, note: nextNote, recordedBy: uid, createdAt: now, updatedAt: now };
    ctx.db.insert(attendanceDaily).values(row).run();
  }
  audit(ctx.db, ctx.actor, { action: 'attendance.set_daily', entity: 'attendance_daily', entityId: row.id, before: snap(existing), after: snap(row), opId }, now);
  return row;
}

/** Set (or clear) a lesson-only exception (ATT-2). Audited. Must run inside a transaction. */
export function setExceptionCore(
  ctx: RequestContext,
  lesson: LessonRow,
  studentId: string,
  status: AttendanceStatus | null,
  note: string | null | undefined,
  opId: string | null = null,
): boolean {
  assertOnRoster(ctx.db, lesson.classId, lesson.localDate, studentId);
  const now = ctx.now();
  const key = and(eq(attendanceLessonExceptions.lessonId, lesson.id), eq(attendanceLessonExceptions.studentId, studentId));
  const existing = ctx.db.select().from(attendanceLessonExceptions).where(key).get();
  const base = { lessonId: lesson.id, teacherId: lesson.teacherId, studentId, classId: lesson.classId, date: lesson.localDate };
  const entityId = `${lesson.id}:${studentId}`;
  if (status === null) {
    if (!existing) return false;
    ctx.db.delete(attendanceLessonExceptions).where(key).run();
    audit(ctx.db, ctx.actor, { action: 'attendance.clear_exception', entity: 'attendance_lesson_exception', entityId, before: { ...base, status: existing.status }, after: { ...base, status: null }, opId }, now);
    return true;
  }
  const nextNote = note === undefined ? (existing?.note ?? null) : note?.trim() ? note.trim() : null;
  if (existing && existing.status === status && existing.note === nextNote) return false;
  const values = { lessonId: lesson.id, studentId, status, note: nextNote, recordedBy: requireUser(ctx).id, updatedAt: now };
  ctx.db
    .insert(attendanceLessonExceptions)
    .values(values)
    .onConflictDoUpdate({ target: [attendanceLessonExceptions.lessonId, attendanceLessonExceptions.studentId], set: { status, note: nextNote, recordedBy: values.recordedBy, updatedAt: now } })
    .run();
  audit(ctx.db, ctx.actor, { action: 'attendance.set_exception', entity: 'attendance_lesson_exception', entityId, before: { ...base, status: existing?.status ?? null }, after: { ...base, status }, opId }, now);
  return true;
}

/** Everyone without a daily record on the lesson's day becomes present; existing records stay (UX-8). */
export function markAllPresentCore(ctx: RequestContext, cls: ClassRow, date: string, opId: string | null): number {
  const existing = dailyFor(ctx.db, cls.id, date);
  let n = 0;
  for (const { student } of rosterRowsOn(ctx.db, cls.id, date)) {
    if (existing.has(student.id)) continue;
    setDailyCore(ctx, cls, date, student.id, 'present', undefined, opId);
    n += 1;
  }
  return n;
}

/** Roster with daily/exception/effective statuses (classroom-safe: no notes). */
export function rosterWithAttendance(db: Db, classId: string, date: string, lessonId: string | null, attendanceEnabled: boolean) {
  const daily = attendanceEnabled ? dailyFor(db, classId, date) : new Map<string, DailyRowDb>();
  const exc = attendanceEnabled && lessonId ? exceptionsFor(db, lessonId) : new Map<string, { status: AttendanceStatus }>();
  return rosterRowsOn(db, classId, date).map(({ student: s }) => {
    const d = daily.get(s.id)?.status ?? null;
    const e = exc.get(s.id)?.status ?? null;
    return { id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue, daily: d, exception: e, effective: effectiveAttendance(e, d) };
  });
}

export function lessonAttendanceCounts(db: Db, lesson: LessonRow) {
  const rows = rosterWithAttendance(db, lesson.classId, lesson.localDate, lesson.id, true);
  return countAttendance(rows.map((r) => r.effective as EffectiveAttendance));
}

// ---------------------------------------------------------------- teacher area (PIN-gated)
const userName = (db: Db, id: string | null) => (id ? (db.select({ n: users.displayName }).from(users).where(eq(users.id, id)).get()?.n ?? null) : null);

function assertDateInYear(db: Db, cls: ClassRow, date: string) {
  const y = getYear(db, cls.schoolYearId);
  if (date < y.startsOn || date > y.endsOn) throw new AppError('VALIDATION', 'The date is outside the school year', { reason: 'DATE_OUTSIDE_YEAR' });
}

function dailyDto(db: Db, s: { id: string; fullName: string; avatarHue: number }, r: DailyRowDb | undefined) {
  return {
    studentId: s.id,
    fullName: s.fullName,
    initials: initials(s.fullName),
    avatarHue: s.avatarHue,
    status: r?.status ?? null,
    note: r?.note ?? null,
    recordedByName: r ? userName(db, r.recordedBy) : null,
    updatedAt: r?.updatedAt ?? null,
  };
}

export function getClassAttendance(ctx: RequestContext, input: In<typeof C.getClassAttendance>) {
  const cls = assertTeachesClass(ctx, input.classId);
  const today = todayFor(ctx, cls);
  const date = input.date ?? today;
  const daily = dailyFor(ctx.db, cls.id, date);
  const roster = rosterRowsOn(ctx.db, cls.id, date);
  // Only the signed-in teacher's own lessons: lesson records are context-owned (ACC-10).
  const mine = ctx.db
    .select()
    .from(lessons)
    .where(and(eq(lessons.classId, cls.id), eq(lessons.localDate, date), eq(lessons.teacherId, requireUser(ctx).id)))
    .all()
    .sort((a, b) => a.startedAt - b.startedAt);
  return {
    classId: cls.id,
    className: cls.name,
    date,
    today,
    students: roster.map(({ student }) => dailyDto(ctx.db, student, daily.get(student.id))),
    lessons: mine.map((l) => ({
      id: l.id,
      contextId: l.contextId,
      subjectName: l.subjectNameSnapshot,
      status: l.status,
      startedAt: l.startedAt,
      exceptions: [...exceptionsFor(ctx.db, l.id).values()].map((e) => ({ studentId: e.studentId, status: e.status, note: e.note })),
    })),
  };
}

export function setClassAttendance(ctx: RequestContext, input: In<typeof C.setClassAttendance>) {
  return tx(ctx.db, () => {
    const cls = assertTeachesClass(ctx, input.classId);
    assertClassWritable(ctx.db, cls);
    assertDateInYear(ctx.db, cls, input.date);
    const row = setDailyCore(ctx, cls, input.date, input.studentId, input.status, input.note);
    const student = ctx.db.select().from(students).where(eq(students.id, input.studentId)).get()!;
    return dailyDto(ctx.db, student, row ?? undefined);
  });
}

export function setLessonExceptionTeacher(ctx: RequestContext, input: In<typeof C.setLessonExceptionTeacher>) {
  tx(ctx.db, () => {
    const lesson = ctx.db.select().from(lessons).where(eq(lessons.id, input.lessonId)).get();
    if (!lesson || lesson.teacherId !== requireUser(ctx).id) throw notFound('Lesson');
    assertClassWritable(ctx.db, getClass(ctx.db, lesson.classId));
    if (setExceptionCore(ctx, lesson, input.studentId, input.status, input.note)) {
      ctx.db.update(lessons).set({ version: lesson.version + 1, updatedAt: ctx.now() }).where(eq(lessons.id, lesson.id)).run();
    }
  });
  return { ok: true as const };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function attendanceHistory(ctx: RequestContext, input: In<typeof C.attendanceHistory>) {
  const cls = assertTeachesClass(ctx, input.classId);
  const to = input.to ?? todayFor(ctx, cls);
  const from = input.from ?? addDays(to, -29);
  if (from > to) throw new AppError('VALIDATION', 'Start date after end date', { reason: 'DATES_REVERSED' });
  if (addDays(from, 366) < to) throw new AppError('VALIDATION', 'Range too long', { reason: 'RANGE_TOO_LONG' });
  const rows = ctx.db
    .select()
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.classId, cls.id), gte(attendanceDaily.localDate, from), lte(attendanceDaily.localDate, to)))
    .all();
  const dates = [...new Set(rows.map((r) => r.localDate))].sort().reverse();
  const days = dates.map((date) => {
    const daily = dailyFor(ctx.db, cls.id, date);
    const statuses = rosterRowsOn(ctx.db, cls.id, date).map(({ student }) => effectiveAttendance(null, daily.get(student.id)?.status ?? null));
    return { date, ...countAttendance(statuses) };
  });

  const date = input.date ?? to;
  const me = requireUser(ctx).id;
  const audits = ctx.db
    .select()
    .from(auditEvents)
    .where(
      and(
        or(eq(auditEvents.entity, 'attendance_daily'), eq(auditEvents.entity, 'attendance_lesson_exception')),
        sql`json_extract(coalesce(${auditEvents.afterJson}, ${auditEvents.beforeJson}), '$.classId') = ${cls.id}`,
        sql`json_extract(coalesce(${auditEvents.afterJson}, ${auditEvents.beforeJson}), '$.date') = ${date}`,
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(500)
    .all();
  const names = new Map<string, string | null>();
  const studentName = (id: string) => {
    if (!names.has(id)) names.set(id, ctx.db.select({ n: students.fullName }).from(students).where(eq(students.id, id)).get()?.n ?? null);
    return names.get(id)!;
  };
  const changes = audits
    .map((a) => {
      const before = a.beforeJson ? (JSON.parse(a.beforeJson) as { studentId?: string; status?: AttendanceStatus | null; teacherId?: string }) : {};
      const after = a.afterJson ? (JSON.parse(a.afterJson) as { studentId?: string; status?: AttendanceStatus | null; teacherId?: string }) : {};
      const kind = a.entity === 'attendance_daily' ? ('daily' as const) : ('exception' as const);
      // Exceptions of other teachers' lessons are their context data (ACC-10).
      if (kind === 'exception' && (after.teacherId ?? before.teacherId) !== me) return null;
      const sid = after.studentId ?? before.studentId ?? null;
      return { at: a.at, actorName: userName(ctx.db, a.actorId), studentName: sid ? studentName(sid) : null, kind, before: before.status ?? null, after: after.status ?? null };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return { from, to, days, changes };
}

