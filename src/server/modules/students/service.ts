/**
 * Students & enrolments (ACC-4/7/9, DAT-2/3, UX-5, IMP-4, GRP-7).
 * - One identity per student; class membership is enrolment history (never overwritten).
 * - Names are NFC-normalised and Turkish-title-cased when typed in a single case.
 * - Possible duplicates are reported, never merged.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/students.ts';
import { avatarHue, foldForSearch, initials, smartTitleCase, sortByName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { classes, enrolments, schoolYears, studentSubjectLevels, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { Actor, AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { assertClassWritable, assertOwnsContext, assertTeachesClass, assertYearWritable, getClass, getYear, todayFor, type ClassRow } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
export type StudentRow = typeof students.$inferSelect;
type EnrolmentRow = typeof enrolments.$inferSelect;

const cleanName = (s: string) => smartTitleCase(s);
const cleanOptName = (s: string | null | undefined) => (s === undefined ? undefined : s === null || !s.trim() ? null : cleanName(s));
const cleanNumber = (s: string | null | undefined) => (s === undefined ? undefined : s === null || !s.trim() ? null : s.trim());

export function studentDetail(s: StudentRow, enrolledFrom: string | null = null) {
  return {
    id: s.id,
    fullName: s.fullName,
    givenNames: s.givenNames,
    familyName: s.familyName,
    studentNumber: s.studentNumber,
    initials: initials(s.fullName),
    avatarHue: s.avatarHue,
    photoConsent: s.photoConsent,
    active: s.deactivatedAt === null,
    enrolledFrom,
  };
}

function getStudent(db: Db, id: string): StudentRow {
  const s = db.select().from(students).where(eq(students.id, id)).get();
  if (!s) throw notFound('Student');
  return s;
}

function openEnrolments(db: Db, studentId: string): EnrolmentRow[] {
  return db.select().from(enrolments).where(and(eq(enrolments.studentId, studentId), isNull(enrolments.toDate))).all();
}

/** Active students with an open enrolment in the class, Turkish-sorted (UX-5, D-009). */
export function rosterRows(db: Db, classId: string): Array<{ student: StudentRow; enrolment: EnrolmentRow }> {
  const rows = db
    .select({ student: students, enrolment: enrolments })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.studentId))
    .where(and(eq(enrolments.classId, classId), isNull(enrolments.toDate), isNull(students.deactivatedAt)))
    .all();
  return sortByName(rows, (r) => r.student.fullName);
}

// ---------------------------------------------------------------- duplicates
interface Candidate {
  id: string;
  fullName: string;
  className: string | null;
}

function currentClassName(db: Db, studentId: string): { classId: string; name: string } | null {
  const open = db
    .select({ classId: classes.id, name: classes.name, startsOn: schoolYears.startsOn })
    .from(enrolments)
    .innerJoin(classes, eq(classes.id, enrolments.classId))
    .innerJoin(schoolYears, eq(schoolYears.id, enrolments.schoolYearId))
    .where(and(eq(enrolments.studentId, studentId), isNull(enrolments.toDate)))
    .all()
    .sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));
  return open[0] ? { classId: open[0].classId, name: open[0].name } : null;
}

/**
 * Split matches into those the caller may see (admins: all; teachers: students in classes they
 * teach) and a bare count of the rest, so duplicate checks do not leak other classes' rosters (ACC-4).
 */
function describeMatches(db: Db, matches: StudentRow[], visibleClassIds: string[] | 'all') {
  const candidates: Candidate[] = [];
  let otherMatches = 0;
  for (const m of matches) {
    const cur = currentClassName(db, m.id);
    if (visibleClassIds === 'all' || (cur && visibleClassIds.includes(cur.classId))) {
      candidates.push({ id: m.id, fullName: m.fullName, className: cur?.name ?? null });
    } else otherMatches++;
  }
  return { candidates, otherMatches };
}

