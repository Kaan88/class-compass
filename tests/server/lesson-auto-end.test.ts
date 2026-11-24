/**
 * Forgotten lessons (S37, D-218; LES-3, RPT-5, D-155): a lesson still running LESSON_AUTO_END_AFTER_MS
 * after its start ends by itself (sweep, or lazily on any read of lesson state), as the system, with
 * nothing that needs a person done or invented; the "still running" reminder goes out once; the
 * teacher home's notices reach only the lesson's teacher; "Got it" is per lesson and survives another
 * device; reports count such a lesson honestly. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { AUTO_END_NOTICE_MS, LESSON_AUTO_END_AFTER_MS, LESSON_REMINDER_AFTER_MS } from '../../src/shared/lessonLimits.ts';
import { sweepForgottenLessons } from '../../src/server/modules/lessons/autoEnd.ts';
import { allEndSteps } from '../../src/server/modules/lessons/endSteps.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız', 'Işıl Çınar', 'Oliver Clarke']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

async function cmd(c: Client, type: string, payload: unknown, meta: { opId?: string; lessonId?: string; contextId?: string } = {}) {
  const { opId = v7(), ...rest } = meta;
  const r = await ok(c.post('/api/commands', { commands: [{ opId, type, payload, ...rest }] }));
  return r.results[0] as { ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };
}
async function start(c: Client, contextId: string, extra: Record<string, unknown> = {}) {
  const r = await cmd(c, 'lesson.start', { contextId, othersPresent: true, ...extra }, { contextId });
  expect(r.ok).toBe(true);
  return r.result as { started: boolean; lessonId: string };
}
const state = (c: Client, contextId: string) => ok(c.get(`/api/classroom/contexts/${contextId}/lesson`));
const notices = (c: Client) => ok(c.get('/api/teacher/lesson-notices'));
const summary = (c: Client, lessonId: string) => ok(c.get(`/api/classroom/lessons/${lessonId}/summary`));
const row = (lessonId: string) => env.db.$client.prepare('select * from lessons where id = ?').get(lessonId) as Record<string, any>;
const audits = (action: string) => env.db.$client.prepare('select actor_type, actor_id, entity_id, after_json from audit_events where action = ?').all(action) as Array<{ actor_type: string; actor_id: string | null; entity_id: string; after_json: string }>;
const lessonNotifications = (userId: string) =>
  env.db.$client.prepare("select category, entity_id, student_id, context_id, count from notifications where user_id = ? and category like 'lesson%' order by created_at, category").all(userId) as Array<Record<string, any>>;
/** Sessions idle out after 12 h: both teachers and the admin sign in again after a long jump. */
async function signInAgain() {
  await s.teacherA.login('ayse.teacher');
  await s.teacherB.login('mehmet.teacher');
  await s.admin.login('root.admin');
}

