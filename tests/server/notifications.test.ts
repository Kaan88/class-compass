/**
 * Teacher notifications (S14e3, D-155): every category through its real write path, recipient rules
 * (current teachers of the student and subject, module on, category on, never the teacher who caused
 * it), settings, daily aggregation, access lost, hidden and deleted items, snippets, mark read, ETag,
 * the daily digest with the fake mail transport (counts only, names on opt-in, EN and TR), the 90-day
 * purge, erasure, the per-student export and 423 while locked. Fictional data only.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { v7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAchievementId } from '../../src/shared/achievements.ts';
import { DEFAULT_ON, NOTIFICATION_CATEGORIES, snippetOf } from '../../src/shared/notifications.ts';
import { runNotificationTick } from '../../src/server/modules/notifications/digest.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { Client, FakeMailer, makeEnv, seedUser, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const SUNSHINE = defaultAchievementId('teacher.sunshine');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);

let env: TestEnv;
let s: School;
let mailer: FakeMailer;
let root: string;
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };
let adaPhone: Client;
/** Mehmet also teaches English in 3-A (a co-teacher); Deniz teaches Mathematics in 3-A. */
let ctxMehmetEn: { id: string };
let deniz: Client;

const list = async (c: Client, q = '') => (await ok(c.get(`/api/teacher/notifications${q}`))) as { items: any[]; unread: number; truncated: boolean };
const rows = () => env.db.$client.prepare('select * from notifications order by created_at, id').all() as any[];
const setMedia = (module: string, on: boolean) => ok(s.admin.put(`/api/admin/module-policies/${module}`, { availability: on ? 'enabled' : 'disabled' }));
const upload = (c: Client, url: string, data: Buffer, filename: string, type: string) => {
  const m = multipart(data, filename, type);
  return c.req('POST', url, m.body, m.headers);
};
const mp3 = () => {
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 20 }, () => Buffer.concat([frame, Buffer.alloc(413)])));
};
const settingsOf = (c: Client) => ok(c.get('/api/teacher/notification-settings'));
async function switchOn(c: Client, ...cats: string[]) {
  const cur = await settingsOf(c);
  await ok(c.put('/api/teacher/notification-settings', { categories: { ...cur.categories, ...Object.fromEntries(cats.map((k) => [k, true])) }, digest: cur.digest }));
}
/** Moves the clock and signs everyone in again (teacher sessions end after 12 idle hours, student ones after 30 days). */
async function travel(ms: number) {
  env.clock.advance(ms);
  for (const [c, login] of [[s.teacherA, 'ayse.teacher'], [s.teacherB, 'mehmet.teacher'], [deniz, 'deniz.teacher'], [s.admin, 'root.admin']] as const) await c.login(login);
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
}
const addGoal = (text = 'I will read one book every week.') => ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text }));

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-notify-'));
  mailer = new FakeMailer();
  env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr'), DATA_DIR: root }, { mailer });
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
  ctxMehmetEn = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.english.id }));
  const denizUser = await seedUser(env, 'teacher', 'deniz.teacher');
  await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: denizUser.id, classId: s.c3a.id, subjectId: s.maths.id }));
  deniz = new Client(env);
  await deniz.login('deniz.teacher');
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
});
afterEach(async () => {
  await env.app.close();
  await fsp.rm(root, { recursive: true, force: true });
});