function assertNumberFree(db: Db, num: string | null, visible: string[] | 'all', exceptId?: string) {
  if (!num) return;
  const taken = db.select().from(students).where(eq(students.studentNumber, num)).get();
  if (taken && taken.id !== exceptId) {
    throw conflict('Another student already has this student number', { reason: 'STUDENT_NUMBER_TAKEN', ...describeMatches(db, [taken], visible) });
  }
}

// ---------------------------------------------------------------- create / update
export interface NewStudentInput {
  fullName: string;
  givenNames?: string | null | undefined;
  familyName?: string | null | undefined;
  studentNumber?: string | null | undefined;
  photoConsent?: boolean | undefined;
  allowDuplicateName?: boolean | undefined;
}

export interface CreateOptions {
  reason?: 'added' | 'import';
  importBatchId?: string | null;
  /** Classes whose students the caller may see in duplicate reports. */
  visibleClassIds: string[] | 'all';
  fromDate?: string;
}

/**
 * Create a student and enrol them in `cls` (ACC-7). Runs inside the caller's transaction.
 * Shared by the teacher and admin endpoints, the demo seed and (later) the importer.
 */
export function createStudentInClass(deps: Pick<AppDeps, 'db' | 'now'>, actor: Actor, cls: ClassRow, input: NewStudentInput, opts: CreateOptions): StudentRow {
  const { db } = deps;
  assertClassWritable(db, cls);
  const fullName = cleanName(input.fullName);
  if (!fullName) throw invalid('Name required');
  const studentNumber = cleanNumber(input.studentNumber) ?? null;
  assertNumberFree(db, studentNumber, opts.visibleClassIds);
  const nameFold = foldForSearch(fullName);
  if (!input.allowDuplicateName) {
    const same = db.select().from(students).where(and(eq(students.nameFold, nameFold), isNull(students.deactivatedAt))).all();
    if (same.length) {
      throw conflict('A student with the same name already exists', { reason: 'POSSIBLE_DUPLICATE', ...describeMatches(db, same, opts.visibleClassIds) });
    }
  }
  const now = deps.now();
  const id = newId();
  const actorId = actor.type === 'user' ? actor.id : null;
  const row: StudentRow = {
    id,
    studentNumber,
    fullName,
    givenNames: cleanOptName(input.givenNames) ?? null,
    familyName: cleanOptName(input.familyName) ?? null,
    nameFold,
    avatarHue: avatarHue(id),
    photoFileId: null,
    photoConsent: input.photoConsent ?? false,
    deactivatedAt: null,
    createdByImportBatchId: opts.importBatchId ?? null,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
  db.insert(students).values(row).run();
  const fromDate = opts.fromDate ?? todayFor(deps, cls);
  db.insert(enrolments)
    .values({ id: newId(), studentId: id, classId: cls.id, schoolYearId: cls.schoolYearId, fromDate, toDate: null, reason: opts.reason ?? 'added', importBatchId: opts.importBatchId ?? null, createdAt: now, createdBy: actorId })
    .run();
  audit(db, actor, { action: 'student.create', entity: 'student', entityId: id, after: { fullName, studentNumber, classId: cls.id, fromDate } }, now);
  return row;
}

export function teacherAddStudent(ctx: RequestContext, input: In<typeof C.addStudentToClass>) {
  return tx(ctx.db, () => {
    const cls = assertTeachesClass(ctx, input.classId);
    const row = createStudentInClass(ctx, ctx.actor, cls, input, { visibleClassIds: taughtClassIds(ctx.db, requireUser(ctx).id) });
    return studentDetail(row, openEnrolments(ctx.db, row.id)[0]?.fromDate ?? null);
  });
}

export function adminAddStudent(ctx: RequestContext, input: In<typeof C.adminAddStudent>) {
  return tx(ctx.db, () => {
    const cls = getClass(ctx.db, input.classId);
    const row = createStudentInClass(ctx, ctx.actor, cls, input, { visibleClassIds: 'all' });
    return studentDetail(row, openEnrolments(ctx.db, row.id)[0]?.fromDate ?? null);
  });
}

/** Teachers edit students currently enrolled in a class they teach (shared class data, ACC-7/9). */
export function teacherUpdateStudent(ctx: RequestContext, input: In<typeof C.updateStudent>) {
  return tx(ctx.db, () => {
    const s = getStudent(ctx.db, input.studentId);
    const taught = taughtClassIds(ctx.db, requireUser(ctx).id);
    const enrol = openEnrolments(ctx.db, s.id).find((e) => taught.includes(e.classId));
    if (!enrol) throw new AppError('FORBIDDEN', 'This student is not in a class you teach');
    if (s.deactivatedAt) throw conflict('This student is deactivated', { reason: 'STUDENT_DEACTIVATED' });
    assertClassWritable(ctx.db, getClass(ctx.db, enrol.classId));
    const patch: Partial<StudentRow> = {};
    if (input.fullName !== undefined) {
      patch.fullName = cleanName(input.fullName);
      patch.nameFold = foldForSearch(patch.fullName);
    }
    const g = cleanOptName(input.givenNames);
    if (g !== undefined) patch.givenNames = g;
    const f = cleanOptName(input.familyName);
    if (f !== undefined) patch.familyName = f;
    const num = cleanNumber(input.studentNumber);
    if (num !== undefined && num !== s.studentNumber) {
      assertNumberFree(ctx.db, num, taught, s.id);
      patch.studentNumber = num;
    }
    if (input.photoConsent !== undefined) patch.photoConsent = input.photoConsent;
    const changedKeys = Object.keys(patch).filter((k) => k !== 'nameFold' && patch[k as keyof StudentRow] !== s[k as keyof StudentRow]);
    if (changedKeys.length) {
      ctx.db.update(students).set({ ...patch, updatedAt: ctx.now(), updatedBy: requireUser(ctx).id }).where(eq(students.id, s.id)).run();
      const pick = (o: Partial<StudentRow>) => Object.fromEntries(changedKeys.map((k) => [k, o[k as keyof StudentRow]]));
      audit(ctx.db, ctx.actor, { action: 'student.update', entity: 'student', entityId: s.id, before: pick(s), after: pick(patch) }, ctx.now());
    }
    return studentDetail(getStudent(ctx.db, s.id), enrol.fromDate);
  });
}

// ---------------------------------------------------------------- rosters
/** Classroom-safe: names, initials, hue only (no numbers, levels, consent). */
export function classroomRoster(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  return {
    classId: cls.id,
    className: cls.name,
    students: rosterRows(ctx.db, cls.id).map(({ student: s }) => ({ id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue })),
  };
}

export function teacherRoster(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  return { classId: cls.id, className: cls.name, students: rosterRows(ctx.db, cls.id).map(({ student, enrolment }) => studentDetail(student, enrolment.fromDate)) };
}

// ---------------------------------------------------------------- subject levels (GRP-3, GRP-7)
function levelsFor(db: Db, classId: string, subjectId: string) {
  const roster = rosterRows(db, classId);
  const ids = roster.map((r) => r.student.id);
  const rows = ids.length
    ? db.select().from(studentSubjectLevels).where(and(eq(studentSubjectLevels.subjectId, subjectId), inArray(studentSubjectLevels.studentId, ids))).all()
    : [];
  const byId = new Map(rows.map((r) => [r.studentId, r.level]));
  return { subjectId, levels: roster.map((r) => ({ studentId: r.student.id, level: byId.get(r.student.id) ?? null })) };
}

export function getContextLevels(ctx: RequestContext, contextId: string) {
  const t = assertOwnsContext(ctx, contextId);
  return levelsFor(ctx.db, t.classId, t.subjectId);
}

export function setContextLevels(ctx: RequestContext, input: In<typeof C.setContextLevels>) {
  return tx(ctx.db, () => {
    const t = assertOwnsContext(ctx, input.contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, t.classId));
    const roster = new Set(rosterRows(ctx.db, t.classId).map((r) => r.student.id));
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    for (const { studentId, level } of input.levels) {
      if (!roster.has(studentId)) throw new AppError('FORBIDDEN', 'Student is not in this class');
      const key = and(eq(studentSubjectLevels.studentId, studentId), eq(studentSubjectLevels.subjectId, t.subjectId));
      const before = ctx.db.select().from(studentSubjectLevels).where(key).get()?.level ?? null;
      if (before === level) continue;
      if (level === null) ctx.db.delete(studentSubjectLevels).where(key).run();
      else
        ctx.db
          .insert(studentSubjectLevels)
          .values({ studentId, subjectId: t.subjectId, level, updatedBy: uid, updatedAt: now })
          .onConflictDoUpdate({ target: [studentSubjectLevels.studentId, studentSubjectLevels.subjectId], set: { level, updatedBy: uid, updatedAt: now } })
          .run();
      audit(ctx.db, ctx.actor, { action: 'student.level_set', entity: 'student', entityId: studentId, before: { subjectId: t.subjectId, level: before }, after: { subjectId: t.subjectId, level } }, now);
    }
    return levelsFor(ctx.db, t.classId, t.subjectId);
  });
}