describe('a forgotten lesson ends itself (S37, D-218)', () => {
  it('ends at the limit and not a moment before: lazily on the classroom poll, as the system, with a clean state', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    await cmd(s.teacherA, 'lesson.timer.set', { contextId: s.ctxA.id, lessonId, durationMs: 10 * 60_000 });
    await cmd(s.teacherA, 'lesson.timer.start', { contextId: s.ctxA.id, lessonId });
    await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId, stageIndex: 2 });
    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS - 1;
    const before = await state(s.teacherA, s.ctxA.id);
    expect(before.lesson).toMatchObject({ id: lessonId, status: 'active', overdue: true, autoEndAt: t0 + LESSON_AUTO_END_AFTER_MS });
    expect(audits('lesson.auto_end')).toHaveLength(0);

    env.clock.advance(1);
    // The board that has been polling sees the end: back to its idle state.
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toBeNull();
    expect((await ok(s.teacherA.get('/api/classroom/lessons/active'))).lessons).toEqual([]);
    const r = row(lessonId);
    expect(r).toMatchObject({ status: 'ended', ended_at: t0 + LESSON_AUTO_END_AFTER_MS, auto_ended_at: t0 + LESSON_AUTO_END_AFTER_MS, reflection_json: null, stage_index: 2 });
    // The timer is stopped; a 10-minute timer started long ago has nothing left.
    expect(JSON.parse(r.timer_json)).toMatchObject({ running: false, startedAt: null, remainingMs: 0 });
    const a = audits('lesson.auto_end');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_type: 'system', actor_id: null, entity_id: lessonId });
    expect(JSON.parse(a[0]!.after_json)).toMatchObject({ endedAt: t0 + LESSON_AUTO_END_AFTER_MS, skippedSteps: expect.arrayContaining(['reflection']) });
    expect(audits('lesson.end')).toHaveLength(0);
    expect(await summary(s.teacherA, lessonId)).toMatchObject({ status: 'ended', autoEnded: true, endedAt: t0 + LESSON_AUTO_END_AFTER_MS, reflection: null, stageReached: 3 });

    // The next Start Lesson is a normal one.
    const next = await start(s.teacherA, s.ctxA.id);
    expect(next.started).toBe(true);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ id: next.lessonId, status: 'active', overdue: false, stageIndex: 0 });
  });

  it('the length of an automatically ended lesson is the limit, however late the server notices (it was down)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS + 5 * 3600_000; // nothing read it for five more hours
    await signInAgain();
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 1, reminded: 0 });
    expect(row(lessonId)).toMatchObject({ ended_at: t0 + LESSON_AUTO_END_AFTER_MS, auto_ended_at: t0 + LESSON_AUTO_END_AFTER_MS + 5 * 3600_000 });
    // No reminder after the fact; the end is notified.
    expect(lessonNotifications(s.ayse.id).map((n) => n.category)).toEqual(['lessonAutoEnded']);
  });

  it('closes lazily on any read: the active-lessons list, the teacher home notices and a new start', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    expect((await ok(s.teacherA.get('/api/classroom/lessons/active'))).lessons).toEqual([]);
    expect(row(a.lessonId).status).toBe('ended');

    const b = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    const n = await notices(s.teacherA);
    expect(n.running).toEqual([]);
    expect(n.autoEnded.map((x: any) => x.lessonId)).toEqual([b.lessonId, a.lessonId]);
    expect(row(b.lessonId).status).toBe('ended');

    const c = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    const d = await start(s.teacherA, s.ctxA.id); // the start itself ends the forgotten one first
    expect(d.started).toBe(true);
    expect(row(c.lessonId)).toMatchObject({ status: 'ended', auto_ended_at: expect.any(Number) });
    expect(audits('lesson.auto_end')).toHaveLength(3);
    expect(audits('lesson.abandon')).toHaveLength(0);
  });

  it('a lesson the local day ends under before its limit is still abandoned at the next start (not ended)', async () => {
    env.clock.t = Date.UTC(2026, 10, 9, 20, 30); // 23:30 in Istanbul
    await signInAgain();
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(45 * 60_000); // 00:15 the next day, 45 minutes in
    await signInAgain();
    expect((await start(s.teacherA, s.ctxA.id)).started).toBe(true);
    expect(row(a.lessonId)).toMatchObject({ status: 'abandoned', ended_at: null, auto_ended_at: null });
  });

  it('is idempotent: two sweeps end it once, notify once and audit once', async () => {
    await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 1, reminded: 0 });
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 0, reminded: 0 });
    await state(s.teacherA, s.ctxA.id);
    expect(audits('lesson.auto_end')).toHaveLength(1);
    expect(lessonNotifications(s.ayse.id).filter((x) => x.category === 'lessonAutoEnded')).toHaveLength(1);
  });

  it("a sweep racing the teacher's End Lesson: whoever is first wins, the other changes nothing and never fails", async () => {
    // The sweep first: the teacher's queued End Lesson is answered with the summary, nothing is written.
    const a = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    sweepForgottenLessons(env.deps);
    const late = await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: a.lessonId, steps: { reflection: { rating: 4, note: 'Lovely' } } }, { contextId: s.ctxA.id, lessonId: a.lessonId });
    expect(late).toMatchObject({ ok: true, result: { id: a.lessonId, autoEnded: true, reflection: null } });
    expect(row(a.lessonId).reflection_json).toBeNull();
    expect(audits('lesson.end')).toHaveLength(0);
    // Another teacher's device cannot use that answer to learn about the lesson.
    const other = await cmd(s.teacherB, 'lesson.end', { contextId: s.ctxA.id, lessonId: a.lessonId, steps: {} });
    expect(other.ok).toBe(false);

    // The teacher first (past the limit, before any sweep or read): their end and answers count.
    const b = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS + 60_000);
    const mine = await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: b.lessonId, steps: { reflection: { rating: 3 } } }, { contextId: s.ctxA.id, lessonId: b.lessonId });
    expect(mine).toMatchObject({ ok: true, result: { autoEnded: false, reflection: { rating: 3, note: null } } });
    expect(sweepForgottenLessons(env.deps)).toEqual({ ended: 0, reminded: 0 });
    expect(row(b.lessonId)).toMatchObject({ status: 'ended', auto_ended_at: null });
    expect(audits('lesson.auto_end')).toHaveLength(1);
  });
});

