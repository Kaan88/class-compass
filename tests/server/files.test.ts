/**
 * Uploads pipeline (S9: STU-8, D-014, CRD-1, ENG-3 "protected evidence & upload validation").
 * Fictional data only; every upload lands in a temporary uploads folder.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStudentResolver } from '../../src/server/lib/http.ts';
import { sessions } from '../../src/server/db/schema.ts';
import { randomToken, tokenHash, newId } from '../../src/server/lib/crypto.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { multipart } from '../import-fixtures.ts';

async function tempDirs() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-files-'));
  return { root, uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') };
}

function upload(c: Client, url: string, data: Buffer, filename: string, contentType: string) {
  const m = multipart(data, filename, contentType);
  return c.req('POST', url, m.body, m.headers);
}

async function raw(env: TestEnv, c: Client, url: string, headers: Record<string, string> = {}) {
  const cookie = [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  return env.app.inject({ method: 'GET', url, headers: { cookie, ...headers } });
}

const setMedia = (s: School, module: string, on: boolean) => ok(s.admin.put(`/api/admin/module-policies/${module}`, { availability: on ? 'enabled' : 'disabled' }));

const jpeg = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();

describe('uploads (STU-8, D-014)', () => {
  let env: TestEnv;
  let s: School;
  let dirs: Awaited<ReturnType<typeof tempDirs>>;
  let ada: { id: string };
  let bora: { id: string };
  beforeAll(async () => {
    dirs = await tempDirs();
    env = await makeEnv({ uploadsDir: dirs.uploadsDir, ocrCacheDir: dirs.ocrCacheDir });
    s = await buildSchool(env);
    ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
    bora = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Bora Kurgu' });
  });
  afterAll(async () => {
    await env.app.close();
    await fsp.rm(dirs.root, { recursive: true, force: true });
  });

  it('refuses photo and audio uploads while the media flags are off (default), documents allowed (D-014)', async () => {
    const img = await jpeg();
    const r1 = await upload(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, img, 'a.jpg', 'image/jpeg');
    expect(r1.status).toBe(403);
    expect(r1.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { reason: 'MEDIA_DISABLED', module: 'media.evidencePhotos' } });
    const r2 = await upload(s.teacherA, `/api/files?kind=audio&ownerStudentId=${ada.id}`, Buffer.alloc(100), 'a.mp3', 'audio/mpeg');
    expect(r2.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'media.evidenceAudio' } });
    const r3 = await upload(s.teacherA, `/api/students/${ada.id}/photo?consent=true`, img, 'p.jpg', 'image/jpeg');
    expect(r3.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'media.studentPhotos' } });
    const r4 = await upload(s.teacherA, `/api/files?kind=document&ownerStudentId=${ada.id}`, Buffer.from('My reading log\nPage 4\n'), 'log.txt', 'text/plain');
    expect(r4.status).toBe(200);
    expect(r4.body).toMatchObject({ kind: 'document', mime: 'text/plain', ownerStudentId: ada.id });
  });

  it('rejects SVG and HTML whatever they are called, and spoofed types (sniffing, never the client type)', async () => {
    await setMedia(s, 'media.evidencePhotos', true);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="4"/></svg>');
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
    for (const [data, name, type, kind] of [
      [svg, 'photo.png', 'image/png', 'image'],
      [svg, 'list.csv', 'text/csv', 'import_source'],
      [html, 'list.csv', 'text/csv', 'import_source'],
      [html, 'notes.txt', 'text/plain', 'document'],
    ] as const) {
      const owner = kind === 'import_source' ? '' : `&ownerStudentId=${ada.id}`;
      const r = await upload(s.teacherA, `/api/files?kind=${kind}${owner}`, data, name, type);
      expect(r.status, `${name} as ${kind}`).toBe(400);
      expect(r.body.error.details.reason).toBe('FILE_TYPE_NOT_ALLOWED');
    }
    // A real PDF sent as an image upload with an image type: refused (kind allow-list by content).
    const { PDFDocument } = await import('pdf-lib');
    const pdf = Buffer.from(await (await PDFDocument.create()).save());
    const spoof = await upload(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, pdf, 'cat.jpg', 'image/jpeg');
    expect(spoof.body.error.details.reason).toBe('FILE_TYPE_NOT_ALLOWED');
    // A JPEG sent with a PDF type and name is stored as what it is.
    const real = await upload(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, await jpeg(), 'doc.pdf', 'application/pdf');
    expect(real.status).toBe(200);
    expect(real.body.mime).toBe('image/jpeg');
  });

  it('re-encodes a polyglot JPEG with HTML appended: the stored file has no markup and is served sandboxed', async () => {
    const poly = Buffer.concat([await jpeg(), Buffer.from('<html><script>alert(document.cookie)</script></html>')]);
    const r = await upload(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, poly, 'x.jpg', 'image/jpeg');
    expect(r.status).toBe(200);
    const got = await raw(env, s.teacherA, `/api/files/${r.body.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.includes(Buffer.from('<script'))).toBe(false);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(String(got.headers['content-security-policy'])).toContain('sandbox');
    expect(String(got.headers['cache-control'])).toContain('no-store');
    // On disk: random key, no extension, not the client's name.
    const files = await fsp.readdir(dirs.uploadsDir, { recursive: true });
    expect(files.some((f) => String(f).includes('x.jpg'))).toBe(false);
  });

  it('strips EXIF including GPS and caps the size at 2560 px', async () => {
    const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#3366aa' } })
      .withExif({ IFD0: { Copyright: 'Fictional', ImageDescription: 'class trip' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '29/1 0/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(big).metadata()).exif).toBeDefined();
    const r = await upload(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, big, 'trip.jpg', 'image/jpeg');
    expect(r.status).toBe(200);
    const got = await raw(env, s.teacherA, `/api/files/${r.body.id}`);
    const meta = await sharp(got.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(2560);
    expect(got.rawPayload.includes(Buffer.from('GPS'))).toBe(false);
    const thumb = await raw(env, s.teacherA, `/api/files/${r.body.id}?thumb=true`);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect((await sharp(thumb.rawPayload).metadata()).width).toBeLessThanOrEqual(320);
  });

  it('refuses files over the kind limit', async () => {
    const huge = Buffer.concat([await jpeg(), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const r = await upload(s.teacherA, `/api/files?kind=image&ownerStudentId=${ada.id}`, huge, 'big.jpg', 'image/jpeg');
    expect(r.status).toBe(400);
    expect(r.body.error.details.reason).toBe('FILE_TOO_LARGE');
    const leftovers = await fsp.readdir(path.join(dirs.uploadsDir, 'tmp')).catch(() => []);
    expect(leftovers).toEqual([]);
  });

  it('serves files only to the owner scope: other teachers, students, signed-out callers get nothing', async () => {
    const doc = await upload(s.teacherA, `/api/files?kind=document&ownerStudentId=${ada.id}`, Buffer.from('Story draft'), 'story.txt', 'text/plain');
    const list = await upload(s.teacherA, '/api/files?kind=import_source', Buffer.from('Ada Kurgu\nBora Kurgu\n'), 'list.txt', 'text/plain');
    expect((await raw(env, s.teacherA, `/api/files/${doc.body.id}`)).statusCode).toBe(200);
    const att = await raw(env, s.teacherA, `/api/files/${doc.body.id}`);
    expect(String(att.headers['content-disposition'])).toMatch(/^attachment/);
    expect((await raw(env, s.admin, `/api/files/${doc.body.id}`)).statusCode).toBe(200);
    // Another teacher (3-B): neither the student's file nor teacher A's import upload.
    expect((await raw(env, s.teacherB, `/api/files/${doc.body.id}`)).statusCode).toBe(404);
    expect((await raw(env, s.teacherB, `/api/files/${list.body.id}`)).statusCode).toBe(404);
    expect((await s.teacherB.get(`/api/files/${doc.body.id}/meta`)).status).toBe(404);
    // Teacher B cannot upload for a student outside their classes either.
    const foreign = await upload(s.teacherB, `/api/files?kind=document&ownerStudentId=${ada.id}`, Buffer.from('x'), 'x.txt', 'text/plain');
    expect(foreign.status).toBe(403);
    // Signed out.
    expect((await raw(env, new Client(env), `/api/files/${doc.body.id}`)).statusCode).toBe(401);
    // A student link session (S10 principal) is not an account: no access through this endpoint.
    setStudentResolver(() => ({ studentId: ada.id, linkId: 'link-1' }));
    try {
      const token = randomToken();
      const now = env.clock.now();
      env.db.insert(sessions).values({ id: newId(), tokenHash: tokenHash(env.config.SECRET_PEPPER, token), kind: 'student', userId: null, studentLinkId: 'link-1', createdAt: now, lastSeenAt: now, expiresAt: now + 3_600_000 }).run();
      const student = new Client(env);
      student.cookies.set('cc', token);
      expect((await raw(env, student, `/api/files/${doc.body.id}`)).statusCode).toBe(401);
    } finally {
      setStudentResolver(() => null);
    }
    void bora;
  });

  it('supports byte ranges for audio (seeking) once audio is enabled', async () => {
    await setMedia(s, 'media.evidenceAudio', true);
    const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
    const mp3 = Buffer.concat([...Array.from({ length: 50 }, () => Buffer.concat([frame, Buffer.alloc(413)]))]);
    const r = await upload(s.teacherA, `/api/files?kind=audio&ownerStudentId=${ada.id}`, mp3, 'reading.mp3', 'audio/mpeg');
    expect(r.status).toBe(200);
    expect(r.body.mime).toBe('audio/mpeg');
    const part = await raw(env, s.teacherA, `/api/files/${r.body.id}`, { range: 'bytes=0-99' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${mp3.length}`);
    expect(part.rawPayload.length).toBe(100);
    expect(String(part.headers['content-disposition'])).toMatch(/^inline/);
    expect((await raw(env, s.teacherA, `/api/files/${r.body.id}`, { range: 'bytes=999999-' })).statusCode).toBe(416);
    await setMedia(s, 'media.evidenceAudio', false);
  });

  it('student photos: off by default, consent required, shown only while allowed (CRD-1, D-014)', async () => {
    const before = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    expect(before.students.every((x: { photoUrl: string | null }) => x.photoUrl === null)).toBe(true);
    await setMedia(s, 'media.studentPhotos', true);
    const noConsent = await upload(s.teacherA, `/api/students/${ada.id}/photo`, await jpeg(), 'p.jpg', 'image/jpeg');
    expect(noConsent.body.error.details.reason).toBe('CONSENT_REQUIRED');
    const okUp = await upload(s.teacherA, `/api/students/${ada.id}/photo?consent=true`, await jpeg(), 'p.jpg', 'image/jpeg');
    expect(okUp.status).toBe(200);
    expect(okUp.body.photoUrl).toMatch(/^\/api\/classroom\/students\//);
    const roster = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    const row = roster.students.find((x: { id: string }) => x.id === ada.id);
    expect(row).toMatchObject({ photoConsent: true, photoUrl: okUp.body.photoUrl });
    const photo = await raw(env, s.teacherA, okUp.body.photoUrl);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/webp');
    // Teacher B does not teach Ada; another teacher cannot set a photo for her either.
    expect((await raw(env, s.teacherB, okUp.body.photoUrl)).statusCode).toBe(404);
    expect((await upload(s.teacherB, `/api/students/${ada.id}/photo?consent=true`, await jpeg(), 'p.jpg', 'image/jpeg')).status).toBe(403);
    // The consent was audited.
    const audit = await ok(s.admin.get(`/api/admin/audit?entity=student&entityId=${ada.id}`));
    expect(JSON.stringify(audit)).toContain('student.photo_set');
    // Turning photos off hides them again at once (and the photo endpoint answers 404).
    await setMedia(s, 'media.studentPhotos', false);
    const after = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    expect(after.students.find((x: { id: string }) => x.id === ada.id).photoUrl).toBeNull();
    expect((await raw(env, s.teacherA, okUp.body.photoUrl)).statusCode).toBe(404);
  });

  it('deleting the file of a current photo clears the photo, so cards show initials again (CRD-1, IMP-6)', async () => {
    await setMedia(s, 'media.studentPhotos', true);
    const up = await upload(s.teacherA, `/api/students/${ada.id}/photo?consent=true`, await jpeg(), 'p.jpg', 'image/jpeg');
    expect(up.status).toBe(200);
    const fileId = new URL(up.body.photoUrl, 'http://x').searchParams.get('v')!;
    expect((await s.teacherA.req('DELETE', `/api/files/${fileId}`)).status).toBe(200);
    const roster = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    expect(roster.students.find((x: { id: string }) => x.id === ada.id).photoUrl).toBeNull();
    const audit = await ok(s.admin.get(`/api/admin/audit?entity=student&entityId=${ada.id}`));
    expect(JSON.stringify(audit)).toContain('student.photo_remove');
    await setMedia(s, 'media.studentPhotos', false);
  });
});

describe('upload quotas (STU-8)', () => {
  it('enforces the per-student and the global quota in the same transaction as the file row', async () => {
    const dirs = await tempDirs();
    const env = await makeEnv({ uploadsDir: dirs.uploadsDir, ocrCacheDir: dirs.ocrCacheDir, UPLOAD_STUDENT_QUOTA_MB: 1, UPLOAD_GLOBAL_QUOTA_MB: 2 });
    try {
      const s = await buildSchool(env);
      const a = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Cem Kurgu' });
      const b = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Deniz Kurgu' });
      const doc = Buffer.from('a'.repeat(700 * 1024));
      const send = (owner: string) => upload(s.teacherA, `/api/files?kind=document&ownerStudentId=${owner}`, doc, 'log.txt', 'text/plain');
      expect((await send(a.id)).status).toBe(200);
      const second = await send(a.id);
      expect(second.status).toBe(409);
      expect(second.body.error.details.reason).toBe('QUOTA_STUDENT');
      expect((await send(b.id)).status).toBe(200);
      expect((await send(b.id)).body.error.details.reason).toBe('QUOTA_STUDENT');
      const c = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Kurgu' });
      expect((await send(c.id)).body.error.details.reason).toBe('QUOTA_GLOBAL');
      // Refused uploads leave no bytes behind.
      const stored = (await fsp.readdir(dirs.uploadsDir, { recursive: true, withFileTypes: true })).filter((d) => d.isFile());
      expect(stored).toHaveLength(2);
    } finally {
      await env.app.close();
      await fsp.rm(dirs.root, { recursive: true, force: true });
    }
  });
});