describe('categories and defaults (D-155)', () => {
  it('only the notifications module is a sink (the emitter is not the activity hook)', () => {
    expect(SERVER_MODULES.filter((m) => m.notificationSink).map((m) => m.key)).toEqual(['notifications']);
    expect(SERVER_MODULES.find((m) => m.key === 'notifications')?.activityListeners).toBeUndefined();
  });

  it('starts with the student-work categories on and the others off; the digest is off', async () => {
    const st = await settingsOf(s.teacherA);
    expect(st).toMatchObject({ categories: {}, digest: { enabled: false, hour: 16, includeNames: false }, emailReady: true, hasEmail: false });
    expect(NOTIFICATION_CATEGORIES.filter((c) => DEFAULT_ON[c])).toEqual([
      'goalCreated', 'goalEdited', 'goalAchieved', 'reflection', 'note', 'selfAssessment',
      'evidenceText', 'evidenceLink', 'evidencePicture', 'evidenceDocument', 'evidenceVoice', 'achievementEarned',
    ]);
    expect((await s.teacherA.put('/api/teacher/notification-settings', { categories: { nope: true }, digest: st.digest })).status).toBe(400);
    expect((await s.teacherA.put('/api/teacher/notification-settings', { categories: {}, digest: { ...st.digest, hour: 24 } })).status).toBe(400);
    // Administrators have no notifications (teacher access).
    expect((await s.admin.get('/api/teacher/notifications')).status).toBe(403);
  });

  it('goals, entries and evidence reach the current teachers of that subject only, with ids only in the row', async () => {
    const goal = await addGoal();
    let a = await list(s.teacherA);
    expect(a.items).toMatchObject([{ category: 'goalCreated', student: { id: ada.id, fullName: 'Ada Kurgu' }, context: { id: s.ctxA.id, className: '3-A' }, goalId: goal.id, snippet: 'I will read one book every week.', count: 1, read: false, gone: false }]);
    expect((await list(s.teacherB)).items).toMatchObject([{ category: 'goalCreated', context: { id: ctxMehmetEn.id } }]);
    // Deniz teaches Ada Mathematics, not English.
    expect((await list(deniz)).items).toEqual([]);
    // Rows hold ids only: never the goal text.
    expect(JSON.stringify(rows())).not.toContain('one book');

    await ok(adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read two books every week.' }));
    await ok(adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read three books every week.' }));
    await ok(adaPhone.patch(`/api/student/goals/${goal.id}`, { status: 'achieved' }));
    await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'I liked the story about the fox.' }));
    await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'note', body: 'Remember the library on Friday.' }));
    await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'self_assessment', body: 'I read well now.', confidence: 4 }));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'My book list: Pip and Tom' }));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'link', url: 'https://example.org/story', body: 'My story page' }));
    const doc = await ok(upload(adaPhone, '/api/student/files?kind=document', Buffer.from('Reading log'), 'log.txt', 'text/plain'));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: doc.id }));
    await setMedia('media.evidencePhotos', true);
    await setMedia('media.evidenceAudio', true);
    const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();
    const photo = await ok(upload(adaPhone, '/api/student/files?kind=image', jpeg, 'p.jpg', 'image/jpeg'));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'file', fileId: photo.id }));
    const voice = await ok(upload(adaPhone, '/api/student/files?kind=audio', mp3(), 'a.mp3', 'audio/mpeg'));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'audio', fileId: voice.id }));

    a = await list(s.teacherA);
    const byCat = Object.fromEntries(a.items.map((i) => [i.category, i]));
    expect(Object.keys(byCat).sort()).toEqual(['evidenceDocument', 'evidenceLink', 'evidencePicture', 'evidenceText', 'evidenceVoice', 'goalAchieved', 'goalCreated', 'goalEdited', 'note', 'reflection', 'selfAssessment'].sort());
    // Two text edits of one goal are one line with a count of 2.
    expect(byCat.goalEdited).toMatchObject({ count: 2, snippet: 'I will read three books every week.' });
    expect(byCat.reflection.snippet).toBe('I liked the story about the fox.');
    expect(byCat.evidenceLink.snippet).toBe('My story page');
    expect(byCat.evidencePicture.snippet).toBeNull();
    expect(a.unread).toBe(11);
    expect((await list(deniz)).items).toEqual([]);
    // Newest first.
    expect(a.items[0].category).toBe('evidenceVoice');
  });

  it('achievements: the other current teachers of the subject, never the teacher who gave it, never a quiet backfill', async () => {
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievements/award`, { achievementId: SUNSHINE, studentIds: [ada.id] }));
    expect((await list(s.teacherA)).items).toEqual([]);
    const m = await list(s.teacherB);
    expect(m.items).toMatchObject([{ category: 'achievementEarned', label: { en: expect.any(String) }, gone: false, snippet: null }]);
    expect((await list(deniz)).items).toEqual([]);
    // A quiet backfill (the past) sends nothing.
    const goal = await addGoal();
    const before = rows().filter((r) => r.category === 'achievementEarned').length;
    const started = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievements/start`, { mode: 'quiet' }));
    expect(started.awarded).toBeGreaterThan(0);
    expect(rows().filter((r) => r.category === 'achievementEarned').length).toBe(before);
    // Automatic awards after the start are notified to every current English teacher (no giver).
    // Reaching the goal earns "First goal reached" automatically.
    await ok(adaPhone.patch('/api/student/goals/' + goal.id, { status: 'achieved' }));
    const autos = rows().filter((r) => r.category === 'achievementEarned');
    expect(autos.filter((r) => r.user_id === s.ayse.id).length).toBeGreaterThan(0);
    // Mehmet also has the manual award that Ayse gave.
    expect(autos.filter((r) => r.user_id === s.mehmet.id).length).toBe(autos.filter((r) => r.user_id === s.ayse.id).length + 1);
  });

  it('avatar, link on a new device and blocked text are off by default; switched on they arrive, blocked text as a daily count', async () => {
    const page = await ok(adaPhone.get('/api/student/page'));
    await ok(adaPhone.put('/api/student/avatar', { spec: page.avatar.generated }));
    expect(rows()).toEqual([]);
    await switchOn(s.teacherA, 'avatarChanged', 'linkNewDevice', 'textBlocked');
    await switchOn(deniz, 'avatarChanged', 'linkNewDevice', 'textBlocked');
    // The avatar is about the student as a whole: every current teacher who wants it (Deniz too).
    await ok(adaPhone.put('/api/student/avatar', { spec: page.avatar.generated }));
    expect((await list(s.teacherA)).items.map((i) => i.category)).toEqual(['avatarChanged']);
    expect((await list(deniz)).items.map((i) => i.category)).toEqual(['avatarChanged']);
    // A second device opens the link.
    await ok(new Client(env).post('/api/student/session', { token: tokenOf(await linkUrl(s.teacherA, s.c3a.id, ada.id)) }));
    expect((await list(s.teacherA)).items.map((i) => i.category)).toEqual(['linkNewDevice', 'avatarChanged']);
    // Two blocked attempts in English on one day: one line with a count of 2, never the text; Deniz (Maths) gets none.
    for (const text of ['I will read this shit book.', 'You are a bitch.']) expect((await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text })).status).toBe(400);
    const blocked = (await list(s.teacherA)).items.filter((i) => i.category === 'textBlocked');
    expect(blocked).toMatchObject([{ count: 2, snippet: null, entity: 'text_check' }]);
    expect((await list(deniz)).items.some((i) => i.category === 'textBlocked')).toBe(false);
    expect(JSON.stringify(rows())).not.toMatch(/shit|bitch/u);
    // Read, then a new attempt: the day's line comes back as new.
    await ok(s.teacherA.post('/api/teacher/notifications/read', { ids: [blocked[0].id] }));
    await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read this shit book.' });
    expect((await list(s.teacherA)).items.find((i) => i.category === 'textBlocked')).toMatchObject({ count: 3, read: false });
    // Another day is another line.
    await travel(DAY);
    await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read this shit book.' });
    expect((await list(s.teacherA)).items.filter((i) => i.category === 'textBlocked').map((i) => i.count)).toEqual([1, 3]);
  });

  it('Super Speakers points: a daily count for the teachers of the badge subject, not for the scorer’s own account', async () => {
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    await switchOn(s.teacherA, 'speakersPoints');
    await switchOn(s.teacherB, 'speakersPoints');
    await switchOn(deniz, 'speakersPoints');
    // The scorer link belongs to Mehmet's account: his own points never notify him.
    const link = await ok(s.admin.post('/api/admin/speakers/scorers', { label: 'Mr Mehmet', userId: s.mehmet.id }));
    const phone = new Client(env);
    await ok(phone.post('/api/scorer/session', { token: tokenOf(link.url) }));
    for (let i = 0; i < 3; i++) {
      const r = await ok(phone.post('/api/scorer/commands', { commands: [{ opId: v7(), type: 'points.award', payload: { studentId: ada.id } }] }));
      expect(r.results[0].ok).toBe(true);
    }
    expect((await list(s.teacherA)).items).toMatchObject([{ category: 'speakersPoints', count: 3, student: { id: ada.id } }]);
    expect((await list(s.teacherB)).items).toEqual([]);
    expect((await list(deniz)).items).toEqual([]);
  });
});

