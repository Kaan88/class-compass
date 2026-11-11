/**
 * S20b (D-170): evidence a teacher adds from the Goals page. The page uploads through the S9
 * teacher upload endpoint (`POST /api/files`, now with the class+subject as `contextId`) and attaches
 * the file with `teacherAddEvidence`; the evidence then shows in the existing list. GOL-4, STU-8,
 * D-014 (media flags), CFG-1 (module gating), ACC-10 (ownership), DAT-1 (read-only years), PIN-1.
 * Fictional data only; uploads land in a temporary folder.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditEvents, files } from '../../src/server/db/schema.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';

let env: TestEnv;
let s: School;
let root: string;
let ada: { id: string; fullName: string };

const setMedia = (module: string, on: boolean) => ok(s.admin.put(`/api/admin/module-policies/${module}`, { availability: on ? 'enabled' : 'disabled' }));
const send = (c: Client, query: string, data: Buffer, filename: string, type: string) => {
  const m = multipart(data, filename, type);
  return c.req('POST', `/api/files?${query}`, m.body, m.headers);
};
/** The Goals page's upload: the student as owner and the class+subject it is for. */
const pageUpload = (c: Client, kind: string, contextId: string, studentId: string, data: Buffer, filename: string, type: string) =>
  send(c, `kind=${kind}&ownerStudentId=${studentId}&contextId=${contextId}`, data, filename, type);
const attach = (c: Client, contextId: string, studentId: string, body: Record<string, unknown>) => c.post(`/api/teacher/contexts/${contextId}/students/${studentId}/evidence`, body);
const jpeg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
const mp3 = () => {
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 20 }, () => Buffer.concat([frame, Buffer.alloc(413)])));
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const fileCount = () => env.db.select({ id: files.id }).from(files).all().length;
const detail = (c: Client = s.teacherA) => ok(c.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));

async function setup(extra: Record<string, unknown> = {}) {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-s20b-'));
  env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr'), ...extra });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
}
async function teardown() {
  await env.app.close();
  await fsp.rm(root, { recursive: true, force: true });
}

