/**
 * Students' own avatar pictures (S24, D-184; CRD-1, STU-8, DAT-1, DAT-4, DAT-5, D-014): sending, the
 * teacher's check with its confirmation and reasons, the 14-day clean-up, backups and exports that
 * never hold a waiting picture, erasure, and the Super Speakers setting. Fictional data and pictures
 * drawn by the test only; every file lands in a temporary data folder.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE_ALL_PICTURES_CONFIRM, PENDING_MS } from '../../src/shared/avatarPictures.ts';
import { sweepAvatarPictures } from '../../src/server/modules/avatars/pictures.ts';
import { createBackup } from '../../src/server/ops/backup.ts';
import { readTar } from '../../src/server/ops/tar.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);

let dir: string;
let env: TestEnv;
let s: School;
let ada: { id: string; fullName: string };
let cem: { id: string; fullName: string };
let adaPhone: Client;

/** A fictional picture drawn by the test: a coloured square with a circle (no person). */
const drawing = (w = 640, h = 480, colour = '#3a7bd5') =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${colour}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#ffd34d"/></svg>`))
    .png()
    .toBuffer();

const send = (phone: Client, data: Buffer, name = 'drawing.png', type = 'image/png') => {
  const m = multipart(data, name, type);
  return phone.req('POST', '/api/student/avatar-picture', m.body, m.headers);
};
const raw = (c: Client, url: string) => env.app.inject({ method: 'GET', url, headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
const setFlag = (on: boolean) => ok(s.admin.put('/api/admin/module-policies/media.avatarPictures', { availability: on ? 'enabled' : 'disabled' }));
const classUploads = (on: boolean, teacher = s.teacherA, classId = s.c3a.id) => ok(teacher.put(`/api/teacher/classes/${classId}/avatar-settings`, { uploads: on }));
const auditRows = (action: string) => env.db.$client.prepare('select * from audit_events where action = ?').all(action) as Array<Record<string, unknown>>;
const rows = () => env.db.$client.prepare('select * from avatar_pictures').all() as Array<Record<string, any>>;
const quarantined = () => (fs.existsSync(env.config.avatarQuarantineDir) ? fs.readdirSync(env.config.avatarQuarantineDir).filter((n) => n !== 'tmp') : []);
const pageOf = async (phone: Client) => (await ok(phone.get('/api/student/page'))).avatar.picture;

async function openAll() {
  await setFlag(true);
  await classUploads(true);
}

/** Sends a picture and returns the waiting row's id. */
async function sendOne(phone = adaPhone, colour?: string) {
  const r = await send(phone, await drawing(640, 480, colour));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return rows().find((x) => x.status === 'pending' && x.student_id === (phone === adaPhone ? ada.id : x.student_id))!.id as string;
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-pictures-'));
  env = await makeEnv({ uploadsDir: path.join(dir, 'uploads'), avatarQuarantineDir: path.join(dir, 'avatar-quarantine'), backupsDir: path.join(dir, 'backups') });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  cem = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Cem Örnek' });
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
});
afterEach(async () => {
  await env.app.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('switches (D-014 media flag, class switch, lock)', () => {
  it('the school switch is off by default; then the class switch; the lock also stops sending', async () => {
    expect(await pageOf(adaPhone)).toEqual({ state: 'off', approvedUrl: null, pending: null, refused: null });
    const off = await send(adaPhone, await drawing());
    expect(off.status).toBe(403);
    expect(off.body.error.details).toMatchObject({ reason: 'MEDIA_DISABLED', module: 'media.avatarPictures' });
    expect((await ok(s.teacherA.get('/api/teacher/avatar-pictures'))).enabled).toBe(false);
    expect(await ok(s.teacherA.get('/api/teacher/avatar-pictures/count'))).toEqual({ enabled: false, toCheck: 0 });

    await setFlag(true);
    expect((await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/avatar-settings`))).uploads).toBe(false);
    expect((await pageOf(adaPhone)).state).toBe('classOff');
    expect((await send(adaPhone, await drawing())).body.error.details.reason).toBe('PICTURES_CLASS_OFF');
    // Only the class's own teacher turns the class switch (ACC-4).
    expect((await s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/avatar-settings`, { uploads: true })).status).toBe(403);
    await classUploads(true);
    expect((await pageOf(adaPhone)).state).toBe('open');
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/avatar-settings`, { locked: true }));
    expect((await pageOf(adaPhone)).state).toBe('locked');
    expect((await send(adaPhone, await drawing())).body.error.details.reason).toBe('AVATAR_LOCKED');
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/avatar-settings`, { locked: false }));
    expect((await send(adaPhone, await drawing())).status).toBe(200);
    expect(auditRows('avatar.settings').some((r) => /uploads/iu.test(String(r.after_json)))).toBe(true);
  });

  it('access classes: staff cannot send, students and teachers cannot reach the admin side, other teachers get 404', async () => {
    await openAll();
    const id = await sendOne();
    expect((await send(s.teacherA, await drawing())).status).toBe(401);
    expect((await adaPhone.get('/api/teacher/avatar-pictures')).status).toBe(401);
    expect((await s.teacherA.get('/api/admin/avatar-pictures')).status).toBe(403);
    expect((await s.admin.get('/api/teacher/avatar-pictures')).status).toBe(403);
    // Teacher B does not teach Ada: the picture does not exist for them.
    expect((await ok(s.teacherB.get('/api/teacher/avatar-pictures'))).toCheck).toEqual([]);
    expect((await s.teacherB.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: true })).status).toBe(404);
    expect((await s.teacherB.post(`/api/teacher/avatar-pictures/${id}/refuse`, { reason: 'unkind' })).status).toBe(404);
    expect((await raw(s.teacherB, `/api/teacher/avatar-pictures/${id}/image`)).statusCode).toBe(404);
    // Another student cannot see Ada's picture.
    const cemPhone = await openLink(env, await linkUrl(s.teacherB, s.c3b.id, cem.id));
    expect((await raw(cemPhone, `/api/student/avatar-picture/${id}`)).statusCode).toBe(404);
  });
});