describe('recipient rules and access at read time', () => {
  it('a category switched off is not written; a module switched off writes nothing and hides what is there', async () => {
    const cur = await settingsOf(s.teacherA);
    await ok(s.teacherA.put('/api/teacher/notification-settings', { categories: { goalCreated: false }, digest: cur.digest }));
    await addGoal();
    expect((await list(s.teacherA)).items).toEqual([]);
    expect((await list(s.teacherB)).items).toHaveLength(1);
    // Goals off in Mehmet's English class: his line is hidden, and nothing new is written.
    await ok(s.teacherB.put(`/api/teacher/contexts/${ctxMehmetEn.id}/modules/goals`, { enabled: false }));
    expect((await list(s.teacherB)).items).toEqual([]);
    expect((await ok(s.teacherB.get('/api/teacher/notifications/count'))).unread).toBe(0);
    await addGoal('I will learn ten new words.');
    expect(rows().filter((r) => r.user_id === s.mehmet.id)).toHaveLength(1);
    await ok(s.teacherB.put(`/api/teacher/contexts/${ctxMehmetEn.id}/modules/goals`, { enabled: true }));
    expect((await list(s.teacherB)).items).toHaveLength(1);
  });

  it('access lost: an ended assignment or a student who left hides the rows; a deactivated student notifies nobody', async () => {
    await addGoal();
    expect((await list(s.teacherB)).items).toHaveLength(1);
    await ok(s.admin.post(`/api/admin/teaching-contexts/${ctxMehmetEn.id}/end`));
    expect((await list(s.teacherB)).items).toEqual([]);
    expect((await ok(s.teacherB.get('/api/teacher/notifications/count'))).unread).toBe(0);
    // Ayse still sees hers; a deactivated student writes nothing and their rows are hidden.
    expect((await list(s.teacherA)).items).toHaveLength(1);
    await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));
    expect((await list(s.teacherA)).items).toEqual([]);
  });

  it('hidden, deleted and taken-back items lose their snippet; a word blocked later is never shown', async () => {
    const goal = await addGoal();
    const ev = await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'Pineapple words: apple, pear' }));
    await ok(s.teacherA.put(`/api/teacher/student-text/goal/${goal.id}/hidden`, { hidden: true }));
    let items = (await list(s.teacherA)).items;
    expect(items.find((i) => i.category === 'goalCreated')).toMatchObject({ gone: true, snippet: null, goalId: null });
    expect(items.find((i) => i.category === 'evidenceText')).toMatchObject({ gone: false, snippet: 'Pineapple words: apple, pear' });
    // The teacher adds a word to their list: the snippet is no longer shown.
    await ok(s.teacherA.put('/api/teacher/text-check-words', { block: ['pineapple'] }));
    items = (await list(s.teacherA)).items;
    expect(items.find((i) => i.category === 'evidenceText')).toMatchObject({ gone: false, snippet: null });
    await ok(adaPhone.del(`/api/student/evidence/${ev.id}`));
    expect((await list(s.teacherA)).items.find((i) => i.category === 'evidenceText')).toMatchObject({ gone: true, snippet: null });
    // Taken back: a revoked award is gone.
    const given = await ok(s.teacherB.post(`/api/teacher/contexts/${ctxMehmetEn.id}/achievements/award`, { achievementId: SUNSHINE, studentIds: [bora.id] }));
    expect((await list(s.teacherA)).items.find((i) => i.category === 'achievementEarned')).toMatchObject({ gone: false, label: { en: expect.any(String) } });
    await ok(s.teacherB.post(`/api/teacher/awards/${given.awards[0].id}/revoke`, { reason: 'Given by mistake' }));
    expect((await list(s.teacherA)).items.find((i) => i.category === 'achievementEarned')).toMatchObject({ gone: true, label: null });
  });

  it('snippets are cut to 120 characters', async () => {
    expect(snippetOf('a'.repeat(200))).toHaveLength(120);
    expect(snippetOf('  two\n\nlines  ')).toBe('two lines');
    expect(snippetOf('   ')).toBeNull();
    const long = 'I will read a book about foxes, then a story about the sea, then a poem about winter, and after that I will write my own short story about a brave little cat who sails to the moon.';
    await addGoal(long);
    const item = (await list(s.teacherA)).items[0];
    expect([...item.snippet].length).toBe(120);
    expect(item.snippet.endsWith('…')).toBe(true);
  });
});

