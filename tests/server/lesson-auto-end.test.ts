/**
 * Forgotten lessons (S37, D-218; LES-3, RPT-5, D-155). A lesson in use is never cut off: it ends by
 * itself only when it is LESSON_AUTO_END_AFTER_MS old AND quiet for LESSON_IDLE_BEFORE_AUTO_END_MS, or
 * at the end of its local day; `endedAt` is then the last activity. Every accepted lesson command
 * (and "Still teaching") is activity. The reminder shows when it is LESSON_REMINDER_AFTER_MS old and
 * quiet for LESSON_REMINDER_QUIET_MS; its notification goes out once. A late End Lesson keeps what
 * the teacher answered; late offline commands that happened while it ran are accepted. Lessons left
 * running from before S37 are abandoned on the first deploy, quietly. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 } from 'uuid';
import { LESSON_AUTO_END_AFTER_MS, LESSON_IDLE_BEFORE_AUTO_END_MS, LESSON_REMINDER_AFTER_MS, LESSON_REMINDER_QUIET_MS } from '../../src/shared/lessonLimits.ts';
import { sweepForgottenLessons } from '../../src/server/modules/lessons/autoEnd.ts';
import { allEndSteps } from '../../src/server/modules/lessons/endSteps.ts';
import { registerLessonCloseHook, setSettleErrorReporter, settleLesson } from '../../src/server/modules/lessons/service.ts';
import { digestContent, digestMail } from '../../src/server/modules/notifications/digest.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const MIN = 60_000;
let env: TestEnv;
let s: School;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız', 'Işıl Çınar', 'Oliver Clarke']) await addStudent(s.teacherA, s.c3a.id, { fullName });
});
afterEach(async () => env.app.close());

type Result = { ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };
async function cmd(c: Client, type: string, payload: unknown, meta: { opId?: string; lessonId?: string; contextId?: string; clientTime?: number } = {}) {
  const { opId = v7(), ...rest } = meta;
  const r = await ok(c.post('/api/commands', { commands: [{ opId, type, payload, ...rest }] }));
  return r.results[0] as Result;
}
async function start(c: Client, contextId: string, extra: Record<string, unknown> = {}) {
  const r = await cmd(c, 'lesson.start', { contextId, othersPresent: true, ...extra }, { contextId });
  expect(r.ok).toBe(true);
  return r.result as { started: boolean; lessonId: string };
}
const ref = (lessonId: string, contextId = s.ctxA.id) => ({ contextId, lessonId });
const stage = (lessonId: string, stageIndex: number, meta: { clientTime?: number } = {}) => cmd(s.teacherA, 'lesson.setStage', { ...ref(lessonId), stageIndex }, { ...ref(lessonId), ...meta });
const stillTeaching = (c: Client, lessonId: string, contextId = s.ctxA.id) => cmd(c, 'lesson.stillTeaching', ref(lessonId, contextId), ref(lessonId, contextId));
const endLesson = (lessonId: string, steps: Record<string, unknown> = {}) => cmd(s.teacherA, 'lesson.end', { ...ref(lessonId), steps }, ref(lessonId));
const state = (c: Client, contextId: string) => ok(c.get(`/api/classroom/contexts/${contextId}/lesson`));
const notices = (c: Client) => ok(c.get('/api/teacher/lesson-notices'));
const summary = (c: Client, lessonId: string) => ok(c.get(`/api/classroom/lessons/${lessonId}/summary`));
const row = (lessonId: string) => env.db.$client.prepare('select * from lessons where id = ?').get(lessonId) as Record<string, any>;
const audits = (action: string) => env.db.$client.prepare('select actor_type, actor_id, entity_id, after_json from audit_events where action = ?').all(action) as Array<{ actor_type: string; actor_id: string | null; entity_id: string; after_json: string }>;
const lessonNotifications = (userId: string) =>
  env.db.$client.prepare("select category, entity_id, student_id, context_id, count, read_at from notifications where user_id = ? and category like 'lesson%' order by created_at, category").all(userId) as Array<Record<string, any>>;
/** Sessions idle out after 12 h: both teachers and the admin sign in again after a long jump. */
async function signInAgain() {
  await s.teacherA.login('ayse.teacher');
  await s.teacherB.login('mehmet.teacher');
  await s.admin.login('root.admin');
}

