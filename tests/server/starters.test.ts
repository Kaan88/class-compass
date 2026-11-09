/**
 * Sentence starters (S14d, D-152; GOL-1, GOL-5, D-116, D-117, D-123). Built-in EN/TR starters for
 * every kind, teachers' own starters (checked with a sample word in the blank), hiding per teacher
 * and archiving per school, the student page's starters in its own language(s), and the server's
 * STARTER_UNFINISHED rule (never counted as a blocked attempt). Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STARTERS, defaultStarterId } from '../../src/server/modules/goals/starters.ts';
import { blankRange, fillBlank, hasBlank, isUnfinishedStarter, normaliseStarter, STARTER_KINDS, STARTER_SAMPLE, STARTER_TEXT_KIND } from '../../src/shared/text/starters.ts';
import { checkStudentText } from '../../src/shared/text/textQuality.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const WRITING = '00000000-0000-7000-8000-00000000c002';
const GOAL_1 = defaultStarterId('goal', 1);

const ALL_STARTER_TEXTS = STARTER_KINDS.flatMap((k) => DEFAULT_STARTERS[k].flatMap((t) => [t.en!, t.tr!]));

/** Short, child-like words that finish a starter (a real student would write these). */
const FILL: Record<'en' | 'tr', string> = { en: 'my English words', tr: 'İngilizce kelimeleri' };

describe('built-in starters (D-152)', () => {
  it('has about six starters per kind in English and Turkish, each with one blank and a fixed id', () => {
    const ids = new Set<string>();
    for (const kind of STARTER_KINDS) {
      expect(DEFAULT_STARTERS[kind].length, kind).toBeGreaterThanOrEqual(5);
      DEFAULT_STARTERS[kind].forEach((t, i) => {
        for (const lang of ['en', 'tr'] as const) {
          expect(t[lang], `${kind} ${i} ${lang}`).toBeTruthy();
          expect(t[lang]!.match(/___/gu)?.length, `${kind} ${i} ${lang}: one blank`).toBe(1);
          expect(normaliseStarter(t[lang]!)).toBe(t[lang]);
          // Short for 7–10-year-olds.
          expect(t[lang]!.split(' ').length, `${kind} ${i} ${lang}: short`).toBeLessThanOrEqual(8);
        }
        ids.add(defaultStarterId(kind, i + 1));
      });
    }
    expect(ids.size).toBe(STARTER_KINDS.reduce((n, k) => n + DEFAULT_STARTERS[k].length, 0));
  });

  it('filled starters pass the student text checks; unchanged ones (blank kept or removed) fail with STARTER_UNFINISHED (GOL-5, D-123)', () => {
    for (const kind of STARTER_KINDS) {
      for (const t of DEFAULT_STARTERS[kind]) {
        for (const lang of ['en', 'tr'] as const) {
          const starter = t[lang]!;
          const textKind = STARTER_TEXT_KIND[kind];
          const opts = { starters: ALL_STARTER_TEXTS };
          for (const words of [STARTER_SAMPLE[lang], FILL[lang]]) {
            const filled = fillBlank(starter, words);
            expect(checkStudentText(filled, textKind, opts), `${kind} ${lang}: "${filled}"`).toEqual({ ok: true });
          }
          expect(checkStudentText(starter, textKind, opts), `${kind} ${lang}: "${starter}"`).toEqual({ ok: false, reason: 'STARTER_UNFINISHED' });
          const blankRemoved = starter.replace('___', '');
          expect(checkStudentText(blankRemoved, textKind, opts), `${kind} ${lang}: "${blankRemoved}"`).toEqual({ ok: false, reason: 'STARTER_UNFINISHED' });
        }
      }
    }
  });

  it('a blank is caught without the list; case, spaces and punctuation do not hide a starter; real sentences pass', () => {
    expect(isUnfinishedStarter('I like __ a lot', [])).toBe(true);
    expect(isUnfinishedStarter('  i WANT to get better at!! ', ['I want to get better at ___.'])).toBe(true);
    expect(isUnfinishedStarter('I want to get better at reading.', ['I want to get better at ___.'])).toBe(false);
    expect(isUnfinishedStarter('', ['I like ___.'])).toBe(false);
    expect(hasBlank('a _ b')).toBe(false);
    expect(normaliseStarter('  I  like ____ and  __ ')).toBe('I like ___ and ___');
    expect(blankRange('I like ___.')).toEqual({ start: 7, end: 10 });
    expect(blankRange('No blank')).toBeNull();
  });
});