describe('page, bell and settings endpoints', () => {
  it('filters, mark read (own rows only), the count with ETag/304', async () => {
    const goal = await addGoal();
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'My book list: Pip and Tom' }));
    await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'I liked the story about the fox.' }));
    expect((await list(s.teacherA, '?group=evidence')).items.map((i) => i.category)).toEqual(['evidenceText']);
    expect((await list(s.teacherA, '?group=goals')).items.map((i) => i.category)).toEqual(['reflection', 'goalCreated']);
    expect((await list(s.teacherA, `?contextId=${ctxMehmetEn.id}`)).items).toEqual([]);
    expect((await list(s.teacherA, `?contextId=${s.ctxA.id}`)).items).toHaveLength(3);

    const c1 = await s.teacherA.get('/api/teacher/notifications/count');
    expect(c1.body).toEqual({ unread: 3 });
    const etag = c1.headers.etag as string;
    expect(etag).toBeTruthy();
    expect((await s.teacherA.req('GET', '/api/teacher/notifications/count', undefined, { 'if-none-match': etag })).status).toBe(304);
    expect(c1.headers['cache-control']).toMatch(/no-store/u);

    // Mehmet cannot mark Ayse's rows read.
    const mine = (await list(s.teacherA)).items;
    await ok(s.teacherB.post('/api/teacher/notifications/read', { ids: mine.map((i) => i.id) }));
    expect((await list(s.teacherA)).unread).toBe(3);
    const r = await ok(s.teacherA.post('/api/teacher/notifications/read', { ids: [mine[0].id] }));
    expect(r).toEqual({ ok: true, unread: 2 });
    expect((await s.teacherA.req('GET', '/api/teacher/notifications/count', undefined, { 'if-none-match': etag })).status).toBe(200);
    expect((await list(s.teacherA, '?unread=1')).items).toHaveLength(2);
    expect((await ok(s.teacherA.post('/api/teacher/notifications/read', { all: true }))).unread).toBe(0);
    expect((await list(s.teacherB)).unread).toBe(3);
    expect((await s.teacherA.post('/api/teacher/notifications/read', {})).status).toBe(400);
  });

  it('answers 423 while the classroom lock is engaged (PIN-8)', async () => {
    expect((await s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await s.teacherA.post('/api/classroom/enter')).status).toBe(200);
    for (const [m, url, body] of [
      ['GET', '/api/teacher/notifications', undefined],
      ['GET', '/api/teacher/notifications/count', undefined],
      ['POST', '/api/teacher/notifications/read', { all: true }],
      ['GET', '/api/teacher/notification-settings', undefined],
      ['PUT', '/api/teacher/notification-settings', { categories: {}, digest: { enabled: true, hour: 8, includeNames: true } }],
    ] as const) {
      expect((await s.teacherA.req(m, url, body)).status, url).toBe(423);
    }
  });
});