describe('sending (re-encode, one waiting picture, limits)', () => {
  it('re-encodes to a 512 px WebP without metadata, keeps it out of the uploads, and a new picture replaces the old', async () => {
    await openAll();
    const withExif = await sharp(await drawing(1200, 900)).jpeg().withMetadata({ exif: { IFD0: { Artist: 'Fictional Camera' } } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = await send(adaPhone, withExif, 'photo.jpg', 'image/jpeg');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ state: 'open', approvedUrl: null, refused: null });
    expect(r.body.pending.deleteAt - r.body.pending.sentAt).toBe(PENDING_MS);
    const [first] = rows();
    expect(first).toMatchObject({ status: 'pending', student_id: ada.id, file_id: null });
    expect(quarantined()).toEqual([first!.quarantine_key]);
    expect(fs.existsSync(env.config.uploadsDir) ? fs.readdirSync(env.config.uploadsDir, { recursive: true }).filter((n) => !fs.statSync(path.join(env.config.uploadsDir, String(n))).isDirectory()) : []).toEqual([]);
    const img = await raw(adaPhone, r.body.pending.url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    // A waiting picture is never cached (only the student and their teachers may see it).
    expect(img.headers['cache-control']).toBe('no-store');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(img.rawPayload).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
    // The teacher is told (a category that can be turned off).
    const n = await ok(s.teacherA.get('/api/teacher/notifications'));
    expect(JSON.stringify(n)).toContain('avatarPicture');

    // A second picture replaces the waiting one, whose bytes are deleted at once.
    const again = await send(adaPhone, await drawing(300, 300, '#22aa66'));
    expect(again.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.id).not.toBe(first!.id);
    expect(quarantined()).toEqual([rows()[0]!.quarantine_key]);
    expect(auditRows('avatar_picture.send')).toHaveLength(2);
    // The audit never holds the image.
    for (const a of auditRows('avatar_picture.send')) expect(JSON.stringify(a).length).toBeLessThan(2000);
  });

  it('refuses other file types, HEIC, animated and huge pictures, and too many pictures an hour', async () => {
    await openAll();
    expect((await send(adaPhone, Buffer.from('not a picture at all'), 'note.txt', 'text/plain')).status).toBe(400);
    const animated = await sharp([await drawing(64, 64, '#ff0000'), await drawing(64, 64, '#00ff00')], { join: { animated: true } }).webp().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect((await send(adaPhone, animated, 'moving.webp', 'image/webp')).body.error.details.reason).toBe('IMAGE_ANIMATED');
    const huge = await sharp({ create: { width: 8100, height: 20, channels: 3, background: '#888888' } }).png().toBuffer();
    expect((await send(adaPhone, huge, 'wide.png')).body.error.details.reason).toBe('IMAGE_TOO_LARGE');
    expect(rows()).toEqual([]);
    expect(quarantined()).toEqual([]);
    // 10 pictures an hour per student (the refused ones above count too).
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await send(adaPhone, await drawing(32, 32))).status;
    expect(last).toBe(429);
    env.clock.advance(61 * 60_000);
    expect((await send(adaPhone, await drawing(32, 32))).status).toBe(200);
  });

  it('the student takes a waiting picture back (deleted) and stops using an approved one', async () => {
    await openAll();
    const id = await sendOne();
    const back = await ok(adaPhone.req('DELETE', '/api/student/avatar-picture', { which: 'pending' }));
    expect(back.pending).toBeNull();
    expect(rows()).toEqual([]);
    expect(quarantined()).toEqual([]);
    expect((await raw(adaPhone, `/api/student/avatar-picture/${id}`)).statusCode).toBe(404);
    expect(auditRows('avatar_picture.take_back')).toHaveLength(1);

    const id2 = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${id2}/approve`, { confirm: true }));
    const fileId = rows()[0]!.file_id as string;
    const stop = await ok(adaPhone.req('DELETE', '/api/student/avatar-picture', { which: 'approved' }));
    expect(stop.approvedUrl).toBeNull();
    expect(rows()).toEqual([]);
    expect(env.db.$client.prepare('select count(*) as n from files where id = ?').get(fileId)).toEqual({ n: 0 });
    expect(auditRows('avatar_picture.remove')).toHaveLength(1);
  });
});

describe('the teacher check (confirmation, reasons)', () => {
  it('approving needs the confirmation; the picture moves into the uploads and reaches the classroom', async () => {
    await openAll();
    const id = await sendOne();
    const list = await ok(s.teacherA.get('/api/teacher/avatar-pictures'));
    expect(list.toCheck).toHaveLength(1);
    expect(list.toCheck[0]).toMatchObject({ id, studentId: ada.id, studentName: 'Ada Kurgu', className: '3-A', status: 'pending' });
    expect(await ok(s.teacherA.get('/api/teacher/avatar-pictures/count'))).toEqual({ enabled: true, toCheck: 1 });
    expect((await raw(s.teacherA, list.toCheck[0].url)).statusCode).toBe(200);
    // Nothing on the classroom yet.
    expect((await ok(s.teacherA.get('/api/classroom/avatars'))).students.find((x: any) => x.id === ada.id).pictureUrl).toBeNull();
    expect((await raw(s.teacherA, `/api/classroom/students/${ada.id}/avatar-picture`)).statusCode).toBe(404);

    const noTick = await s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, {});
    expect(noTick.status).toBe(400);
    expect(noTick.body.error.details.reason).toBe('CONFIRM_REQUIRED');
    expect((await s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: false })).body.error.details.reason).toBe('CONFIRM_REQUIRED');
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: true }));
    expect((await s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: true })).body.error.details.reason).toBe('PICTURE_NOT_PENDING');

    const row = rows()[0]!;
    expect(row).toMatchObject({ status: 'approved', quarantine_key: null, expires_at: null });
    expect(quarantined()).toEqual([]);
    const file = env.db.$client.prepare('select * from files where id = ?').get(row.file_id) as any;
    expect(file).toMatchObject({ kind: 'image', sniffed_mime: 'image/webp', owner_student_id: ada.id, deleted_at: null });
    expect(fs.existsSync(path.join(env.config.uploadsDir, file.storage_key))).toBe(true);
    const approve = auditRows('avatar_picture.approve');
    expect(approve).toHaveLength(1);
    expect(JSON.stringify(approve[0])).toContain('confirmedNotAPrivatePerson');

    const dirEntry = (await ok(s.teacherA.get('/api/classroom/avatars'))).students.find((x: any) => x.id === ada.id);
    expect(dirEntry.pictureUrl).toMatch(new RegExp(`^/api/classroom/students/${ada.id}/avatar-picture\\?v=`));
    const img = await raw(s.teacherA, dirEntry.pictureUrl);
    expect(img.statusCode).toBe(200);
    expect(img.headers['cache-control']).toBe('private, max-age=3600');
    // Teacher B does not teach Ada: 404.
    expect((await raw(s.teacherB, dirEntry.pictureUrl)).statusCode).toBe(404);
    expect((await pageOf(adaPhone)).approvedUrl).toBeTruthy();
    expect((await ok(s.teacherA.get('/api/teacher/avatar-pictures'))).inUse).toHaveLength(1);

    // The school switch off: nobody sees it (it comes back when the switch is on again).
    await setFlag(false);
    try {
      expect((await ok(s.teacherA.get('/api/classroom/avatars'))).students.find((x: any) => x.id === ada.id).pictureUrl).toBeNull();
      expect((await raw(s.teacherA, dirEntry.pictureUrl)).statusCode).toBe(404);
    } finally {
      await setFlag(true);
    }
    expect((await ok(s.teacherA.get('/api/classroom/avatars'))).students.find((x: any) => x.id === ada.id).pictureUrl).toBeTruthy();

    // Remove: gone at once (files row and bytes too).
    await ok(s.teacherA.req('DELETE', `/api/teacher/avatar-pictures/${id}`, {}));
    expect(rows()).toEqual([]);
    expect(fs.existsSync(path.join(env.config.uploadsDir, file.storage_key))).toBe(false);
    expect(auditRows('avatar_picture.remove')).toHaveLength(1);
  });

  it('refusing needs a reason; the picture is deleted at once and the student sees why', async () => {
    await openAll();
    const id = await sendOne();
    const noReason = await s.teacherA.post(`/api/teacher/avatar-pictures/${id}/refuse`, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details.reason).toBe('REASON_REQUIRED');
    expect((await s.teacherA.post(`/api/teacher/avatar-pictures/${id}/refuse`, { reason: 'rude' })).status).toBe(400);
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${id}/refuse`, { reason: 'knownPerson' }));
    expect(quarantined()).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: 'refused', quarantine_key: null, refusal_reason: 'knownPerson' });
    const info = await pageOf(adaPhone);
    expect(info).toMatchObject({ pending: null, approvedUrl: null, refused: { reason: 'knownPerson' } });
    expect((await raw(adaPhone, `/api/student/avatar-picture/${id}`)).statusCode).toBe(404);
    expect(auditRows('avatar_picture.refuse')).toHaveLength(1);
    // The student closes the note.
    expect((await ok(adaPhone.req('DELETE', '/api/student/avatar-picture', { which: 'refused' }))).refused).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('an administrator decides for any student and can delete every picture with a typed confirmation', async () => {
    await openAll();
    await classUploads(true, s.teacherB, s.c3b.id);
    const cemPhone = await openLink(env, await linkUrl(s.teacherB, s.c3b.id, cem.id));
    const adaId = await sendOne();
    expect((await send(cemPhone, await drawing())).status).toBe(200);
    const all = await ok(s.admin.get('/api/admin/avatar-pictures'));
    expect(all.toCheck.map((x: any) => x.studentName).sort()).toEqual(['Ada Kurgu', 'Cem Örnek']);
    expect((await s.admin.post(`/api/admin/avatar-pictures/${adaId}/approve`, {})).body.error.details.reason).toBe('CONFIRM_REQUIRED');
    await ok(s.admin.post(`/api/admin/avatar-pictures/${adaId}/approve`, { confirm: true }));
    expect((await raw(s.admin, `/api/admin/avatar-pictures/${adaId}/image`)).statusCode).toBe(200);

    expect((await s.admin.post('/api/admin/avatar-pictures/delete-all', { confirm: 'yes' })).body.error.details.reason).toBe('CONFIRMATION_MISMATCH');
    expect((await s.teacherA.post('/api/admin/avatar-pictures/delete-all', { confirm: DELETE_ALL_PICTURES_CONFIRM })).status).toBe(403);
    expect(await ok(s.admin.post('/api/admin/avatar-pictures/delete-all', { confirm: DELETE_ALL_PICTURES_CONFIRM }))).toEqual({ pending: 1, approved: 1 });
    expect(rows()).toEqual([]);
    expect(quarantined()).toEqual([]);
    expect(env.db.$client.prepare(`select count(*) as n from files where original_name = 'avatar-picture.webp'`).get()).toEqual({ n: 0 });
    expect(JSON.parse(String(auditRows('avatar_picture.delete_all')[0]!.after_json))).toEqual({ pending: 1, approved: 1 });
  });
});

