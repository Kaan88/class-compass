/**
 * Uploads pipeline and protected file access (S9: STU-8, D-014, CRD-1).
 *
 * Upload: access check → media policy (before reading the body) → stream to a temp file with the
 * kind's hard size limit → sniff the bytes against the kind's allow-list (client type and name are
 * ignored) → re-encode images (EXIF/GPS stripped, evidence ≤ 2048 px, others ≤ 2560 px, thumbnail),
 * strip audio tags (D-119) → move into place under a
 * random key → quotas checked in the SAME transaction that inserts the files row.
 *
 * Access: a file is only ever served by `sendFile` after `assertCanReadFile` (owner scope): admins
 * any file; teachers files they uploaded and files owned by a student in a class they teach; a student
 * link session (S10) only files owned by its own student that the student uploaded or that are shown
 * on that student's live evidence. Anything else is a 404, so file ids reveal nothing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ALLOWED_MIME, EVIDENCE_IMAGE_EDGE, UPLOAD_LIMITS, type FileKind, type FileMeta } from '../../../shared/contracts/files.ts';
import { tx, type Db } from '../../db/client.ts';
import { evidence, files, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { getMediaPolicy } from '../school/modules.ts';
import { teacherSeesStudent } from '../students/service.ts';
import { neutralStudentFileName } from '../textChecks/service.ts';
import { AudioMetaError, stripAudioMetadata } from './audioMeta.ts';
import { MAX_IMAGE_EDGE, reencodeImage } from './image.ts';
import { sniffFile } from './sniff.ts';
import { newStorageKey, newTempPath, removeKey, removeQuietly, sha256File, storeBuffer, storeTemp, storagePath } from './storage.ts';

export type FileRow = typeof files.$inferSelect;

const MB = 1024 * 1024;

export function fileMeta(f: FileRow): FileMeta {
  return {
    id: f.id,
    kind: f.kind,
    mime: f.sniffedMime,
    size: f.size,
    name: f.originalName,
    ownerStudentId: f.ownerStudentId,
    hasThumbnail: f.thumbStorageKey !== null,
    createdAt: f.createdAt,
  };
}

/** Keep a display name only: no path, no control characters, NFC, at most 120 characters. */
export function cleanFileName(name: string | undefined | null): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/u).pop() ?? '';
  const clean = base.normalize('NFC').replace(/[\u0000-\u001f\u007f"<>|*?:]/gu, '_').trim().slice(0, 120);
  return clean || null;
}

/** The media flag an upload of `kind` needs (D-014); student photos use `media.studentPhotos`. */
export function assertMediaAllowed(db: Db, kind: FileKind, purpose: 'evidence' | 'student_photo' | 'import'): void {
  const media = getMediaPolicy(db);
  const ok =
    purpose === 'import' ? kind === 'import_source' : purpose === 'student_photo' ? media.studentPhotos : kind === 'image' ? media.evidencePhotos : kind === 'audio' ? media.evidenceAudio : kind === 'document' ? media.evidenceDocuments : false;
  if (!ok) {
    const module = purpose === 'student_photo' ? 'media.studentPhotos' : kind === 'image' ? 'media.evidencePhotos' : kind === 'audio' ? 'media.evidenceAudio' : 'media.evidenceDocuments';
    throw new AppError('FEATURE_DISABLED', 'This kind of upload is turned off by the administrator', { reason: 'MEDIA_DISABLED', module });
  }
}

/** Bytes in use (live files, thumbnails included) for one student or (null) the whole server. */
function usedBytes(db: Db, ownerStudentId: string | null): number {
  const where = ownerStudentId === null ? isNull(files.deletedAt) : and(isNull(files.deletedAt), eq(files.ownerStudentId, ownerStudentId));
  const r = db
    .select({ total: sql<number>`coalesce(sum(${files.size} + coalesce(${files.thumbSize}, 0)), 0)` })
    .from(files)
    .where(where)
    .get();
  return Number(r?.total ?? 0);
}

/** Quotas (STU-8). Must run inside the transaction that inserts the files row. */
function assertQuota(ctx: RequestContext, ownerStudentId: string | null, bytes: number): void {
  if (ownerStudentId) {
    const perStudent = ctx.config.UPLOAD_STUDENT_QUOTA_MB * MB;
    if (usedBytes(ctx.db, ownerStudentId) + bytes > perStudent) throw new AppError('CONFLICT', "This student's upload space is full", { reason: 'QUOTA_STUDENT' });
  }
  const global = ctx.config.UPLOAD_GLOBAL_QUOTA_MB * MB;
  if (usedBytes(ctx.db, null) + bytes > global) throw new AppError('CONFLICT', 'The server has no room for more uploads', { reason: 'QUOTA_GLOBAL' });
}

export interface IngestOptions {
  kind: FileKind;
  ownerStudentId: string | null;
  /** Runs inside the transaction that inserts the row (e.g. set the student's photo, audit). */
  onStored?: (db: Db, row: FileRow) => void;
}

/** Read the single multipart file part into a temp file, enforcing the kind's size limit. */
async function receiveToTemp(ctx: RequestContext, req: FastifyRequest, kind: FileKind): Promise<{ tmp: string; filename: string | null }> {
  if (!req.isMultipart()) throw invalid('Send the file as multipart form data', { reason: 'NOT_MULTIPART' });
  const limit = UPLOAD_LIMITS[kind];
  const part = await req.file({ limits: { fileSize: limit, files: 1 } });
  if (!part) throw invalid('No file received', { reason: 'NO_FILE' });
  const tmp = await newTempPath(ctx.config);
  try {
    await pipeline(part.file, fs.createWriteStream(tmp, { flags: 'wx' }));
    if (part.file.truncated) throw new Error('truncated');
  } catch (err) {
    await removeQuietly(tmp);
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE' || (err as Error).message === 'truncated') {
      throw invalid(`The file is larger than ${Math.round(limit / MB)} MB`, { reason: 'FILE_TOO_LARGE', limitBytes: limit });
    }
    throw err;
  }
  return { tmp, filename: cleanFileName(part.filename) };
}