describe('daily digest (counts only, off by default)', () => {
  async function withEmail(login: string, email: string, locale: 'en' | 'tr' = 'en') {
    env.db.$client.prepare('update users set email = ?, locale = ? where login = ?').run(email, locale, login);
  }

  it('sends nothing while off; once a day after the hour, counts only, names only on opt-in; the second tick sends nothing', async () => {
    await withEmail('ayse.teacher', 'ayse@example.org');
    await addGoal();
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'My book list: Pip and Tom' }));
    env.clock.advance(7 * HOUR); // 17:00 in Istanbul
    expect((await runNotificationTick(env.deps)).sent).toBe(0);
    expect(mailer.sent).toEqual([]);

    await ok(s.teacherA.put('/api/teacher/notification-settings', { categories: {}, digest: { enabled: true, hour: 18, includeNames: false } }));
    expect((await runNotificationTick(env.deps)).sent).toBe(0); // before 18:00
    env.clock.advance(HOUR);
    const r = await runNotificationTick(env.deps);
    expect(r).toMatchObject({ sent: 1, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe('ayse@example.org');
    expect(mail.subject).toBe('Class Compass: 2 new things from your students');
    expect(mail.text).toContain('- New goals: 1');
    expect(mail.text).toContain('- Written work: 1');
    expect(mail.text).toContain('http://localhost:5173/teacher/notifications');
    // Counts only: no names, no student text, no class.
    expect(mail.text).not.toMatch(/Ada|Kurgu|book|Pip|3-A/u);
    const digest = env.db.$client.prepare('select * from notification_digests').all() as any[];
    expect(digest).toMatchObject([{ user_id: s.ayse.id, status: 'sent' }]);
    expect(JSON.parse(digest[0].items_json)).toEqual({ goalCreated: 1, evidenceText: 1 });
    // Once a day.
    env.clock.advance(60_000);
    await addGoal('I will learn ten new words.');
    expect((await runNotificationTick(env.deps)).sent).toBe(0);
    expect(mailer.sent).toHaveLength(1);

    // Next day, names on: only what is new since the last digest, with the student's name and count.
    await ok(s.teacherA.put('/api/teacher/notification-settings', { categories: {}, digest: { enabled: true, hour: 18, includeNames: true } }));
    await travel(DAY);
    expect((await runNotificationTick(env.deps)).sent).toBe(1);
    const second = mailer.sent[1]!;
    expect(second.subject).toBe('Class Compass: 1 new thing from your students');
    expect(second.text).toContain('- Ada Kurgu: 1');
    expect(second.text).not.toMatch(/ten new words|book/u);
  });

  it('nothing new means no email; read items are not mailed; Turkish teachers get Turkish; no address or no mailer, no email', async () => {
    await withEmail('ayse.teacher', 'ayse@example.org', 'tr');
    await ok(s.teacherA.put('/api/teacher/notification-settings', { categories: {}, digest: { enabled: true, hour: 9, includeNames: true } }));
    await ok(s.teacherB.put('/api/teacher/notification-settings', { categories: {}, digest: { enabled: true, hour: 9, includeNames: true } }));
    expect(await runNotificationTick(env.deps)).toMatchObject({ sent: 0, empty: 1 });
    await travel(DAY);
    await addGoal();
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'My book list: Pip and Tom' }));
    const ev = (await list(s.teacherA)).items.find((i) => i.category === 'evidenceText');
    await ok(s.teacherA.post('/api/teacher/notifications/read', { ids: [ev.id] }));
    expect(await runNotificationTick(env.deps)).toMatchObject({ sent: 1 });
    const mail = mailer.sent[0]!;
    expect(mail.subject).toBe('Sınıf Pusulası: öğrencilerinizden 1 yeni bildirim');
    expect(mail.text).toContain('- Yeni hedefler: 1');
    expect(mail.text).toContain('- Ada Kurgu: 1');
    expect(mail.text).not.toContain('Yazılı çalışma');
    // Mehmet has no email address: no mail, no record.
    expect(mailer.sent.map((m) => m.to)).toEqual(['ayse@example.org']);
    // Without a mail transport the tick only purges.
    const none = await makeEnv({}, { mailer: null });
    expect(await runNotificationTick(none.deps)).toMatchObject({ sent: 0, empty: 0 });
    await none.app.close();
  });

  it('a failed send is recorded and not retried that day', async () => {
    await withEmail('ayse.teacher', 'ayse@example.org');
    await ok(s.teacherA.put('/api/teacher/notification-settings', { categories: {}, digest: { enabled: true, hour: 9, includeNames: false } }));
    await addGoal();
    const failing = { ...env.deps, mailer: { send: () => Promise.reject(new Error('smtp down')) } };
    expect(await runNotificationTick(failing)).toMatchObject({ failed: 1 });
    expect(await runNotificationTick(env.deps)).toMatchObject({ sent: 0, failed: 0 });
    expect((env.db.$client.prepare('select status from notification_digests').get() as any).status).toBe('failed');
  });
});