describe('the 14-day clean-up', () => {
  it('deletes unchecked pictures (row and file) after 14 days and refusal notes after their time; approved stay', async () => {
    await openAll();
    const waiting = await sendOne();
    const r = rows().find((x) => x.id === waiting)!;
    expect(r.expires_at - r.created_at).toBe(14 * 24 * 3600_000);
    expect(await sweepAvatarPictures(env.deps)).toMatchObject({ expired: 0, notes: 0 });
    env.clock.advance(14 * 24 * 3600_000 - 1000);
    expect((await sweepAvatarPictures(env.deps)).expired).toBe(0);
    expect(quarantined()).toHaveLength(1);
    env.clock.advance(2000);
    expect((await sweepAvatarPictures(env.deps)).expired).toBe(1);
    expect(rows()).toEqual([]);
    expect(quarantined()).toEqual([]);
    expect(auditRows('avatar_picture.expire')).toHaveLength(1);

    // An approved picture never expires; a refusal note does (sessions ended meanwhile: sign in again).
    await s.teacherA.login('ayse.teacher');
    adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
    const keep = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${keep}/approve`, { confirm: true }));
    env.clock.advance(61 * 60_000);
    const refuse = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${refuse}/refuse`, { reason: 'hardToSee' }));
    env.clock.advance(15 * 24 * 3600_000);
    expect(await sweepAvatarPictures(env.deps)).toMatchObject({ expired: 0, notes: 1 });
    expect(rows().map((x) => x.status)).toEqual(['approved']);
  });
});

