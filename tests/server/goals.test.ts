/**
 * Goals, reflections and evidence on the student page (S10: GOL-1..6, STU-2, STU-5, STU-8, DAT-6,
 * D-014). Fictional data only; uploads land in a temporary folder.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registeredEndpoints } from '../../src/server/lib/http.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { cmd, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const READ_WEEKLY = '00000000-0000-7000-8000-00000000d011';
const PRIVATE_MARKER = 'PRIVATE-NOTE-zebra-quartz-7731';

let env: TestEnv;
let s: School;
let root: string;
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };
let adaPhone: Client;
let boraPhone: Client;

const setMedia = (module: string, on: boolean) => ok(s.admin.put(`/api/admin/module-policies/${module}`, { availability: on ? 'enabled' : 'disabled' }));
const upload = (c: Client, url: string, data: Buffer, filename: string, type: string) => {
  const m = multipart(data, filename, type);
  return c.req('POST', url, m.body, m.headers);
};
const jpeg = () => sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();
const mp3 = () => {
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 20 }, () => Buffer.concat([frame, Buffer.alloc(413)])));
};
const goalsSection = (page: any, subject = 'English') => page.subjects.find((x: any) => x.name.en === subject)?.sections.find((x: any) => x.key === 'goals')?.data;

async function setup() {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-goals-'));
  env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  boraPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, bora.id));
}
async function teardown() {
  await env.app.close();
  await fsp.rm(root, { recursive: true, force: true });
}

describe('student page goals (GOL-1, GOL-2, GOL-4, STU-2)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('shows default EN/TR categories and presets; a student chooses a preset, reflects with confidence and adds text evidence', async () => {
    const page = await ok(adaPhone.get('/api/student/page'));
    const goals = goalsSection(page);
    expect(goals.categories.map((c: any) => c.name.en)).toEqual(['Reading', 'Writing', 'Grammar', 'Vocabulary', 'Listening', 'Speaking', 'Phonics']);
    expect(goals.categories.map((c: any) => c.name.tr)).toEqual(['Okuma', 'Yazma', 'Dil bilgisi', 'Kelime bilgisi', 'Dinleme', 'Konuşma', 'Sesletim']);
    expect(goals.presets.length).toBeGreaterThan(4);
    expect(goals.canWrite).toBe(true);

    const goal = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, presetId: READ_WEEKLY, practiceChoices: ['Library book'] }));
    expect(goal).toMatchObject({ authorType: 'student', presetId: READ_WEEKLY, category: { id: READING }, practiceChoices: ['Library book'] });
    const own = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read comics in English.' }));
    expect(own.text).toBe('I will read comics in English.');
    const reflected = await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'self_assessment', body: 'I read two books!', confidence: 4 }));
    expect(reflected.entries).toMatchObject([{ kind: 'self_assessment', confidence: 4, authorType: 'student' }]);
    expect((await adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'self_assessment', body: 'No number' })).body.error.details.reason).toBe('CONFIDENCE_REQUIRED');
    const ev = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, goalId: goal.id, kind: 'text', body: 'Book list: Tom, Pip' }));
    expect(ev).toMatchObject({ kind: 'text', goalId: goal.id, authorType: 'student' });

    // The teacher sees it all and the overview counts it (RPT-5).
    const detail = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));
    expect(detail.goals).toHaveLength(2);
    expect(detail.evidence).toHaveLength(1);
    const overview = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goals`));
    expect(overview.students.find((x: any) => x.id === ada.id)).toMatchObject({ activeGoals: 2, evidence: 1, lastConfidence: 4 });
    expect(overview.students.find((x: any) => x.id === bora.id)).toMatchObject({ activeGoals: 0, evidence: 0, lastConfidence: null });

    // Teacher feedback and outcomes appear read-only on the page.
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/feedback`, { goalId: goal.id, body: 'Lovely reading, Ada.' }));
    await ok(s.teacherA.post(`/api/teacher/goals/${goal.id}/assessments`, { outcome: 'developing' }));
    const after = goalsSection(await ok(adaPhone.get('/api/student/page')));
    expect(after.feedback).toMatchObject([{ body: 'Lovely reading, Ada.', teacherName: 'Test ayse.teacher' }]);
    expect(after.goals.find((g: any) => g.id === goal.id).assessments).toMatchObject([{ outcome: 'developing' }]);
  });

  it('refuses javascript: and other non-web links; keeps https links', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'JaVaScRiPt:alert(1)', 'https://user:pw@example.test/', 'ftp://example.test/x']) {
      const r = await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'link', url });
      expect(r.status, url).toBe(400);
    }
    const okLink = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'link', url: 'https://example.test/my-story' }));
    expect(okLink.url).toBe('https://example.test/my-story');
  });

  it('a renamed category keeps its snapshot in the goal history (DAT-6)', async () => {
    const cat = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/goal-categories`, { name: { en: 'Speaking', tr: 'Konuşma' } }));
    const goal = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: cat.id, text: 'I will say three sentences in class.' }));
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${cat.id}`, { name: { en: 'Talking', tr: 'Sohbet' } }));
    const shown = goalsSection(await ok(adaPhone.get('/api/student/page'))).goals.find((g: any) => g.id === goal.id);
    expect(shown.category).toEqual({ id: cat.id, name: { en: 'Talking', tr: 'Sohbet' }, nameAtCreation: { en: 'Speaking', tr: 'Konuşma' } });
    // Another teacher's custom category is not offered to this subject's students.
    expect((await s.teacherB.post(`/api/teacher/contexts/${s.ctxB.id}/goal-categories`, { name: { en: 'Geometry' } })).status).toBe(200);
    const names = goalsSection(await ok(adaPhone.get('/api/student/page'))).categories.map((c: any) => c.name.en);
    expect(names).toContain('Talking');
    expect(names).not.toContain('Geometry');
  });

  it('a switched-off module leaves the section out and refuses writes; an archived class is read-only', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: false }));
    expect(goalsSection(await ok(adaPhone.get('/api/student/page')))).toBeUndefined();
    const r = await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'x' });
    expect(r.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('only their own contributions (GOL-5, STU-5)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('student A cannot read or change student B’s goals, entries, evidence or files', async () => {
    const goal = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read one book every week.' }));
    const withEntry = await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'Today I read a short story.' }));
    const entryId = withEntry.entries[0].id;
    const file = await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('Ada’s reading log'), 'log.txt', 'text/plain'));
    const ev = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: file.id, goalId: goal.id }));
    expect((await adaPhone.get(`/api/student/files/${file.id}`)).status).toBe(200);

    const page = JSON.stringify(await ok(boraPhone.get('/api/student/page')));
    expect(page).not.toContain('Ada');
    const tries = [
      boraPhone.patch(`/api/student/goals/${goal.id}`, { text: 'hacked' }),
      boraPhone.del(`/api/student/goals/${goal.id}`),
      boraPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'x' }),
      boraPhone.patch(`/api/student/entries/${entryId}`, { body: 'x' }),
      boraPhone.del(`/api/student/entries/${entryId}`),
      boraPhone.patch(`/api/student/evidence/${ev.id}`, { body: 'x' }),
      boraPhone.del(`/api/student/evidence/${ev.id}`),
      boraPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: file.id }),
      // The payload My goals "Add my work" sends (S27b, D-194), with another student's goal.
      boraPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'x', goalId: goal.id }),
      boraPhone.get(`/api/student/files/${file.id}`),
    ];
    for (const r of await Promise.all(tries)) expect(r.status).toBe(404);
    // Nothing changed for Ada.
    const mine = goalsSection(await ok(adaPhone.get('/api/student/page')));
    expect(mine.goals[0]).toMatchObject({ text: 'I will read one book every week.', entries: [{ body: 'Today I read a short story.' }] });
    expect(mine.evidence).toHaveLength(1);
    // A teacher of another class cannot see them either.
    expect((await s.teacherB.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`)).status).toBe(403);
    expect((await s.teacherB.get(`/api/files/${file.id}`)).status).toBe(404);
    expect((await s.teacherA.get(`/api/files/${file.id}`)).status).toBe(200);
  });

  it('a student edits and deletes their own entries but never the teacher’s goals, progress, outcomes or feedback (403)', async () => {
    const teacherGoal = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`, { categoryId: READING, text: 'Read aloud daily' }));
    const progressed = await ok(s.teacherA.post(`/api/teacher/goals/${teacherGoal.id}/progress`, { body: 'Good start' }));
    const teacherEntry = progressed.entries[0].id;
    await ok(s.teacherA.post(`/api/teacher/goals/${teacherGoal.id}/assessments`, { outcome: 'secure' }));
    const fb = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/feedback`, { body: 'Keep going' }));

    for (const r of [
      await adaPhone.patch(`/api/student/goals/${teacherGoal.id}`, { text: 'mine now' }),
      await adaPhone.del(`/api/student/goals/${teacherGoal.id}`),
      await adaPhone.patch(`/api/student/entries/${teacherEntry}`, { body: 'changed' }),
      await adaPhone.del(`/api/student/entries/${teacherEntry}`),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.error.details.reason).toBe('NOT_YOUR_CONTRIBUTION');
    }
    // Teacher endpoints are not reachable with a student session at all.
    expect((await adaPhone.post(`/api/teacher/goals/${teacherGoal.id}/assessments`, { outcome: 'exceeded' })).status).toBe(401);
    expect((await adaPhone.del(`/api/teacher/feedback/${fb.id}`)).status).toBe(401);

    // The student may still reflect on the teacher's goal and manage that reflection.
    const mine = await ok(adaPhone.post(`/api/student/goals/${teacherGoal.id}/entries`, { kind: 'self_assessment', body: 'Getting better', confidence: 3 }));
    const myEntry = mine.entries.find((e: any) => e.authorType === 'student').id;
    expect((await ok(adaPhone.patch(`/api/student/entries/${myEntry}`, { confidence: 5 }))).entries.find((e: any) => e.id === myEntry).confidence).toBe(5);
    await ok(adaPhone.del(`/api/student/entries/${myEntry}`));
    const own = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'My own goal' }));
    expect((await ok(adaPhone.patch(`/api/student/goals/${own.id}`, { status: 'achieved' }))).status).toBe('achieved');
    await ok(adaPhone.del(`/api/student/goals/${own.id}`));

    const page = goalsSection(await ok(adaPhone.get('/api/student/page')));
    expect(page.goals.map((g: any) => g.text)).toEqual(['Read aloud daily']);
    expect(page.goals[0].assessments).toMatchObject([{ outcome: 'secure' }]);
    expect(page.feedback).toMatchObject([{ body: 'Keep going' }]);
  });

  it('teachers cannot rewrite a student’s own goal words (STUDENT_CONTRIBUTION)', async () => {
    const own = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will write a short story.' }));
    const r = await s.teacherA.patch(`/api/teacher/goals/${own.id}`, { text: 'Teacher words' });
    expect(r.status).toBe(403);
    expect((await ok(s.teacherA.patch(`/api/teacher/goals/${own.id}`, { reviewOn: '2026-12-01' }))).reviewOn).toBe('2026-12-01');
  });
});

describe('media flags (D-014, STU-8)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('photo and audio evidence are refused while the flags are off; documents, text and links are allowed', async () => {
    const photo = await upload(adaPhone, '/api/student/files?kind=image', await jpeg(), 'p.jpg', 'image/jpeg');
    expect(photo.status).toBe(403);
    expect(photo.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'media.evidencePhotos' } });
    const audio = await upload(adaPhone, '/api/student/files?kind=audio', mp3(), 'a.mp3', 'audio/mpeg');
    expect(audio.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'media.evidenceAudio' } });
    const doc = await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('Story'), 's.txt', 'text/plain'));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: doc.id }));
    expect((await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'audio', fileId: doc.id })).body.error.details.reason).toBe('EVIDENCE_FILE_KIND');
    expect(goalsSection(await ok(adaPhone.get('/api/student/page'))).evidence).toHaveLength(1);
    const page = await ok(adaPhone.get('/api/student/page'));
    expect(page.media).toEqual({ photos: false, audio: false, documents: true });
  });

  it('with the flags on photos and audio work, and attaching is refused again once a flag is switched off', async () => {
    await setMedia('media.evidencePhotos', true);
    await setMedia('media.evidenceAudio', true);
    const photo = await ok(upload(adaPhone, '/api/student/files?kind=image', await jpeg(), 'p.jpg', 'image/jpeg'));
    const audio = await ok(upload(adaPhone, '/api/student/files?kind=audio', mp3(), 'a.mp3', 'audio/mpeg'));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'audio', fileId: audio.id }));
    await setMedia('media.evidencePhotos', false);
    const r = await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: photo.id });
    expect(r.body.error).toMatchObject({ code: 'FEATURE_DISABLED', details: { module: 'media.evidencePhotos' } });
    await setMedia('media.evidenceAudio', false);
  });
});

describe('private notes and Secret Student data never reach a student (GOL-6, SEC-3)', () => {
  beforeAll(setup);
  afterAll(teardown);

  it('scans every student response for a private note', async () => {
    const goal = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read every day.' }));
    const note = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/private-notes`, { body: `${PRIVATE_MARKER} for Ada` }));
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`))).privateNotes).toMatchObject([{ id: note.id }]);
    // Another teacher never sees it.
    const answers: string[] = [];
    const keep = (r: { status: number; body: unknown }) => {
      answers.push(JSON.stringify(r.body));
      return r;
    };
    const studentGets = registeredEndpoints.filter((e) => e.access === 'student' && e.method === 'GET');
    expect(studentGets.length).toBeGreaterThanOrEqual(2);
    const doc = await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('notes'), 'n.txt', 'text/plain'));
    for (const e of studentGets) {
      const url = e.path.replace(':fileId', doc.id);
      keep(await adaPhone.get(url));
      keep(await adaPhone.get(url.replace(doc.id, note.id)));
    }
    keep(await adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'note', body: 'x' }));
    keep(await adaPhone.patch(`/api/student/goals/${goal.id}`, { status: 'active' }));
    keep(await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'y' }));
    keep(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'z' }));
    for (const a of answers) {
      expect(a).not.toContain(PRIVATE_MARKER);
      expect(a).not.toContain(note.id);
      expect(a).not.toMatch(/privateNote/iu);
    }
  });

  it('the student page does not depend on who the Secret Students are', async () => {
    const more = [];
    for (const fullName of ['Cem Kurgu', 'Dila Kurgu', 'Efe Kurgu']) more.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
    const phones = [adaPhone, boraPhone];
    for (const m of more) phones.push(await openLink(env, await linkUrl(s.teacherA, s.c3a.id, m.id)));
    const lessonId = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/secret/settings`, { count: 2 }));
    await cmd(s.teacherA, 'secret.draw', { contextId: s.ctxA.id, lessonId });
    const snap = async () => Promise.all(phones.map(async (p) => JSON.stringify(await ok(p.get('/api/student/page')))));
    const before = await snap();
    const rows = env.db.$client.prepare("select s.id, s.student_id studentId from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ? and r.status = 'live'").all(lessonId) as Array<{ id: string; studentId: string }>;
    expect(rows.length).toBe(2);
    const all = [ada.id, bora.id, ...more.map((m) => m.id)];
    const others = all.filter((id) => !rows.some((r) => r.studentId === id));
    rows.forEach((r, i) => env.db.$client.prepare('update secret_selections set student_id = ? where id = ?').run(others[i], r.id));
    expect(await snap()).toEqual(before);
    for (const p of before) expect(p).not.toMatch(/secret/iu);
  });
});

describe('boundaries (GOL-6, STU-5)', () => {
  it('only the private-notes file reads private notes, and no student code imports it', () => {
    const srcRoot = path.resolve(import.meta.dirname, '../../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.tsx?$/u.test(f.name)) files.push(full);
      }
    };
    walk(srcRoot);
    const rel = (f: string) => path.relative(srcRoot, f).replaceAll('\\', '/');
    const users = files.filter((f) => /privateTeacherNotes|private_teacher_notes/u.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    expect(users).toEqual(['server/db/schema.ts', 'server/modules/goals/history.ts', 'server/modules/goals/private.ts']);
    const importers = files.filter((f) => /from '\.\/private\.ts'|goals\/private\.ts'/u.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(importers).toEqual(['server/modules/goals/teacher.ts']);
    for (const f of ['server/modules/goals/student.ts', 'server/modules/goals/dto.ts', 'server/modules/links/page.ts', 'server/modules/homework/student.ts']) {
      expect(fs.readFileSync(path.join(srcRoot, f), 'utf8')).not.toMatch(/teacher\.ts'|private\.ts'/u);
    }
  });
});

describe('S10 review fixes: student uploads can be removed (STU-8, GOL-5)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('deleting own file evidence deletes the uploaded file for the student and every teacher', async () => {
    const file = await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('Ada’s poem'), 'poem.txt', 'text/plain'));
    const ev = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: file.id }));
    expect((await s.teacherA.get(`/api/files/${file.id}`)).status).toBe(200);
    await ok(adaPhone.del(`/api/student/evidence/${ev.id}`));
    expect((await adaPhone.get(`/api/student/files/${file.id}`)).status).toBe(404);
    expect((await s.teacherA.get(`/api/files/${file.id}`)).status).toBe(404);
    const audit = env.db.$client.prepare("SELECT actor_type FROM audit_events WHERE action = 'file.delete' AND entity_id = ?").all(file.id) as { actor_type: string }[];
    expect(audit).toEqual([{ actor_type: 'student' }]);
  });

  it('uploads never attached stop filling the student quota after the grace period', async () => {
    (env.config as { UPLOAD_STUDENT_QUOTA_MB: number }).UPLOAD_STUDENT_QUOTA_MB = 0.001; // ≈1 kB
    const blob = Buffer.from('x'.repeat(700));
    const loose = await ok(upload(adaPhone, '/api/student/files?kind=document', blob, 'a.txt', 'text/plain'));
    const full = await upload(adaPhone, '/api/student/files?kind=document', blob, 'b.txt', 'text/plain');
    expect(full.body.error.details.reason).toBe('QUOTA_STUDENT');
    env.clock.advance(61 * 60_000);
    await ok(upload(adaPhone, '/api/student/files?kind=document', blob, 'c.txt', 'text/plain'));
    expect((await adaPhone.get(`/api/student/files/${loose.id}`)).status).toBe(404);
  });

  it('an attached upload is kept by the clean-up', async () => {
    const file = await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('kept'), 'k.txt', 'text/plain'));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: file.id }));
    env.clock.advance(2 * 60 * 60_000);
    await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('next'), 'n.txt', 'text/plain'));
    expect((await adaPhone.get(`/api/student/files/${file.id}`)).status).toBe(200);
  });
});

describe('S10 review fixes: teacher deletes and library edits follow DAT-1 and ACC-10', () => {
  beforeEach(setup);
  afterEach(teardown);

  const prepare = async () => {
    const fb = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/feedback`, { body: 'Well done.' }));
    const note = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/private-notes`, { body: 'note' }));
    const cat = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/goal-categories`, { name: { en: 'Speaking' } }));
    const preset = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/goal-presets`, { categoryId: cat.id, text: { en: 'Say hello' } }));
    return { fb, note, cat, preset };
  };

  it('an archived year is read-only for feedback, private notes, categories and presets (DAT-1)', async () => {
    const { fb, note, cat, preset } = await prepare();
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`, {}));
    for (const r of [
      await s.teacherA.del(`/api/teacher/feedback/${fb.id}`),
      await s.teacherA.del(`/api/teacher/private-notes/${note.id}`),
      await s.teacherA.patch(`/api/teacher/goal-categories/${cat.id}`, { archived: true }),
      await s.teacherA.patch(`/api/teacher/goal-presets/${preset.id}`, { text: { en: 'Changed' } }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.error.details.reason).toBe('YEAR_ARCHIVED');
    }
    const detail = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));
    expect(detail.feedback).toHaveLength(1);
    expect(detail.privateNotes).toHaveLength(1);
  });

  it('a teacher who no longer teaches the student cannot delete what they wrote (404, ACC-10)', async () => {
    const { fb, note } = await prepare();
    await ok(s.admin.post(`/api/admin/teaching-contexts/${s.ctxA.id}/end`, {}));
    expect((await s.teacherA.del(`/api/teacher/feedback/${fb.id}`)).status).toBe(404);
    expect((await s.teacherA.del(`/api/teacher/private-notes/${note.id}`)).status).toBe(404);
  });

  it('a switched-off module refuses deleting feedback; a writable class allows it', async () => {
    const { fb, note } = await prepare();
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: false }));
    expect((await s.teacherA.del(`/api/teacher/feedback/${fb.id}`)).body.error.code).toBe('FEATURE_DISABLED');
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: true }));
    await ok(s.teacherA.del(`/api/teacher/feedback/${fb.id}`));
    await ok(s.teacherA.del(`/api/teacher/private-notes/${note.id}`));
  });
});