/**
 * The full upload pipeline. Callers check access and the media policy first (so a disabled kind is
 * refused before the body is read) and authorise `ownerStudentId`.
 */
export async function ingestUpload(ctx: RequestContext, req: FastifyRequest, opts: IngestOptions): Promise<FileRow> {
  const { tmp, filename } = await receiveToTemp(ctx, req, opts.kind);
  const keys: string[] = [];
  try {
    const sniff = await sniffFile(tmp, ALLOWED_MIME[opts.kind]);
    if (!sniff.ok) {
      if (sniff.detected === 'image/heic' || sniff.detected === 'image/heif') throw invalid('HEIC pictures cannot be read here', { reason: 'IMAGE_HEIC' });
      throw invalid(sniff.reason === 'FILE_EMPTY' ? 'The file is empty' : 'This type of file is not accepted', { reason: sniff.reason });
    }
    const key = newStorageKey();
    let mime = sniff.mime;
    let size: number;
    let sha: string;
    let thumbKey: string | null = null;
    let thumbSize: number | null = null;
    if (mime.startsWith('image/')) {
      let img;
      try {
        img = await reencodeImage(await fsp.readFile(tmp), mime, opts.kind === 'image' ? EVIDENCE_IMAGE_EDGE : MAX_IMAGE_EDGE);
      } catch {
        throw invalid('The image could not be read', { reason: 'IMAGE_UNREADABLE' });
      }
      await storeBuffer(ctx.config, key, img.main);
      keys.push(key);
      thumbKey = `${key}-thumb`;
      await storeBuffer(ctx.config, thumbKey, img.thumb);
      keys.push(thumbKey);
      mime = img.mime;
      size = img.main.length;
      thumbSize = img.thumb.length;
      sha = crypto.createHash('sha256').update(img.main).digest('hex');
      await removeQuietly(tmp);
    } else {
      if (mime.startsWith('audio/')) {
        // Voice files lose their tags (names, places, cover pictures) before they are stored (D-119).
        let clean: Buffer;
        const raw = await fsp.readFile(tmp);
        try {
          clean = stripAudioMetadata(raw, mime);
        } catch (err) {
          if (err instanceof AudioMetaError) throw invalid('The sound file could not be read', { reason: 'AUDIO_UNREADABLE' });
          throw err;
        }
        if (clean !== raw) await fsp.writeFile(tmp, clean);
      }
      size = (await fsp.stat(tmp)).size;
      sha = await sha256File(tmp);
      await storeTemp(ctx.config, key, tmp);
      keys.push(key);
    }
    const now = ctx.now();
    const row: FileRow = {
      id: newId(),
      storageKey: key,
      thumbStorageKey: thumbKey,
      sha256: sha,
      size,
      thumbSize,
      sniffedMime: mime,
      kind: opts.kind,
      // A student's file name is shown back to them and to teachers: one with a blocked word gets a neutral name (D-123).
      originalName: ctx.actor.type === 'student' ? neutralStudentFileName(ctx.db, filename) : filename,
      ownerStudentId: opts.ownerStudentId,
      uploadedByType: ctx.actor.type,
      uploadedById: ctx.actor.id,
      createdAt: now,
      deletedAt: null,
    };
    tx(ctx.db, () => {
      assertQuota(ctx, opts.ownerStudentId, size + (thumbSize ?? 0));
      ctx.db.insert(files).values(row).run();
      audit(ctx.db, ctx.actor, { action: 'file.upload', entity: 'file', entityId: row.id, after: { kind: row.kind, mime, size, ownerStudentId: row.ownerStudentId } }, now);
      opts.onStored?.(ctx.db, row);
    });
    return row;
  } catch (err) {
    await removeQuietly(tmp);
    for (const k of keys) await removeKey(ctx.config, k);
    throw err;
  }
}

