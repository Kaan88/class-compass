/**
 * Students & enrolments (ACC-4/7/9, DAT-2/3, UX-5, IMP-4, GRP-7).
 * - One identity per student; class membership is enrolment history (never overwritten).
 * - Names are NFC-normalised and Turkish-title-cased when typed in a single case.
 * - Possible duplicates are reported, never merged.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { photoUrlOf } from '../../../shared/contracts/files.ts';
import type * as C from '../../../shared/contracts/students.ts';
import { avatarHue, foldForSearch, initials, smartTitleCase, sortByName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { classes, enrolments, studentSubjectLevels, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { Actor, AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import {
  assertClassWritable,
  assertOwnsContext,
  assertTeachesClass,
  dayAfter,
  defaultEnrolmentDate,
  enrolmentActiveOn,
  enrolmentNotEndedOn,
  getClass,
  getYear,
  todayFor,
  type ClassRow,
} from '../school/policy.ts';
import { getMediaPolicy } from '../school/modules.ts';
import { taughtClassIds } from '../school/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
export type StudentRow = typeof students.$inferSelect;
type EnrolmentRow = typeof enrolments.$inferSelect;
type Deps = Pick<AppDeps, 'db' | 'now'>;

const cleanName = (s: string) => smartTitleCase(s);
const cleanOptName = (s: string | null | undefined) => (s === undefined ? undefined : s === null || !s.trim() ? null : cleanName(s));
const cleanNumber = (s: string | null | undefined) => (s === undefined ? undefined : s === null || !s.trim() ? null : s.trim());

/** `photosOn`: media.studentPhotos (D-014); the photo URL is only given to teachers (classroom endpoint). */
export function studentDetail(s: StudentRow, enrolledFrom: string | null = null, photosOn = false) {
  return {
    id: s.id,
    fullName: s.fullName,
    givenNames: s.givenNames,
    familyName: s.familyName,
    studentNumber: s.studentNumber,
    initials: initials(s.fullName),
    avatarHue: s.avatarHue,
    photoConsent: s.photoConsent,
    photoUrl: photoUrlOf(s, photosOn),
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

type LiveEnrolment = EnrolmentRow & { activeToday: boolean; className: string };

/**
 * Enrolments of a student that have not ended today (in each class's timezone): the current one and
 * any scheduled by a future-dated move or promotion (D-021).
 */
function currentAndScheduledEnrolments(deps: Deps, studentId: string): LiveEnrolment[] {
  const rows = deps.db
    .select({ e: enrolments, cls: classes })
    .from(enrolments)
    .innerJoin(classes, eq(classes.id, enrolments.classId))
    .where(eq(enrolments.studentId, studentId))
    .all();
  const out: LiveEnrolment[] = [];
  for (const { e, cls } of rows) {
    const today = todayFor(deps, cls);
    if (e.toDate !== null && e.toDate <= today) continue;
    out.push({ ...e, activeToday: e.fromDate <= today, className: cls.name });
  }
  return out;
}

/** Enrolments the student is in today or is scheduled to start (D-021, D-027), with their ids and years. */
export function liveEnrolmentsOf(deps: Deps, studentId: string): EnrolmentRow[] {
  return currentAndScheduledEnrolments(deps, studentId);
}

/** Classes the student is in today or is scheduled to join (D-021). */
export function liveClassIdsOf(deps: Deps, studentId: string): string[] {
  return currentAndScheduledEnrolments(deps, studentId).map((e) => e.classId);
}

/**
 * Shared-class-data rule (ARCHITECTURE §3) for a teacher: the student is (or will be) in a class the
 * teacher teaches. Used for photos and files owned by a student (STU-8).
 */
export function teacherSeesStudent(ctx: RequestContext, studentId: string): boolean {
  const user = requireUser(ctx);
  const taught = taughtClassIds(ctx.db, user.id);
  return liveClassIdsOf(ctx, studentId).some((c) => taught.includes(c));
}

/**
 * Active students enrolled in the class *today* (class timezone): fromDate <= today < toDate. A move
 * or promotion dated in the future therefore keeps the student in the old class until that day
 * (D-021). Turkish-sorted (UX-5, D-009).
 */
export function rosterRows(deps: Deps, cls: ClassRow): Array<{ student: StudentRow; enrolment: EnrolmentRow }> {
  return rosterRowsOn(deps.db, cls.id, todayFor(deps, cls));
}

/** Active students enrolled in the class on local day `date` (attendance for past days, S5). */
export function rosterRowsOn(db: Db, classId: string, date: string): Array<{ student: StudentRow; enrolment: EnrolmentRow }> {
  const rows = db
    .select({ student: students, enrolment: enrolments })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.studentId))
    .where(and(eq(enrolments.classId, classId), enrolmentActiveOn(date), isNull(students.deactivatedAt)))
    .all();
  return sortByName(rows, (r) => r.student.fullName);
}

