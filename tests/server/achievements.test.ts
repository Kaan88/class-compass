/**
 * Achievements (S13c items 1–8, D-121, D-122): positive defaults, the idempotent rule engine, the
 * quiet backfill / start-fresh choice, manual badges given in class through the outbox (undo within
 * 10 minutes, then a revoke with a reason in the teacher area), archives, isolation and the student
 * page. Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACHIEVEMENTS, defaultAchievementId } from '../../src/shared/achievements.ts';
import { CONTEXT_MODULES } from '../../src/shared/modules.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const SUNSHINE = defaultAchievementId('teacher.sunshine');
const KIND = defaultAchievementId('teacher.kind');
const GOAL_SETTER = defaultAchievementId('goals.first');
const PLANNER = defaultAchievementId('goals.planner');

let env: TestEnv;
let s: School;
let ada: { id: string; fullName: string };
let bora: { id: string; fullName: string };
let adaPhone: Client;
let boraPhone: Client;

const base = () => `/api/teacher/contexts/${s.ctxA.id}/achievements`;
const section = (page: any) => page.subjects.find((x: any) => x.name.en === 'English')?.sections.find((x: any) => x.key === 'achievements')?.data;
const awardsOf = async (studentId: string) => (await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${studentId}/achievements`))).awards as any[];
const addGoal = (phone: Client, text: string) => ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text }));
const auditCount = (action: string) => (env.db.$client.prepare('select count(*) as n from audit_events where action = ?').get(action) as { n: number }).n;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Kurgu' });
  bora = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Kurgu' });
  adaPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
  boraPhone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, bora.id));
});
afterEach(() => env.app.close());

describe('achievements module and defaults (item 1)', () => {
  it('is registered with its policy key and on by default', async () => {
    expect(CONTEXT_MODULES).toContain('achievements');
    expect(SERVER_MODULES.find((m) => m.key === 'achievements')?.policyKey).toBe('achievements');
    const o = await ok(s.teacherA.get(base()));
    expect(o.enabled).toBe(true);
    expect(o.settings).toMatchObject({ autoEnabled: true, levelsEnabled: true, announce: 'off', startMode: null });
  });

  it('ships 60+ positive defaults with EN and TR words, and none count attendance, speed or rank', async () => {
    expect(DEFAULT_ACHIEVEMENTS.length).toBeGreaterThanOrEqual(60);
    for (const d of DEFAULT_ACHIEVEMENTS) {
      expect(d.name.en?.trim() && d.name.tr?.trim() && d.description.en?.trim() && d.description.tr?.trim(), d.key).toBeTruthy();
      expect(`${d.key} ${d.name.en} ${d.description.en}`).not.toMatch(/attend|present|absent|late|fast|quick|first in class|top|best in|rank|winner/i);
    }
    // Neither the facts the engine reads nor the pure rules look at attendance (item 2).
    for (const f of ['src/server/modules/achievements/facts.ts', 'src/domain/achievements.ts', 'src/shared/achievements.ts']) {
      const code = fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/attendance/i);
    }
    const o = await ok(s.teacherA.get(base()));
    expect(o.definitions.length).toBeGreaterThanOrEqual(60);
    // Super Speakers badges are defined but wait for that module (S12).
    expect(o.definitions.filter((d: any) => d.category === 'speakers').every((d: any) => d.inactive)).toBe(true);
  });
});

describe('rule engine, backfill and start fresh (items 2, 3)', () => {
  it('waits for the start choice; quiet backfill awards past work silently; a second start is refused', async () => {
    await addGoal(adaPhone, 'I will read one book every week.');
    expect(await awardsOf(ada.id)).toEqual([]);
    const started = await ok(s.teacherA.post(`${base()}/start`, { mode: 'quiet' }));
    expect(started.settings.startMode).toBe('quiet');
    expect(started.awarded).toBe(1);
    const awards = await awardsOf(ada.id);
    expect(awards).toMatchObject([{ achievementId: GOAL_SETTER, source: 'backfill' }]);
    // Quiet: nothing is "new" on the student page, so no celebration.
    expect(section(await ok(adaPhone.get('/api/student/page'))).earned).toMatchObject([{ id: GOAL_SETTER, isNew: false }]);
    const again = await s.teacherA.post(`${base()}/start`, { mode: 'fresh' });
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('ACHIEVEMENTS_ALREADY_STARTED');
    expect(auditCount('achievements.start')).toBe(1);
  });

  it('awards once per badge however often the rules are evaluated (idempotent), and shows progress', async () => {
    await ok(s.teacherA.post(`${base()}/start`, { mode: 'quiet' }));
    for (const t of ['I will read one book every week.', 'I will write a short story.', 'I will learn ten new words.']) await addGoal(adaPhone, t);
    const awards = await awardsOf(ada.id);
    expect(awards.filter((a) => a.achievementId === GOAL_SETTER)).toHaveLength(1);
    expect(awards[0]).toMatchObject({ source: 'auto', awardedBy: null });
    const sec = section(await ok(adaPhone.get('/api/student/page')));
    expect(sec.earned.find((e: any) => e.id === GOAL_SETTER).isNew).toBe(true);
    expect(sec.locked.find((l: any) => l.id === PLANNER).progress).toEqual({ current: 3, target: 5 });
    expect(sec.level).toMatchObject({ level: 1, points: 1 });
    // Seen once: the celebration plays only once.
    await ok(adaPhone.post('/api/student/achievements/seen', {}));
    expect(section(await ok(adaPhone.get('/api/student/page'))).earned[0].isNew).toBe(false);
    // Bora did nothing: no badges for him.
    expect(await awardsOf(bora.id)).toEqual([]);
  });

  it('start fresh ignores what happened before the choice', async () => {
    await addGoal(adaPhone, 'I will read one book every week.');
    env.clock.advance(60_000);
    const started = await ok(s.teacherA.post(`${base()}/start`, { mode: 'fresh' }));
    expect(started.awarded).toBe(0);
    expect(await awardsOf(ada.id)).toEqual([]);
    env.clock.advance(60_000);
    await addGoal(adaPhone, 'I will write a short story.');
    expect((await awardsOf(ada.id)).map((a) => a.achievementId)).toEqual([GOAL_SETTER]);
  });

  it('automatic badges can be switched off and levels hidden; the module switch turns the section off', async () => {
    await ok(s.teacherA.post(`${base()}/start`, { mode: 'quiet' }));
    await ok(s.teacherA.put(`${base()}/settings`, { autoEnabled: false, levelsEnabled: false }));
    await addGoal(adaPhone, 'I will read one book every week.');
    expect(await awardsOf(ada.id)).toEqual([]);
    await ok(s.teacherA.post(`${base()}/award`, { achievementId: KIND, studentIds: [ada.id] }));
    const sec = section(await ok(adaPhone.get('/api/student/page')));
    expect(sec.level).toBeNull();
    expect(sec.locked).toEqual([]);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/achievements`, { enabled: false }));
    expect(section(await ok(adaPhone.get('/api/student/page')))).toBeUndefined();
  });
});

describe('manual badges in class and in the teacher area (items 4, 5)', () => {
  it('gives a badge through the outbox without a PIN, replays idempotently, undoes within 10 minutes', async () => {
    const lessonId = await startLesson(s.teacherA, s.ctxA.id);
    const view = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/achievements?lessonId=${lessonId}`));
    expect(view.badges.map((b: any) => b.id)).toContain(SUNSHINE);
    // Classroom-safe: no levels or counts.
    expect(JSON.stringify(view)).not.toMatch(/level|points/);
    const opId = '01900000-0000-7000-8000-0000000000a1';
    const r = await cmd(s.teacherA, 'achievements.award', { contextId: s.ctxA.id, lessonId, achievementId: SUNSHINE, studentIds: [ada.id, bora.id] }, { opId });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.result.awardIds).toHaveLength(2);
    const replay = await cmd(s.teacherA, 'achievements.award', { contextId: s.ctxA.id, lessonId, achievementId: SUNSHINE, studentIds: [ada.id, bora.id] }, { opId });
    expect(replay.replayed).toBe(true);
    expect((await awardsOf(ada.id)).filter((a) => a.achievementId === SUNSHINE)).toHaveLength(1);
    // Giving the same badge again in the same class is a no-op for students who hold it.
    const twice = await cmd(s.teacherA, 'achievements.award', { contextId: s.ctxA.id, lessonId, achievementId: SUNSHINE, studentIds: [ada.id] });
    expect(twice.result).toMatchObject({ awardIds: [], already: 1 });
    expect(auditCount('achievement.award')).toBe(1);

    const lessonView = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/achievements?lessonId=${lessonId}`));
    expect(lessonView.lessonAwards.every((a: any) => a.undoable)).toBe(true);
    const undo = await cmd(s.teacherA, 'achievements.undo', { contextId: s.ctxA.id, lessonId, awardIds: [r.result.awardIds[1]] });
    expect(undo.result).toEqual({ undone: 1 });
    expect((await awardsOf(bora.id)).find((a) => a.achievementId === SUNSHINE).revokedAt).not.toBeNull();
    // The student sees the badge with the teacher's name and a celebration (isNew).
    const sec = section(await ok(adaPhone.get('/api/student/page')));
    expect(sec.earned).toMatchObject([{ id: SUNSHINE, isNew: true, by: 'Test ayse.teacher' }]);
    expect(section(await ok(boraPhone.get('/api/student/page')))?.earned ?? []).toEqual([]);
  });

  it('after 10 minutes undo is refused; the teacher area revokes manual awards with a reason (kept, audited)', async () => {
    const lessonId = await startLesson(s.teacherA, s.ctxA.id);
    const r = await cmd(s.teacherA, 'achievements.award', { contextId: s.ctxA.id, lessonId, achievementId: KIND, studentIds: [ada.id] });
    const awardId = r.result.awardIds[0];
    env.clock.advance(11 * 60_000);
    const late = await cmd(s.teacherA, 'achievements.undo', { contextId: s.ctxA.id, lessonId, awardIds: [awardId] });
    expect(late.ok).toBe(false);
    expect(late.error?.reason).toBe('UNDO_WINDOW_PASSED');
    // Another teacher cannot see or remove it.
    expect((await s.teacherB.post(`/api/teacher/awards/${awardId}/revoke`, { reason: 'Given by mistake' })).status).toBe(403);
    const revoked = await ok(s.teacherA.post(`/api/teacher/awards/${awardId}/revoke`, { reason: 'Given by mistake' }));
    expect(revoked).toMatchObject({ revokeReason: 'Given by mistake' });
    expect(revoked.revokedAt).not.toBeNull();
    expect((await s.teacherA.post(`/api/teacher/awards/${awardId}/revoke`, { reason: 'Again' })).body.error.details.reason).toBe('ALREADY_REVOKED');
    expect(auditCount('achievement.revoke')).toBe(1);
    expect(env.db.$client.prepare('select count(*) as n from student_achievements').get()).toEqual({ n: 1 });
  });

  it('automatic badges cannot be given by hand or revoked; students outside the class are refused', async () => {
    expect((await s.teacherA.post(`${base()}/award`, { achievementId: GOAL_SETTER, studentIds: [ada.id] })).body.error.details.reason).toBe('NOT_MANUAL');
    const other = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Cem Kurgu' });
    expect((await s.teacherA.post(`${base()}/award`, { achievementId: KIND, studentIds: [other.id] })).status).toBe(404);
    await ok(s.teacherA.post(`${base()}/start`, { mode: 'quiet' }));
    await addGoal(adaPhone, 'I will read one book every week.');
    const auto = (await awardsOf(ada.id))[0];
    expect((await s.teacherA.post(`/api/teacher/awards/${auto.id}/revoke`, { reason: 'Not wanted' })).body.error.details.reason).toBe('NOT_MANUAL');
    // Teacher B cannot read or award in teacher A's class.
    expect((await s.teacherB.get(base())).status).toBe(403);
    expect((await s.teacherB.post(`${base()}/award`, { achievementId: KIND, studentIds: [ada.id] })).status).toBe(403);
  });

  it('teachers make custom badges; defaults are read-only but can be hidden per teacher; admins archive defaults', async () => {
    const custom = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievement-definitions`, { name: { en: 'Story builder', tr: 'Hikâye kurucu' }, description: { en: 'Built a story with the class.', tr: '' }, icon: 'book', tier: 'silver', kind: 'manual' }));
    expect(custom).toMatchObject({ custom: true, kind: 'manual', archived: false });
    expect((await s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/achievement-definitions`, { name: { en: 'Auto one', tr: '' }, description: { en: '', tr: '' }, icon: 'book', tier: 'gold', kind: 'auto' })).body.error.details.reason).toBe('RULE_REQUIRED');
    const changed = await s.teacherA.patch(`/api/teacher/contexts/${s.ctxA.id}/achievement-definitions/${SUNSHINE}`, { tier: 'gold' });
    expect(changed.body.error.details.reason).toBe('DEFAULT_READ_ONLY');
    await ok(s.teacherA.patch(`/api/teacher/contexts/${s.ctxA.id}/achievement-definitions/${SUNSHINE}`, { archived: true }));
    const lessonId = await startLesson(s.teacherA, s.ctxA.id);
    const view = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/achievements?lessonId=${lessonId}`));
    expect(view.badges.map((b: any) => b.id)).not.toContain(SUNSHINE);
    expect(view.badges.map((b: any) => b.id)).toContain(custom.id);

    // Admin archive hides a default school-wide; only defaults are listed.
    const defaults = await ok(s.admin.get('/api/admin/achievement-defaults'));
    expect(defaults.definitions.length).toBe(DEFAULT_ACHIEVEMENTS.length);
    await ok(s.admin.put(`/api/admin/achievement-defaults/${KIND}`, { archived: true }));
    const after = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/achievements?lessonId=${lessonId}`));
    expect(after.badges.map((b: any) => b.id)).not.toContain(KIND);
    expect((await s.admin.put(`/api/admin/achievement-defaults/${custom.id}`, { archived: true })).status).toBe(404);
    expect((await s.teacherA.get('/api/admin/achievement-defaults')).status).toBe(403);
    expect(auditCount('achievement_default.archive')).toBe(1);
    expect(auditCount('achievement_default.hide')).toBe(1);
  });
});

describe('isolation and the End Lesson "Well done!" (items 6, 7)', () => {
  it('students see only their own badges; the moment lists automatic badges only when the class chose it', async () => {
    await ok(s.teacherA.post(`${base()}/start`, { mode: 'fresh' }));
    const lessonId = await startLesson(s.teacherA, s.ctxA.id);
    env.clock.advance(1000);
    await addGoal(adaPhone, 'I will read one book every week.');
    const off = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/achievements?lessonId=${lessonId}`));
    expect(off.wellDone).toEqual([]);
    await ok(s.teacherA.put(`${base()}/settings`, { announce: 'endOfLesson' }));
    const on = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/achievements?lessonId=${lessonId}`));
    expect(on.wellDone).toMatchObject([{ studentId: ada.id, fullName: 'Ada Kurgu', badge: { id: GOAL_SETTER } }]);
    const boraPage = JSON.stringify(await ok(boraPhone.get('/api/student/page')));
    expect(boraPage).not.toContain('Ada');
    expect(section(JSON.parse(boraPage)).earned).toEqual([]);
    // There is no endpoint where a student reads another student's awards.
    expect((await adaPhone.get(`/api/teacher/contexts/${s.ctxA.id}/students/${bora.id}/achievements`)).status).toBe(401);
  });
});
