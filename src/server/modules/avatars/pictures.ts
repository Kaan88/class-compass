/**
 * Students' own avatar pictures (S24, D-184; owner request 2026-11-11). The only module that reads or
 * writes `avatar_pictures` (the generic erasure and exports read it by table name).
 *
 * Life of a picture:
 * 1. The student sends one square picture from their page (`student` access, the link session's
 *    student only). Checks before the body is read: the school switch `media.avatarPictures` (D-014
 *    pattern), a class of theirs lets students send pictures, avatar changes are not paused (the lock
 *    also stops uploads), at most `AVATAR_PICTURE_UPLOADS_PER_HOUR` per student. The bytes are streamed
 *    into the QUARANTINE folder (`config.avatarQuarantineDir`, outside the uploads, so no backup or
 *    export ever holds a picture nobody approved), sniffed (JPG, PNG, WebP; HEIC is refused like the
 *    evidence pipeline), refused when animated or huge, then decoded and written again with sharp as a
 *    512 px square WebP without any metadata. A new picture replaces (and deletes) a waiting one.
 * 2. A teacher who teaches the student (or an administrator) decides. "Yes, use it" needs the
 *    confirmation tick (`confirm: true`, else 400 CONFIRM_REQUIRED); the picture is then copied into the
 *    uploads as a `files` row owned by the student (backed up, in both exports, erased with the
 *    student) and the quarantine copy is deleted; a picture approved earlier is deleted. "Not this one"
 *    needs a reason (400 REASON_REQUIRED) and deletes the picture at once; the row keeps only the reason
 *    for the student. Every decision and removal is audited (who, when, student, reason; never the image).
 * 3. Nobody checked it in `PENDING_DAYS` days: the sweep (start-up and hourly) deletes it.
 * Removing an approved picture deletes the row, the files row and the bytes at once.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  AVATAR_PICTURE_EDGE,
  AVATAR_PICTURE_MAX_BYTES,
  AVATAR_PICTURE_MAX_DIMENSION,
  AVATAR_PICTURE_UPLOADS_PER_HOUR,
  DELETE_ALL_PICTURES_CONFIRM,
  PENDING_MS,
  type PictureState,
  type RefusalReason,
} from '../../../shared/avatarPictures.ts';
import { ALLOWED_MIME } from '../../../shared/contracts/files.ts';
import { classroomPictureUrl, studentPictureUrl, type PictureList, type PictureListItem, type StudentPictureInfo } from '../../../shared/contracts/avatars.ts';
import type { Config } from '../../config.ts';
import { tx, type Db } from '../../db/client.ts';
import { avatarPictures, classes, files, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { actorUserId, requireStudent, requireUser, type AppDeps, type RequestContext } from '../../lib/context.ts';
import { compareNames } from '../../../shared/text/turkish.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { notify } from '../../lib/notify.ts';
import { newId } from '../../lib/crypto.ts';
import { studentScope } from '../links/scope.ts';
import { getMediaPolicy } from '../school/modules.ts';
import { assertClassWritable, getClass, isClassWritable, type ClassRow } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';
import { liveClassIdsOf, rosterRows } from '../students/service.ts';
import { sniffFile } from '../files/sniff.ts';
import { newStorageKey, removeKey, removeQuietly, storagePath } from '../files/storage.ts';

type PictureRow = typeof avatarPictures.$inferSelect;
type StudentRow = typeof students.$inferSelect;

/** Images below the uploads limit of sharp: refuse decompression bombs before resizing. */
const LIMIT_INPUT_PIXELS = 50_000_000;
const HOUR_MS = 60 * 60 * 1000;
/** Files in the quarantine folder without a row (a crash between write and insert) go after this. */
const ORPHAN_MS = HOUR_MS;

// ---------------------------------------------------------------- quarantine storage
const QKEY_RE = /^[0-9a-f-]{36}$/u;

