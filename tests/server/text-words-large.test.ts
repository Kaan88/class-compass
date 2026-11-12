/**
 * S28b (D-198; GOL-5, refines D-123): the server checks student text with the larger word lists, so a
 * reflection with real but uncommon words is saved, while keyboard mashing is still refused. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkStudentText } from '../../src/shared/text/textQuality.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';

let env: TestEnv;
let s: School;
let phone: Client;

const reasonOf = (r: { body: any }) => r.body?.error?.details?.reason;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  const ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  phone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
});
afterEach(async () => {
  await env.app.close();
});

describe('student text on the server with the larger word lists (S28b, D-198)', () => {
  it('saves real but uncommon English and Turkish words that our own lists alone refused', async () => {
    const goal = await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read about volcanoes.' }));
    for (const body of ['Volcanoes erupt magma', 'Yanardağlar lav püskürtür']) {
      expect(checkStudentText(body, 'reflection')).toEqual({ ok: false, reason: 'UNKNOWN_WORDS' });
      await ok(phone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body }));
    }
    const glaciers = await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'Glaciers carve canyons' }));
    expect(glaciers.id).toBeTruthy();
  });

  it('still refuses keyboard mashing and unknown words', async () => {
    const goal = await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read about volcanoes.' }));
    expect(reasonOf(await phone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'I will asdf qwer' }))).toBe('TEXT_KEYBOARD_MASH');
    expect(reasonOf(await phone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'Ben lololo yaptım' }))).toBe('TEXT_KEYBOARD_MASH');
    expect(reasonOf(await phone.post(`/api/student/goals/${goal.id}/entries`, { kind: 'reflection', body: 'blorf zintu quabbo' }))).toBe('TEXT_UNKNOWN_WORDS');
  });
});