// ---------------------------------------------------------------- admin
function adminStudent(db: Db, s: StudentRow) {
  const cur = currentClassName(db, s.id);
  const from = cur ? (openEnrolments(db, s.id).find((e) => e.classId === cur.classId)?.fromDate ?? null) : null;
  return { ...studentDetail(s, from), currentClassId: cur?.classId ?? null, currentClassName: cur?.name ?? null };
}

export function adminListStudents(db: Db, input: In<typeof C.adminListStudents>) {
  let rows = db.select().from(students).where(input.includeDeactivated ? undefined : isNull(students.deactivatedAt)).all();
  if (input.classId || input.yearId) {
    const conds = [isNull(enrolments.toDate)];
    if (input.classId) conds.push(eq(enrolments.classId, input.classId));
    if (input.yearId) conds.push(eq(enrolments.schoolYearId, input.yearId));
    const ids = new Set(db.select({ id: enrolments.studentId }).from(enrolments).where(and(...conds)).all().map((r) => r.id));
    rows = rows.filter((s) => ids.has(s.id));
  }
  if (input.q?.trim()) {
    const q = foldForSearch(input.q);
    rows = rows.filter((s) => s.nameFold.includes(q) || (s.studentNumber ?? '').includes(input.q!.trim()));
  }
  const sorted = sortByName(rows, (s) => s.fullName);
  const start = (input.page - 1) * input.pageSize;
  return { students: sorted.slice(start, start + input.pageSize).map((s) => adminStudent(db, s)), total: sorted.length, page: input.page, pageSize: input.pageSize };
}

