/**
 * Boolean history check for the importer's revert (IMP-5, D-081): has anything been recorded for the
 * student in the goals and links tables since `since`? Returns only true/false, never content, so the
 * importer needs no access to private notes or evidence (GOL-6).
 */
import { and, eq, gte, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { evidence, goals, privateTeacherNotes, studentLinks, students, subjects, teacherFeedback, users } from '../../db/schema.ts';

export const GOALS_HISTORY_TABLES = ['goals', 'evidence', 'teacher_feedback', 'private_teacher_notes', 'student_links'] as const;

export function goalsHistorySince(db: Db, studentId: string, since: number): boolean {
  return Boolean(
    db.select({ id: goals.id }).from(goals).where(and(eq(goals.studentId, studentId), gte(goals.createdAt, since))).get() ??
      db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.studentId, studentId), gte(evidence.createdAt, since))).get() ??
      db.select({ id: teacherFeedback.id }).from(teacherFeedback).where(and(eq(teacherFeedback.studentId, studentId), gte(teacherFeedback.createdAt, since))).get() ??
      db.select({ id: privateTeacherNotes.id }).from(privateTeacherNotes).where(and(eq(privateTeacherNotes.studentId, studentId), gte(privateTeacherNotes.createdAt, since))).get() ??
      // A link made automatically (D-115) counts only once it was opened or replaced by a person.
      db
        .select({ id: studentLinks.id })
        .from(studentLinks)
        .where(and(eq(studentLinks.studentId, studentId), gte(studentLinks.createdAt, since), or(isNotNull(studentLinks.createdBy), isNotNull(studentLinks.lastUsedAt))))
        .get(),
  );
}

/**
 * SQL name of the private notes table, so generic exports can handle it without naming it (GOL-6:
 * readable in the app only by the teacher who wrote it; in the full administrator export since S13b2,
 * D-114, through `exportablePrivateNotes`).
 */
export const PRIVATE_NOTES_TABLE = 'private_teacher_notes';

/**
 * Private teacher notes for the FULL administrator export only (S13b2, D-114: the owner decided the
 * full export includes them). Every note, deleted ones too (with `deleted_at`), with the names of the
 * author, the student and the subject so the CSV is readable on its own. Nothing else may call this:
 * the per-student export keeps only the count, and no app screen or report shows notes to anyone but
 * their author.
 */
export const PRIVATE_NOTES_EXPORT_COLUMNS = ['id', 'teacher_id', 'author_name', 'student_id', 'student_name', 'subject_id', 'subject_name_en', 'subject_name_tr', 'body', 'created_at', 'updated_at', 'deleted_at'] as const;
export function exportablePrivateNotes(db: Db): Array<Record<(typeof PRIVATE_NOTES_EXPORT_COLUMNS)[number], unknown>> {
  return db
    .select({ n: privateTeacherNotes, author: users.displayName, student: students.fullName, subject: subjects.name })
    .from(privateTeacherNotes)
    .leftJoin(users, eq(users.id, privateTeacherNotes.teacherId))
    .leftJoin(students, eq(students.id, privateTeacherNotes.studentId))
    .leftJoin(subjects, eq(subjects.id, privateTeacherNotes.subjectId))
    .all()
    .sort((a, b) => a.n.createdAt - b.n.createdAt || a.n.id.localeCompare(b.n.id))
    .map((r) => ({
      id: r.n.id,
      teacher_id: r.n.teacherId,
      author_name: r.author ?? '',
      student_id: r.n.studentId,
      student_name: r.student ?? '',
      subject_id: r.n.subjectId,
      subject_name_en: r.subject?.en ?? '',
      subject_name_tr: r.subject?.tr ?? '',
      body: r.n.body,
      created_at: r.n.createdAt,
      updated_at: r.n.updatedAt,
      deleted_at: r.n.deletedAt,
    }));
}

/** How many private notes exist about a student, or in the whole school (a number only, for export manifests). */
export function privateNotesCount(db: Db, studentId?: string): number {
  return db.select({ id: privateTeacherNotes.id }).from(privateTeacherNotes).where(studentId ? eq(privateTeacherNotes.studentId, studentId) : undefined).all().length;
}

/**
 * Permanent erasure of a student (S13b, D-109): removes every private note about them and returns only
 * the number removed. The notes are never read here.
 */
export function erasePrivateNotesOf(db: Db, studentId: string): number {
  return db.delete(privateTeacherNotes).where(eq(privateTeacherNotes.studentId, studentId)).run().changes;
}