describe('a lesson in use is never cut off (S37, D-218)', () => {
  it('activity keeps a three-hour lesson alive; once it is quiet for 30 minutes it ends at its last activity', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    for (let m = 10; m <= 180; m += 10) {
      env.clock.t = t0 + m * MIN;
      expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 0, reminded: 0, abandoned: 0, failed: 0 });
      expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ id: lessonId, status: 'active', overdue: false });
      expect((await stage(lessonId, m % 4)).ok).toBe(true);
    }
    const last = t0 + 180 * MIN;
    expect(row(lessonId)).toMatchObject({ last_activity_at: last, reminded_at: null });
    env.clock.t = last + LESSON_IDLE_BEFORE_AUTO_END_MS - 1;
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ status: 'active', overdue: true, autoEndAt: last + LESSON_IDLE_BEFORE_AUTO_END_MS });
    env.clock.advance(1);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toBeNull();
    expect(row(lessonId)).toMatchObject({ status: 'ended', ended_at: last, auto_ended_at: last + LESSON_IDLE_BEFORE_AUTO_END_MS });
  });

  it('after two hours, 30 quiet minutes end it: as the system, endedAt = the last activity, a clean state', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    await cmd(s.teacherA, 'lesson.timer.set', { ...ref(lessonId), durationMs: 10 * MIN }, ref(lessonId));
    await cmd(s.teacherA, 'lesson.timer.start', ref(lessonId), ref(lessonId));
    env.clock.t = t0 + 100 * MIN;
    await stage(lessonId, 2);
    // Two hours old, but only 20 quiet minutes: still running, and it says when it would end.
    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS;
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ status: 'active', overdue: true, autoEndAt: t0 + 130 * MIN });
    env.clock.t = t0 + 130 * MIN;
    expect((await ok(s.teacherA.get('/api/classroom/lessons/active'))).lessons).toEqual([]);
    const r = row(lessonId);
    expect(r).toMatchObject({ status: 'ended', ended_at: t0 + 100 * MIN, auto_ended_at: t0 + 130 * MIN, reflection_json: null, stage_index: 2 });
    expect(JSON.parse(r.timer_json)).toMatchObject({ running: false, startedAt: null, remainingMs: 0 });
    const a = audits('lesson.auto_end');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_type: 'system', actor_id: null, entity_id: lessonId });
    expect(JSON.parse(a[0]!.after_json)).toMatchObject({ endedAt: t0 + 100 * MIN, skippedSteps: expect.arrayContaining(['reflection']) });
    expect(await summary(s.teacherA, lessonId)).toMatchObject({ status: 'ended', autoEnded: true, endedAt: t0 + 100 * MIN, reflection: null, stageReached: 3 });
    // The next Start Lesson is a normal one.
    const next = await start(s.teacherA, s.ctxA.id);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ id: next.lessonId, status: 'active', overdue: false, stageIndex: 0 });
  });

  it('the midnight cap: a lesson still in use at the end of its local day ends there, at its last activity', async () => {
    env.clock.t = Date.UTC(2026, 10, 9, 19, 30); // 22:30 in Istanbul
    await signInAgain();
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    for (let m = 10; m <= 85; m += 15) {
      env.clock.t = Date.UTC(2026, 10, 9, 19, 30) + m * MIN; // up to 23:55
      expect((await stage(lessonId, 1)).ok).toBe(true);
    }
    const midnight = Date.UTC(2026, 10, 9, 21, 0);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ status: 'active', autoEndAt: midnight });
    env.clock.t = midnight;
    sweepForgottenLessons(env.deps);
    expect(row(lessonId)).toMatchObject({ status: 'ended', ended_at: midnight - 5 * MIN, auto_ended_at: midnight });
  });

  it('a lesson that nothing happened in ends two hours after its start (its start is its last activity)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS + 5 * 3600_000; // the server was down for five more hours
    await signInAgain();
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 1, reminded: 0, abandoned: 0, failed: 0 });
    expect(row(lessonId)).toMatchObject({ ended_at: t0, auto_ended_at: t0 + LESSON_AUTO_END_AFTER_MS + 5 * 3600_000 });
    expect(lessonNotifications(s.ayse.id).map((n) => n.category)).toEqual(['lessonAutoEnded']);
  });

  it('is idempotent: two sweeps end it once, notify once and audit once; a start ends the forgotten one first', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    expect(sweepForgottenLessons(env.deps)).toMatchObject({ ended: 1 });
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 0, reminded: 0, abandoned: 0, failed: 0 });
    await state(s.teacherA, s.ctxA.id);
    expect(lessonNotifications(s.ayse.id).filter((x) => x.category === 'lessonAutoEnded')).toHaveLength(1);
    const b = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    expect((await start(s.teacherA, s.ctxA.id)).started).toBe(true);
    expect(row(b.lessonId)).toMatchObject({ status: 'ended', auto_ended_at: expect.any(Number) });
    expect(audits('lesson.auto_end').map((x) => x.entity_id)).toEqual([a.lessonId, b.lessonId]);
    expect(audits('lesson.abandon')).toHaveLength(0);
  });
});

