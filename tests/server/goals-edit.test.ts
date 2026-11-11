/**
 * S22b (D-176): teachers rename default goal categories for their own classes (GOL-1, DAT-1, DAT-6,
 * UX-3/4), and students change the words of their own goals and entries from the student page
 * (GOL-5, STU-5, D-123, D-152). Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const WRITING = '00000000-0000-7000-8000-00000000c002';
const READ_WEEKLY = '00000000-0000-7000-8000-00000000d011';

let env: TestEnv;
let s: School;
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };
let adaPhone: Client;
let boraPhone: Client;

const goalsSection = (page: any, subject = 'English') => page.subjects.find((x: any) => x.name.en === subject)?.sections.find((x: any) => x.key === 'goals')?.data;
const reasonOf = (r: { body: any }) => r.body?.error?.details?.reason;
const auditRows = (action: string) => env.db.$client.prepare('select * from audit_events where action = ?').all(action) as Array<Record<string, unknown>>;
const rename = (c: Client, categoryId: string, body: Record<string, unknown>) => c.patch(`/api/teacher/goal-categories/${categoryId}`, body);

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  boraPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, bora.id));
});
afterEach(async () => {
  await env.app.close();
});

describe('renaming default goal categories (S22b, D-176, GOL-1)', () => {
  it('renames a default for the teacher’s own classes only; the id stays, so goals, topics and reports still group by it', async () => {
    const before = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read a comic every week.' }));
    // Mehmet teaches English in 3-B too: his classes keep the school's name.
    const ctxB2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3b.id, subjectId: s.english.id }));

    const renamed = await ok(rename(s.teacherA, READING, { contextId: s.ctxA.id, name: { en: 'Reading club', tr: 'Okuma kulübü' } }));
    expect(renamed).toMatchObject({ id: READING, custom: false, name: { en: 'Reading club', tr: 'Okuma kulübü' }, defaultName: { en: 'Reading', tr: 'Okuma' } });
    expect(auditRows('goal_category.rename')).toHaveLength(1);
    expect(JSON.parse(String(auditRows('goal_category.rename')[0]!.after_json ?? auditRows('goal_category.rename')[0]!.after))).toMatchObject({ name: { en: 'Reading club' }, scope: 'teacher' });

    // The teacher's library, the student page and the goal set before (its history keeps the old name, DAT-6).
    const lib = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goal-library`));
    expect(lib.categories.find((c: any) => c.id === READING)).toMatchObject({ name: { en: 'Reading club' }, defaultName: { en: 'Reading' } });
    const page = goalsSection(await ok(adaPhone.get('/api/student/page')));
    expect(page.categories.find((c: any) => c.id === READING).name).toEqual({ en: 'Reading club', tr: 'Okuma kulübü' });
    expect(page.goals.find((g: any) => g.id === before.id).category).toEqual({ id: READING, name: { en: 'Reading club', tr: 'Okuma kulübü' }, nameAtCreation: { en: 'Reading', tr: 'Okuma' } });
    // A goal set after the rename remembers the new name.
    const after = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read to my little brother.' }));
    expect(after.category).toMatchObject({ id: READING, nameAtCreation: { en: 'Reading club' } });
    const teacherGoal = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${bora.id}/goals`, { categoryId: READING, text: 'Read aloud every day' }));
    expect(teacherGoal.category).toMatchObject({ id: READING, name: { en: 'Reading club' }, nameAtCreation: { en: 'Reading club' } });

    // Lesson topics are the same categories: the teacher's topic list shows the new name.
    const topics = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/topic-plan`));
    expect(topics.topics.find((t: any) => t.id === READING).name).toEqual({ en: 'Reading club', tr: 'Okuma kulübü' });

    // The goals report groups by the id and shows the class's name (RPT-5, DAT-6).
    const report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-01&to=2026-11-30`));
    const cats = report.sections.find((x: any) => x.key === 'goals').tables.find((t: any) => t.key === 'categories');
    expect(cats.rows.map((r: any) => r.key)).toEqual([READING]);
    expect(cats.rows[0].cells[0].v.text.en).toMatch(/^Reading/);
    expect(cats.rows[0].cells[0].v.now?.en ?? cats.rows[0].cells[0].v.text.en).toBe('Reading club');

    // Another teacher of the same subject and their students still see the school's name.
    const libB = await ok(s.teacherB.get(`/api/teacher/contexts/${ctxB2.id}/goal-library`));
    expect(libB.categories.find((c: any) => c.id === READING)).toMatchObject({ name: { en: 'Reading', tr: 'Okuma' } });
    expect(libB.categories.find((c: any) => c.id === READING).defaultName).toBeUndefined();
    const can = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Can Kurgu' });
    const canPhone = await openLink(env, await linkUrl(s.teacherB, s.c3b.id, can.id));
    expect(goalsSection(await ok(canPhone.get('/api/student/page'))).categories.find((c: any) => c.id === READING).name.en).toBe('Reading');
    // The default row itself never changed (admin view).
    const defaults = await ok(s.admin.get('/api/admin/goal-defaults'));
    expect(defaults.categories.find((c: any) => c.id === READING).name).toEqual({ en: 'Reading', tr: 'Okuma' });
  });

  it('goes back to the default name with resetName (or by saving the default name); own categories rename in their own row', async () => {
    await ok(rename(s.teacherA, WRITING, { contextId: s.ctxA.id, name: { en: 'Story writing', tr: 'Hikâye yazma' } }));
    const back = await ok(rename(s.teacherA, WRITING, { contextId: s.ctxA.id, resetName: true }));
    expect(back.name).toEqual({ en: 'Writing', tr: 'Yazma' });
    expect(back.defaultName).toBeUndefined();
    await ok(rename(s.teacherA, WRITING, { contextId: s.ctxA.id, name: { en: 'Story writing', tr: 'Yazma' } }));
    const same = await ok(rename(s.teacherA, WRITING, { contextId: s.ctxA.id, name: { en: 'Writing', tr: 'Yazma' } }));
    expect(same.defaultName).toBeUndefined();
    expect(env.db.$client.prepare('select count(*) as n from goal_category_names').get()).toEqual({ n: 0 });
    // Four changes, four audit rows; a reset with nothing to reset writes none.
    await ok(rename(s.teacherA, WRITING, { contextId: s.ctxA.id, resetName: true }));
    expect(auditRows('goal_category.rename')).toHaveLength(4);

    const own = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/goal-categories`, { name: { en: 'Songs' } }));
    expect((await ok(rename(s.teacherA, own.id, { name: { en: 'Songs and rhymes', tr: 'Şarkılar ve tekerlemeler' } }))).name).toEqual({ en: 'Songs and rhymes', tr: 'Şarkılar ve tekerlemeler' });
    expect(reasonOf(await rename(s.teacherA, own.id, { resetName: true }))).toBe('NOT_A_DEFAULT');
  });

  it('refuses without a class+subject, for another teacher’s class+subject, an icon change, and in an archived year (DAT-1, ACC-10)', async () => {
    expect(reasonOf(await rename(s.teacherA, READING, { name: { en: 'Books' } }))).toBe('CONTEXT_REQUIRED');
    expect((await rename(s.teacherA, READING, { contextId: s.ctxB.id, name: { en: 'Books' } })).status).toBe(403);
    expect(reasonOf(await rename(s.teacherA, READING, { contextId: s.ctxA.id, name: { en: 'Books' }, icon: 'pen' }))).toBe('DEFAULT_ITEM_READ_ONLY');
    // Archiving a default for one's own classes still works as before (D-116).
    expect((await ok(rename(s.teacherA, READING, { archived: true }))).archived).toBe(true);
    await ok(rename(s.teacherA, READING, { archived: false }));
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`, {}));
    const r = await rename(s.teacherA, READING, { contextId: s.ctxA.id, name: { en: 'Books' } });
    expect(r.status).toBe(409);
    expect(reasonOf(r)).toBe('YEAR_ARCHIVED');
    expect(env.db.$client.prepare('select count(*) as n from goal_category_names').get()).toEqual({ n: 0 });
    expect(auditRows('goal_category.rename')).toHaveLength(0);
  });
});

describe('students change the words of their own goals and entries (S22b, D-176, GOL-5, STU-5)', () => {
  const adaGoal = async () => {
    const goal = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read one book every week.' }));
    const withEntry = await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'Today I read a short story.' }));
    return { goal, entryId: withEntry.entries[0].id as string };
  };

  it('a student edits their own goal and reflection; the teacher sees the new words, notified and audited', async () => {
    const { goal, entryId } = await adaGoal();
    const edited = await ok(adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read two books every week.' }));
    expect(edited.text).toBe('I will read two books every week.');
    const withEntry = await ok(adaPhone.patch(`/api/student/entries/${entryId}`, { body: 'Today I read a long story about a fox.' }));
    expect(withEntry.entries[0].body).toBe('Today I read a long story about a fox.');
    // A goal chosen from a ready-made goal becomes the student's own words when they change it.
    const preset = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, presetId: READ_WEEKLY }));
    expect(preset.presetText).not.toBeNull();
    const own = await ok(adaPhone.patch(`/api/student/goals/${preset.id}`, { text: 'I will read a short book every weekend.' }));
    expect(own).toMatchObject({ presetText: null, text: 'I will read a short book every weekend.' });

    const detail = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));
    const seen = detail.goals.find((g: any) => g.id === goal.id);
    expect(seen.text).toBe('I will read two books every week.');
    expect(seen.entries[0].body).toBe('Today I read a long story about a fox.');
    expect(auditRows('goal.update').length).toBeGreaterThanOrEqual(2);
    expect(auditRows('goal_entry.update')).toHaveLength(1);
    // The audit says the words changed, never the words themselves.
    expect(JSON.stringify(auditRows('goal.update'))).not.toContain('two books');
  });

  it('refuses another student’s goal and entry (404), a teacher-written goal or progress entry (403) and keeps the words', async () => {
    const { goal, entryId } = await adaGoal();
    for (const r of [await boraPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read comics all day long.' }), await boraPhone.patch(`/api/student/entries/${entryId}`, { body: 'Bora was here today.' })]) {
      expect(r.status).toBe(404);
    }
    const teacherGoal = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`, { categoryId: READING, text: 'Read aloud daily' }));
    const progressed = await ok(s.teacherA.post(`/api/teacher/goals/${teacherGoal.id}/progress`, { body: 'A good start this week.' }));
    for (const r of [await adaPhone.patch(`/api/student/goals/${teacherGoal.id}`, { text: 'I will read when I want to.' }), await adaPhone.patch(`/api/student/entries/${progressed.entries[0].id}`, { body: 'My teacher is happy with me.' })]) {
      expect(r.status).toBe(403);
      expect(reasonOf(r)).toBe('NOT_YOUR_CONTRIBUTION');
    }
    const page = goalsSection(await ok(adaPhone.get('/api/student/page')));
    expect(page.goals.find((g: any) => g.id === goal.id)).toMatchObject({ text: 'I will read one book every week.', entries: [{ body: 'Today I read a short story.' }] });
    expect(page.goals.find((g: any) => g.id === teacherGoal.id)).toMatchObject({ text: 'Read aloud daily', entries: [{ body: 'A good start this week.' }] });
  });

  it('a blocked word is refused and counted, never stored (D-123); an unfinished sentence starter is refused (D-152)', async () => {
    const { goal, entryId } = await adaGoal();
    const rude = await adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read this shit book.' });
    expect(rude.status).toBe(400);
    expect(reasonOf(rude)).toBe('TEXT_BLOCKED_WORD');
    const rudeEntry = await adaPhone.patch(`/api/student/entries/${entryId}`, { body: 'This book is shit.' });
    expect(reasonOf(rudeEntry)).toBe('TEXT_BLOCKED_WORD');
    expect(env.db.$client.prepare('select count from text_check_attempts where student_id = ?').get(ada.id)).toEqual({ count: 2 });
    const dump = JSON.stringify(env.db.$client.prepare('select * from goals').all()) + JSON.stringify(env.db.$client.prepare('select * from goal_entries').all()) + JSON.stringify(env.db.$client.prepare('select * from audit_events').all());
    expect(dump).not.toContain('shit');
    expect(reasonOf(await adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I want to get better at ___.' }))).toBe('TEXT_STARTER_UNFINISHED');
    expect(reasonOf(await adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'asdfgh qwerty zxcvb' }))).toMatch(/^TEXT_/);
    const page = goalsSection(await ok(adaPhone.get('/api/student/page')));
    expect(page.goals[0]).toMatchObject({ text: 'I will read one book every week.', entries: [{ body: 'Today I read a short story.' }] });
  });

  it('a locked (archived) year or a switched-off module refuses changes (DAT-1, CFG-2)', async () => {
    const { goal, entryId } = await adaGoal();
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: false }));
    expect(reasonOf(await adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read two books every week.' }))).toBe('GOALS_READ_ONLY');
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/goals`, { enabled: true }));
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`, {}));
    for (const r of [await adaPhone.patch(`/api/student/goals/${goal.id}`, { text: 'I will read two books every week.' }), await adaPhone.patch(`/api/student/entries/${entryId}`, { body: 'Today I read a long story.' })]) {
      expect(r.status).toBe(403);
      expect(reasonOf(r)).toBe('GOALS_READ_ONLY');
    }
    const detail = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${ada.id}/goals`));
    expect(detail.goals[0]).toMatchObject({ text: 'I will read one book every week.', entries: [{ body: 'Today I read a short story.' }] });
  });
});