export function getFileRow(db: Db, fileId: string): FileRow | null {
  return db.select().from(files).where(eq(files.id, fileId)).get() ?? null;
}

/** Owner-scope read policy. Unknown, deleted and forbidden files all answer 404. */
export function assertCanReadFile(ctx: RequestContext, fileId: string): FileRow {
  const f = getFileRow(ctx.db, fileId);
  if (!f || f.deletedAt !== null) throw notFound('File');
  if (ctx.user?.role === 'admin') return f;
  if (ctx.user?.role === 'teacher') {
    if (f.uploadedByType === 'user' && f.uploadedById === ctx.user.id) return f;
    // Import sources are private to the uploader (and admins); student files follow the class rule.
    if (f.kind !== 'import_source' && f.ownerStudentId && teacherSeesStudent(ctx, f.ownerStudentId)) return f;
  }
  if (ctx.student && f.kind !== 'import_source' && f.ownerStudentId === ctx.student.studentId) {
    // Student-visible: their own upload, or a file on their own live evidence. Never a teacher's other
    // files about them (e.g. a student photo), never another student's.
    if (f.uploadedByType === 'student' && f.uploadedById === ctx.student.studentId) return f;
    const shown = ctx.db
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.studentId, ctx.student.studentId), eq(evidence.fileId, f.id), isNull(evidence.deletedAt)))
      .get();
    if (shown) return f;
  }
  throw notFound('File');
}

/** RFC 6266 attachment name with an ASCII fallback. */
function disposition(type: 'inline' | 'attachment', name: string | null, fallbackExt: string): string {
  const n = name ?? `file${fallbackExt}`;
  const ascii = n.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'audio/wav': '.wav',
};