export function quarantinePath(config: Pick<Config, 'avatarQuarantineDir'>, key: string): string {
  if (!QKEY_RE.test(key)) throw new Error('Invalid quarantine key');
  return path.join(config.avatarQuarantineDir, key);
}
const quarantineTmpDir = (config: Pick<Config, 'avatarQuarantineDir'>) => path.join(config.avatarQuarantineDir, 'tmp');

export async function removeQuarantined(config: Pick<Config, 'avatarQuarantineDir'>, key: string | null | undefined): Promise<void> {
  if (!key || !QKEY_RE.test(key)) return;
  await removeQuietly(quarantinePath(config, key));
}

// ---------------------------------------------------------------- reads
export const picturesOn = (db: Db) => getMediaPolicy(db).avatarPictures;

const rowsOf = (db: Db, studentId: string) => db.select().from(avatarPictures).where(eq(avatarPictures.studentId, studentId)).all();

/** The approved picture of each student (only live files), for the classroom directory and Super Speakers. */
export function approvedPictureIds(db: Db, studentIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!studentIds.length || !picturesOn(db)) return out;
  for (let i = 0; i < studentIds.length; i += 500) {
    const part = studentIds.slice(i, i + 500);
    const rows = db
      .select({ id: avatarPictures.id, studentId: avatarPictures.studentId })
      .from(avatarPictures)
      .innerJoin(files, eq(files.id, avatarPictures.fileId))
      .where(and(inArray(avatarPictures.studentId, part), eq(avatarPictures.status, 'approved'), isNull(files.deletedAt)))
      .all();
    for (const r of rows) out.set(r.studentId, r.id);
  }
  return out;
}

/** The student page's view of their own picture (S24). */
export function studentPictureInfo(db: Db, student: StudentRow, classRows: readonly ClassRow[]): StudentPictureInfo {
  const on = picturesOn(db);
  const state: PictureState = !on ? 'off' : classRows.some((c) => c.avatarsLocked) ? 'locked' : classRows.some((c) => c.avatarUploads) ? 'open' : 'classOff';
  const rows = rowsOf(db, student.id);
  const approved = on ? (approvedPictureIds(db, [student.id]).get(student.id) ?? null) : null;
  const pending = rows.find((r) => r.status === 'pending');
  const refused = rows.find((r) => r.status === 'refused');
  return {
    state,
    approvedUrl: approved ? studentPictureUrl(approved) : null,
    pending: on && pending ? { sentAt: pending.createdAt, deleteAt: pending.expiresAt ?? pending.createdAt + PENDING_MS, url: studentPictureUrl(pending.id) } : null,
    refused: on && refused && refused.refusalReason ? { reason: refused.refusalReason, at: refused.decidedAt ?? refused.createdAt } : null,
  };
}

// ---------------------------------------------------------------- the student's upload
const recentUploads = new Map<string, number[]>();

function assertUploadRate(studentId: string, now: number): void {
  const list = (recentUploads.get(studentId) ?? []).filter((t) => t > now - HOUR_MS);
  if (list.length >= AVATAR_PICTURE_UPLOADS_PER_HOUR) {
    recentUploads.set(studentId, list);
    throw new AppError('RATE_LIMITED', 'Too many pictures this hour', { reason: 'PICTURE_RATE_LIMIT' });
  }
  list.push(now);
  recentUploads.set(studentId, list);
}

function assertMaySend(ctx: RequestContext, studentId: string) {
  if (!picturesOn(ctx.db)) throw new AppError('FEATURE_DISABLED', 'Own pictures are turned off', { reason: 'MEDIA_DISABLED', module: 'media.avatarPictures' });
  const scope = studentScope(ctx, studentId);
  if (!scope.classes.length) throw notFound('Class');
  if (scope.classes.some((c) => c.avatarsLocked)) throw new AppError('FORBIDDEN', 'Your teacher has paused avatar changes', { reason: 'AVATAR_LOCKED' });
  if (!scope.classes.some((c) => c.avatarUploads)) throw new AppError('FORBIDDEN', 'Your class does not take pictures now', { reason: 'PICTURES_CLASS_OFF' });
  return scope;
}