describe('backups, exports and erasure (DAT-1, DAT-4, DAT-5)', () => {
  it('a backup holds the approved picture but never a waiting one', async () => {
    await openAll();
    await classUploads(true, s.teacherB, s.c3b.id);
    const approved = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${approved}/approve`, { confirm: true }));
    const cemPhone = await openLink(env, await linkUrl(s.teacherB, s.c3b.id, cem.id));
    expect((await send(cemPhone, await drawing())).status).toBe(200);
    const pendingKey = rows().find((x) => x.status === 'pending')!.quarantine_key as string;
    const storageKey = (env.db.$client.prepare('select storage_key from files where id = ?').get(rows().find((x) => x.status === 'approved')!.file_id) as any).storage_key as string;

    const b = await createBackup({ config: env.config, sqlite: env.db.$client, now: env.clock.now(), kind: 'local', includeUploads: true });
    const names = (await readTar(b.file)).map((e) => e.name);
    expect(names.some((n) => n.endsWith(storageKey))).toBe(true);
    expect(names.some((n) => n.includes(pendingKey) || n.includes('avatar-quarantine'))).toBe(false);
  });

  it('the student export has the approved picture and says waiting ones are not kept; the full export has no waiting picture', async () => {
    await openAll();
    const approved = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${approved}/approve`, { confirm: true }));
    env.clock.advance(61 * 60_000);
    await sendOne(adaPhone, '#aa3355');
    const pendingKey = rows().find((x) => x.status === 'pending')!.quarantine_key as string;
    const storageKey = (env.db.$client.prepare('select storage_key from files where id = ?').get(rows().find((x) => x.status === 'approved')!.file_id) as any).storage_key as string;
    const download = async (token: string) => unzip((await raw(s.admin, `/api/admin/exports/${token}`)).rawPayload);

    const one = await download((await ok(s.admin.post(`/api/admin/students/${ada.id}/export`, {}))).token);
    const oneNames = Object.keys(one);
    expect(oneNames.some((n) => n.includes(storageKey))).toBe(true);
    expect(oneNames.some((n) => n.includes(pendingKey))).toBe(false);
    expect(one['manifest.json']!.toString('utf8')).toContain('avatar pictures waiting for a teacher');

    const full = await download((await ok(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: true }))).token);
    const fullNames = Object.keys(full);
    expect(fullNames.some((n) => n.includes(storageKey))).toBe(true);
    expect(fullNames.some((n) => n.includes(pendingKey) || n.includes('quarantine/'))).toBe(false);
    expect(full['manifest.json']!.toString('utf8')).toContain('avatar pictures waiting for a teacher');
  });

  it('erasing a student removes their pictures, the waiting one included', async () => {
    await openAll();
    const approved = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${approved}/approve`, { confirm: true }));
    env.clock.advance(61 * 60_000);
    await sendOne(adaPhone, '#aa3355');
    const storageKey = (env.db.$client.prepare('select storage_key from files where id = ?').get(rows().find((x) => x.status === 'approved')!.file_id) as any).storage_key as string;
    expect(quarantined()).toHaveLength(1);
    await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));
    await ok(s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Kurgu' }));
    expect(rows()).toEqual([]);
    expect(quarantined()).toEqual([]);
    expect(fs.existsSync(path.join(env.config.uploadsDir, storageKey))).toBe(false);
  });
});

describe('review fixes (S24)', () => {
  it('an approved picture survives the clean-up of loose evidence uploads; a dead row is not "in use" and the sweep removes it', async () => {
    await openAll();
    const id = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: true }));
    const fileId = rows()[0]!.file_id as string;
    const file = env.db.$client.prepare('select * from files where id = ?').get(fileId) as any;
    // Recorded as stored by the system: the student's own-upload rules never match it.
    expect(file).toMatchObject({ uploaded_by_type: 'system', uploaded_by_id: null, owner_student_id: ada.id });
    // More than the loose-upload grace later, the student uploads evidence (which runs the clean-up).
    env.clock.advance(2 * 3600_000);
    await s.teacherA.login('ayse.teacher');
    adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
    const pdf = multipart(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), 'my story.pdf', 'application/pdf');
    await ok(adaPhone.req('POST', '/api/student/files?kind=document', pdf.body, pdf.headers));
    expect(env.db.$client.prepare('select deleted_at from files where id = ?').get(fileId)).toEqual({ deleted_at: null });
    expect(fs.existsSync(path.join(env.config.uploadsDir, file.storage_key))).toBe(true);
    expect(rows()[0]).toMatchObject({ status: 'approved', file_id: fileId });
    expect((await pageOf(adaPhone)).approvedUrl).toBeTruthy();
    expect((await ok(s.teacherA.get('/api/classroom/avatars'))).students.find((x: any) => x.id === ada.id).pictureUrl).toBeTruthy();
    expect((await ok(s.teacherA.get('/api/teacher/avatar-pictures'))).inUse).toHaveLength(1);
    // The approved file cannot be read or attached as the student's own upload.
    const attach = await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId });
    expect(attach.status).toBe(404);

    // If the files row goes some other way, the picture is not listed and the sweep removes the row.
    env.db.$client.prepare('update files set deleted_at = ? where id = ?').run(env.clock.now(), fileId);
    expect((await ok(s.teacherA.get('/api/teacher/avatar-pictures'))).inUse).toEqual([]);
    expect(await sweepAvatarPictures(env.deps)).toMatchObject({ dead: 1 });
    expect(rows()).toEqual([]);
    expect(env.db.$client.prepare('select count(*) as n from files where id = ?').get(fileId)).toEqual({ n: 0 });
    expect(auditRows('avatar_picture.remove_missing')).toHaveLength(1);
  });

  it('while the school switch is off teachers see no pictures and every image is 404; an administrator still sees the list to remove them', async () => {
    await openAll();
    const kept = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${kept}/approve`, { confirm: true }));
    env.clock.advance(61 * 60_000);
    const waiting = await sendOne(adaPhone, '#aa3355');
    await setFlag(false);
    try {
      expect(await ok(s.teacherA.get('/api/teacher/avatar-pictures'))).toEqual({ enabled: false, toCheck: [], inUse: [] });
      expect((await raw(s.teacherA, `/api/teacher/avatar-pictures/${waiting}/image`)).statusCode).toBe(404);
      expect((await raw(s.teacherA, `/api/teacher/avatar-pictures/${kept}/image`)).statusCode).toBe(404);
      expect((await raw(s.admin, `/api/admin/avatar-pictures/${kept}/image`)).statusCode).toBe(404);
      const admin = await ok(s.admin.get('/api/admin/avatar-pictures'));
      expect(admin.enabled).toBe(false);
      expect(admin.toCheck.map((x: any) => x.id)).toEqual([waiting]);
      expect(admin.inUse.map((x: any) => x.id)).toEqual([kept]);
      // Deleting stays possible.
      await ok(s.admin.req('DELETE', `/api/admin/avatar-pictures/${kept}`, {}));
      expect(rows().map((x) => x.id)).toEqual([waiting]);
    } finally {
      await setFlag(true);
    }
    expect((await raw(s.teacherA, `/api/teacher/avatar-pictures/${waiting}/image`)).statusCode).toBe(200);
  });

  it('the administrator list keeps the pictures of a student without a class now, so they can be removed', async () => {
    await openAll();
    const id = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: true }));
    // The enrolment ended (e.g. the student left at the end of a term): no live class any more.
    env.db.$client.prepare('update enrolments set to_date = from_date where student_id = ?').run(ada.id);
    const admin = await ok(s.admin.get('/api/admin/avatar-pictures'));
    expect(admin.inUse).toEqual([expect.objectContaining({ id, studentName: 'Ada Kurgu', classId: null, className: null })]);
    expect((await ok(s.teacherA.get('/api/teacher/avatar-pictures'))).inUse).toEqual([]);
    await ok(s.admin.req('DELETE', `/api/admin/avatar-pictures/${id}`, {}));
    expect(rows()).toEqual([]);
  });
});