describe('End Lesson steps on an automatic end: nothing invented (S37, D-218; RPT-5)', () => {
  it('skips every step that needs a person and leaves it "not recorded"', async () => {
    // Every module with a step, switched on: Secret Students (40), the assistant (60), "Well done!" (70),
    // the lesson goal (90) and the core reflection (100).
    expect(allEndSteps().map((x) => x.key)).toEqual(['secretStudents', 'assistantThanks', 'achievementsWellDone', 'lessonGoal', 'reflection']);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/lessonGoals`, { enabled: true }));
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/achievements/settings`, { announce: 'endOfLesson' }));
    await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/assistant/plan`));
    const { lessonId } = await start(s.teacherA, s.ctxA.id, { steps: { lessonGoal: { text: 'We can name ten animals.' } } });
    expect((await state(s.teacherA, s.ctxA.id)).lesson.endSteps).toEqual(['secretStudents', 'assistantThanks', 'achievementsWellDone', 'lessonGoal', 'reflection']);
    expect((await cmd(s.teacherA, 'secret.draw', { contextId: s.ctxA.id, lessonId })).ok).toBe(true);
    const awardsBefore = env.db.$client.prepare('select count(*) n from student_achievements').get();

    env.clock.advance(LESSON_AUTO_END_AFTER_MS);
    sweepForgottenLessons(env.deps);
    const after = JSON.parse(audits('lesson.auto_end')[0]!.after_json);
    expect(after.skippedSteps).toEqual(['secretStudents', 'assistantThanks', 'achievementsWellDone', 'lessonGoal', 'reflection']);
    // Secret Students: never revealed by the server; the close hook closes the round as unrevealed (D-010).
    const sel = env.db.$client.prepare("select s.status from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ?").all(lessonId) as Array<{ status: string }>;
    expect(sel.length).toBeGreaterThan(0);
    expect(sel.every((x) => x.status === 'unrevealed_abandoned')).toBe(true);
    expect(audits('secret.reveal')).toHaveLength(0);
    // Assistant: not thanked.
    expect(env.db.$client.prepare('select thanked_at from assistant_assignments where context_id = ? and local_date = ?').get(s.ctxA.id, '2026-11-09')).toEqual({ thanked_at: null });
    // "Well done!" writes nothing anyway; no award is made.
    expect(env.db.$client.prepare('select count(*) n from student_achievements').get()).toEqual(awardsBefore);
    // Lesson goal: not answered (never "not reached").
    expect(env.db.$client.prepare('select outcome, reviewed_at from lesson_goals where lesson_id = ?').get(lessonId)).toEqual({ outcome: null, reviewed_at: null });
    // Reflection: none.
    const sum = await summary(s.teacherA, lessonId);
    expect(sum).toMatchObject({ autoEnded: true, reflection: null, lessonGoal: { text: 'We can name ten animals.', outcome: null } });
  });
});

describe('the reminder and the notices (S37, D-218; D-155)', () => {
  it('reminds once, after LESSON_REMINDER_AFTER_MS: one notification, one version bump, however often it is read', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const t0 = row(lessonId).started_at as number;
    env.clock.t = t0 + LESSON_REMINDER_AFTER_MS - 1;
    expect((await state(s.teacherA, s.ctxA.id)).lesson.overdue).toBe(false);
    expect((await notices(s.teacherA)).running).toEqual([]);
    const v0 = row(lessonId).version;
    env.clock.advance(1);
    for (let i = 0; i < 4; i += 1) {
      expect((await state(s.teacherA, s.ctxA.id)).lesson.overdue).toBe(true);
      env.clock.advance(5_000);
    }
    sweepForgottenLessons(env.deps);
    expect(row(lessonId).version).toBe(v0 + 1);
    expect(lessonNotifications(s.ayse.id)).toEqual([{ category: 'lessonStillRunning', entity_id: lessonId, student_id: null, context_id: s.ctxA.id, count: 1 }]);
    const n = await notices(s.teacherA);
    expect(n.running).toEqual([
      { lessonId, contextId: s.ctxA.id, className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-09', startedAt: t0, autoEndAt: t0 + LESSON_AUTO_END_AFTER_MS, timezone: 'Europe/Istanbul' },
    ]);
    // The bell and the page have it, about the lesson and not a student.
    const list = await ok(s.teacherA.get('/api/teacher/notifications'));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ category: 'lessonStillRunning', student: null, entity: 'lesson', context: { id: s.ctxA.id, className: '3-A' } });
    expect((await ok(s.teacherA.get('/api/teacher/notifications?group=lessons'))).items).toHaveLength(1);
    expect((await ok(s.teacherA.get('/api/teacher/notifications/count'))).unread).toBe(1);

    env.clock.t = t0 + LESSON_AUTO_END_AFTER_MS;
    sweepForgottenLessons(env.deps);
    expect(lessonNotifications(s.ayse.id).map((x) => x.category)).toEqual(['lessonStillRunning', 'lessonAutoEnded']);
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
    expect((await ok(s.teacherB.get('/api/teacher/notifications'))).items).toEqual([]);
    // Mehmet cannot dismiss Ayşe's notice (and learns nothing about it); an admin is not a teacher here.
    expect((await s.teacherB.post(`/api/teacher/lesson-notices/${a.lessonId}/seen`, {})).status).toBe(404);
    expect((await s.admin.get('/api/teacher/lesson-notices')).status).toBe(403);
    // Once the class+subject is no longer hers, the notices and the notifications are gone.
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
    expect(await ok(s.teacherA.post(`/api/teacher/lesson-notices/${a.lessonId}/seen`, {}))).toEqual({ ok: true }); // again: still fine
    const tablet = new Client(env);
    await tablet.login('ayse.teacher');
    expect((await notices(tablet)).autoEnded.map((x: any) => x.lessonId)).toEqual([b.lessonId]);
    // A lesson that a teacher ended has no such notice.
    const c = await start(s.teacherA, s.ctxA.id);
    await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: c.lessonId, steps: {} });
    expect((await s.teacherA.post(`/api/teacher/lesson-notices/${c.lessonId}/seen`, {})).status).toBe(404);
  });

  it('a lesson forgotten long before is closed quietly: no notice, no notification (still audited)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    env.clock.advance(LESSON_AUTO_END_AFTER_MS + AUTO_END_NOTICE_MS + 60_000);
    await signInAgain();
    sweepForgottenLessons(env.deps);
    expect(row(lessonId).status).toBe('ended');
    expect(audits('lesson.auto_end')).toHaveLength(1);
    expect(lessonNotifications(s.ayse.id)).toEqual([]);
    expect(await notices(s.teacherA)).toEqual({ running: [], autoEnded: [] });
  });
});

describe('reports stay honest (S37, D-218; RPT-5)', () => {
  it('counts an automatically ended lesson as held, says how many ended by themselves, and its reflection is not recorded', async () => {
    const a = await start(s.teacherA, s.ctxA.id);
    await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: a.lessonId, steps: { reflection: { rating: 4 } } });
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
    const rowB = refl.tables[0].rows.find((x: any) => x.key === b.lessonId);
    expect(rowB.cells[2]).toEqual({ t: 'nr' }); // never 0, never a made-up rating
  });
});