let env: TestEnv;
let s: School;
let ada: { id: string; fullName: string };
let adaPhone: Client;

const goalsOf = (page: any) => page.subjects.find((x: any) => x.name.en === 'English').sections.find((x: any) => x.key === 'goals').data;
const startersOnPage = async () => goalsOf(await ok(adaPhone.get('/api/student/page'))).starters as Array<{ id: string; kind: string; categoryId: string | null; text: { en?: string; tr?: string } }>;
const attempts = () => (env.db.$client.prepare('select coalesce(sum(count), 0) as n from text_check_attempts').get() as { n: number }).n;
const reasonOf = (r: { body: any }) => r.body?.error?.details?.reason;

describe('starters on the student page and the STARTER_UNFINISHED rule', () => {
  beforeEach(async () => {
    env = await makeEnv();
    s = await buildSchool(env);
    ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
    adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  });
  afterEach(async () => {
    await env.app.close();
  });

  it('sends the built-in starters in the student page’s languages only (D-117)', async () => {
    const en = await startersOnPage();
    expect(en.length).toBe(STARTER_KINDS.reduce((n, k) => n + DEFAULT_STARTERS[k].length, 0));
    expect(en.every((x) => x.text.en && x.text.tr === undefined)).toBe(true);
    expect(new Set(en.map((x) => x.kind))).toEqual(new Set(STARTER_KINDS));
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'en', secondLanguageEnabled: false, studentPage: { mainLanguage: 'tr', secondLanguageEnabled: false } }));
    expect((await startersOnPage()).every((x) => x.text.tr && x.text.en === undefined)).toBe(true);
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/language`, { mainLanguage: 'tr', secondLanguageEnabled: true, studentPage: null }));
    expect((await startersOnPage()).every((x) => x.text.tr && x.text.en)).toBe(true);
  });

  it('refuses a starter sent unchanged or with its blank in every student text, without counting an attempt; a finished sentence is saved', async () => {
    const before = attempts();
    const blank = await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I want to get better at ___.' });
    expect(blank.status).toBe(400);
    expect(reasonOf(blank)).toBe('TEXT_STARTER_UNFINISHED');
    expect(reasonOf(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I want to get better at.' }))).toBe('TEXT_STARTER_UNFINISHED');
    expect(reasonOf(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: '___ konusunda daha iyi olmak istiyorum.' }))).toBe('TEXT_STARTER_UNFINISHED');
    const goal = await ok(adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I want to get better at reading stories.', practiceChoices: ['Read comics at bedtime.'] }));
    expect(reasonOf(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read comics.', practiceChoices: ['Read ___ at bedtime.'] }))).toBe('TEXT_STARTER_UNFINISHED');
    expect(reasonOf(await adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'Today I learned ___.' }))).toBe('TEXT_STARTER_UNFINISHED');
    expect(reasonOf(await adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'self_assessment', body: 'It is going well because', confidence: 4 }))).toBe('TEXT_STARTER_UNFINISHED');
    await ok(adaPhone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'self_assessment', body: 'It is going well because I read every night.', confidence: 4 }));
    expect(reasonOf(await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'This is my ___.' }))).toBe('TEXT_STARTER_UNFINISHED');
    expect(reasonOf(await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'link', url: 'https://example.org/story', body: 'A picture of ___.' }))).toBe('TEXT_STARTER_UNFINISHED');
    await ok(adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'This is my story about a little fox.' }));
    // Unfinished starters are not unkind words: nothing is counted for the teacher notice (D-123).
    expect(attempts()).toBe(before);
    // A blocked word still is.
    expect(reasonOf(await adaPhone.post('/api/student/evidence', { subjectId: s.english.id, kind: 'text', body: 'This is my shit story.' }))).toBe('TEXT_BLOCKED_WORD');
    expect(attempts()).toBe(before + 1);
  });

  it('a teacher’s own starter needs a blank and must pass the checks with a sample word; it reaches only their students (GOL-1)', async () => {
    const make = (body: Record<string, unknown>) => s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/starters`, body);
    expect(reasonOf(await make({ kind: 'goal', text: { en: 'I will read more.' } }))).toBe('STARTER_NEEDS_BLANK');
    const risky = await make({ kind: 'goal', text: { en: 'I will ___ like a shit.' } });
    expect([risky.status, reasonOf(risky), risky.body.error.details.textReason]).toEqual([400, 'STARTER_INVALID', 'BLOCKED_WORD']);
    expect(reasonOf(await make({ kind: 'reflection', text: { en: 'asdfgh qwerty ___' } }))).toBe('STARTER_INVALID');
    expect((await make({ kind: 'goal', categoryId: '00000000-0000-7000-8000-00000000ffff', text: { en: 'I will ___.' } })).status).toBe(404);
    // Two or more underscores are one blank; a short starter is fine (students add words).
    const own = await ok(make({ kind: 'goal', categoryId: READING, text: { en: 'I will  read __ with my family.', tr: 'Ailemle __ okuyacağım.' } }));
    expect(own).toMatchObject({ kind: 'goal', categoryId: READING, custom: true, archived: false, text: { en: 'I will read ___ with my family.', tr: 'Ailemle ___ okuyacağım.' } });
    expect((await ok(make({ kind: 'practice', text: { en: 'Read ___.' } }))).kind).toBe('practice');

    const lib = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/goal-library`));
    expect(lib.starters.find((x: any) => x.id === own.id)).toMatchObject({ custom: true });
    expect(lib.starters.filter((x: any) => !x.custom).length).toBe(STARTER_KINDS.reduce((n, k) => n + DEFAULT_STARTERS[k].length, 0));
    const onPage = (await startersOnPage()).find((x) => x.id === own.id);
    expect(onPage).toEqual({ id: own.id, kind: 'goal', categoryId: READING, text: { en: 'I will read ___ with my family.' } });

    // Another teacher (Mathematics in 3-B) neither sees nor changes it.
    const libB = await ok(s.teacherB.get(`/api/teacher/contexts/${s.ctxB.id}/goal-library`));
    expect(libB.starters.some((x: any) => x.id === own.id)).toBe(false);
    expect((await s.teacherB.patch(`/api/teacher/starters/${own.id}`, { archived: true })).status).toBe(404);
    // Its own words sent unchanged are refused too, also after it was archived.
    expect(reasonOf(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read with my family.' }))).toBe('TEXT_STARTER_UNFINISHED');
    const archived = await ok(s.teacherA.patch(`/api/teacher/starters/${own.id}`, { archived: true }));
    expect(archived.archived).toBe(true);
    expect((await startersOnPage()).some((x) => x.id === own.id)).toBe(false);
    expect(reasonOf(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read with my family.' }))).toBe('TEXT_STARTER_UNFINISHED');
    // Editing checks again.
    expect(reasonOf(await s.teacherA.patch(`/api/teacher/starters/${own.id}`, { text: { en: 'No blank here.' } }))).toBe('STARTER_NEEDS_BLANK');
    const edited = await ok(s.teacherA.patch(`/api/teacher/starters/${own.id}`, { text: { en: 'We will read ___ together.' }, archived: false }));
    expect(edited.text).toEqual({ en: 'We will read ___ together.' });
    const actions = env.db.$client.prepare("select action from audit_events where entity = 'text_starter' order by action").all() as Array<{ action: string }>;
    expect(actions.map((a) => a.action)).toEqual(['text_starter.create', 'text_starter.create', 'text_starter.update', 'text_starter.update']);
  });

  it('a category starter is offered only while its category can be chosen', async () => {
    const own = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/starters`, { kind: 'goal', categoryId: WRITING, text: { en: 'I will write about ___.' } }));
    expect((await startersOnPage()).some((x) => x.id === own.id)).toBe(true);
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${WRITING}`, { archived: true }));
    expect((await startersOnPage()).some((x) => x.id === own.id)).toBe(false);
  });

  it('a teacher hides a default starter for their classes only; an admin archives one for the school; defaults cannot be reworded (D-116)', async () => {
    expect(reasonOf(await s.teacherA.patch(`/api/teacher/starters/${GOAL_1}`, { text: { en: 'Changed ___.' } }))).toBe('DEFAULT_ITEM_READ_ONLY');
    const hidden = await ok(s.teacherA.patch(`/api/teacher/starters/${GOAL_1}`, { archived: true }));
    expect(hidden).toMatchObject({ id: GOAL_1, custom: false, archived: true, schoolArchived: false });
    expect((await startersOnPage()).some((x) => x.id === GOAL_1)).toBe(false);
    // Teacher B (another class) still has it.
    expect((await ok(s.teacherB.get(`/api/teacher/contexts/${s.ctxB.id}/goal-library`))).starters.find((x: any) => x.id === GOAL_1).archived).toBe(false);
    // Hidden or not, the starter's own words are not a finished goal.
    expect(reasonOf(await adaPhone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I want to get better at' }))).toBe('TEXT_STARTER_UNFINISHED');
    await ok(s.teacherA.patch(`/api/teacher/starters/${GOAL_1}`, { archived: false }));
    expect((await startersOnPage()).some((x) => x.id === GOAL_1)).toBe(true);

    expect((await s.teacherA.put(`/api/admin/goal-defaults/starter/${GOAL_1}`, { archived: true })).status).toBe(403);
    const lib = await ok(s.admin.put(`/api/admin/goal-defaults/starter/${GOAL_1}`, { archived: true }));
    expect(lib.starters.find((x: any) => x.id === GOAL_1)).toMatchObject({ archived: true, schoolArchived: true });
    expect((await startersOnPage()).some((x) => x.id === GOAL_1)).toBe(false);
    // A teacher's "restore" only clears their own hide.
    await ok(s.teacherA.patch(`/api/teacher/starters/${GOAL_1}`, { archived: false }));
    expect((await startersOnPage()).some((x) => x.id === GOAL_1)).toBe(false);
    await ok(s.admin.put(`/api/admin/goal-defaults/starter/${GOAL_1}`, { archived: false }));
    expect((await startersOnPage()).some((x) => x.id === GOAL_1)).toBe(true);
    const own = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/starters`, { kind: 'note', text: { en: 'Ask about ___.' } }));
    expect((await s.admin.put(`/api/admin/goal-defaults/starter/${own.id}`, { archived: true })).status).toBe(404);
    const defaults = await ok(s.admin.get('/api/admin/goal-defaults'));
    expect(defaults.starters.length).toBe(STARTER_KINDS.reduce((n, k) => n + DEFAULT_STARTERS[k].length, 0));
    expect(defaults.starters.every((x: any) => x.custom === false)).toBe(true);
    const actions = env.db.$client.prepare("select action, entity from audit_events where action like 'goal_default.%' order by at").all();
    expect(actions).toEqual([
      { action: 'goal_default.hide', entity: 'text_starter' },
      { action: 'goal_default.show', entity: 'text_starter' },
      { action: 'goal_default.archive', entity: 'text_starter' },
      { action: 'goal_default.restore', entity: 'text_starter' },
    ]);
  });
});