describe('retention, erasure and exports (KVKK)', () => {
  it('the tick purges rows older than 90 days', async () => {
    await addGoal();
    await travel(89 * DAY);
    await addGoal('I will learn ten new words.');
    expect((await runNotificationTick(env.deps)).purged).toBe(0);
    env.clock.advance(2 * DAY);
    expect((await runNotificationTick(env.deps)).purged).toBe(2); // Ayse's and Mehmet's first rows
    expect(rows()).toHaveLength(2);
  });

  it('erasing a student removes their notifications; the per-student export leaves them out, the full export has them', async () => {
    await addGoal();
    expect(rows()).toHaveLength(2);
    const unzip = (buf: Buffer) => {
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
    };
    const download = async (token: string) => (await env.app.inject({ method: 'GET', url: `/api/admin/exports/${token}`, headers: { cookie: [...s.admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })).rawPayload;
    const one = unzip(await download((await ok(s.admin.post(`/api/admin/students/${ada.id}/export`))).token));
    expect(Object.keys(one).some((n) => n.includes('notifications'))).toBe(false);
    expect(JSON.parse(one['manifest.json']!.toString('utf8')).neverExported.join(' ')).toContain('notifications');
    const full = unzip(await download((await ok(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: false }))).token));
    expect(full['tables/notifications.csv']!.toString('utf8')).toContain(ada.id);

    await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));
    await ok(s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Kurgu' }));
    expect(rows()).toEqual([]);
  });
});
