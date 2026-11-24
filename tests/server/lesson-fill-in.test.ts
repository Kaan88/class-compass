/**
 * Filling in a forgotten lesson (S37, D-218; LES-3, RPT-5, D-155). After a lesson ended by itself the
 * teacher can still fill in End Lesson until the end of the next school day after the lesson's own
 * local day (class timezone; weekends and the holiday calendar skipped); then it is closed for good:
 * the late End Lesson is refused with LESSON_FILL_IN_CLOSED, the notice is gone by itself, the
 * notification no longer offers the flow, and what was not filled in stays not recorded. Late offline
 * commands keep the lesson's own day. The school is in Europe/Istanbul (UTC+3). Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { LESSON_AUTO_END_AFTER_MS } from '../../src/shared/lessonLimits.ts';
import { sweepForgottenLessons } from '../../src/server/modules/lessons/autoEnd.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const MIN = 60_000;
let env: TestEnv;
let s: School;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız']) await addStudent(s.teacherA, s.c3a.id, { fullName });
});
afterEach(async () => env.app.close());

type Result = { ok: boolean; result?: any; error?: { code: string; reason?: string } };
async function cmd(c: Client, type: string, payload: unknown, meta: { lessonId?: string; contextId?: string; clientTime?: number } = {}) {
  const r = await ok(c.post('/api/commands', { commands: [{ opId: v7(), type, payload, ...meta }] }));
  return r.results[0] as Result;
}
const ref = (lessonId: string) => ({ contextId: s.ctxA.id, lessonId });
/** Midnight at the end of a local Istanbul day = 21:00 UTC of that date. */
const endOfDay = (date: string) => Date.parse(`${date}T21:00:00Z`);
/** Sessions idle out after 12 h: sign in again after a jump. */
async function signInAgain() {
  await s.teacherA.login('ayse.teacher');
  await s.teacherB.login('mehmet.teacher');
  await s.admin.login('root.admin');
}
async function at(ms: number) {
  env.clock.t = ms;
  await signInAgain();
}
/** A lesson on `date` at 09:00 Istanbul that nobody ends: two hours later it ends by itself. */
async function forgotten(date: string, before?: (lessonId: string) => Promise<void>) {
  await at(Date.parse(`${date}T06:00:00Z`));
  const r = await cmd(s.teacherA, 'lesson.start', { contextId: s.ctxA.id, othersPresent: true }, { contextId: s.ctxA.id });
  expect(r.ok).toBe(true);
  const lessonId = r.result.lessonId as string;
  if (before) await before(lessonId);
  env.clock.advance(LESSON_AUTO_END_AFTER_MS);
  sweepForgottenLessons(env.deps);
  expect(row(lessonId)).toMatchObject({ status: 'ended' });
  return lessonId;
}
const lateEnd = (c: Client, lessonId: string, steps: Record<string, unknown> = { reflection: { rating: 3, note: null } }) => cmd(c, 'lesson.end', { ...ref(lessonId), steps }, ref(lessonId));
const notices = (c: Client) => ok(c.get('/api/teacher/lesson-notices'));
const fillIn = (c: Client, lessonId: string) => c.get(`/api/teacher/lessons/${lessonId}/fill-in`);
const lessonItems = async (c: Client) => ((await ok(c.get('/api/teacher/notifications?group=lessons'))).items as any[]).filter((i) => i.category === 'lessonAutoEnded');
const row = (lessonId: string) => env.db.$client.prepare('select * from lessons where id = ?').get(lessonId) as Record<string, any>;