export function adminGetStudent(db: Db, studentId: string) {
  const s = getStudent(db, studentId);
  const history = db
    .select({ e: enrolments, className: classes.name })
    .from(enrolments)
    .innerJoin(classes, eq(classes.id, enrolments.classId))
    .where(eq(enrolments.studentId, s.id))
    .all()
    .sort((a, b) => (a.e.fromDate < b.e.fromDate ? -1 : a.e.fromDate > b.e.fromDate ? 1 : a.e.createdAt - b.e.createdAt))
    .map(({ e, className }) => ({ id: e.id, classId: e.classId, className, schoolYearId: e.schoolYearId, fromDate: e.fromDate, toDate: e.toDate, reason: e.reason }));
  return { ...adminStudent(db, s), enrolments: history };
}

/** Deactivation hides the student from rosters; every record and enrolment stays intact (DAT-3). */
export function setStudentActive(ctx: RequestContext, studentId: string, active: boolean) {
  tx(ctx.db, () => {
    const s = getStudent(ctx.db, studentId);
    if ((s.deactivatedAt === null) === active) return;
    ctx.db
      .update(students)
      .set({ deactivatedAt: active ? null : ctx.now(), updatedAt: ctx.now(), updatedBy: requireUser(ctx).id })
      .where(eq(students.id, s.id))
      .run();
    audit(ctx.db, ctx.actor, { action: active ? 'student.reactivate' : 'student.deactivate', entity: 'student', entityId: s.id }, ctx.now());
  });
}

