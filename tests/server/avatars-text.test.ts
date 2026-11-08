/**
 * Student avatars (S13c items 9–11, D-124) and student text checks (item 12, D-123). Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { READY_MADE, lockedPartsOf, randomPerson, seededRandom, type PersonSpec } from '../../src/shared/avatars.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { multipart } from '../import-fixtures.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';

let env: TestEnv;
let s: School;
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };
let adaPhone: Client;
let boraPhone: Client;

const auditCount = (action: string) => (env.db.$client.prepare('select count(*) as n from audit_events where action = ?').get(action) as { n: number }).n;
const plainPerson = (): PersonSpec => ({ ...randomPerson(seededRandom(7)), hat: 'cap', accessory: 'scarf', bg: 'circle', glasses: 'round', hair: 'hijab' });
const goalsOf = (page: any) => page.subjects.find((x: any) => x.name.en === 'English')?.sections.find((x: any) => x.key === 'goals')?.data;
const addGoal = (phone: Client, text: string) => phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text });

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  boraPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, bora.id));
});
afterEach(() => env.app.close());

describe('avatars (items 9–11)', () => {
  it('a student picks a ready-made or own avatar; it reaches the classroom directory; unknown parts are refused', async () => {
    const page = await ok(adaPhone.get('/api/student/page'));
    expect(page.avatar).toMatchObject({ spec: null, locked: false });
    expect(page.avatar.generated.type).toBe('creature');
    const ready = READY_MADE.find((r) => lockedPartsOf(r).length === 0)!;
    expect((await ok(adaPhone.put('/api/student/avatar', { spec: ready }))).spec).toEqual(ready);
    const own = plainPerson();
    expect((await ok(boraPhone.put('/api/student/avatar', { spec: own }))).spec).toEqual(own);
    const dir = await ok(s.teacherA.get('/api/classroom/avatars'));
    expect(dir.students.find((x: any) => x.id === ada.id).spec).toEqual(ready);
    expect(dir.students.find((x: any) => x.id === bora.id).spec).toEqual(own);
    // Teacher B does not teach 3-A: those students are not in their directory.
    expect((await ok(s.teacherB.get('/api/classroom/avatars'))).students.map((x: any) => x.id)).not.toContain(ada.id);
    // Validation: unknown part values, extra keys and a species from another family are 400s.
    expect((await adaPhone.put('/api/student/avatar', { spec: { ...own, hair: 'mohawk-xl' } })).status).toBe(400);
    expect((await adaPhone.put('/api/student/avatar', { spec: { ...own, svg: '<script>' } })).status).toBe(400);
    expect((await adaPhone.put('/api/student/avatar', { spec: { ...ready, family: 'robots', species: 'unicorn' } })).status).toBe(400);
    expect(auditCount('avatar.set')).toBe(2);
  });

  it('parts unlock with badges; teachers lock changes and reset an avatar (audited)', async () => {
    const starry = { ...plainPerson(), bg: 'stars' as const };
    const refused = await adaPhone.put('/api/student/avatar', { spec: starry });
    expect(refused.status).toBe(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'AVATAR_PART_LOCKED', parts: ['bg.stars'] });
    await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievements/start`, { mode: 'quiet' }));
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'I read a short story about a fox.' }));
    expect((await ok(adaPhone.get('/api/student/page'))).avatar.earned).toContain('evidence.first');
    await ok(adaPhone.put('/api/student/avatar', { spec: starry }));

    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/avatar-settings`, { locked: true, fallback: 'initials' }));
    expect((await ok(adaPhone.get('/api/student/page'))).avatar).toMatchObject({ locked: true, fallback: 'initials' });
    expect((await adaPhone.put('/api/student/avatar', { spec: plainPerson() })).body.error.details.reason).toBe('AVATAR_LOCKED');
    expect((await s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/avatar-settings`, { locked: false })).status).toBe(403);
    expect((await s.teacherB.req('DELETE', `/api/teacher/students/${ada.id}/avatar`)).status).toBe(403);
    await ok(s.teacherA.req('DELETE', `/api/teacher/students/${ada.id}/avatar`));
    expect((await ok(adaPhone.get('/api/student/page'))).avatar.spec).toBeNull();
    expect(auditCount('avatar.reset')).toBe(1);
  });
});

describe('student text checks (item 12)', () => {
  it('refuses nonsense and risky words kindly; a blocked attempt is stored as a count only', async () => {
    const mash = await addGoal(adaPhone, 'asdfgh qwerty zxcvb');
    expect(mash.status).toBe(400);
    expect(mash.body.error.details.reason).toMatch(/^TEXT_/);
    const rude = await addGoal(adaPhone, 'I will read this shit book.');
    expect(rude.status).toBe(400);
    expect(rude.body.error.details.reason).toBe('TEXT_BLOCKED_WORD');
    expect(JSON.stringify(rude.body)).not.toContain('shit');
    // Scunthorpe: innocent words that contain a risky word are fine.
    await ok(addGoal(adaPhone, 'I will read about the class assistant and Scunthorpe.'));
    const rows = env.db.$client.prepare('select * from text_check_attempts').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ student_id: ada.id, count: 1 });
    expect(Object.keys(rows[0]).sort()).toEqual(['count', 'local_date', 'student_id', 'subject_id', 'updated_at']);
    const dump = JSON.stringify(env.db.$client.prepare("select * from audit_events").all()) + JSON.stringify(env.db.$client.prepare('select * from goals').all());
    expect(dump).not.toContain('shit');
  });

  it('the notice is off by default and shows counts only once a teacher turns it on', async () => {
    await addGoal(adaPhone, 'I will read this shit book.');
    await addGoal(adaPhone, 'You are a bitch.');
    const url = `/api/teacher/contexts/${s.ctxA.id}/blocked-text`;
    expect(await ok(s.teacherA.get(url))).toEqual({ enabled: false, students: [] });
    await ok(s.teacherA.put(url, { enabled: true }));
    const n = await ok(s.teacherA.get(url));
    expect(n.students).toMatchObject([{ id: ada.id, fullName: 'Ada Kurgu', count: 2 }]);
    expect(JSON.stringify(n)).not.toMatch(/shit|bitch/);
    expect((await s.teacherB.get(url)).status).toBe(403);
    expect(auditCount('text_checks.notice')).toBe(1);
  });

  it('admin block and allow lists and teacher words apply on the server', async () => {
    await ok(s.admin.put('/api/admin/text-checks', { block: ['zorblat'] }));
    expect((await addGoal(adaPhone, 'I will zorblat every single day.')).body.error.details.reason).toBe('TEXT_BLOCKED_WORD');
    await ok(s.admin.put('/api/admin/text-checks', { allow: ['zorblat'] }));
    await ok(addGoal(adaPhone, 'I will zorblat every single day.'));
    await ok(s.teacherA.put('/api/teacher/text-check-words', { block: ['pineapple'] }));
    expect((await addGoal(boraPhone, 'I will draw a pineapple every day.')).body.error.details.reason).toBe('TEXT_BLOCKED_WORD');
    expect((await s.teacherA.put('/api/admin/text-checks', { block: ['x1'] })).status).toBe(403);
    expect((await s.admin.put('/api/admin/text-checks', { block: ['<b>'] })).status).toBe(400);
  });

  it('a teacher hides an entry from the student page (audited, the words are kept)', async () => {
    const goal = await ok(addGoal(adaPhone, 'I will read one book every week.'));
    await ok(s.teacherA.put(`/api/teacher/student-text/goal/${goal.id}/hidden`, { hidden: true }));
    expect(goalsOf(await ok(adaPhone.get('/api/student/page'))).goals.map((g: any) => g.id)).not.toContain(goal.id);
    expect((await adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read two books every week.' })).status).toBe(404);
    const teacherView = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));
    expect(teacherView.goals.find((g: any) => g.id === goal.id)).toMatchObject({ hidden: true, text: 'I will read one book every week.' });
    expect((await s.teacherB.put(`/api/teacher/student-text/goal/${goal.id}/hidden`, { hidden: false })).status).toBe(403);
    await ok(s.teacherA.put(`/api/teacher/student-text/goal/${goal.id}/hidden`, { hidden: false }));
    expect(goalsOf(await ok(adaPhone.get('/api/student/page'))).goals.map((g: any) => g.id)).toContain(goal.id);
    expect(auditCount('student_text.hide')).toBe(1);
    expect(auditCount('student_text.show')).toBe(1);
  });
});

describe('archived classes are read-only for every S13c teacher write (review fix, DAT-1)', () => {
  it('revoke, achievement settings, hiding a default, the notice switch, hiding text and resetting an avatar answer 409 CLASS_ARCHIVED', async () => {
    const defs = (await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/achievements`))).definitions as any[];
    const manual = defs.find((d) => d.kind === 'manual' && !d.custom)!;
    const award = (await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievements/award`, { achievementId: manual.id, studentIds: [ada.id] }))).awards[0];
    const goal = await ok(addGoal(adaPhone, 'I will read one book every week.'));
    await ok(adaPhone.put('/api/student/avatar', { spec: plainPerson() }));
    await ok(s.admin.post(`/api/admin/classes/${s.c3a.id}/archive`));
    const refused = [
      await s.teacherA.post(`/api/teacher/awards/${award.id}/revoke`, { reason: 'Given by mistake' }),
      await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/achievements/settings`, { levelsEnabled: false }),
      await s.teacherA.patch(`/api/teacher/contexts/${s.ctxA.id}/achievement-definitions/${manual.id}`, { archived: true }),
      await s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/blocked-text`, { enabled: true }),
      await s.teacherA.put(`/api/teacher/student-text/goal/${goal.id}/hidden`, { hidden: true }),
      await s.teacherA.req('DELETE', `/api/teacher/students/${ada.id}/avatar`),
    ];
    expect(refused.map((r) => [r.status, r.body.error?.details?.reason])).toEqual(refused.map(() => [409, 'CLASS_ARCHIVED']));
    expect(auditCount('avatar.reset') + auditCount('achievement.revoke') + auditCount('student_text.hide')).toBe(0);
  });

  it('a reset keeps the previous avatar spec in the audit row so a mistake can be put back', async () => {
    const own = plainPerson();
    await ok(adaPhone.put('/api/student/avatar', { spec: own }));
    await ok(s.teacherA.req('DELETE', `/api/teacher/students/${ada.id}/avatar`));
    const row = env.db.$client.prepare("select before_json as b from audit_events where action = 'avatar.reset'").get() as { b: string };
    expect(JSON.parse(row.b)).toMatchObject({ hadAvatar: true, spec: own });
  });
});

describe('the language check also reads link addresses and upload names (review fix, D-123)', () => {
  it('a link whose address has a blocked word is refused and counted; a student file with one gets a neutral name', async () => {
    const r = await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'link', url: 'https://example.org/stories/shit-happens', body: 'My story' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.reason).toBe('TEXT_BLOCKED_WORD');
    const counted = env.db.$client.prepare('select sum(count) as n from text_check_attempts where student_id = ?').get(ada.id) as { n: number };
    expect(counted.n).toBe(1);
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'link', url: 'https://example.org/stories/the-fox', body: 'My story' }));
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const bad = multipart(pdf, 'my shit story.pdf', 'application/pdf');
    const up = await ok(adaPhone.req('POST', '/api/student/files?kind=document', bad.body, bad.headers));
    expect(up.name).toBe('file.pdf');
    const fine = multipart(pdf, 'my fox story.pdf', 'application/pdf');
    expect((await ok(adaPhone.req('POST', '/api/student/files?kind=document', fine.body, fine.headers))).name).toBe('my fox story.pdf');
  });
});