/**
 * Send a file that passed the policy check. Uploaded content can never run in the app's origin:
 * `Content-Security-Policy: sandbox`, `nosniff`, `no-store`, and anything that is not an image or
 * audio is an attachment. Audio supports single byte ranges (seeking in the player).
 */
export async function sendFile(ctx: RequestContext, req: FastifyRequest, reply: FastifyReply, f: FileRow, opts: { thumb?: boolean } = {}) {
  const useThumb = Boolean(opts.thumb && f.thumbStorageKey);
  const key = useThumb ? f.thumbStorageKey! : f.storageKey;
  const mime = useThumb ? 'image/webp' : f.sniffedMime;
  const abs = storagePath(ctx.config, key);
  let size: number;
  try {
    size = (await fsp.stat(abs)).size;
  } catch {
    throw notFound('File');
  }
  const inline = mime.startsWith('image/') || mime.startsWith('audio/');
  reply.header('Content-Type', mime === 'text/plain' ? 'text/plain; charset=utf-8' : mime);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
  reply.header('Cache-Control', 'private, no-store');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Content-Disposition', disposition(inline ? 'inline' : 'attachment', f.originalName, EXT[mime] ?? ''));
  reply.header('Accept-Ranges', mime.startsWith('audio/') ? 'bytes' : 'none');
  const range = mime.startsWith('audio/') ? req.headers.range : undefined;
  if (typeof range === 'string') {
    const m = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());
    let start = m && m[1] !== '' ? Number(m[1]) : NaN;
    let end = m && m[2] !== '' ? Number(m[2]) : NaN;
    if (m && m[1] === '' && m[2] !== '') {
      // Suffix range: the last N bytes.
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else if (m && Number.isNaN(end)) end = size - 1;
    if (!m || Number.isNaN(start) || start > end || start >= size) {
      reply.header('Content-Range', `bytes */${size}`);
      return reply.code(416).send();
    }
    end = Math.min(end, size - 1);
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
    reply.header('Content-Length', String(end - start + 1));
    return reply.send(fs.createReadStream(abs, { start, end }));
  }
  reply.header('Content-Length', String(size));
  return reply.send(fs.createReadStream(abs));
}

/** Soft-delete: the row stays (history, audit), the bytes are removed from disk. */
export async function deleteFileRow(ctx: RequestContext, f: FileRow): Promise<void> {
  tx(ctx.db, () => {
    ctx.db.update(files).set({ deletedAt: ctx.now() }).where(eq(files.id, f.id)).run();
    audit(ctx.db, ctx.actor, { action: 'file.delete', entity: 'file', entityId: f.id, before: { kind: f.kind, ownerStudentId: f.ownerStudentId } }, ctx.now());
    // A student's current photo (CRD-1): clear the reference too, so cards fall back to initials
    // instead of pointing at a file that no longer exists.
    for (const st of ctx.db.select({ id: students.id }).from(students).where(eq(students.photoFileId, f.id)).all()) {
      ctx.db.update(students).set({ photoFileId: null, updatedAt: ctx.now(), updatedBy: ctx.user?.id ?? null }).where(eq(students.id, st.id)).run();
      audit(ctx.db, ctx.actor, { action: 'student.photo_remove', entity: 'student', entityId: st.id, before: { photoFileId: f.id } }, ctx.now());
    }
  });
  await removeKey(ctx.config, f.storageKey);
  await removeKey(ctx.config, f.thumbStorageKey);
}

/** Who may delete: the uploader or an admin (others get the same 404 as for reading). */
export function assertCanDeleteFile(ctx: RequestContext, fileId: string): FileRow {
  const f = assertCanReadFile(ctx, fileId);
  if (ctx.user?.role === 'admin' || (f.uploadedByType === 'user' && f.uploadedById === ctx.user?.id)) return f;
  throw new AppError('FORBIDDEN', 'Only the person who uploaded the file or an administrator can delete it');
}
