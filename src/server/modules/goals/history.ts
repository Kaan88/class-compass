/**
 * Boolean history check for the importer's revert (IMP-5, D-081): has anything been recorded for the
 * student in the goals and links tables since `since`? Returns only true/false, never content, so the
 * importer needs no access to private notes or evidence (GOL-6).
 */
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { evidence, goals, privateTeacherNotes, studentLinks, teacherFeedback } from '../../db/schema.ts';

export const GOALS_HISTORY_TABLES = ['goals', 'evidence', 'teacher_feedback', 'private_teacher_notes', 'student_links'] as const;

export function goalsHistorySince(db: Db, studentId: string, since: number): boolean {
  return Boolean(
    db.select({ id: goals.id }).from(goals).where(and(eq(goals.studentId, studentId), gte(goals.createdAt, since))).get() ??
      db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.studentId, studentId), gte(evidence.createdAt, since))).get() ??
      db.select({ id: teacherFeedback.id }).from(teacherFeedback).where(and(eq(teacherFeedback.studentId, studentId), gte(teacherFeedback.createdAt, since))).get() ??
      db.select({ id: privateTeacherNotes.id }).from(privateTeacherNotes).where(and(eq(privateTeacherNotes.studentId, studentId), gte(privateTeacherNotes.createdAt, since))).get() ??
      db.select({ id: studentLinks.id }).from(studentLinks).where(and(eq(studentLinks.studentId, studentId), gte(studentLinks.createdAt, since))).get(),
  );
}

/**
 * SQL name of the private notes table, so generic exports can leave it out without naming it (GOL-6:
 * readable only by the teacher who wrote it, also not by administrators or in exports).
 */
export const PRIVATE_NOTES_TABLE = 'private_teacher_notes';

/** How many private notes exist about a student, or in the whole school (a number only, for export manifests). */
export function privateNotesCount(db: Db, studentId?: string): number {
  return db.select({ id: privateTeacherNotes.id }).from(privateTeacherNotes).where(studentId ? eq(privateTeacherNotes.studentId, studentId) : undefined).all().length;
}