async function receive(ctx: RequestContext, req: FastifyRequest): Promise<string> {
  if (!req.isMultipart()) throw invalid('Send the file as multipart form data', { reason: 'NOT_MULTIPART' });
  const part = await req.file({ limits: { fileSize: AVATAR_PICTURE_MAX_BYTES, files: 1 } });
  if (!part) throw invalid('No file received', { reason: 'NO_FILE' });
  const dir = quarantineTmpDir(ctx.config);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${crypto.randomUUID()}.part`);
  try {
    await pipeline(part.file, fs.createWriteStream(tmp, { flags: 'wx' }));
    if (part.file.truncated) throw new Error('truncated');
  } catch (err) {
    await removeQuietly(tmp);
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || (err as Error).message === 'truncated') {
      throw invalid('The picture is larger than 8 MB', { reason: 'FILE_TOO_LARGE', limitBytes: AVATAR_PICTURE_MAX_BYTES });
    }
    throw err;
  }
  return tmp;
}

/** Sniff, refuse animated or huge pictures, and encode a 512 px square WebP without metadata. */
export async function encodePicture(tmp: string): Promise<Buffer> {
  const sniff = await sniffFile(tmp, ALLOWED_MIME.image, { name: null });
  if (!sniff.ok) {
    if (sniff.detected === 'image/heic' || sniff.detected === 'image/heif') throw invalid('HEIC pictures cannot be read here', { reason: 'IMAGE_HEIC' });
    throw invalid(sniff.reason === 'FILE_EMPTY' ? 'The file is empty' : 'This type of file is not accepted', { reason: sniff.reason });
  }
  const input = await fsp.readFile(tmp);
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { limitInputPixels: false, animated: true }).metadata();
  } catch {
    throw invalid('The picture could not be read', { reason: 'IMAGE_UNREADABLE' });
  }
  if ((meta.pages ?? 1) > 1) throw invalid('Moving pictures cannot be used', { reason: 'IMAGE_ANIMATED' });
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw invalid('The picture could not be read', { reason: 'IMAGE_UNREADABLE' });
  if (w > AVATAR_PICTURE_MAX_DIMENSION || h > AVATAR_PICTURE_MAX_DIMENSION || w * h > LIMIT_INPUT_PIXELS) throw invalid('The picture is too big', { reason: 'IMAGE_TOO_LARGE' });
  try {
    // sharp writes no metadata unless asked to: EXIF, GPS, XMP, ICC and appended bytes are gone.
    return await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error', animated: false })
      .rotate()
      .resize({ width: AVATAR_PICTURE_EDGE, height: AVATAR_PICTURE_EDGE, fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw invalid('The picture could not be read', { reason: 'IMAGE_UNREADABLE' });
  }
}

export async function uploadPicture(ctx: RequestContext, req: FastifyRequest): Promise<StudentPictureInfo> {
  const { studentId } = requireStudent(ctx);
  assertMaySend(ctx, studentId);
  assertUploadRate(studentId, ctx.now());
  const tmp = await receive(ctx, req);
  const key = crypto.randomUUID();
  let stored = false;
  try {
    const out = await encodePicture(tmp);
    await fsp.writeFile(quarantinePath(ctx.config, key), out, { flag: 'wx' });
    stored = true;
    const old = tx(ctx.db, () => {
      // Checked again inside the write: a switch turned off meanwhile wins.
      const scope = assertMaySend(ctx, studentId);
      const now = ctx.now();
      const previous = rowsOf(ctx.db, studentId).filter((r) => r.status !== 'approved');
      if (previous.length)
        ctx.db
          .delete(avatarPictures)
          .where(
            inArray(
              avatarPictures.id,
              previous.map((r) => r.id),
            ),
          )
          .run();
      const id = newId();
      ctx.db
        .insert(avatarPictures)
        .values({ id, studentId, status: 'pending', quarantineKey: key, fileId: null, createdAt: now, expiresAt: now + PENDING_MS })
        .run();
      audit(
        ctx.db,
        ctx.actor,
        { action: 'avatar_picture.send', entity: 'student', entityId: studentId, after: { pictureId: id, replaced: previous.filter((r) => r.status === 'pending').length } },
        now,
      );
      notify(ctx, { category: 'avatarPicture', studentId, subjectId: null, entity: 'student', entityId: studentId });
      return { previous, scope };
    });
    for (const r of old.previous) await removeQuarantined(ctx.config, r.quarantineKey);
    return studentPictureInfo(ctx.db, old.scope.student, old.scope.classes);
  } catch (err) {
    if (stored) await removeQuarantined(ctx.config, key);
    throw err;
  } finally {
    await removeQuietly(tmp);
  }
}

/** The student takes their waiting picture back, closes a refusal note or stops using their picture. */
export async function removeOwnPicture(ctx: RequestContext, which: 'pending' | 'refused' | 'approved'): Promise<StudentPictureInfo> {
  const { studentId } = requireStudent(ctx);
  const scope = studentScope(ctx, studentId);
  const row = rowsOf(ctx.db, studentId).find((r) => r.status === which);
  if (row) {
    const purged = tx(ctx.db, () => {
      const p = purgeRows(ctx.db, [row]);
      if (which !== 'refused')
        audit(
          ctx.db,
          ctx.actor,
          { action: which === 'pending' ? 'avatar_picture.take_back' : 'avatar_picture.remove', entity: 'student', entityId: studentId, before: { pictureId: row.id, status: row.status } },
          ctx.now(),
        );
      return p;
    });
    await removeBytes(ctx.config, purged);
  }
  return studentPictureInfo(ctx.db, scope.student, scope.classes);
}

// ---------------------------------------------------------------- purge
interface Purged {
  quarantineKeys: string[];
  storageKeys: string[];
}

/** Deletes the rows and their files rows inside the caller's transaction; the bytes go afterwards (`removeBytes`). */
function purgeRows(db: Db, rows: readonly PictureRow[]): Purged {
  const out: Purged = { quarantineKeys: [], storageKeys: [] };
  if (!rows.length) return out;
  const fileIds = rows.flatMap((r) => (r.fileId ? [r.fileId] : []));
  for (const r of rows) if (r.quarantineKey) out.quarantineKeys.push(r.quarantineKey);
  db.delete(avatarPictures)
    .where(
      inArray(
        avatarPictures.id,
        rows.map((r) => r.id),
      ),
    )
    .run();
  if (fileIds.length) {
    for (const f of db.select().from(files).where(inArray(files.id, fileIds)).all()) {
      out.storageKeys.push(f.storageKey);
      if (f.thumbStorageKey) out.storageKeys.push(f.thumbStorageKey);
    }
    // Purge means gone: the files row too (nothing else refers to an avatar picture's file).
    db.delete(files).where(inArray(files.id, fileIds)).run();
  }
  return out;
}

async function removeBytes(config: Config, p: Purged): Promise<void> {
  for (const k of p.quarantineKeys) await removeQuarantined(config, k);
  for (const k of p.storageKeys) await removeKey(config, k);
}

/** Quarantine keys of a student's waiting pictures (the erasure removes them after its commit). */
export function quarantineKeysOf(db: Db, studentId: string): string[] {
  return rowsOf(db, studentId).flatMap((r) => (r.quarantineKey ? [r.quarantineKey] : []));
}

// ---------------------------------------------------------------- teachers and administrators
function getRow(db: Db, id: string): PictureRow {
  const r = db.select().from(avatarPictures).where(eq(avatarPictures.id, id)).get();
  if (!r) throw notFound('Picture');
  return r;
}

/** A teacher who teaches the student now (or an admin) may see and decide; others get the same 404. */
function assertDecider(ctx: RequestContext, row: PictureRow): void {
  const user = requireUser(ctx);
  if (user.role === 'admin') return;
  const taught = taughtClassIds(ctx.db, user.id);
  if (!liveClassIdsOf(ctx, row.studentId).some((c) => taught.includes(c))) throw notFound('Picture');
}

function assertOn(db: Db): void {
  if (!picturesOn(db)) throw new AppError('FEATURE_DISABLED', 'Own pictures are turned off', { reason: 'MEDIA_DISABLED', module: 'media.avatarPictures' });
}

/** Archived classes and years are read-only (DAT-1): refuse when every class the decision acts through is archived. */
function assertWritableFor(ctx: RequestContext, studentId: string): void {
  const user = requireUser(ctx);
  const live = liveClassIdsOf(ctx, studentId);
  const via = user.role === 'admin' ? live : live.filter((c) => taughtClassIds(ctx.db, user.id).includes(c));
  const rows = via.map((c) => getClass(ctx.db, c));
  if (rows.length && !rows.some((c) => isClassWritable(ctx.db, c))) assertClassWritable(ctx.db, rows[0]!);
}

const imagePath = (base: 'teacher' | 'admin', id: string) => `/api/${base}/avatar-pictures/${encodeURIComponent(id)}/image`;

export function listPictures(ctx: RequestContext): PictureList {
  const user = requireUser(ctx);
  const enabled = picturesOn(ctx.db);
  const base = user.role === 'admin' ? 'admin' : 'teacher';
  // Who is shown: teacher = the students in the classes they teach today; admin = everyone, with a current class.
  const whereOf = new Map<string, { student: StudentRow; cls: ClassRow }>();
  if (user.role === 'admin') {
    const rows = ctx.db.select().from(avatarPictures).all();
    const ids = [...new Set(rows.map((r) => r.studentId))];
    const st = ids.length ? ctx.db.select().from(students).where(inArray(students.id, ids)).all() : [];
    for (const s of st) {
      const clsId = liveClassIdsOf(ctx, s.id)[0];
      const cls = clsId ? ctx.db.select().from(classes).where(eq(classes.id, clsId)).get() : undefined;
      if (cls) whereOf.set(s.id, { student: s, cls });
    }
  } else {
    const ids = taughtClassIds(ctx.db, user.id);
    const clsRows = ids.length ? ctx.db.select().from(classes).where(inArray(classes.id, ids)).all() : [];
    for (const cls of clsRows) for (const { student } of rosterRows(ctx, cls)) if (!whereOf.has(student.id)) whereOf.set(student.id, { student, cls });
  }
  const studentIds = [...whereOf.keys()];
  const rows: PictureRow[] = [];
  for (let i = 0; i < studentIds.length; i += 500) {
    rows.push(
      ...ctx.db
        .select()
        .from(avatarPictures)
        .where(and(inArray(avatarPictures.studentId, studentIds.slice(i, i + 500)), inArray(avatarPictures.status, ['pending', 'approved'])))
        .all(),
    );
  }
  const item = (r: PictureRow): PictureListItem => {
    const w = whereOf.get(r.studentId)!;
    return {
      id: r.id,
      studentId: r.studentId,
      studentName: w.student.fullName,
      classId: w.cls.id,
      className: w.cls.name,
      status: r.status === 'approved' ? 'approved' : 'pending',
      sentAt: r.createdAt,
      deleteAt: r.status === 'pending' ? (r.expiresAt ?? r.createdAt + PENDING_MS) : null,
      decidedAt: r.decidedAt,
      url: imagePath(base, r.id),
    };
  };
  const byName = (a: PictureListItem, b: PictureListItem) => compareNames(a.studentName, b.studentName);
  return {
    enabled,
    // Oldest first: the one closest to its deletion at the top.
    toCheck: rows
      .filter((r) => r.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(item),
    inUse: rows
      .filter((r) => r.status === 'approved')
      .map(item)
      .sort(byName),
  };
}

export function pictureCount(ctx: RequestContext): { enabled: boolean; toCheck: number } {
  const enabled = picturesOn(ctx.db);
  if (!enabled) return { enabled, toCheck: 0 };
  return { enabled, toCheck: listPictures(ctx).toCheck.length };
}

export async function approvePicture(ctx: RequestContext, pictureId: string, confirm: boolean | undefined): Promise<void> {
  assertOn(ctx.db);
  const row = getRow(ctx.db, pictureId);
  assertDecider(ctx, row);
  if (row.status !== 'pending' || !row.quarantineKey) throw new AppError('CONFLICT', 'This picture is no longer waiting', { reason: 'PICTURE_NOT_PENDING' });
  if (confirm !== true) throw invalid('Tick that it is not a photo of the student or anyone they know', { reason: 'CONFIRM_REQUIRED' });
  assertWritableFor(ctx, row.studentId);
  const src = quarantinePath(ctx.config, row.quarantineKey);
  let data: Buffer;
  try {
    data = await fsp.readFile(src);
  } catch {
    throw notFound('Picture');
  }
  const key = newStorageKey();
  const target = storagePath(ctx.config, key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, data, { flag: 'wx' });
  let old: Purged;
  try {
    old = tx(ctx.db, () => {
      const now = ctx.now();
      const cur = getRow(ctx.db, pictureId);
      if (cur.status !== 'pending') throw new AppError('CONFLICT', 'This picture is no longer waiting', { reason: 'PICTURE_NOT_PENDING' });
      const previous = rowsOf(ctx.db, row.studentId).filter((r) => r.status === 'approved');
      const purged = purgeRows(ctx.db, previous);
      const fileId = newId();
      ctx.db
        .insert(files)
        .values({
          id: fileId,
          storageKey: key,
          thumbStorageKey: null,
          sha256: crypto.createHash('sha256').update(data).digest('hex'),
          size: data.length,
          thumbSize: null,
          sniffedMime: 'image/webp',
          kind: 'image',
          originalName: 'avatar-picture.webp',
          ownerStudentId: row.studentId,
          uploadedByType: 'student',
          uploadedById: row.studentId,
          createdAt: now,
          deletedAt: null,
        })
        .run();
      ctx.db
        .update(avatarPictures)
        .set({ status: 'approved', quarantineKey: null, fileId, expiresAt: null, decidedAt: now, decidedBy: actorUserId(ctx.actor) })
        .where(eq(avatarPictures.id, pictureId))
        .run();
      // The teacher's confirmation is recorded (KVKK: no photo of a private person); never the image.
      audit(
        ctx.db,
        ctx.actor,
        { action: 'avatar_picture.approve', entity: 'student', entityId: row.studentId, after: { pictureId, confirmedNotAPrivatePerson: true, replaced: previous.length } },
        now,
      );
      purged.quarantineKeys.push(row.quarantineKey!);
      return purged;
    });
  } catch (err) {
    await removeKey(ctx.config, key);
    throw err;
  }
  await removeBytes(ctx.config, old);
}

export async function refusePicture(ctx: RequestContext, pictureId: string, reason: RefusalReason | undefined): Promise<void> {
  const row = getRow(ctx.db, pictureId);
  assertDecider(ctx, row);
  if (row.status !== 'pending') throw new AppError('CONFLICT', 'This picture is no longer waiting', { reason: 'PICTURE_NOT_PENDING' });
  if (!reason) throw invalid('Choose why', { reason: 'REASON_REQUIRED' });
  assertWritableFor(ctx, row.studentId);
  // Refusing works while the school switch is off too: deleting is always allowed.
  tx(ctx.db, () => {
    const now = ctx.now();
    ctx.db
      .update(avatarPictures)
      .set({ status: 'refused', quarantineKey: null, decidedAt: now, decidedBy: actorUserId(ctx.actor), refusalReason: reason, expiresAt: now + PENDING_MS })
      .where(eq(avatarPictures.id, pictureId))
      .run();
    audit(ctx.db, ctx.actor, { action: 'avatar_picture.refuse', entity: 'student', entityId: row.studentId, after: { pictureId, reason } }, now);
  });
  await removeQuarantined(ctx.config, row.quarantineKey);
}

export async function removePicture(ctx: RequestContext, pictureId: string): Promise<void> {
  const row = getRow(ctx.db, pictureId);
  assertDecider(ctx, row);
  if (row.status === 'refused') throw notFound('Picture');
  const purged = tx(ctx.db, () => {
    const p = purgeRows(ctx.db, [row]);
    audit(ctx.db, ctx.actor, { action: 'avatar_picture.remove', entity: 'student', entityId: row.studentId, before: { pictureId, status: row.status } }, ctx.now());
    return p;
  });
  await removeBytes(ctx.config, purged);
}

/** Admin: delete every uploaded picture (waiting and approved) and empty the quarantine folder. */
export async function deleteAllPictures(ctx: RequestContext, confirm: string) {
  if (confirm.trim() !== DELETE_ALL_PICTURES_CONFIRM) throw invalid(`Type ${DELETE_ALL_PICTURES_CONFIRM} to confirm`, { reason: 'CONFIRMATION_MISMATCH' });
  const { purged, counts } = tx(ctx.db, () => {
    const rows = ctx.db.select().from(avatarPictures).all();
    const counts = { pending: rows.filter((r) => r.status === 'pending').length, approved: rows.filter((r) => r.status === 'approved').length };
    const purged = purgeRows(ctx.db, rows);
    audit(ctx.db, ctx.actor, { action: 'avatar_picture.delete_all', entity: 'avatar_picture', entityId: null, after: counts }, ctx.now());
    return { purged, counts };
  });
  await removeBytes(ctx.config, purged);
  await fsp.rm(ctx.config.avatarQuarantineDir, { recursive: true, force: true });
  return counts;
}

// ---------------------------------------------------------------- serving the bytes
async function sendPicture(reply: FastifyReply, abs: string, cache: string) {
  let size: number;
  try {
    size = (await fsp.stat(abs)).size;
  } catch {
    throw notFound('Picture');
  }
  reply.header('Content-Type', 'image/webp');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
  reply.header('Cache-Control', cache);
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Content-Disposition', 'inline; filename="avatar-picture.webp"');
  reply.header('Content-Length', String(size));
  return reply.send(fs.createReadStream(abs));
}

/** Where the bytes of a picture are (quarantine or uploads), or null. */
function pathOf(db: Db, config: Config, row: PictureRow): string | null {
  if (row.status === 'pending' && row.quarantineKey) return quarantinePath(config, row.quarantineKey);
  if (row.status === 'approved' && row.fileId) {
    const f = db.select().from(files).where(eq(files.id, row.fileId)).get();
    return f && f.deletedAt === null ? storagePath(config, f.storageKey) : null;
  }
  return null;
}

/** An approved picture's bytes for viewers other than the student (the school switch must be on). */
export function approvedPicturePath(db: Db, config: Config, studentId: string): string | null {
  if (!picturesOn(db)) return null;
  const row = rowsOf(db, studentId).find((r) => r.status === 'approved');
  return row ? pathOf(db, config, row) : null;
}

/** Shared pictures (classroom, board, scorer) are cached privately for an hour; the URL changes with the picture. */
export const sendSharedPicture = (reply: FastifyReply, abs: string) => sendPicture(reply, abs, 'private, max-age=3600');

export async function serveStudentPicture(ctx: RequestContext, reply: FastifyReply, pictureId: string) {
  const { studentId } = requireStudent(ctx);
  const row = ctx.db.select().from(avatarPictures).where(eq(avatarPictures.id, pictureId)).get();
  if (!row || row.studentId !== studentId || !picturesOn(ctx.db)) throw notFound('Picture');
  const abs = pathOf(ctx.db, ctx.config, row);
  if (!abs) throw notFound('Picture');
  return sendPicture(reply, abs, 'private, no-store');
}

export async function serveDeciderPicture(ctx: RequestContext, reply: FastifyReply, pictureId: string) {
  const row = ctx.db.select().from(avatarPictures).where(eq(avatarPictures.id, pictureId)).get();
  if (!row) throw notFound('Picture');
  assertDecider(ctx, row);
  const abs = pathOf(ctx.db, ctx.config, row);
  if (!abs) throw notFound('Picture');
  return sendPicture(reply, abs, 'private, no-store');
}

/** Classroom cards: 404 unless the switch is on, the picture is approved and the teacher teaches the student. */
export async function serveClassroomPicture(ctx: RequestContext, reply: FastifyReply, studentId: string) {
  const user = requireUser(ctx);
  const taught = taughtClassIds(ctx.db, user.id);
  if (!liveClassIdsOf(ctx, studentId).some((c) => taught.includes(c))) throw notFound('Picture');
  const abs = approvedPicturePath(ctx.db, ctx.config, studentId);
  if (!abs) throw notFound('Picture');
  return sendSharedPicture(reply, abs);
}

export { classroomPictureUrl };

// ---------------------------------------------------------------- the clean-up (start-up and hourly)
export const PICTURE_SWEEP_MS = HOUR_MS;

/**
 * Deletes waiting pictures nobody checked in time, refusal notes that ran out, waiting rows whose file
 * is missing (e.g. after a restore: the quarantine is never in a backup) and files in the quarantine
 * folder that no row knows (older than an hour). Counts are audited as the system; never an image.
 */
export async function sweepAvatarPictures(deps: Pick<AppDeps, 'db' | 'config' | 'now'>): Promise<{ expired: number; notes: number; orphans: number }> {
  const now = deps.now();
  const rows = deps.db
    .select()
    .from(avatarPictures)
    .where(inArray(avatarPictures.status, ['pending', 'refused']))
    .all();
  const expired: PictureRow[] = [];
  const notes: PictureRow[] = [];
  for (const r of rows) {
    if (r.status === 'refused') {
      if ((r.expiresAt ?? 0) <= now) notes.push(r);
    } else if ((r.expiresAt ?? 0) <= now || !r.quarantineKey || !fs.existsSync(quarantinePath(deps.config, r.quarantineKey))) expired.push(r);
  }
  if (expired.length || notes.length) {
    const purged = tx(deps.db, () => {
      const p = purgeRows(deps.db, [...expired, ...notes]);
      if (expired.length) audit(deps.db, { type: 'system', id: null }, { action: 'avatar_picture.expire', entity: 'avatar_picture', entityId: null, after: { deleted: expired.length } }, now);
      return p;
    });
    await removeBytes(deps.config as Config, purged);
  }
  // Files without a row.
  let orphans = 0;
  const known = new Set(
    deps.db
      .select({ k: avatarPictures.quarantineKey })
      .from(avatarPictures)
      .all()
      .flatMap((r) => (r.k ? [r.k] : [])),
  );
  const scan = async (dir: string, isTmp: boolean) => {
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const abs = path.join(dir, n);
      let st: fs.Stats;
      try {
        st = await fsp.stat(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if ((isTmp || !known.has(n)) && st.mtimeMs < now - ORPHAN_MS) {
        await removeQuietly(abs);
        orphans++;
      }
    }
  };
  await scan(deps.config.avatarQuarantineDir, false);
  await scan(quarantineTmpDir(deps.config), true);
  return { expired: expired.length, notes: notes.length, orphans };
}
