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
    // Super Speakers badges are active since S12 (D-132): points feed them.
    expect(o.definitions.filter((d: any) => d.category === 'speakers').length).toBe(4);
    expect(o.definitions.filter((d: any) => d.category === 'speakers').every((d: any) => !d.inactive)).toBe(true);
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
    // Seen once: the celebration plays only once (the page names the award rows it celebrated).
    await ok(adaPhone.post('/api/student/achievements/seen', { awardIds: [sec.earned.find((e: any) => e.id === GOAL_SETTER).awardId] }));
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

  it('start fresh: later activity on an old reached goal or an old homework mark never earns past work (review fix)', async () => {
    const g = await addGoal(adaPhone, 'I will read one book every week.');
    await ok(adaPhone.patch(`/api/student/goals/${g.id}`, { status: 'achieved' }));
    const hw = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/homework`, { title: 'Workbook page 12', assignedOn: '2026-11-09', dueOn: '2026-11-09' }));
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: ada.id, status: 'completed' }] }));
    env.clock.advance(60_000);
    await ok(s.teacherA.post(`${base()}/start`, { mode: 'fresh' }));
    env.clock.advance(60_000);
    // A reflection on the old goal and a teacher progress note bump goals.updatedAt; a note bumps the mark's updatedAt.
    await ok(adaPhone.post(`/api/student/goals/${g.id}/entries`, { kind: 'reflection', body: 'I read two chapters of my book today.' }));
    await ok(s.teacherA.post(`/api/teacher/goals/${g.id}/progress`, { body: 'Good progress with reading.' }));
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: ada.id, status: 'completed', note: 'Neat work' }] }));
    const ids = (await awardsOf(ada.id)).map((a) => a.achievementId);
    expect(ids).not.toContain(defaultAchievementId('goals.firstReached'));
    expect(ids).not.toContain(defaultAchievementId('homework.first'));
    // A goal reached after the start does count.
    const g2 = await addGoal(adaPhone, 'I will write a short story.');
    await ok(adaPhone.patch(`/api/student/goals/${g2.id}`, { status: 'achieved' }));
    expect((await awardsOf(ada.id)).map((a) => a.achievementId)).toContain(defaultAchievementId('goals.firstReached'));
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

describe('"seen" marks only the award rows the page celebrated (D-122)', () => {
  const seen = (body: unknown) => adaPhone.post('/api/student/achievements/seen', body);
  const badgeOf = (sec: any, id: string) => sec.earned.find((e: any) => e.id === id);

  it('a badge awarded after the page was fetched stays new; the row of another student, an unknown id and {} from an older page change nothing', async () => {
    await ok(s.teacherA.post(`${base()}/award`, { achievementId: KIND, studentIds: [ada.id, bora.id] }));
    const fetched = section(await ok(adaPhone.get('/api/student/page')));
    const kind = badgeOf(fetched, KIND);
    expect(kind).toMatchObject({ isNew: true, awardId: expect.any(String) });
    // The teacher gives Ada another badge after her page was fetched, before its report lands.
    env.clock.advance(1000);
    await ok(s.teacherA.post(`${base()}/award`, { achievementId: SUNSHINE, studentIds: [ada.id] }));
    const boraRow = (await awardsOf(bora.id)).find((a) => a.achievementId === KIND).id;
    expect(boraRow).not.toBe(kind.awardId);
    // The report names what the page celebrated, plus Bora's row (never Ada's to touch) and an unknown id.
    expect(await ok(seen({ awardIds: [kind.awardId, boraRow, 'no-such-award'] }))).toEqual({ ok: true });
    const after = section(await ok(adaPhone.get('/api/student/page')));
    expect(badgeOf(after, KIND).isNew).toBe(false);
    expect(badgeOf(after, SUNSHINE).isNew).toBe(true);
    expect(badgeOf(section(await ok(boraPhone.get('/api/student/page'))), KIND).isNew).toBe(true);
    // A page opened before the update sends {}: nothing is marked (celebrated once more next visit, never lost).
    await ok(seen({}));
    expect(badgeOf(section(await ok(adaPhone.get('/api/student/page'))), SUNSHINE).isNew).toBe(true);
    // The list is bounded by the contract.
    expect((await seen({ awardIds: Array.from({ length: 201 }, (_, i) => `award-${i}`) })).status).toBe(400);
    await ok(seen({ awardIds: [badgeOf(after, SUNSHINE).awardId] }));
    expect(badgeOf(section(await ok(adaPhone.get('/api/student/page'))), SUNSHINE).isNew).toBe(false);
  });

  it('a badge held in two classes of one subject is seen as one: revoking the newer row does not make it new again; a later award of it is new', async () => {
    // Mehmet also teaches English to 3-A: Ada has the badge from both teachers; the page shows the newest.
    const ctx2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.english.id }));
    const award = async (teacher: Client, contextId: string) => {
      await ok(teacher.post(`/api/teacher/contexts/${contextId}/achievements/award`, { achievementId: KIND, studentIds: [ada.id] }));
      return (await ok(teacher.get(`/api/teacher/contexts/${contextId}/students/${ada.id}/achievements`))).awards.find((a: any) => a.achievementId === KIND && !a.revokedAt).id as string;
    };
    const older = await award(s.teacherA, s.ctxA.id);
    env.clock.advance(60_000);
    const newer = await award(s.teacherB, ctx2.id);
    const shown = section(await ok(adaPhone.get('/api/student/page'))).earned.filter((e: any) => e.id === KIND);
    expect(shown).toMatchObject([{ awardId: newer, isNew: true }]);
    await ok(seen({ awardIds: [newer] }));
    // The newer row is revoked: the older one shows, and it is not new.
    env.clock.advance(60_000);
    await ok(s.teacherB.post(`/api/teacher/awards/${newer}/revoke`, { reason: 'Given by mistake' }));
    expect(section(await ok(adaPhone.get('/api/student/page'))).earned.filter((e: any) => e.id === KIND)).toMatchObject([{ awardId: older, isNew: false }]);
    // Given again after the report: a new award, still celebrated.
    env.clock.advance(60_000);
    const again = await award(s.teacherB, ctx2.id);
    expect(section(await ok(adaPhone.get('/api/student/page'))).earned.filter((e: any) => e.id === KIND)).toMatchObject([{ awardId: again, isNew: true }]);
    // Reporting the older row never marks a row awarded after it.
    await ok(seen({ awardIds: [older] }));
    expect(badgeOf(section(await ok(adaPhone.get('/api/student/page'))), KIND)).toMatchObject({ awardId: again, isNew: true });
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
    // The classroom moment names only the students actually awarded (review fix).
    expect(r.result.studentIds.sort()).toEqual([ada.id, bora.id].sort());
    expect(twice.result.studentIds).toEqual([]);
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