describe('the fill-in window: until the end of the next school day (S37, D-218)', () => {
  it('a Monday lesson can be filled in until Tuesday ends: the deadline in the notice, the notification and the flow', async () => {
    const lessonId = await forgotten('2026-11-09');
    const deadline = endOfDay('2026-11-10');
    const n = await notices(s.teacherA);
    expect(n.autoEnded).toEqual([expect.objectContaining({ lessonId, fillInUntil: deadline, timezone: 'Europe/Istanbul' })]);
    expect(await lessonItems(s.teacherA)).toEqual([expect.objectContaining({ fillIn: { lessonId, until: deadline } })]);
    const f = await ok(fillIn(s.teacherA, lessonId));
    expect(f).toMatchObject({ contextId: s.ctxA.id, className: '3-A', fillInUntil: deadline, notAvailable: ['secretStudents'], state: { lesson: { id: lessonId, status: 'ended' }, today: { localDate: '2026-11-09' } } });
    expect(f.state.lesson.endSteps).toContain('reflection');
  });

  it('accepted one millisecond before the deadline, refused at it with a reason of its own; nothing is invented', async () => {
    const lessonId = await forgotten('2026-11-09');
    const other = await forgotten('2026-11-10');
    const deadline = endOfDay('2026-11-10');
    await at(deadline - 1);
    expect(await lateEnd(s.teacherA, lessonId)).toMatchObject({ ok: true, result: { id: lessonId, autoEnded: false, reflection: { rating: 3 } } });
    // The lesson now counts as ended by the teacher; its notice and its link are gone.
    expect(row(lessonId)).toMatchObject({ auto_ended_at: null });
    expect((await notices(s.teacherA)).autoEnded.map((x: any) => x.lessonId)).toEqual([other]);
    expect((await fillIn(s.teacherA, lessonId)).status).toBe(404);

    // The Tuesday lesson's own window runs to Wednesday; Monday's would be closed now.
    const third = await forgotten('2026-11-11');
    await at(endOfDay('2026-11-12'));
    expect(await lateEnd(s.teacherA, third)).toMatchObject({ ok: false, error: { code: 'CONFLICT', reason: 'LESSON_FILL_IN_CLOSED' } });
    expect(row(third)).toMatchObject({ reflection_json: null });
    expect(row(third).auto_ended_at).not.toBeNull();
  });

  it('after the deadline: the notice is gone without Got it, the flow says closed, the notification has no link', async () => {
    const lessonId = await forgotten('2026-11-09');
    await at(endOfDay('2026-11-10'));
    expect((await notices(s.teacherA)).autoEnded).toEqual([]);
    const r = await fillIn(s.teacherA, lessonId);
    expect(r.status).toBe(409);
    expect(r.body.error.details.reason).toBe('LESSON_FILL_IN_CLOSED');
    expect(await lessonItems(s.teacherA)).toEqual([expect.objectContaining({ fillIn: null })]);
    expect(await lateEnd(s.teacherA, lessonId)).toMatchObject({ ok: false, error: { reason: 'LESSON_FILL_IN_CLOSED' } });
    // Not recorded stays not recorded: the summary has no reflection and still says it ended by itself.
    expect(await ok(s.teacherA.get(`/api/classroom/lessons/${lessonId}/summary`))).toMatchObject({ autoEnded: true, reflection: null });
  });

  it('a Friday lesson is filled in on Monday', async () => {
    const lessonId = await forgotten('2026-11-06');
    expect((await notices(s.teacherA)).autoEnded[0]).toMatchObject({ lessonId, fillInUntil: endOfDay('2026-11-09') });
    await at(Date.parse('2026-11-08T12:00:00Z')); // Sunday
    expect((await notices(s.teacherA)).autoEnded.map((x: any) => x.lessonId)).toEqual([lessonId]);
    await at(Date.parse('2026-11-09T15:00:00Z')); // Monday 18:00
    expect(await lateEnd(s.teacherA, lessonId)).toMatchObject({ ok: true });
  });

  it('a holiday after the lesson moves the deadline to the first school day after it', async () => {
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/closures`, { name: { en: 'Fictional Day', tr: 'Hayali Gün' }, startsOn: '2026-11-10', endsOn: '2026-11-11' }));
    const lessonId = await forgotten('2026-11-09');
    expect((await notices(s.teacherA)).autoEnded[0]).toMatchObject({ lessonId, fillInUntil: endOfDay('2026-11-12') });
    await at(endOfDay('2026-11-11') + 60 * MIN); // Thursday 01:00
    expect((await notices(s.teacherA)).autoEnded).toHaveLength(1);
    expect(await lateEnd(s.teacherA, lessonId)).toMatchObject({ ok: true });
  });

  it('"Got it" hides the notice but not the window: the notification still opens the flow', async () => {
    const lessonId = await forgotten('2026-11-09');
    await ok(s.teacherA.post(`/api/teacher/lesson-notices/${lessonId}/seen`, {}));
    expect((await notices(s.teacherA)).autoEnded).toEqual([]);
    expect((await lessonItems(s.teacherA))[0]).toMatchObject({ fillIn: { lessonId } });
    expect((await fillIn(s.teacherA, lessonId)).status).toBe(200);
    expect(await lateEnd(s.teacherA, lessonId)).toMatchObject({ ok: true });
    expect((await lessonItems(s.teacherA))[0]).toMatchObject({ read: true, fillIn: null });
  });

  it("another teacher gets nothing: no notice, no flow, no late end", async () => {
    const lessonId = await forgotten('2026-11-09');
    expect((await notices(s.teacherB)).autoEnded).toEqual([]);
    expect((await fillIn(s.teacherB, lessonId)).status).toBe(404);
    expect(await lessonItems(s.teacherB)).toEqual([]);
    expect((await lateEnd(s.teacherB, lessonId)).ok).toBe(false);
    expect(row(lessonId).auto_ended_at).not.toBeNull();
    expect((await s.admin.get(`/api/teacher/lessons/${lessonId}/fill-in`)).status).toBe(403);
  });

  it('a step that cannot be applied any more (the Secret Student round closed unrevealed) is listed as not available', async () => {
    const lessonId = await forgotten('2026-11-09', async (id) => {
      expect((await cmd(s.teacherA, 'secret.draw', ref(id), ref(id))).ok).toBe(true);
    });
    const f = await ok(fillIn(s.teacherA, lessonId));
    expect(f.notAvailable).toEqual(['secretStudents']);
    expect(f.state.lesson.endSteps).toContain('secretStudents');
    await at(Date.parse('2026-11-10T08:00:00Z'));
    expect(await lateEnd(s.teacherA, lessonId, { secretStudents: {}, reflection: { rating: 3, note: null } })).toMatchObject({ ok: true, result: { notApplied: ['secretStudents'] } });
  });

  it('late offline commands keep the lesson’s own day: the next day they are refused although End Lesson is still open', async () => {
    const lessonId = await forgotten('2026-11-09');
    const before = Date.parse('2026-11-09T07:00:00Z');
    await at(Date.parse('2026-11-10T07:00:00Z'));
    expect(await cmd(s.teacherA, 'lesson.setStage', { ...ref(lessonId), stageIndex: 1 }, { ...ref(lessonId), clientTime: before })).toMatchObject({ ok: false, error: { reason: 'LESSON_ENDED' } });
    expect((await fillIn(s.teacherA, lessonId)).status).toBe(200);
  });

  it('an End Lesson saved offline in time is applied when it arrives after the deadline; one saved after it is refused', async () => {
    const lessonId = await forgotten('2026-11-06'); // Friday: open until Monday ends
    const other = await forgotten('2026-11-06');
    await at(Date.parse('2026-11-10T08:00:00Z')); // Tuesday: past the deadline
    const savedFriday = Date.parse('2026-11-06T12:00:00Z');
    expect(await cmd(s.teacherA, 'lesson.end', { ...ref(lessonId), steps: { reflection: { rating: 4, note: null } } }, { ...ref(lessonId), clientTime: savedFriday })).toMatchObject({ ok: true, result: { reflection: { rating: 4 } } });
    const savedTuesday = Date.parse('2026-11-10T07:00:00Z');
    expect(await cmd(s.teacherA, 'lesson.end', { ...ref(other), steps: {} }, { ...ref(other), clientTime: savedTuesday })).toMatchObject({ ok: false, error: { reason: 'LESSON_FILL_IN_CLOSED' } });
    // A clientTime in the future or before the lesson is not trusted: the arrival decides.
    expect(await cmd(s.teacherA, 'lesson.end', { ...ref(other), steps: {} }, { ...ref(other), clientTime: Date.parse('2026-11-01T07:00:00Z') })).toMatchObject({ ok: false, error: { reason: 'LESSON_FILL_IN_CLOSED' } });
  });
});

/** Every table's row count and the assistant's rows as they are: a pure read changes none of it. */
function snapshot() {
  const tables = (env.db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'").all() as Array<{ name: string }>).map((t) => t.name);
  const counts = Object.fromEntries(tables.map((t) => [t, (env.db.$client.prepare(`select count(*) as n from "${t}"`).get() as { n: number }).n]));
  return { counts, assignments: env.db.$client.prepare('select * from assistant_assignments order by id').all(), audits: env.db.$client.prepare('select count(*) as n from audit_events').get() };
}

describe('the fill-in read is a pure read (S37, D-218)', () => {
  async function filledInWithAssistant(change: (assistant: { id: string; fullName: string }) => Promise<void> | void) {
    // The board's poll during the lesson plans the week (the live path), as in class.
    const lessonId = await forgotten('2026-11-09', async () => {
      await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`));
    });
    const day = env.db.$client.prepare("select planned_student_id, actual_student_id from assistant_assignments where context_id = ? and local_date = '2026-11-09'").get(s.ctxA.id) as { planned_student_id: string; actual_student_id: string | null };
    const id = day.actual_student_id ?? day.planned_student_id;
    const fullName = (env.db.$client.prepare('select full_name from students where id = ?').get(id) as { full_name: string }).full_name;
    await at(Date.parse('2026-11-10T07:00:00Z'));
    await change({ id, fullName });
    const before = snapshot();
    const f = await ok(fillIn(s.teacherA, lessonId));
    expect(snapshot()).toEqual(before);
    return { f, assistant: { id, fullName } };
  }

  it("shows the lesson day's assistant as stored, no duties, nothing written", async () => {
    const { f, assistant } = await filledInWithAssistant(() => {});
    expect(f.state.assistant).toMatchObject({ localDate: '2026-11-09', assistant: { id: assistant.id }, responsibilities: [], checked: [], thanked: false });
  });

  it('the day’s assistant marked absent afterwards: still that day’s row as it is, nothing replaced', async () => {
    const { f, assistant } = await filledInWithAssistant(async (a) => {
      await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: a.id, status: 'absent' }));
    });
    expect(f.state.assistant).toMatchObject({ localDate: '2026-11-09', assistant: { id: env.db.$client.prepare("select coalesce(actual_student_id, planned_student_id) as id from assistant_assignments where context_id = ? and local_date = '2026-11-09'").pluck().get(s.ctxA.id) } });
    expect(assistant.id).toBeTruthy();
  });

  it('the day’s assistant erased since: no assistant, no thank-you, nothing written', async () => {
    const { f } = await filledInWithAssistant(async (a) => {
      await ok(s.admin.post(`/api/admin/students/${a.id}/deactivate`));
      await ok(s.admin.post(`/api/admin/students/${a.id}/erase`, { confirm: a.fullName }));
    });
    expect(f.state.assistant).toMatchObject({ localDate: '2026-11-09', assistant: null });
  });

  it('a day without an assignment: no assistant (the thank-you is not offered) and none is invented', async () => {
    const { f } = await filledInWithAssistant(() => {
      env.db.$client.prepare("delete from assistant_assignments where context_id = ? and local_date = '2026-11-09'").run(s.ctxA.id);
    });
    expect(f.state.assistant).toMatchObject({ assistant: null, thanked: false });
    expect(env.db.$client.prepare("select count(*) as n from assistant_assignments where local_date = '2026-11-09'").get()).toEqual({ n: 0 });
  });
});

