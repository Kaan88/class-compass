/**
 * Student photos (CRD-1, D-014). Implemented but OFF by default (`media.studentPhotos`): uploads are
 * refused with FEATURE_DISABLED while the flag is off, and photos are only ever shown (photoUrl) when
 * the flag is on AND the student's photo consent is recorded. Initials avatars are always the default
 * (IMP-6). Shared class data: any teacher of the student's class, or an admin, may set it (audited).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { photoUrlOf } from '../../../shared/contracts/files.ts';
import { tx, type Db } from '../../db/client.ts';
import { files, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { getMediaPolicy } from '../school/modules.ts';
import { teacherSeesStudent } from '../students/service.ts';
import { assertMediaAllowed, getFileRow, ingestUpload, sendFile, type FileRow } from './service.ts';
import { removeKey } from './storage.ts';

type StudentRow = typeof students.$inferSelect;


function studentFor(ctx: RequestContext, studentId: string): StudentRow {
  const s = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!s) throw notFound('Student');
  if (ctx.user?.role === 'admin') return s;
  if (ctx.user?.role === 'teacher' && teacherSeesStudent(ctx, s.id)) return s;
  throw new AppError('FORBIDDEN', 'This student is not in a class you teach');
}

/** Retire an old photo file inside the transaction; its bytes are removed afterwards. */
function retireFile(db: Db, fileId: string | null, now: number): FileRow | null {
  if (!fileId) return null;
  const f = getFileRow(db, fileId);
  if (!f || f.deletedAt !== null) return null;
  db.update(files).set({ deletedAt: now }).where(eq(files.id, f.id)).run();
  return f;
}

export async function uploadStudentPhoto(ctx: RequestContext, req: FastifyRequest, input: { studentId: string; consent?: boolean | undefined }) {
  assertMediaAllowed(ctx.db, 'image', 'student_photo');
  const s = studentFor(ctx, input.studentId);
  if (s.deactivatedAt) throw new AppError('CONFLICT', 'This student is deactivated', { reason: 'STUDENT_DEACTIVATED' });
  if (input.consent !== true) throw invalid('Confirm that consent for this photo has been given', { reason: 'CONSENT_REQUIRED' });
  let old: FileRow | null = null;
  const row = await ingestUpload(ctx, req, {
    kind: 'image',
    ownerStudentId: s.id,
    onStored: (db, file) => {
      const now = ctx.now();
      const current = db.select().from(students).where(eq(students.id, s.id)).get()!;
      old = retireFile(db, current.photoFileId, now);
      db.update(students)
        .set({ photoFileId: file.id, photoConsent: true, updatedAt: now, updatedBy: ctx.user?.id ?? null })
        .where(eq(students.id, s.id))
        .run();
      audit(db, ctx.actor, { action: 'student.photo_set', entity: 'student', entityId: s.id, before: { photoFileId: current.photoFileId, photoConsent: current.photoConsent }, after: { photoFileId: file.id, photoConsent: true, consentConfirmedBy: ctx.actor.id } }, now);
    },
  });
  const retired = old as FileRow | null;
  if (retired) {
    await removeKey(ctx.config, retired.storageKey);
    await removeKey(ctx.config, retired.thumbStorageKey);
  }
  return { studentId: s.id, photoUrl: photoUrlOf({ id: s.id, photoFileId: row.id, photoConsent: true }, true), photoConsent: true };
}

export async function removeStudentPhoto(ctx: RequestContext, studentId: string) {
  const s = studentFor(ctx, studentId);
  const retired = tx(ctx.db, () => {
    const now = ctx.now();
    const f = retireFile(ctx.db, s.photoFileId, now);
    if (s.photoFileId) {
      ctx.db.update(students).set({ photoFileId: null, updatedAt: now, updatedBy: ctx.user?.id ?? null }).where(eq(students.id, s.id)).run();
      audit(ctx.db, ctx.actor, { action: 'student.photo_remove', entity: 'student', entityId: s.id, before: { photoFileId: s.photoFileId } }, now);
    }
    return f;
  });
  if (retired) {
    await removeKey(ctx.config, retired.storageKey);
    await removeKey(ctx.config, retired.thumbStorageKey);
  }
}

/** Classroom card photo: 404 unless photos are on, consent is recorded and the teacher teaches the student. */
export async function serveClassroomPhoto(ctx: RequestContext, req: FastifyRequest, reply: FastifyReply, studentId: string) {
  const s = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!s || !getMediaPolicy(ctx.db).studentPhotos || !s.photoConsent || !s.photoFileId || !teacherSeesStudent(ctx, s.id)) throw notFound('Photo');
  const f = getFileRow(ctx.db, s.photoFileId);
  if (!f || f.deletedAt !== null) throw notFound('Photo');
  return sendFile(ctx, req, reply, f, { thumb: true });
}