type SkipReason = 'ALREADY_IN_CLASS' | 'DEACTIVATED' | 'NOT_FOUND';

/** Default move date: today in the target class's timezone, but never before the target year starts. */
function defaultMoveDate(ctx: RequestContext, to: ClassRow): string {
  const today = todayFor(ctx, to);
  const y = getYear(ctx.db, to.schoolYearId);
  return today < y.startsOn ? y.startsOn : today;
}

/**
 * Close each open enrolment (toDate = date, exclusive) and open a new one in `to` (DAT-2). History
 * rows are never edited beyond setting toDate. Runs inside the caller's transaction.
 */
function moveWithinTx(ctx: RequestContext, studentIds: string[], to: ClassRow, date: string | undefined) {
  assertClassWritable(ctx.db, to);
  const on = date ?? defaultMoveDate(ctx, to);
  const moved: string[] = [];
  const skipped: Array<{ studentId: string; reason: SkipReason }> = [];
  const now = ctx.now();
  for (const sid of [...new Set(studentIds)]) {
    const s = ctx.db.select().from(students).where(eq(students.id, sid)).get();
    if (!s) {
      skipped.push({ studentId: sid, reason: 'NOT_FOUND' });
      continue;
    }
    if (s.deactivatedAt) {
      skipped.push({ studentId: sid, reason: 'DEACTIVATED' });
      continue;
    }
    const open = openEnrolments(ctx.db, sid);
    if (open.some((e) => e.classId === to.id)) {
      skipped.push({ studentId: sid, reason: 'ALREADY_IN_CLASS' });
      continue;
    }
    for (const e of open) {
      assertYearWritable(ctx.db, e.schoolYearId);
      if (on < e.fromDate) throw invalid(`Move date ${on} is before the student joined their current class (${e.fromDate})`);
      ctx.db.update(enrolments).set({ toDate: on }).where(eq(enrolments.id, e.id)).run();
    }
    const reason = open.some((e) => e.schoolYearId !== to.schoolYearId) ? 'promotion' : 'move';
    ctx.db
      .insert(enrolments)
      .values({ id: newId(), studentId: sid, classId: to.id, schoolYearId: to.schoolYearId, fromDate: on, toDate: null, reason, importBatchId: null, createdAt: now, createdBy: requireUser(ctx).id })
      .run();
    audit(ctx.db, ctx.actor, { action: reason === 'promotion' ? 'student.promote' : 'student.move', entity: 'student', entityId: sid, before: { classIds: open.map((e) => e.classId) }, after: { classId: to.id, date: on } }, now);
    moved.push(sid);
  }
  return { moved, skipped };
}

export function moveStudents(ctx: RequestContext, input: In<typeof C.moveStudents>) {
  return tx(ctx.db, () => moveWithinTx(ctx, input.studentIds, getClass(ctx.db, input.toClassId), input.date));
}

/** Promote a whole class into a class of another school year (DAT-2). */
export function promoteClass(ctx: RequestContext, input: In<typeof C.promoteClass>) {
  return tx(ctx.db, () => {
    const from = getClass(ctx.db, input.classId);
    const to = getClass(ctx.db, input.toClassId);
    if (from.schoolYearId === to.schoolYearId) throw invalid('Promotion moves a class into a different school year; use move within the same year');
    assertYearWritable(ctx.db, from.schoolYearId);
    const ids = ctx.db
      .select({ id: enrolments.studentId })
      .from(enrolments)
      .where(and(eq(enrolments.classId, from.id), isNull(enrolments.toDate)))
      .all()
      .map((r) => r.id);
    const report = moveWithinTx(ctx, ids, to, input.date);
    audit(ctx.db, ctx.actor, { action: 'class.promote', entity: 'class', entityId: from.id, after: { toClassId: to.id, moved: report.moved.length, skipped: report.skipped.length } }, ctx.now());
    return report;
  });
}