describe('Secret Students in a late End Lesson: never (S37, D-218)', () => {
  for (const when of ['the same day', 'the next day'] as const) {
    it(`a round revealed during the lesson, filled in ${when}: listed as not available, skipped, nothing changed`, async () => {
      const lessonId = await forgotten('2026-11-09', async (id) => {
        expect((await cmd(s.teacherA, 'secret.draw', ref(id), ref(id))).ok).toBe(true);
        expect((await cmd(s.teacherA, 'secret.reveal', ref(id), ref(id))).ok).toBe(true);
      });
      if (when === 'the next day') await at(Date.parse('2026-11-10T07:00:00Z'));
      const f = await ok(fillIn(s.teacherA, lessonId));
      expect(f.notAvailable).toEqual(['secretStudents']);
      const selections = () => env.db.$client.prepare('select s.* from secret_selections s join secret_rounds r on r.id = s.round_id where r.lesson_id = ? order by s.id').all(lessonId) as Array<{ id: string }>;
      const before = selections();
      expect(before.length).toBeGreaterThan(0);
      const r = await lateEnd(s.teacherA, lessonId, { secretStudents: { outcomes: before.map((x) => ({ selectionId: x.id, outcome: 'goal_met' })) }, reflection: { rating: 2, note: null } });
      expect(r).toMatchObject({ ok: true, result: { notApplied: ['secretStudents'], reflection: { rating: 2 } } });
      expect(selections()).toEqual(before);
    });
  }
});