// ---------------------------------------------------------------- duplicates
interface Candidate {
  id: string;
  fullName: string;
  className: string | null;
  /** false = deactivated record: an admin should reactivate it instead of creating a second identity (ACC-7). */
  active: boolean;
}

/** The class the student is in today; if none yet, the earliest one they are scheduled to join. */
function currentClassName(deps: Deps, studentId: string): { classId: string; name: string; fromDate: string } | null {
  const live = currentAndScheduledEnrolments(deps, studentId);
  const today = live.filter((e) => e.activeToday).sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
  const later = live.filter((e) => !e.activeToday).sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
  const pick = today[0] ?? later[0];
  return pick ? { classId: pick.classId, name: pick.className, fromDate: pick.fromDate } : null;
}

/**
 * Split matches into those the caller may see (admins: all; teachers: students in classes they
 * teach) and a bare count of the rest, so duplicate checks do not leak other classes' rosters (ACC-4).
 */
function describeMatches(deps: Deps, matches: StudentRow[], visibleClassIds: string[] | 'all') {
  const candidates: Candidate[] = [];
  let otherMatches = 0;
  for (const m of matches) {
    const cur = currentClassName(deps, m.id);
    if (visibleClassIds === 'all' || (cur && visibleClassIds.includes(cur.classId))) {
      candidates.push({ id: m.id, fullName: m.fullName, className: cur?.name ?? null, active: m.deactivatedAt === null });
    } else otherMatches++;
  }
  // Deactivated matches are reported too (only as a count when hidden from the caller), so a
  // returning child is reactivated rather than given a second identity (ACC-7, IMP-4).
  const inactiveMatches = matches.filter((m) => m.deactivatedAt !== null).length;
  return { candidates, otherMatches, inactiveMatches };
}

function assertNumberFree(deps: Deps, num: string | null, visible: string[] | 'all', exceptId?: string) {
  if (!num) return;
  const taken = deps.db.select().from(students).where(eq(students.studentNumber, num)).get();
  if (taken && taken.id !== exceptId) {
    throw conflict('Another student already has this student number', { reason: 'STUDENT_NUMBER_TAKEN', ...describeMatches(deps, [taken], visible) });
  }
}

