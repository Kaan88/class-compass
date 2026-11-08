/**
 * The teacher's own time's-up clip (S13b, D-107). A teacher asset, not student media: the student
 * media flags (D-014) do not apply, but the upload goes through the same pipeline (streamed 2 MB limit,
 * content sniffing against an audio allow-list, quota, audit). One clip per teacher; a new upload
 * replaces the old one, whose bytes are removed. Played on the classroom display of that teacher's
 * lessons when the class's time's-up setting is "clip".
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { tx } from '../../db/client.ts';
import { files, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { notFound } from '../../lib/errors.ts';
import { fileMeta, getFileRow, ingestUpload, sendFile, type FileRow } from './service.ts';
import { removeKey } from './storage.ts';

function retire(ctx: RequestContext, fileId: string | null): FileRow | null {
  if (!fileId) return null;
  const f = getFileRow(ctx.db, fileId);
  if (!f || f.deletedAt !== null) return null;
  ctx.db.update(files).set({ deletedAt: ctx.now() }).where(eq(files.id, f.id)).run();
  return f;
}

export async function uploadTimeUpClip(ctx: RequestContext, req: FastifyRequest) {
  const user = requireUser(ctx);
  let old: FileRow | null = null;
  const row = await ingestUpload(ctx, req, {
    kind: 'teacher_sound',
    ownerStudentId: null,
    onStored: (db, f) => {
      const current = db.select({ id: users.timeUpClipFileId }).from(users).where(eq(users.id, user.id)).get()?.id ?? null;
      old = retire(ctx, current);
      db.update(users).set({ timeUpClipFileId: f.id, updatedAt: ctx.now() }).where(eq(users.id, user.id)).run();
      audit(db, ctx.actor, { action: 'user.time_up_clip_set', entity: 'user', entityId: user.id, after: { fileId: f.id } }, ctx.now());
    },
  });
  const retired = old as FileRow | null;
  if (retired) {
    await removeKey(ctx.config, retired.storageKey);
    await removeKey(ctx.config, retired.thumbStorageKey);
  }
  return fileMeta(row);
}

export async function deleteTimeUpClip(ctx: RequestContext) {
  const user = requireUser(ctx);
  const f = tx(ctx.db, () => {
    const current = ctx.db.select({ id: users.timeUpClipFileId }).from(users).where(eq(users.id, user.id)).get()?.id ?? null;
    const r = retire(ctx, current);
    ctx.db.update(users).set({ timeUpClipFileId: null, updatedAt: ctx.now() }).where(eq(users.id, user.id)).run();
    if (current) audit(ctx.db, ctx.actor, { action: 'user.time_up_clip_delete', entity: 'user', entityId: user.id }, ctx.now());
    return r;
  });
  if (f) {
    await removeKey(ctx.config, f.storageKey);
    await removeKey(ctx.config, f.thumbStorageKey);
  }
}

export async function serveTimeUpClip(ctx: RequestContext, req: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(ctx);
  const fresh = ctx.db.select({ id: users.timeUpClipFileId }).from(users).where(eq(users.id, user.id)).get();
  const f = fresh?.id ? getFileRow(ctx.db, fresh.id) : null;
  if (!f || f.deletedAt !== null || f.kind !== 'teacher_sound' || f.uploadedById !== user.id) throw notFound('Clip');
  return sendFile(ctx, req, reply, f);
}
