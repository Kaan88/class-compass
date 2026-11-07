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
import { todayFor, type ClassRow, type ContextRow } from '../school/policy.ts';

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