describe('evidence from the teacher Goals page (S20b, D-170)', () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it('GOL-4: a document uploaded for a goal is attached, listed with its goal, audited and seen by the student as the teacher’s', async () => {
    const goal = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`, { categoryId: READING, text: 'I will read a short book every week.' }));
    const up = await ok(pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'reading-log.pdf', 'application/pdf'));
    expect(up).toMatchObject({ kind: 'document', mime: 'application/pdf', ownerStudentId: ada.id });
    const ev = await ok(attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'file', fileId: up.id, goalId: goal.id, body: 'Reading log from class' }));
    expect(ev).toMatchObject({ authorType: 'teacher', goalId: goal.id, kind: 'file' });

    const listed = (await detail()).evidence.find((e: any) => e.id === ev.id);
    expect(listed).toMatchObject({ goalId: goal.id, body: 'Reading log from class', file: { id: up.id, name: 'reading-log.pdf' } });

    const actions = env.db.select().from(auditEvents).all().filter((a) => a.entityId === up.id || a.entityId === ev.id);
    expect(actions.map((a) => a.action).sort()).toEqual(['evidence.create', 'file.upload']);
    expect(actions.every((a) => a.actorType === 'user' && a.actorId === s.ayse.id)).toBe(true);

    const adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
    expect((await adaPhone.get(`/api/student/files/${up.id}`)).status).toBe(200);
  });

  it('ACC-10: another class’s teacher is refused (403) at the upload and at the attach, and nothing is stored', async () => {
    const before = fileCount();
    // Mehmet teaches 3-B only: he cannot upload for Ada at all.
    expect((await pageUpload(s.teacherB, 'document', s.ctxB.id, ada.id, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
    // Once he also teaches Mathematics in 3-A, he still cannot use Ayşe's English class+subject.
    const mathsA = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.maths.id }));
    expect((await pageUpload(s.teacherB, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
    expect((await attach(s.teacherB, s.ctxA.id, ada.id, { kind: 'text', body: 'x' })).status).toBe(403);
    // His own 3-B context does not hold Ada: 404 for the student.
    const wrongClass = await pageUpload(s.teacherB, 'document', s.ctxB.id, ada.id, PDF, 'x.pdf', 'application/pdf');
    expect(wrongClass.status).toBe(404);
    expect(fileCount()).toBe(before);
    // In his own 3-A Mathematics context it works, and Ayşe cannot attach his upload.
    const his = await ok(pageUpload(s.teacherB, 'document', mathsA.id, ada.id, PDF, 'sums.pdf', 'application/pdf'));
    expect((await attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'file', fileId: his.id })).status).toBe(404);
  });

  it('D-014: photos and audio only while the media flags allow; a photo uploaded while allowed is refused once the flag is off', async () => {
    const off = await pageUpload(s.teacherA, 'image', s.ctxA.id, ada.id, await jpeg(), 'work.jpg', 'image/jpeg');
    expect(off.status).toBe(403);
    expect(off.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { reason: 'MEDIA_DISABLED', module: 'media.evidencePhotos' } });
    expect((await pageUpload(s.teacherA, 'audio', s.ctxA.id, ada.id, mp3(), 'read.mp3', 'audio/mpeg')).body.error.details.module).toBe('media.evidenceAudio');
    try {
      await setMedia('media.evidencePhotos', true);
      await setMedia('media.evidenceAudio', true);
      const pic = await ok(pageUpload(s.teacherA, 'image', s.ctxA.id, ada.id, await jpeg(), 'work.jpg', 'image/jpeg'));
      const voice = await ok(pageUpload(s.teacherA, 'audio', s.ctxA.id, ada.id, mp3(), 'read.mp3', 'audio/mpeg'));
      await ok(attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'audio', fileId: voice.id }));
      await setMedia('media.evidencePhotos', false);
      const r = await attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'file', fileId: pic.id });
      expect(r.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'media.evidencePhotos' } });
      // Documents follow their own switch (on by default).
      await setMedia('media.evidenceDocuments', false);
      expect((await pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf')).body.error.details.reason).toBe('MEDIA_DISABLED');
    } finally {
      await setMedia('media.evidencePhotos', false);
      await setMedia('media.evidenceAudio', false);
      await setMedia('media.evidenceDocuments', true);
    }
  });

  it('CFG-1, DAT-1: a switched-off Goals module or an archived year refuses the upload before anything is stored, and the attach', async () => {
    const early = await ok(pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'early.pdf', 'application/pdf'));
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: false }));
    const before = fileCount();
    const r = await pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf');
    expect(r.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'goals' } });
    expect((await attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'file', fileId: early.id })).body.error.code).toBe('FEATURE_DISABLED');
    expect(fileCount()).toBe(before);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: true }));
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`, {}));
    const archived = await pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf');
    expect(archived.body.error.details.reason).toBe('YEAR_ARCHIVED');
    expect(fileCount()).toBe(before);
  });

  it('PIN-1: in classroom mode the upload and the attach answer 423 until the PIN is typed', async () => {
    expect((await s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await s.teacherA.post('/api/classroom/enter')).status).toBe(200);
    const locked = await pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf');
    expect(locked.status).toBe(423);
    expect((await attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'text', body: 'Read aloud' })).status).toBe(423);
    expect((await s.teacherA.post('/api/auth/pin/unlock', { pin: '2468' })).status).toBe(200);
    const up = await ok(pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf'));
    await ok(attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'file', fileId: up.id }));
  });

  it('a goal of another student or subject is refused (404); the evidence is not stored', async () => {
    const bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
    const borasGoal = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${bora.id}/goals`, { categoryId: READING, text: 'I will read every day.' }));
    const up = await ok(pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf'));
    expect((await attach(s.teacherA, s.ctxA.id, ada.id, { kind: 'file', fileId: up.id, goalId: borasGoal.id })).status).toBe(404);
    expect((await detail()).evidence).toHaveLength(0);
    expect(env.db.select().from(auditEvents).where(eq(auditEvents.action, 'evidence.create')).all()).toHaveLength(0);
  });
});

describe('every evidence upload names its class+subject (S21b, D-174)', () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it('ENG-3, STU-8: an evidence upload without contextId (or without the student) is a 400 and stores nothing', async () => {
    const before = fileCount();
    try {
      await setMedia('media.evidencePhotos', true);
      await setMedia('media.evidenceAudio', true);
      for (const [kind, data, name, type] of [
        ['document', PDF, 'log.pdf', 'application/pdf'],
        ['image', await jpeg(), 'work.jpg', 'image/jpeg'],
        ['audio', mp3(), 'read.mp3', 'audio/mpeg'],
      ] as const) {
        const noContext = await send(s.teacherA, `kind=${kind}&ownerStudentId=${ada.id}`, data, name, type);
        expect(noContext.status, `${kind} without contextId`).toBe(400);
        expect(noContext.body.error.code).toBe('VALIDATION');
        const noOwner = await send(s.teacherA, `kind=${kind}&contextId=${s.ctxA.id}`, data, name, type);
        expect(noOwner.status, `${kind} without ownerStudentId`).toBe(400);
      }
    } finally {
      await setMedia('media.evidencePhotos', false);
      await setMedia('media.evidenceAudio', false);
    }
    expect(fileCount()).toBe(before);
    expect(env.db.select().from(auditEvents).where(eq(auditEvents.action, 'file.upload')).all()).toHaveLength(0);
  });

  it('ACC-10: a contextId of another class is refused (403) even for a student the teacher teaches; an admin needs a class+subject of their own', async () => {
    const before = fileCount();
    // Ayşe teaches Ada in 3-A, but 3-B English is Mehmet's class+subject.
    const other = await pageUpload(s.teacherA, 'document', s.ctxB.id, ada.id, PDF, 'x.pdf', 'application/pdf');
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('FORBIDDEN');
    // An administrator teaches no class+subject: no evidence upload, with or without one named.
    expect((await pageUpload(s.admin, 'document', s.ctxA.id, ada.id, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
    expect((await send(s.admin, `kind=document&ownerStudentId=${ada.id}`, PDF, 'x.pdf', 'application/pdf')).status).toBe(400);
    expect(fileCount()).toBe(before);
  });

  it('IMP-1: a student list still uploads without a class+subject; the time’s-up clip is still sent to its own endpoint', async () => {
    const csv = multipart(Buffer.from('Öğrenci No;Adı Soyadı\n9001;Cem Kurgu\n', 'utf8'), 'list.csv', 'text/csv');
    expect((await ok(s.teacherA.req('POST', '/api/files?kind=import_source', csv.body, csv.headers))).kind).toBe('import_source');
    const owned = await send(s.teacherA, `kind=import_source&ownerStudentId=${ada.id}`, Buffer.from('Öğrenci No;Adı Soyadı\n'), 'list.csv', 'text/csv');
    expect(owned.body.error.details.reason).toBe('OWNER_NOT_ALLOWED');
    expect((await send(s.teacherA, 'kind=teacher_sound', mp3(), 'x.mp3', 'audio/mpeg')).body.error.details.reason).toBe('WRONG_UPLOAD_KIND');
  });
});

describe('quotas for evidence from the Goals page (S20b, STU-8)', () => {
  beforeEach(() => setup({ UPLOAD_STUDENT_QUOTA_MB: 1 }));
  afterEach(teardown);

  it('the per-student quota counts the teacher’s uploads for that student', async () => {
    const doc = Buffer.from('a'.repeat(700 * 1024));
    await ok(pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, doc, 'log.txt', 'text/plain'));
    const second = await pageUpload(s.teacherA, 'document', s.ctxA.id, ada.id, doc, 'log2.txt', 'text/plain');
    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe('QUOTA_STUDENT');
  });
});