describe('"Still teaching" and the reminder (S37, D-218; D-155)', () => {
  it('the reminder waits for 90 minutes and 15 quiet ones; Still teaching (home banner or board) hides it and moves the end', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    env.clock.t = t0 + 80 * MIN;
    await stage(lessonId, 1);
    env.clock.t = t0 + LESSON_REMINDER_AFTER_MS;
    expect((await state(s.teacherA, s.ctxA.id)).lesson.overdue).toBe(false); // only 10 quiet minutes
    expect((await notices(s.teacherA)).running).toEqual([]);
    env.clock.t = t0 + 80 * MIN + LESSON_REMINDER_QUIET_MS;
    expect((await state(s.teacherA, s.ctxA.id)).lesson.overdue).toBe(true);
    const n = await notices(s.teacherA);
    expect(n.running).toEqual([{ lessonId, contextId: s.ctxA.id, className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-09', startedAt: t0, autoEndAt: t0 + LESSON_AUTO_END_AFTER_MS, timezone: 'Europe/Istanbul' }]);
    expect(lessonNotifications(s.ayse.id)).toEqual([{ category: 'lessonStillRunning', entity_id: lessonId, student_id: null, context_id: s.ctxA.id, count: 1, read_at: null }]);
    const list = await ok(s.teacherA.get('/api/teacher/notifications?group=lessons'));
    expect(list.items[0]).toMatchObject({ category: 'lessonStillRunning', student: null, entity: 'lesson', context: { id: s.ctxA.id, className: '3-A' } });

    // The home banner's button (a teacher-area device) …
    const tablet = new Client(env);
    await tablet.login('ayse.teacher');
    expect(await stillTeaching(tablet, lessonId)).toMatchObject({ ok: true, result: { active: true } });
    const now1 = env.clock.t;
    expect(row(lessonId).last_activity_at).toBe(now1);
    expect((await notices(s.teacherA)).running).toEqual([]);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ overdue: false, autoEndAt: now1 + LESSON_IDLE_BEFORE_AUTO_END_MS });

    // … and, 15 quiet minutes later, the board's: the same command; the notification is not sent again.
    env.clock.advance(LESSON_REMINDER_QUIET_MS);
    expect((await state(s.teacherA, s.ctxA.id)).lesson.overdue).toBe(true);
    expect((await stillTeaching(s.teacherA, lessonId)).ok).toBe(true);
    expect((await state(s.teacherA, s.ctxA.id)).lesson.overdue).toBe(false);
    env.clock.advance(LESSON_REMINDER_QUIET_MS);
    sweepForgottenLessons(env.deps);
    expect(lessonNotifications(s.ayse.id)).toHaveLength(1);
    // Another teacher cannot keep Ayşe's lesson alive.
    expect((await stillTeaching(s.teacherB, lessonId)).ok).toBe(false);
  });

  it('a lesson that ends marks its "still running" notification read (no dead End lesson link)', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_REMINDER_AFTER_MS);
    sweepForgottenLessons(env.deps);
    expect((await endLesson(a.lessonId)).ok).toBe(true);
    expect(lessonNotifications(s.ayse.id)).toEqual([expect.objectContaining({ category: 'lessonStillRunning', read_at: env.clock.t })]);
    const b = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_REMINDER_AFTER_MS);
    sweepForgottenLessons(env.deps);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS - LESSON_REMINDER_AFTER_MS);
    sweepForgottenLessons(env.deps);
    const rows = lessonNotifications(s.ayse.id).filter((x) => x.entity_id === b.lessonId);
    expect(rows.map((x) => [x.category, x.read_at === null])).toEqual([
      ['lessonStillRunning', false],
      ['lessonAutoEnded', true],
    ]);
  });

  it("only the lesson's own teacher gets the notices; another class's teacher gets nothing", async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_REMINDER_AFTER_MS);
    sweepForgottenLessons(env.deps);
    expect((await notices(s.teacherB)).running).toEqual([]);
    expect((await notices(s.teacherA)).running.map((x: any) => x.lessonId)).toEqual([a.lessonId]);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    sweepForgottenLessons(env.deps);
    expect(await notices(s.teacherB)).toEqual({ running: [], autoEnded: [] });
    expect((await notices(s.teacherA)).autoEnded.map((x: any) => x.lessonId)).toEqual([a.lessonId]);
    expect(lessonNotifications(s.mehmet.id)).toEqual([]);
    expect((await s.teacherB.post(`/api/teacher/lesson-notices/${a.lessonId}/seen`, {})).status).toBe(404);
    expect((await s.admin.get('/api/teacher/lesson-notices')).status).toBe(403);
    await ok(s.admin.post(`/api/admin/teaching-contexts/${s.ctxA.id}/end`));
    expect(await notices(s.teacherA)).toEqual({ running: [], autoEnded: [] });
    expect((await ok(s.teacherA.get('/api/teacher/notifications'))).items).toEqual([]);
  });

  it('"Got it" dismisses the notice for good, on every device of the teacher', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    const b = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    expect((await notices(s.teacherA)).autoEnded.map((x: any) => x.lessonId)).toEqual([b.lessonId, a.lessonId]);
    expect(await ok(s.teacherA.post(`/api/teacher/lesson-notices/${a.lessonId}/seen`, {}))).toEqual({ ok: true });
    expect(await ok(s.teacherA.post(`/api/teacher/lesson-notices/${a.lessonId}/seen`, {}))).toEqual({ ok: true });
    const tablet = new Client(env);
    await tablet.login('ayse.teacher');
    expect((await notices(tablet)).autoEnded.map((x: any) => x.lessonId)).toEqual([b.lessonId]);
    const c = await start(s.teacherA, s.ctxA.id);
    await endLesson(c.lessonId);
    expect((await s.teacherA.post(`/api/teacher/lesson-notices/${c.lessonId}/seen`, {})).status).toBe(404);
  });

  it('a digest that contains a lesson notice counts it by kind and names no student', async () => {
    await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_REMINDER_AFTER_MS);
    sweepForgottenLessons(env.deps);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    sweepForgottenLessons(env.deps);
    const content = digestContent(env.deps, s.ayse.id, 0);
    // The reminder was resolved when the lesson ended: the digest has the end only.
    expect(content).toMatchObject({ total: 1, byCategory: { lessonAutoEnded: 1 }, byStudent: [] });
    for (const locale of ['en', 'tr'] as const) {
      const mail = digestMail(locale, 'Ayşe', content, true, 'https://school.example.org/teacher/notifications');
      expect(mail.text).not.toMatch(/\{|\}|undefined|null/u);
      expect(mail.text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
    }
  });

  it('the sweep copes with a disabled teacher and an ended class+subject: the lessons end, nobody is notified', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    const b = await start(s.teacherB, s.ctxB.id);
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    await ok(s.admin.post(`/api/admin/teaching-contexts/${s.ctxB.id}/end`));
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 2, reminded: 0, abandoned: 0, failed: 0 });
    expect([row(a.lessonId).status, row(b.lessonId).status]).toEqual(['ended', 'ended']);
    expect(env.db.$client.prepare("select count(*) n from notifications where category like 'lesson%'").get()).toEqual({ n: 0 });
  });
});

