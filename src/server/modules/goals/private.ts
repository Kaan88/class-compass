/**
 * Private teacher notes (GOL-6). The ONLY module file that reads or writes `private_teacher_notes`
 * (besides the boolean history check), and it is never imported by the student page code
 * (test-enforced): there is no student read path at all. A note is visible to the teacher who wrote it.
 * The audit log records that a note was written or deleted, never its text.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PrivateNote } from '../../../shared/contracts/goals.ts';
import { tx, type Db } from '../../db/client.ts';
import { privateTeacherNotes } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { notFound } from '../../lib/errors.ts';

type NoteRow = typeof privateTeacherNotes.$inferSelect;
const dto = (n: NoteRow): PrivateNote => ({ id: n.id, body: n.body, createdAt: n.createdAt, updatedAt: n.updatedAt });

export function myPrivateNotes(db: Db, teacherId: string, studentId: string, subjectId: string): PrivateNote[] {
  return db
    .select()
    .from(privateTeacherNotes)
    .where(and(eq(privateTeacherNotes.teacherId, teacherId), eq(privateTeacherNotes.studentId, studentId), eq(privateTeacherNotes.subjectId, subjectId), isNull(privateTeacherNotes.deletedAt)))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .map(dto);
}

/** Callers check that the teacher teaches the student in this subject (and the class is writable). */
export function addPrivateNote(ctx: RequestContext, studentId: string, subjectId: string, body: string): PrivateNote {
  const now = ctx.now();
  const row: NoteRow = { id: newId(), studentId, subjectId, teacherId: requireUser(ctx).id, body, createdAt: now, updatedAt: now, deletedAt: null };
  ctx.db.insert(privateTeacherNotes).values(row).run();
  audit(ctx.db, ctx.actor, { action: 'private_note.create', entity: 'private_teacher_note', entityId: row.id, after: { studentId, subjectId } }, now);
  return dto(row);
}

/**
 * Only the author may delete (anyone else gets the same 404 as for a missing note). `guard` is the
 * caller's scope check (still teaches the student, writable class and year); it sees no note text.
 */
export function deletePrivateNote(ctx: RequestContext, noteId: string, guard: (note: { studentId: string; subjectId: string }) => void): void {
  tx(ctx.db, () => {
    const n = ctx.db.select().from(privateTeacherNotes).where(eq(privateTeacherNotes.id, noteId)).get();
    if (!n || n.deletedAt !== null || n.teacherId !== requireUser(ctx).id) throw notFound('Note');
    guard({ studentId: n.studentId, subjectId: n.subjectId });
    ctx.db.update(privateTeacherNotes).set({ deletedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(privateTeacherNotes.id, n.id)).run();
    audit(ctx.db, ctx.actor, { action: 'private_note.delete', entity: 'private_teacher_note', entityId: n.id, before: { studentId: n.studentId, subjectId: n.subjectId } }, ctx.now());
  });
}
