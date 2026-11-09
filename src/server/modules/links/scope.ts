/**
 * What a student link session may see (STU-2, STU-4, STU-5): the student's OWN records in the classes
 * they are enrolled in today and the subjects taught there. Every student service starts from the
 * studentId of the session (never from the request) and from this scope.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { classes, enrolments, students, subjects, teachingContexts } from '../../db/schema.ts';
import type { AppDeps } from '../../lib/context.ts';
import { notFound } from '../../lib/errors.ts';
import { localDate } from '../../../domain/dates.ts';
import { getSchoolSettings, todayFor, type ClassRow, type ContextRow } from '../school/policy.ts';

export type StudentRow = typeof students.$inferSelect;
type SubjectRow = typeof subjects.$inferSelect;

export interface ScopeContext {
  context: ContextRow;
  cls: ClassRow;
  subject: SubjectRow;
}

export interface StudentScope {
  student: StudentRow;
  /** Classes the student is enrolled in today (date-aware, D-027). */
  classes: ClassRow[];
  /** Active teaching contexts of those classes (oldest first). */
  contexts: ScopeContext[];
}

export function getStudentRow(db: Db, studentId: string): StudentRow {
  const s = db.select().from(students).where(eq(students.id, studentId)).get();
  if (!s) throw notFound('Student');
  return s;
}

export function studentScope(deps: Pick<AppDeps, 'db' | 'now'>, studentId: string): StudentScope {
  const student = getStudentRow(deps.db, studentId);
  const rows = deps.db.select({ e: enrolments, cls: classes }).from(enrolments).innerJoin(classes, eq(classes.id, enrolments.classId)).where(eq(enrolments.studentId, studentId)).all();
  const current: ClassRow[] = [];
  for (const { e, cls } of rows) {
    const today = todayFor(deps, cls);
    // fromDate <= today < toDate (D-021, D-027), deactivated students see nothing.
    const active = e.fromDate <= today && (e.toDate === null || e.toDate > today);
    if (active && student.deactivatedAt === null && !current.some((c) => c.id === cls.id)) current.push(cls);
  }
  const classIds = current.map((c) => c.id);
  const ctxRows = classIds.length
    ? deps.db
        .select({ context: teachingContexts, subject: subjects })
        .from(teachingContexts)
        .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
        .where(and(inArray(teachingContexts.classId, classIds), isNull(teachingContexts.endedAt)))
        .all()
        .sort((a, b) => a.context.createdAt - b.context.createdAt || a.context.id.localeCompare(b.context.id))
    : [];
  return {
    student,
    classes: current,
    contexts: ctxRows.map((r) => ({ context: r.context, subject: r.subject, cls: current.find((c) => c.id === r.context.classId)! })),
  };
}

export interface TeacherStudentScope {
  student: StudentRow;
  /** The teacher's own contexts among the student's `studentScope(...).contexts`, in the same order. */
  contexts: ScopeContext[];
}

/**
 * `studentScope` for every student of one teacher at once (S15a, D-162), restricted to that teacher's
 * contexts: what `studentScope(deps, id).contexts.filter((c) => c.context.teacherId === teacherId)`
 * gives, with the same rules (classes the student is in today in the class timezone, fromDate <=
 * today < toDate; deactivated students see nothing; active contexts only, oldest first), but in three
 * queries for the whole request instead of several per student. `scopeOf` answers null for a student
 * who is in none of the teacher's current classes (or does not exist).
 */
export function teacherStudentScopes(deps: Pick<AppDeps, 'db' | 'now'>, teacherId: string): { scopeOf(studentId: string): TeacherStudentScope | null } {
  const ctxRows = deps.db
    .select({ context: teachingContexts, subject: subjects, cls: classes })
    .from(teachingContexts)
    .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
    .innerJoin(classes, eq(classes.id, teachingContexts.classId))
    .where(and(eq(teachingContexts.teacherId, teacherId), isNull(teachingContexts.endedAt)))
    .all()
    .sort((a, b) => a.context.createdAt - b.context.createdAt || a.context.id.localeCompare(b.context.id));
  const classById = new Map(ctxRows.map((r) => [r.cls.id, r.cls]));
  const classIds = [...classById.keys()];
  // Today per class, read once per request (todayFor: the class timezone, else the school's).
  const now = deps.now();
  let schoolTz: string | undefined;
  const today = new Map([...classById.values()].map((c) => [c.id, localDate(now, c.timezone ?? (schoolTz ??= getSchoolSettings(deps.db).timezone))]));
  const studentRows = new Map<string, StudentRow>();
  const currentClasses = new Map<string, Set<string>>();
  for (let i = 0; i < classIds.length; i += 500) {
    const rows = deps.db
      .select({ e: enrolments, student: students })
      .from(enrolments)
      .innerJoin(students, eq(students.id, enrolments.studentId))
      .where(inArray(enrolments.classId, classIds.slice(i, i + 500)))
      .all();
    for (const { e, student } of rows) {
      const t = today.get(e.classId)!;
      // fromDate <= today < toDate (D-021, D-027), deactivated students see nothing.
      if (!(e.fromDate <= t && (e.toDate === null || e.toDate > t)) || student.deactivatedAt !== null) continue;
      studentRows.set(student.id, student);
      let set = currentClasses.get(student.id);
      if (!set) currentClasses.set(student.id, (set = new Set()));
      set.add(e.classId);
    }
  }
  const memo = new Map<string, TeacherStudentScope | null>();
  return {
    scopeOf(studentId) {
      if (memo.has(studentId)) return memo.get(studentId)!;
      const student = studentRows.get(studentId);
      const inClasses = currentClasses.get(studentId);
      const scope = student && inClasses ? { student, contexts: ctxRows.filter((r) => inClasses.has(r.context.classId)).map((r) => ({ context: r.context, subject: r.subject, cls: r.cls })) } : null;
      memo.set(studentId, scope);
      return scope;
    },
  };
}