/** Same folded name (active or deactivated) is a 409 POSSIBLE_DUPLICATE warning unless confirmed (D-022). */
function assertNameNotDuplicate(deps: Deps, nameFold: string, visible: string[] | 'all', exceptId?: string) {
  const same = deps.db
    .select()
    .from(students)
    .where(eq(students.nameFold, nameFold))
    .all()
    .filter((m) => m.id !== exceptId);
  if (same.length) throw conflict('A student with the same name already exists', { reason: 'POSSIBLE_DUPLICATE', ...describeMatches(deps, same, visible) });
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
  assertNumberFree(deps, studentNumber, opts.visibleClassIds);
  const nameFold = foldForSearch(fullName);
  if (!input.allowDuplicateName) assertNameNotDuplicate(deps, nameFold, opts.visibleClassIds);
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
  const fromDate = opts.fromDate ?? defaultEnrolmentDate(deps, cls);
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
    return studentDetail(row, openEnrolments(ctx.db, row.id)[0]?.fromDate ?? null, getMediaPolicy(ctx.db).studentPhotos);
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
    // The class the student is in today, or one they are scheduled to join (future-dated move).
    const enrol = currentAndScheduledEnrolments(ctx, s.id).find((e) => taught.includes(e.classId));
    if (!enrol) throw new AppError('FORBIDDEN', 'This student is not in a class you teach');
    if (s.deactivatedAt) throw conflict('This student is deactivated', { reason: 'STUDENT_DEACTIVATED' });
    assertClassWritable(ctx.db, getClass(ctx.db, enrol.classId));
    const patch: Partial<StudentRow> = {};
    if (input.fullName !== undefined) {
      patch.fullName = cleanName(input.fullName);
      if (!patch.fullName) throw invalid('Name required');
      patch.nameFold = foldForSearch(patch.fullName);
      // A rename can create a duplicate as easily as an add (D-022, UX-5).
      if (patch.nameFold !== s.nameFold && !input.allowDuplicateName) assertNameNotDuplicate(ctx, patch.nameFold, taught, s.id);
    }
    const g = cleanOptName(input.givenNames);
    if (g !== undefined) patch.givenNames = g;
    const f = cleanOptName(input.familyName);
    if (f !== undefined) patch.familyName = f;
    const num = cleanNumber(input.studentNumber);
    if (num !== undefined && num !== s.studentNumber) {
      assertNumberFree(ctx, num, taught, s.id);
      patch.studentNumber = num;
    }
    if (input.photoConsent !== undefined) patch.photoConsent = input.photoConsent;
    const changedKeys = Object.keys(patch).filter((k) => k !== 'nameFold' && patch[k as keyof StudentRow] !== s[k as keyof StudentRow]);
    if (changedKeys.length) {
      ctx.db.update(students).set({ ...patch, updatedAt: ctx.now(), updatedBy: requireUser(ctx).id }).where(eq(students.id, s.id)).run();
      const pick = (o: Partial<StudentRow>) => Object.fromEntries(changedKeys.map((k) => [k, o[k as keyof StudentRow]]));
      audit(ctx.db, ctx.actor, { action: 'student.update', entity: 'student', entityId: s.id, before: pick(s), after: pick(patch) }, ctx.now());
    }
    return studentDetail(getStudent(ctx.db, s.id), enrol.fromDate, getMediaPolicy(ctx.db).studentPhotos);
  });
}

// ---------------------------------------------------------------- rosters
/** Classroom-safe: names, initials, hue only (no numbers, levels, consent). */
export function classroomRoster(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  return {
    classId: cls.id,
    className: cls.name,
    students: rosterRows(ctx, cls).map(({ student: s }) => ({ id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue })),
  };
}

export function teacherRoster(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  const photosOn = getMediaPolicy(ctx.db).studentPhotos;
  return { classId: cls.id, className: cls.name, students: rosterRows(ctx, cls).map(({ student, enrolment }) => studentDetail(student, enrolment.fromDate, photosOn)) };
}

// ---------------------------------------------------------------- subject levels (GRP-3, GRP-7)
function levelsFor(deps: Deps, classId: string, subjectId: string) {
  const { db } = deps;
  const roster = rosterRows(deps, getClass(db, classId));
  const ids = roster.map((r) => r.student.id);
  const rows = ids.length
    ? db.select().from(studentSubjectLevels).where(and(eq(studentSubjectLevels.subjectId, subjectId), inArray(studentSubjectLevels.studentId, ids))).all()
    : [];
  const byId = new Map(rows.map((r) => [r.studentId, r.level]));
  return { subjectId, levels: roster.map((r) => ({ studentId: r.student.id, level: byId.get(r.student.id) ?? null })) };
}

export function getContextLevels(ctx: RequestContext, contextId: string) {
  const t = assertOwnsContext(ctx, contextId);
  return levelsFor(ctx, t.classId, t.subjectId);
}

export function setContextLevels(ctx: RequestContext, input: In<typeof C.setContextLevels>) {
  return tx(ctx.db, () => {
    const t = assertOwnsContext(ctx, input.contextId);
    const cls = getClass(ctx.db, t.classId);
    assertClassWritable(ctx.db, cls);
    const roster = new Set(rosterRows(ctx, cls).map((r) => r.student.id));
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
    return levelsFor(ctx, t.classId, t.subjectId);
  });
}

// ---------------------------------------------------------------- admin
function adminStudent(deps: Deps, s: StudentRow) {
  const cur = currentClassName(deps, s.id);
  return { ...studentDetail(s, cur?.fromDate ?? null), currentClassId: cur?.classId ?? null, currentClassName: cur?.name ?? null };
}