describe('never throw away what the teacher did (S37, D-218)', () => {
  it('End Lesson opened at 1:58 (Still teaching) and submitted at 2:20 keeps every answer', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    env.clock.t = t0 + 118 * MIN;
    expect((await stillTeaching(s.teacherA, lessonId)).ok).toBe(true); // End Lesson opens
    env.clock.t = t0 + 140 * MIN;
    sweepForgottenLessons(env.deps);
    expect(row(lessonId).status).toBe('active');
    const end = await endLesson(lessonId, { reflection: { rating: 4, note: 'They loved the song.' } });
    expect(end).toMatchObject({ ok: true, result: { autoEnded: false, reflection: { rating: 4, note: 'They loved the song.' } } });
    expect(row(lessonId)).toMatchObject({ ended_at: t0 + 140 * MIN, auto_ended_at: null });
  });

  it('a late End Lesson applies every step it still can, names the one it cannot, and the notice is gone', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/lessonGoals`, { enabled: true }));
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/achievements/settings`, { announce: 'endOfLesson' }));
    const plan = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/assistant/plan`));
    expect(plan).toBeTruthy();
    const { lessonId } = await start(s.teacherA, s.ctxA.id, { steps: { lessonGoal: { text: 'We can name ten animals.' } } });
    expect(allEndSteps().map((x) => x.key)).toEqual(['secretStudents', 'assistantThanks', 'achievementsWellDone', 'lessonGoal', 'reflection']);
    const t0 = row(lessonId).started_at as number;
    expect((await cmd(s.teacherA, 'secret.draw', ref(lessonId), ref(lessonId))).ok).toBe(true);
    const lastAct = row(lessonId).last_activity_at as number;

    // It ends by itself: no step is faked; the round is closed unrevealed (D-010).
    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS;
    sweepForgottenLessons(env.deps);
    expect(JSON.parse(audits('lesson.auto_end')[0]!.after_json).skippedSteps).toEqual(['secretStudents', 'assistantThanks', 'achievementsWellDone', 'lessonGoal', 'reflection']);
    const selections = () => env.db.$client.prepare('select s.id, s.status from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ?').all(lessonId) as Array<{ id: string; status: string }>;
    expect(selections().every((x) => x.status === 'unrevealed_abandoned')).toBe(true);
    expect(env.db.$client.prepare('select outcome from lesson_goals where lesson_id = ?').get(lessonId)).toEqual({ outcome: null });
    expect((await notices(s.teacherA)).autoEnded.map((x: any) => x.lessonId)).toEqual([lessonId]);

    // Twenty minutes later the teacher submits the End Lesson that was open on the board.
    env.clock.advance(20 * MIN);
    const steps = {
      secretStudents: { outcomes: selections().map((x) => ({ selectionId: x.id, outcome: 'goal_met' })) },
      assistantThanks: { thanked: true },
      lessonGoal: { outcome: 'reached' },
      reflection: { rating: 4, note: 'A good lesson.' },
    };
    const late = await endLesson(lessonId, steps);
    expect(late).toMatchObject({ ok: true, result: { id: lessonId, autoEnded: false, notApplied: ['secretStudents'], reflection: { rating: 4, note: 'A good lesson.' }, lessonGoal: { outcome: 'reached' } } });
    expect(row(lessonId)).toMatchObject({ status: 'ended', ended_at: lastAct, auto_ended_at: null, auto_end_seen_at: null });
    expect(selections().every((x) => x.status === 'unrevealed_abandoned')).toBe(true);
    expect(audits('secret.reveal')).toHaveLength(0);
    const thanked = env.db.$client.prepare('select thanked_at from assistant_assignments where context_id = ? and local_date = ?').get(s.ctxA.id, '2026-11-09') as { thanked_at: number | null } | undefined;
    if (thanked) expect(thanked.thanked_at).toBe(env.clock.t);
    const endAudit = audits('lesson.end');
    expect(endAudit).toHaveLength(1);
    expect(JSON.parse(endAudit[0]!.after_json)).toMatchObject({ late: true, autoEndedAt: t0 + LESSON_AUTO_END_AFTER_MS, notApplied: ['secretStudents'] });
    // It counts as ended by the teacher: no notice, the notification read, Got it has nothing left.
    expect((await notices(s.teacherA)).autoEnded).toEqual([]);
    expect(lessonNotifications(s.ayse.id).every((x) => x.read_at !== null)).toBe(true);
    expect((await s.teacherA.post(`/api/teacher/lesson-notices/${lessonId}/seen`, {})).status).toBe(404);
    expect(await summary(s.teacherA, lessonId)).toMatchObject({ autoEnded: false, reflection: { rating: 4 } });
    // A second End Lesson (another device's queue) changes nothing.
    expect(await endLesson(lessonId, { reflection: { rating: 1 } })).toMatchObject({ ok: false, error: { reason: 'LESSON_ENDED' } });
    expect(JSON.parse(row(lessonId).reflection_json).rating).toBe(4);
    // Another teacher's device cannot use a late end to learn about the lesson.
    expect((await cmd(s.teacherB, 'lesson.end', { ...ref(lessonId), steps: {} })).ok).toBe(false);
  });

  it('a late End Lesson without a Secret Student round applies everything', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    sweepForgottenLessons(env.deps);
    expect(await endLesson(lessonId, { reflection: { rating: 3 } })).toMatchObject({ ok: true, result: { autoEnded: false, notApplied: [], reflection: { rating: 3, note: null } } });
  });

  it('queued offline commands: made before the end they are accepted, made after it they are refused, and none throws', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    env.clock.t = t0 + 60 * MIN;
    await stage(lessonId, 1);
    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS;
    sweepForgottenLessons(env.deps);
    expect(row(lessonId)).toMatchObject({ ended_at: t0 + 60 * MIN, auto_ended_at: t0 + LESSON_AUTO_END_AFTER_MS });

    // A tablet that was offline sends what it did at 1:30 and at 1:55: accepted, and the lesson ended no earlier.
    env.clock.t = t0 + 150 * MIN;
    expect(await stage(lessonId, 2, { clientTime: t0 + 90 * MIN })).toMatchObject({ ok: true });
    expect((await cmd(s.teacherA, 'lesson.timer.start', ref(lessonId), { ...ref(lessonId), clientTime: t0 + 115 * MIN })).ok).toBe(true); // a no-op
    expect(row(lessonId)).toMatchObject({ status: 'ended', stage_index: 2, ended_at: t0 + 115 * MIN });
    // Made after the end, with no time, in the future, or a game that closed with the lesson: LESSON_ENDED as before.
    for (const meta of [{ clientTime: t0 + 125 * MIN }, {}, { clientTime: t0 + 200 * MIN }]) {
      expect(await stage(lessonId, 3, meta)).toMatchObject({ ok: false, error: { code: 'CONFLICT', reason: 'LESSON_ENDED' } });
    }
    expect(await cmd(s.teacherA, 'secret.draw', ref(lessonId), { ...ref(lessonId), clientTime: t0 + 90 * MIN })).toMatchObject({ ok: false, error: { reason: 'LESSON_ENDED' } });
    expect(row(lessonId)).toMatchObject({ stage_index: 2, ended_at: t0 + 115 * MIN });

    // A lesson the teacher ended: what was done before the end is accepted; the end is not moved.
    const b = await start(s.teacherA, s.ctxA.id);
    const tb = env.clock.t;
    env.clock.advance(10 * MIN);
    await endLesson(b.lessonId);
    env.clock.advance(10 * MIN);
    expect(await stage(b.lessonId, 1, { clientTime: tb + 5 * MIN })).toMatchObject({ ok: true });
    expect(row(b.lessonId)).toMatchObject({ stage_index: 1, ended_at: tb + 10 * MIN });
    expect(await stage(b.lessonId, 2, { clientTime: tb + 15 * MIN })).toMatchObject({ ok: false, error: { reason: 'LESSON_ENDED' } });
  });
});

describe('the first deploy and robustness (S37, D-218)', () => {
  it("a lesson left running from before S37 on an earlier day is abandoned, quietly; one from today counts from its start", async () => {
    const old = await start(s.teacherA, s.ctxA.id);
    const today = await start(s.teacherB, s.ctxB.id);
    env.db.$client.prepare('update lessons set last_activity_at = null').run(); // as the migration leaves them
    env.clock.t = Date.UTC(2026, 10, 9, 20, 59); // 23:59: still the same day
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 2, reminded: 0, abandoned: 0, failed: 0 });
    // The next day: yesterday's lesson from before S37 (made again here) is abandoned.
    const yesterday = await (async () => {
      env.clock.t = Date.UTC(2026, 10, 9, 7, 0);
      await signInAgain();
      const l = await start(s.teacherA, s.ctxA.id);
      env.db.$client.prepare('update lessons set last_activity_at = null where id = ?').run(l.lessonId);
      return l;
    })();
    env.clock.t = Date.UTC(2026, 10, 10, 6, 0);
    await signInAgain();
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toBeNull();
    expect(row(yesterday.lessonId)).toMatchObject({ status: 'abandoned', ended_at: null, auto_ended_at: null });
    const ab = audits('lesson.abandon');
    expect(ab.map((x) => [x.entity_id, x.actor_type])).toEqual([[yesterday.lessonId, 'system']]);
    expect(JSON.parse(ab[0]!.after_json)).toMatchObject({ reason: 'before_auto_end' });
    expect(await notices(s.teacherA)).toEqual({ running: [], autoEnded: expect.not.arrayContaining([expect.objectContaining({ lessonId: yesterday.lessonId })]) });
    expect(lessonNotifications(s.ayse.id).filter((x) => x.entity_id === yesterday.lessonId && x.category === 'lessonAutoEnded')).toEqual([]);
    expect([row(old.lessonId).status, row(today.lessonId).status]).toEqual(['ended', 'ended']);
  });

  it('the sweep goes on past a lesson whose settle throws; a read serves the lesson as it is', async () => {
    const broken = new Set<string>();
    registerLessonCloseHook((_ctx, lesson) => {
      if (broken.has(lesson.id)) throw new Error('a module broke');
    });
    const reported: string[] = [];
    setSettleErrorReporter((_err, id) => reported.push(id));
    try {
      const a = await start(s.teacherA, s.ctxA.id);
      const b = await start(s.teacherB, s.ctxB.id);
      broken.add(a.lessonId);
      env.clock.advance(LESSON_AUTO_END_AFTER_MS);
      const failed: string[] = [];
      expect(sweepForgottenLessons(env.deps, (_e, id) => failed.push(id))).toEqual({ ended: 1, reminded: 0, abandoned: 0, failed: 1 });
      expect(failed).toEqual([a.lessonId]);
      expect(row(b.lessonId).status).toBe('ended');
      expect(row(a.lessonId)).toMatchObject({ status: 'active', auto_ended_at: null }); // rolled back
      const r = await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`);
      expect(r.status).toBe(200);
      expect(r.body.lesson).toMatchObject({ id: a.lessonId, status: 'active' });
      expect((await s.teacherA.get('/api/teacher/lesson-notices')).status).toBe(200);
      expect(reported).toContain(a.lessonId);
    } finally {
      broken.clear();
      setSettleErrorReporter(() => {});
    }
  });

  it('an idle poll opens no write transaction and changes nothing', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(10 * MIN);
    const before = row(lessonId);
    const spy = vi.spyOn(env.db.$client, 'transaction');
    try {
      expect(settleLesson(env.deps, lessonId)).toMatchObject({ id: lessonId, status: 'active' });
      expect(spy).not.toHaveBeenCalled();
      sweepForgottenLessons(env.deps);
      expect(spy).not.toHaveBeenCalled();
      await state(s.teacherA, s.ctxA.id);
      await notices(s.teacherA);
      expect(row(lessonId)).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('reports stay honest (S37, D-218; RPT-5)', () => {
  it('counts an automatically ended lesson as held, says how many ended by themselves, and its reflection is not recorded', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    await endLesson(a.lessonId, { reflection: { rating: 4 } });
    const b = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    sweepForgottenLessons(env.deps);
    const r = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-09&to=2026-11-09`));
    const overview = r.sections.find((x: any) => x.key === 'overview');
    const metric = (k: string) => overview.metrics.find((m: any) => m.key === k).cell;
    expect(metric('lessons')).toEqual({ t: 'n', v: 2 });
    expect(metric('autoEnded')).toEqual({ t: 'n', v: 1, d: 2 });
    const refl = r.sections.find((x: any) => x.key === 'lessonReflections');
    expect(refl.metrics[0].cell).toEqual({ t: 'n', v: 1, d: 2 });
    expect(refl.tables[0].rows.find((x: any) => x.key === b.lessonId).cells[2]).toEqual({ t: 'nr' });
  });
});
