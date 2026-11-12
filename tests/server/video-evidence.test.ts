/**
 * S27a (D-193): video evidence. GOL-4 (evidence kinds), STU-8 (type by content, size limits, quotas,
 * owner access), STU-4 (scope on every file access), D-014 (media flag off by default: the server
 * refuses), DAT-4 (exports), KVKK erasure. Videos are made in the test (`tests/video-fixtures.ts`):
 * containers with the boxes the server reads and no real pictures. Fictional data only; uploads land
 * in a temporary folder.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_VIDEO_MS, UPLOAD_LIMITS } from '../../src/shared/contracts/files.ts';
import { inspectVideo, neutraliseVideoMetadata } from '../../src/server/modules/files/video.ts';
import { storagePath } from '../../src/server/modules/files/storage.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';
import { FAKE_LOCATION, mp4Video, webmVideo } from '../video-fixtures.ts';

let env: TestEnv;
let s: School;
let root: string;
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };
let adaPhone: Client;

const VIDEO = 'media.evidenceVideo';
const setMedia = (module: string, on: boolean) => ok(s.admin.put(`/api/admin/module-policies/${module}`, { availability: on ? 'enabled' : 'disabled' }));
const studentUpload = (c: Client, data: Buffer, name = 'my-video.mp4', type = 'video/mp4') => {
  const m = multipart(data, name, type);
  return c.req('POST', '/api/student/files?kind=video', m.body, m.headers);
};
const teacherUpload = (c: Client, contextId: string, studentId: string, data: Buffer, name = 'class-play.mp4', type = 'video/mp4') => {
  const m = multipart(data, name, type);
  return c.req('POST', `/api/files?kind=video&ownerStudentId=${studentId}&contextId=${contextId}`, m.body, m.headers);
};
const raw = (c: Client, url: string, headers: Record<string, string> = {}) =>
  env.app.inject({ method: 'GET', url, headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers } });
const storedBytes = (fileId: string) => {
  const row = env.db.$client.prepare('select storage_key from files where id = ?').get(fileId) as { storage_key: string };
  return fsp.readFile(storagePath(env.config, row.storage_key));
};
const uploadAudit = (fileId: string) => JSON.parse((env.db.$client.prepare("select after_json from audit_events where action = 'file.upload' and entity_id = ?").get(fileId) as { after_json: string }).after_json);
const fileRows = () => (env.db.$client.prepare('select count(*) n from files').get() as { n: number }).n;

async function setup(overrides: Record<string, unknown> = {}) {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-s27a-'));
  env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr'), ...overrides });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Masal' });
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
}
async function teardown() {
  await env.app.close();
  await fsp.rm(root, { recursive: true, force: true });
}

describe('the video parser (D-193)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-s27a-parse-'));
  });
  afterEach(() => fsp.rm(dir, { recursive: true, force: true }));
  const inspect = async (b: Buffer) => {
    const f = path.join(dir, crypto.randomUUID());
    await fsp.writeFile(f, b);
    return { f, r: await inspectVideo(f) };
  };

  it('STU-8: MP4, MOV and WebM by their bytes, with their durations; audio-only files, Matroska and other files are refused', async () => {
    expect((await inspect(mp4Video({ seconds: 2 }))).r).toMatchObject({ ok: true, container: 'mp4', mime: 'video/mp4', durationMs: 2000 });
    expect((await inspect(mp4Video({ brand: 'qt  ', seconds: 75 }))).r).toMatchObject({ ok: true, container: 'quicktime', mime: 'video/quicktime', durationMs: 75_000 });
    // A browser recording: Segment and Clusters of unknown size, no Info/Duration: the last block's time.
    expect((await inspect(webmVideo({ clusters: [[0, [0, 400]], [2000, [0, 900]]] }))).r).toMatchObject({ ok: true, container: 'webm', mime: 'video/webm', durationMs: 2900 });
    expect((await inspect(webmVideo({ infoMs: 4200, unknownSizes: false }))).r).toMatchObject({ ok: true, durationMs: 4200 });
    // Fragmented MP4: mehd when present, else unknown.
    expect((await inspect(mp4Video({ fragmentSeconds: 30 }))).r).toMatchObject({ ok: true, durationMs: 30_000 });
    expect((await inspect(mp4Video({ fragmentSeconds: null }))).r).toMatchObject({ ok: true, durationMs: null, atLeastMs: 0 });

    for (const b of [mp4Video({ tracks: ['soun'] }), mp4Video({ brand: 'M4A ' }), webmVideo({ tracks: [2] }), webmVideo({ docType: 'matroska' }), Buffer.from('%PDF-1.4\n'), Buffer.from('just text')]) {
      expect((await inspect(b)).r).toEqual({ ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' });
    }
    expect((await inspect(mp4Video({ noMoov: true }))).r).toEqual({ ok: false, reason: 'VIDEO_UNREADABLE' });
    expect((await inspect(mp4Video().subarray(0, 60))).r).toEqual({ ok: false, reason: 'VIDEO_UNREADABLE' });
    expect((await inspect(Buffer.alloc(0))).r).toEqual({ ok: false, reason: 'FILE_EMPTY' });
  });

  it('a header that claims a short video does not hide longer blocks (the longest time counts)', async () => {
    const r = (await inspect(webmVideo({ infoMs: 1000, clusters: [[0, [0]], [200_000, [0]]] }))).r;
    expect(r).toMatchObject({ ok: true, durationMs: 200_000 });
  });

  it('location tags are blanked in place: same size, same duration, still a video, no location left', async () => {
    for (const b of [mp4Video({ location: true }), mp4Video({ location: true, brand: 'qt  ' }), webmVideo({ tags: true })]) {
      const { f, r } = await inspect(b);
      if (!r.ok) throw new Error('expected a video');
      expect(r.metadata.length).toBeGreaterThan(0);
      expect(b.includes(Buffer.from(FAKE_LOCATION))).toBe(true);
      await neutraliseVideoMetadata(f, r.container, r.metadata);
      const after = await fsp.readFile(f);
      expect(after.length).toBe(b.length);
      expect(after.includes(Buffer.from(FAKE_LOCATION))).toBe(false);
      expect(after.includes(Buffer.from('com.apple.quicktime.location'))).toBe(false);
      expect(after.includes(Buffer.from('Fictional Phone'))).toBe(false);
      const again = await inspectVideo(f);
      expect(again).toMatchObject({ ok: true, container: r.container, durationMs: r.durationMs, metadata: [] });
      // Everything outside the blanked boxes is byte for byte the same (the media data is untouched).
      const tail = b.subarray(b.length - 200);
      expect(after.subarray(after.length - 200).equals(tail) || r.container === 'webm').toBe(true);
    }
  });
});

describe('video evidence (S27a, D-193)', () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it('D-014: while the switch is off (the default) the student and teacher uploads are refused with 403 and nothing is stored; the pages say video is off', async () => {
    const before = fileRows();
    const st = await studentUpload(adaPhone, mp4Video());
    expect(st.status).toBe(403);
    expect(st.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { reason: 'MEDIA_DISABLED', module: VIDEO } });
    const te = await teacherUpload(s.teacherA, s.ctxA.id, ada.id, mp4Video());
    expect(te.status).toBe(403);
    expect(te.body.error.details.module).toBe(VIDEO);
    expect(fileRows()).toBe(before);
    expect((await ok(adaPhone.get('/api/student/page'))).media.video).toBe(false);
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`))).media.video).toBe(false);
  });

  it('GOL-4, STU-8: with the switch on a student attaches an MP4; the location is removed, the duration audited, the teacher notified; switching off refuses attaching it again', async () => {
    try {
      await setMedia(VIDEO, true);
      expect((await ok(adaPhone.get('/api/student/page'))).media.video).toBe(true);
      const data = mp4Video({ seconds: 12, location: true, mdat: 4096 });
      const up = await ok(studentUpload(adaPhone, data, 'Ada reading.mp4'));
      expect(up).toMatchObject({ kind: 'video', mime: 'video/mp4', size: data.length });
      const stored = await storedBytes(up.id);
      expect(stored.length).toBe(data.length);
      expect(stored.includes(Buffer.from(FAKE_LOCATION))).toBe(false);
      expect(uploadAudit(up.id)).toMatchObject({ kind: 'video', mime: 'video/mp4', durationMs: 12_000 });

      const ev = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: up.id, body: 'Me reading aloud' }));
      expect(ev).toMatchObject({ kind: 'file', file: { id: up.id, mime: 'video/mp4' } });
      // An audio evidence item cannot carry a video.
      const up2 = await ok(studentUpload(adaPhone, mp4Video()));
      expect((await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'audio', fileId: up2.id })).body.error.details.reason).toBe('EVIDENCE_FILE_KIND');
      const notes = (await ok(s.teacherA.get('/api/teacher/notifications'))) as { items: Array<{ category: string }> };
      expect(notes.items.map((n) => n.category)).toContain('evidenceVideo');

      await setMedia(VIDEO, false);
      const again = await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: up2.id });
      expect(again.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: VIDEO } });
    } finally {
      await setMedia(VIDEO, false);
    }
  });

  it('STU-8: MOV and a WebM browser recording are accepted; other files, audio-only files and broken videos are refused before anything is stored', async () => {
    try {
      await setMedia(VIDEO, true);
      expect(await ok(studentUpload(adaPhone, mp4Video({ brand: 'qt  ' }), 'IMG_0001.MOV', 'video/quicktime'))).toMatchObject({ mime: 'video/quicktime' });
      const rec = await ok(studentUpload(adaPhone, webmVideo({ tags: true }), 'video.webm', 'video/webm'));
      expect(rec).toMatchObject({ mime: 'video/webm' });
      expect(uploadAudit(rec.id).durationMs).toBe(2000);
      const before = fileRows();
      // The client's type and name are never trusted.
      for (const [data, name, type, reason] of [
        [Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n'), 'trick.mp4', 'video/mp4', 'FILE_TYPE_NOT_ALLOWED'],
        [mp4Video({ tracks: ['soun'] }), 'song.mp4', 'video/mp4', 'FILE_TYPE_NOT_ALLOWED'],
        [webmVideo({ docType: 'matroska' }), 'film.webm', 'video/webm', 'FILE_TYPE_NOT_ALLOWED'],
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.webm', 'video/webm', 'FILE_TYPE_NOT_ALLOWED'],
        [mp4Video({ noMoov: true }), 'cut.mp4', 'video/mp4', 'VIDEO_UNREADABLE'],
      ] as const) {
        const r = await studentUpload(adaPhone, data, name, type);
        expect(r.status, name).toBe(400);
        expect(r.body.error.details.reason, name).toBe(reason);
      }
      expect(fileRows()).toBe(before);
    } finally {
      await setMedia(VIDEO, false);
    }
  });

  it('STU-8: the 3-minute cap (with a small allowance) from the container; an unreadable duration is accepted within the size cap and audited as unknown', async () => {
    try {
      await setMedia(VIDEO, true);
      expect(MAX_VIDEO_MS).toBe(180_000);
      await ok(studentUpload(adaPhone, mp4Video({ seconds: 180 })));
      await ok(studentUpload(adaPhone, mp4Video({ seconds: 181 })));
      for (const data of [mp4Video({ seconds: 185 }), webmVideo({ clusters: [[0, [0]], [190_000, [0]]] }), webmVideo({ infoMs: 1000, clusters: [[0, [0]], [200_000, [0]]] }), mp4Video({ fragmentSeconds: 600 })]) {
        const r = await studentUpload(adaPhone, data);
        expect(r.status).toBe(400);
        expect(r.body.error.details).toMatchObject({ reason: 'VIDEO_TOO_LONG', maxSeconds: 180 });
      }
      const unknown = await ok(studentUpload(adaPhone, mp4Video({ fragmentSeconds: null })));
      expect(uploadAudit(unknown.id).durationMs).toBeNull();
    } finally {
      await setMedia(VIDEO, false);
    }
  });

  it('STU-8: the size cap is about 150 MB (here lowered for the test) and the per-student quota counts videos', async () => {
    expect(UPLOAD_LIMITS.video).toBe(150 * 1024 * 1024);
    const saved = UPLOAD_LIMITS.video;
    try {
      await setMedia(VIDEO, true);
      UPLOAD_LIMITS.video = 64 * 1024;
      const big = await studentUpload(adaPhone, mp4Video({ mdat: 70 * 1024 }));
      expect(big.status).toBe(400);
      expect(big.body.error.details).toMatchObject({ reason: 'FILE_TOO_LARGE', limitBytes: 64 * 1024 });
    } finally {
      UPLOAD_LIMITS.video = saved;
      await setMedia(VIDEO, false);
    }
  });

  it('STU-8: Range requests (206, suffix, 416), the right Content-Type, inline, a short private cache; for the owner, the teacher and an admin', async () => {
    try {
      await setMedia(VIDEO, true);
      const data = mp4Video({ seconds: 3, mdat: 2000 });
      const up = await ok(studentUpload(adaPhone, data, 'Ada.mp4'));
      await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: up.id }));
      for (const [c, url] of [
        [adaPhone, `/api/student/files/${up.id}`],
        [s.teacherA, `/api/files/${up.id}`],
        [s.admin, `/api/files/${up.id}`],
      ] as const) {
        const whole = await raw(c, url);
        expect(whole.statusCode, url).toBe(200);
        expect(whole.headers['content-type']).toBe('video/mp4');
        expect(whole.headers['accept-ranges']).toBe('bytes');
        expect(whole.headers['cache-control']).toBe('private, max-age=600');
        expect(String(whole.headers['content-disposition'])).toMatch(/^inline;/u);
        expect(whole.headers['x-content-type-options']).toBe('nosniff');
        expect(whole.rawPayload.length).toBe(data.length);

        const part = await raw(c, url, { range: 'bytes=0-99' });
        expect(part.statusCode).toBe(206);
        expect(part.headers['content-range']).toBe(`bytes 0-99/${data.length}`);
        expect(part.headers['content-length']).toBe('100');
        expect(part.rawPayload.equals((await storedBytes(up.id)).subarray(0, 100))).toBe(true);
        const open = await raw(c, url, { range: `bytes=${data.length - 10}-` });
        expect(open.statusCode).toBe(206);
        expect(open.rawPayload.length).toBe(10);
        const suffix = await raw(c, url, { range: 'bytes=-25' });
        expect(suffix.headers['content-range']).toBe(`bytes ${data.length - 25}-${data.length - 1}/${data.length}`);
        const bad = await raw(c, url, { range: `bytes=${data.length + 5}-` });
        expect(bad.statusCode).toBe(416);
        expect(bad.headers['content-range']).toBe(`bytes */${data.length}`);
      }
      // Other files keep no-store.
      const doc = multipart(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), 'log.pdf', 'application/pdf');
      const pdf = await ok(s.teacherA.req('POST', `/api/files?kind=document&ownerStudentId=${ada.id}&contextId=${s.ctxA.id}`, doc.body, doc.headers));
      expect((await raw(s.teacherA, `/api/files/${pdf.id}`)).headers['cache-control']).toMatch(/no-store/u);
    } finally {
      await setMedia(VIDEO, false);
    }
  });

  it('STU-4, ACC-10 (IDOR): another student, a teacher of another class and a student guessing ids get 404; nobody attaches someone else’s video', async () => {
    try {
      await setMedia(VIDEO, true);
      const up = await ok(studentUpload(adaPhone, mp4Video()));
      await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: up.id }));
      const boraPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, bora.id));
      expect((await raw(boraPhone, `/api/student/files/${up.id}`)).statusCode).toBe(404);
      expect((await raw(boraPhone, `/api/student/files/${up.id}`, { range: 'bytes=0-10' })).statusCode).toBe(404);
      expect((await boraPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: up.id })).status).toBe(404);
      // Mehmet teaches only 3-B.
      expect((await raw(s.teacherB, `/api/files/${up.id}`)).statusCode).toBe(404);
      expect((await raw(s.teacherB, `/api/files/${up.id}`, { range: 'bytes=0-10' })).statusCode).toBe(404);
      // A teacher's upload for Ada: Ayşe cannot attach it for Bora, and Ada sees it only once it is on her evidence.
      const tv = await ok(teacherUpload(s.teacherA, s.ctxA.id, ada.id, mp4Video({ seconds: 5 })));
      expect(tv).toMatchObject({ kind: 'video', ownerStudentId: ada.id });
      expect((await raw(adaPhone, `/api/student/files/${tv.id}`)).statusCode).toBe(404);
      expect((await s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${bora.id}/evidence`, { kind: 'file', fileId: tv.id })).status).toBe(404);
      await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/evidence`, { kind: 'file', fileId: tv.id, body: 'Our class play' }));
      expect((await raw(adaPhone, `/api/student/files/${tv.id}`)).statusCode).toBe(200);
      expect((await teacherUpload(s.teacherB, s.ctxB.id, ada.id, mp4Video())).status).toBe(403);
    } finally {
      await setMedia(VIDEO, false);
    }
  });

  it('DAT-4, KVKK: the student export carries the video byte for byte, the full export with uploads too; erasing the student removes it from disk', async () => {
    try {
      await setMedia(VIDEO, true);
      const up = await ok(studentUpload(adaPhone, mp4Video({ seconds: 4, mdat: 3000 })));
      await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: up.id }));
      const bytes = await storedBytes(up.id);
      const key = (env.db.$client.prepare('select storage_key from files where id = ?').get(up.id) as { storage_key: string }).storage_key;
      const download = async (token: string) => unzip((await raw(s.admin, `/api/admin/exports/${token}`)).rawPayload);
      const one = await download((await ok(s.admin.post(`/api/admin/students/${ada.id}/export`, {}))).token);
      const inOne = Object.entries(one).find(([n]) => n.includes(key));
      expect(inOne?.[1].equals(bytes)).toBe(true);
      const full = await download((await ok(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: true }))).token);
      expect(Object.keys(full).some((n) => n.includes(key))).toBe(true);

      await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));
      await ok(s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Kurgu' }));
      await expect(fsp.stat(storagePath(env.config, key))).rejects.toThrow();
    } finally {
      await setMedia(VIDEO, false);
    }
  });
});

describe('video quota (S27a, D-193)', () => {
  beforeEach(() => setup({ UPLOAD_STUDENT_QUOTA_MB: 1 }));
  afterEach(teardown);

  it('STU-8: a video that would fill the student’s space is refused (QUOTA_STUDENT)', async () => {
    try {
      await setMedia(VIDEO, true);
      await ok(studentUpload(adaPhone, mp4Video({ mdat: 600 * 1024 })));
      const r = await studentUpload(adaPhone, mp4Video({ mdat: 600 * 1024 }));
      expect(r.status).toBe(409);
      expect(r.body.error.details.reason).toBe('QUOTA_STUDENT');
    } finally {
      await setMedia(VIDEO, false);
    }
  });
});

/** Tiny ZIP reader (stored + deflate), as in backup.test.ts. */
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