describe('Super Speakers (owner decision d)', () => {
  it('the board and the scorer show the avatar until the administrator turns own pictures on', async () => {
    await openAll();
    const id = await sendOne();
    await ok(s.teacherA.post(`/api/teacher/avatar-pictures/${id}/approve`, { confirm: true }));
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    const scorerLink = await ok(s.admin.post('/api/admin/speakers/scorers', { label: 'Ms Deniz' }));
    const phone = new Client(env);
    await ok(phone.post('/api/scorer/session', { token: tokenOf(scorerLink.url) }));
    const boardLink = await ok(s.admin.post('/api/admin/speakers/displays', { label: 'Hall screen' }));
    const screen = new Client(env);
    await ok(screen.post('/api/board/session', { token: tokenOf(boardLink.url) }));
    const r = await ok(phone.post('/api/scorer/commands', { commands: [{ opId: '01900000-0000-7000-8000-0000000000a1', type: 'points.award', payload: { studentId: ada.id } }] }));
    expect(r.results[0].ok).toBe(true);

    expect((await ok(s.admin.get('/api/admin/speakers'))).settings.showOwnPictures).toBe(false);
    const adaOnScorer = async () => (await ok(phone.get('/api/scorer/students'))).students.find((x: any) => x.id === ada.id);
    const adaOnBoard = async () => (await ok(screen.get('/api/board'))).places.flatMap((p: any) => p.students).find((x: any) => x.id === ada.id);
    expect((await adaOnScorer()).pictureUrl).toBeNull();
    expect((await adaOnBoard()).pictureUrl).toBeNull();
    expect((await raw(screen, `/api/board/students/${ada.id}/picture`)).statusCode).toBe(404);
    expect((await raw(phone, `/api/scorer/students/${ada.id}/picture`)).statusCode).toBe(404);

    await ok(s.admin.put('/api/admin/speakers/settings', { showOwnPictures: true }));
    try {
      const onScorer = (await adaOnScorer()).pictureUrl;
      const onBoard = (await adaOnBoard()).pictureUrl;
      expect(onScorer).toMatch(new RegExp(`^/api/scorer/students/${ada.id}/picture\\?v=`));
      expect(onBoard).toMatch(new RegExp(`^/api/board/students/${ada.id}/picture\\?v=`));
      expect((await raw(screen, onBoard)).statusCode).toBe(200);
      expect((await raw(phone, onScorer)).statusCode).toBe(200);
      // Not from the other side, and not for a student without an approved picture.
      expect((await raw(screen, onScorer)).statusCode).not.toBe(200);
      expect((await raw(screen, `/api/board/students/${cem.id}/picture`)).statusCode).toBe(404);
    } finally {
      await ok(s.admin.put('/api/admin/speakers/settings', { showOwnPictures: false }));
    }
    expect((await adaOnBoard()).pictureUrl).toBeNull();
  });
});

function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString('utf8');
    const data = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    i += 30 + nlen + xlen + csize;
  }
  return out;
}