/** Class/year filters match enrolments that have not ended today: current and scheduled ones (D-021). */
export function adminListStudents(deps: Deps, input: In<typeof C.adminListStudents>) {
  const { db } = deps;
  let rows = db.select().from(students).where(input.includeDeactivated ? undefined : isNull(students.deactivatedAt)).all();
  if (input.classId || input.yearId) {
    const conds = [enrolmentNotEndedOn(todayFor(deps, null))];
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
  return { students: sorted.slice(start, start + input.pageSize).map((s) => adminStudent(deps, s)), total: sorted.length, page: input.page, pageSize: input.pageSize };
}

export function adminGetStudent(deps: Deps, studentId: string) {
  const { db } = deps;
  const s = getStudent(db, studentId);
  const history = db
    .select({ e: enrolments, className: classes.name })
    .from(enrolments)
    .innerJoin(classes, eq(classes.id, enrolments.classId))
    .where(eq(enrolments.studentId, s.id))
    .all()
    .sort((a, b) => (a.e.fromDate < b.e.fromDate ? -1 : a.e.fromDate > b.e.fromDate ? 1 : a.e.createdAt - b.e.createdAt))
    .map(({ e, className }) => ({ id: e.id, classId: e.classId, className, schoolYearId: e.schoolYearId, fromDate: e.fromDate, toDate: e.toDate, reason: e.reason }));
  return { ...adminStudent(deps, s), enrolments: history };
}

/**
 * "Remove from this class" by a teacher of the class (S13b, D-109): the current (or scheduled)
 * enrolment in this class ends today in the class timezone, so the student leaves the roster at once.
 * Nothing is deleted: attendance, marks, goals and the enrolment history stay (DAT-2/3).
 */
export function removeFromClass(ctx: RequestContext, classId: string, studentId: string) {
  tx(ctx.db, () => {
    const cls = assertTeachesClass(ctx, classId);
    assertClassWritable(ctx.db, cls);
    const today = todayFor(ctx, cls);
    const open = ctx.db
      .select()
      .from(enrolments)
      .where(and(eq(enrolments.studentId, studentId), eq(enrolments.classId, cls.id), enrolmentNotEndedOn(today)))
      .all();
    if (!open.length) throw notFound('Student');
    for (const e of open) {
      // A scheduled enrolment that has not started yet is closed on its own first day (an empty range).
      const end = e.fromDate > today ? e.fromDate : today;
      ctx.db.update(enrolments).set({ toDate: end }).where(eq(enrolments.id, e.id)).run();
    }
    audit(ctx.db, ctx.actor, { action: 'student.remove_from_class', entity: 'student', entityId: studentId, after: { classId: cls.id, date: today } }, ctx.now());
  });
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

/**
 * Close each open enrolment and open one in `to` (DAT-2, D-021). History rows are never edited
 * beyond setting toDate. Runs inside the caller's transaction.
 * - The date (default: today in the target class's timezone, clamped into the target year) must
 *   fall inside the target class's school year.
 * - Source classes must be writable like the target (archived class or year = read-only, DAT-1).
 * - Across years, the old enrolment ends no later than the day after its own year ends, so a
 *   promotion dated on the new year's first day does not stretch the old enrolment over the summer.
 * - Rosters are date-aware, so a future-dated move keeps the student in the old class until then.
 */
function moveWithinTx(ctx: RequestContext, studentIds: string[], to: ClassRow, date: string | undefined) {
  assertClassWritable(ctx.db, to);
  const toYear = getYear(ctx.db, to.schoolYearId);
  const on = date ?? defaultEnrolmentDate(ctx, to);
  if (on < toYear.startsOn || on > toYear.endsOn) {
    throw invalid(`The date ${on} is outside the school year ${toYear.name} (${toYear.startsOn} – ${toYear.endsOn})`, { reason: 'MOVE_DATE_OUTSIDE_YEAR' });
  }
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
      assertClassWritable(ctx.db, getClass(ctx.db, e.classId));
      if (on < e.fromDate) {
        throw invalid(`Move date ${on} is before the student joined their current class (${e.fromDate})`, { reason: 'MOVE_DATE_BEFORE_ENROLMENT' });
      }
      let end = on;
      if (e.schoolYearId !== to.schoolYearId) {
        const afterYear = dayAfter(getYear(ctx.db, e.schoolYearId).endsOn);
        if (end > afterYear) end = afterYear;
      }
      ctx.db.update(enrolments).set({ toDate: end }).where(eq(enrolments.id, e.id)).run();
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
    if (from.schoolYearId === to.schoolYearId) throw invalid('Promotion moves a class into a different school year; use move within the same year', { reason: 'PROMOTE_SAME_YEAR' });
    assertClassWritable(ctx.db, from);
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
