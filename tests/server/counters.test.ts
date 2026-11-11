/**
 * Counters (S6): CNT-1..12, CRD-2, D-003, D-004, UX-11, ACC-10, RPT-5, DAT-6. Fictional names only.
 * Test clock starts Monday 2026-11-09 10:00 Europe/Istanbul.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import type { Client } from '../helpers.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;

const H = 3600_000;
const D = 24 * H;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız', 'Işıl Çınar', 'Oliver Clarke']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

type Result = { ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };
async function cmd(c: Client, type: string, payload: any, opId = v7()): Promise<Result> {
  const r = await ok(c.post('/api/commands', { commands: [{ opId, type, payload, contextId: payload.contextId, lessonId: payload.lessonId }] }));
  return r.results[0];
}
async function start(c: Client, contextId: string) {
  const r = await cmd(c, 'lesson.start', { contextId });
  expect(r.ok).toBe(true);
  return r.result.lessonId as string;
}
async function end(c: Client, contextId: string, lessonId: string) {
  expect((await cmd(c, 'lesson.end', { contextId, lessonId, steps: {} })).ok).toBe(true);
}
const state = (c: Client, contextId: string) => ok(c.get(`/api/classroom/contexts/${contextId}/lesson`));
async function english(c: Client, contextId: string) {
  const st = await state(c, contextId);
  return st.counters.counters.find((x: any) => x.kind === 'english_reminders');
}
const tap = (c: Client, contextId: string, lessonId: string, counterId: string, studentId?: string, opId?: string) =>
  cmd(c, 'counter.tap', { contextId, lessonId, counterId, ...(studentId ? { studentId } : {}) }, opId);
/** Move the clock and sign the teachers in again (sessions expire after 12 idle hours). */
async function travel(to: { by?: number; at?: number }) {
  if (to.by) env.clock.advance(to.by);
  if (to.at) env.clock.t = to.at;
  await s.teacherA.login('ayse.teacher');
}
const weekly = (counter: any, studentId: string) => counter.students.find((x: any) => x.studentId === studentId)?.count;

describe('English preset (CNT-1, CNT-12)', () => {
  it('is created on first use for an English class+subject with the default labels, 10 segments and responses', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id);
    const st = await state(s.teacherA, s.ctxA.id);
    expect(st.lesson.id).toBe(lessonId);
    expect(st.counters.weekStart).toBe('2026-11-09');
    expect(st.counters.weekEnd).toBe('2026-11-15');
    expect(st.counters.counters).toHaveLength(1);
    const c = st.counters.counters[0];
    expect(c).toMatchObject({ kind: 'english_reminders', scope: 'both', barSegments: 10, resetPeriod: 'week', thresholds: [2, 4, 6], lessonTotal: 0, barValue: 0, reached: false, crossingSeq: null });
    expect(c.labels.main.en).toBe('Our English Time');
    expect(c.labels.supporting.en).toBe('{count} / {limit} Turkish reminders');
    expect(c.labels.individual.en).toBe('Turkish reminders');
    expect(c.students).toHaveLength(4);
    const list = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/counters`));
    expect(list.englishSubject).toBe(true);
    const responses = list.counters[0].responses.map((r: any) => r.kind);
    expect(responses).toEqual(expect.arrayContaining(['no_breaktime', 'class_reset', 'practice_challenge']));
    // "No breaktime" is selectable, not the fixed default (CNT-9).
    expect(list.counters[0].activeResponseId).not.toBe('no-breaktime');
    // Polling again does not create a second preset.
    await state(s.teacherA, s.ctxA.id);
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/counters`))).counters).toHaveLength(1);
  });

  it('is not created automatically for other subjects but can be added on request, once', async () => {
    const list = await ok(s.teacherB.get(`/api/teacher/contexts/${s.ctxB.id}/counters`));
    expect(list).toMatchObject({ englishSubject: false, counters: [] });
    const preset = await ok(s.teacherB.post(`/api/teacher/contexts/${s.ctxB.id}/counters/english-preset`));
    expect(preset.kind).toBe('english_reminders');
    const again = await s.teacherB.post(`/api/teacher/contexts/${s.ctxB.id}/counters/english-preset`);
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('ENGLISH_PRESET_EXISTS');
  });

  it('an archived preset is not re-created and disappears from the classroom; its history stays (CFG-2)', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    expect((await tap(s.teacherA, s.ctxA.id, lessonId, c.id, kids[0]!.id)).ok).toBe(true);
    await ok(s.teacherA.post(`/api/teacher/counters/${c.id}/archive`));
    expect((await state(s.teacherA, s.ctxA.id)).counters.counters).toHaveLength(0);
    const r = await tap(s.teacherA, s.ctxA.id, lessonId, c.id, kids[0]!.id);
    expect(r.error?.reason).toBe('COUNTER_ARCHIVED');
    const hist = await ok(s.teacherA.get(`/api/teacher/counters/${c.id}/history?weeks=1`));
    expect(hist.weeks[0].total).toBe(1);
    expect(hist.counter.archived).toBe(true);
  });

  it('is not created by reads in an archived school year (DAT-1: read-only, no counter or audit rows)', async () => {
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`));
    await state(s.teacherA, s.ctxA.id);
    const list = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/counters`));
    expect(list.counters).toHaveLength(0);
    expect(env.db.$client.prepare('select count(*) n from counters').get()).toEqual({ n: 0 });
    expect(env.db.$client.prepare("select count(*) n from audit_events where action = 'counter.create'").get()).toEqual({ n: 0 });
    // Unarchived again, first use creates the preset as usual.
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/unarchive`));
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/counters`))).counters).toHaveLength(1);
  });
});

describe('lesson bar vs weekly counts (CNT-2, CNT-3, CNT-8)', () => {
  it('lesson total and weekly totals are independent: two lessons in one week', async () => {
    const l1 = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    for (const k of [kids[0]!, kids[1]!, kids[2]!]) expect((await tap(s.teacherA, s.ctxA.id, l1, c.id, k.id)).ok).toBe(true);
    await tap(s.teacherA, s.ctxA.id, l1, c.id, kids[0]!.id);
    let cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ lessonTotal: 4, barValue: 4 });
    expect(weekly(cs, kids[0]!.id)).toBe(2);
    await end(s.teacherA, s.ctxA.id, l1);

    // Next day, new lesson: the bar starts at 0 (new lesson), weekly counts carry on.
    await travel({ by: D });
    const l2 = await start(s.teacherA, s.ctxA.id);
    expect(l2).not.toBe(l1);
    cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ lessonTotal: 0, barValue: 0, reached: false });
    expect(weekly(cs, kids[0]!.id)).toBe(2);
    await tap(s.teacherA, s.ctxA.id, l2, c.id, kids[0]!.id);
    cs = await english(s.teacherA, s.ctxA.id);
    // Lesson total = this lesson's events (1), not the weekly sum (5).
    expect(cs).toMatchObject({ lessonTotal: 1, barValue: 1 });
    expect(weekly(cs, kids[0]!.id)).toBe(3);
    expect(weekly(cs, kids[3]!.id)).toBe(0);
  });

  it('resuming (refresh, second start) or switching class does not reset the bar (LES-2, LES-4)', async () => {
    const ctxA2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3b.id, subjectId: s.english.id }));
    const l1 = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await tap(s.teacherA, s.ctxA.id, l1, c.id, kids[0]!.id);
    await tap(s.teacherA, s.ctxA.id, l1, c.id);
    const again = await cmd(s.teacherA, 'lesson.start', { contextId: s.ctxA.id });
    expect(again.result).toMatchObject({ started: false, lessonId: l1 });
    // Switch to 3-B (own lesson + own counter) and back.
    const lb = await start(s.teacherA, ctxA2.id);
    const cb = await english(s.teacherA, ctxA2.id);
    expect(cb.id).not.toBe(c.id);
    await tap(s.teacherA, ctxA2.id, lb, cb.id);
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ lessonTotal: 2, barValue: 2 });
    expect(await english(s.teacherA, ctxA2.id)).toMatchObject({ lessonTotal: 1 });
  });

  it('individual counts keep going after the bar is full (CNT-10) with levels 0/1/2/3 (CNT-6)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    for (let i = 0; i < 12; i += 1) expect((await tap(s.teacherA, s.ctxA.id, l, c.id, kids[1]!.id)).ok).toBe(true);
    const cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ lessonTotal: 12, barValue: 12, reached: true, crossingSeq: 1, crossingCount: 1 });
    expect(cs.students.find((x: any) => x.studentId === kids[1]!.id)).toMatchObject({ count: 12, level: 3 });
    expect(cs.students.find((x: any) => x.studentId === kids[0]!.id)).toMatchObject({ count: 0, level: 0 });
  });
});

describe('week boundary on the server (D-003, CNT-7)', () => {
  it('a tap at Sunday 23:59 Istanbul counts for that week, one at Monday 00:00 for the next; old weeks stay queryable', async () => {
    await travel({ at: Date.UTC(2026, 10, 15, 20, 0) }); // Sunday 15 Nov 23:00 Istanbul
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    env.clock.t = Date.UTC(2026, 10, 15, 20, 59); // Sunday 23:59
    expect((await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id)).result.studentCount).toBe(1);
    env.clock.t = Date.UTC(2026, 10, 15, 21, 0); // Monday 16 Nov 00:00 Istanbul (still Sunday in UTC)
    // The lesson started on Sunday still accepts queued taps by id (D-043); the tap belongs to the new week.
    const r = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    expect(r.ok).toBe(true);
    expect(r.result.studentCount).toBe(1);
    const rows = env.db.$client.prepare('select local_date d, week_start w from counter_events order by seq').all();
    expect(rows).toEqual([
      { d: '2026-11-15', w: '2026-11-09' },
      { d: '2026-11-16', w: '2026-11-16' },
    ]);
    const hist = await ok(s.teacherA.get(`/api/teacher/counters/${c.id}/history?weeks=2`));
    expect(hist.timezone).toBe('Europe/Istanbul');
    expect(hist.weeks.map((w: any) => [w.weekStart, w.weekEnd, w.counts[kids[0]!.id] ?? 0])).toEqual([
      ['2026-11-16', '2026-11-22', 1],
      ['2026-11-09', '2026-11-15', 1],
    ]);
  });
});

describe('undo and thresholds (CNT-4, CNT-9, CNT-11, D-004)', () => {
  it('voiding below the threshold clears "reached"; crossing again fires once more with the next crossingSeq', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    const fired: boolean[] = [];
    let lastId = '';
    for (let i = 0; i < 10; i += 1) {
      const r = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[i % 4]!.id);
      fired.push(r.result.fired);
      lastId = r.result.eventId;
    }
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired[9]).toBe(true);
    let cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ reached: true, crossingSeq: 1, crossingCount: 1 });
    expect(cs.activeResponse.kind).toBe('message');

    const v = await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l, eventId: lastId });
    expect(v.result).toMatchObject({ alreadyVoided: false, lessonTotal: 9, reached: false });
    cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ barValue: 9, reached: false, crossingSeq: null, crossingCount: 1, activeResponse: { kind: 'message' } });
    // Voiding again (another opId) is a harmless no-op; the event is kept, not deleted (CNT-4).
    const v2 = await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l, eventId: lastId });
    expect(v2.result.alreadyVoided).toBe(true);
    const row = env.db.$client.prepare('select voided_at, voided_by from counter_events where id = ?').get(lastId) as any;
    expect(row.voided_by).toBe(s.ayse.id);

    const again = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    expect(again.result).toMatchObject({ fired: true, reached: true });
    cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ reached: true, crossingSeq: 2, crossingCount: 2 });
    const more = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    expect(more.result.fired).toBe(false);
    const audit = env.db.$client.prepare("select count(*) n from audit_events where action = 'counter.void'").get();
    expect(audit).toEqual({ n: 1 });
  });

  it('the threshold state sent to the classroom never identifies the student who completed the bar (CNT-9)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    let last: Result | null = null;
    for (let i = 0; i < 10; i += 1) last = await tap(s.teacherA, s.ctxA.id, l, c.id, i === 9 ? kids[3]!.id : kids[0]!.id);
    const cs = await english(s.teacherA, s.ctxA.id);
    const { students, ...threshold } = cs;
    const text = JSON.stringify(threshold);
    for (const k of kids) expect(text).not.toContain(k.id);
    expect(text).not.toContain(last!.result.eventId);
    expect(Object.keys(threshold)).not.toContain('eventId');
    // The per-student list has every student, in roster order, nobody singled out.
    expect(students.map((x: any) => Object.keys(x).sort())).toEqual(kids.map(() => ['count', 'level', 'studentId']));
  });

  it('only events of the current lesson of the same class+subject can be undone', async () => {
    const l1 = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    const r = await tap(s.teacherA, s.ctxA.id, l1, c.id, kids[0]!.id);
    await end(s.teacherA, s.ctxA.id, l1);
    await travel({ by: D });
    const l2 = await start(s.teacherA, s.ctxA.id);
    const v = await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l2, eventId: r.result.eventId });
    expect(v.error?.reason).toBe('EVENT_NOT_IN_LESSON');
    const old = await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l1, eventId: r.result.eventId });
    expect(old.error?.reason).toBe('LESSON_ENDED');
  });

  it('class reset only when "Class reset" is the selected response; it keeps the events (D-058)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    for (let i = 0; i < 10; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id, kids[i % 4]!.id);
    const refused = await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id });
    expect(refused.error?.reason).toBe('RESET_NOT_ENABLED');
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { activeResponseId: 'class-reset' }));
    const r = await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id });
    expect(r.ok).toBe(true);
    let cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ lessonTotal: 10, barValue: 0, reached: false, crossingSeq: null, crossingCount: 1 });
    expect(weekly(cs, kids[0]!.id)).toBe(3);
    for (let i = 0; i < 10; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    cs = await english(s.teacherA, s.ctxA.id);
    expect(cs).toMatchObject({ lessonTotal: 20, barValue: 10, reached: true, crossingSeq: 2 });
  });
});

describe('idempotency and access (CNT-5, UX-11, ACC-10, LES-4)', () => {
  it('a replayed tap (same opId) never counts twice, also within one batch', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    const opId = v7();
    const a = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id, opId);
    const b = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id, opId);
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(b).toMatchObject({ ok: true, replayed: true, result: { eventId: opId } });
    const p = { contextId: s.ctxA.id, lessonId: l, counterId: c.id, studentId: kids[1]!.id };
    const op2 = v7();
    const batch = await ok(s.teacherA.post('/api/commands', { commands: [op2, op2, op2].map((o) => ({ opId: o, type: 'counter.tap', payload: p, contextId: s.ctxA.id, lessonId: l })) }));
    expect(batch.results.map((x: any) => x.replayed)).toEqual([false, true, true]);
    const cs = await english(s.teacherA, s.ctxA.id);
    expect(cs.lessonTotal).toBe(2);
    expect(weekly(cs, kids[1]!.id)).toBe(1);
  });

  it('absent students cannot receive taps (CRD-2)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId: l, studentId: kids[2]!.id, status: 'absent' });
    const r = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[2]!.id);
    expect(r).toMatchObject({ ok: false, error: { code: 'CONFLICT', reason: 'STUDENT_ABSENT' } });
    // A lesson-only exception (arrived late) makes the student tappable again.
    await cmd(s.teacherA, 'attendance.setLessonException', { contextId: s.ctxA.id, lessonId: l, studentId: kids[2]!.id, status: 'late' });
    expect((await tap(s.teacherA, s.ctxA.id, l, c.id, kids[2]!.id)).ok).toBe(true);
    // A student of another class is refused too.
    const other = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Deniz Aydın' });
    expect((await tap(s.teacherA, s.ctxA.id, l, c.id, other.id)).error?.reason).toBe('STUDENT_NOT_IN_CLASS');
  });

  it("cannot tap into another class's lesson or with another class's counter", async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    // Another teacher: not their context.
    const foreign = await tap(s.teacherB, s.ctxA.id, l, c.id, kids[0]!.id);
    expect(foreign).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    // Same teacher, other class: the lesson id does not match the context's active lesson.
    const ctxA2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3b.id, subjectId: s.english.id }));
    const lb = await start(s.teacherA, ctxA2.id);
    expect((await tap(s.teacherA, ctxA2.id, l, c.id, kids[0]!.id)).error?.reason).toBe('WRONG_LESSON');
    // Right lesson of 3-B, but 3-A's counter.
    expect((await tap(s.teacherA, ctxA2.id, lb, c.id)).error?.reason).toBe('WRONG_COUNTER');
    // The counters of a context are not visible to another teacher (ACC-10).
    expect((await s.teacherB.get(`/api/teacher/contexts/${s.ctxA.id}/counters`)).status).toBe(403);
    expect((await s.teacherB.get(`/api/teacher/counters/${c.id}/history`)).status).toBe(403);
    expect((await s.teacherB.patch(`/api/teacher/counters/${c.id}`, { barSegments: 5 })).status).toBe(403);
  });

  it('with the Counters module off: no counters in the lesson state, taps refused, data kept (CFG-2)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/counters`, { enabled: false }));
    expect((await state(s.teacherA, s.ctxA.id)).counters).toBeNull();
    expect((await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id)).error?.code).toBe('FEATURE_DISABLED');
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/counters`, { enabled: true }));
    expect((await english(s.teacherA, s.ctxA.id)).lessonTotal).toBe(1);
  });

  it('the polled ETag changes after a tap and after a settings change', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    const e1 = (await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`)).headers.etag as string;
    expect((await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': e1 })).status).toBe(304);
    await tap(s.teacherA, s.ctxA.id, l, c.id);
    const e2 = (await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`)).headers.etag as string;
    expect(e2).not.toBe(e1);
    env.clock.advance(1000);
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { colour: 'teal' }));
    const r = await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': e2 });
    expect(r.status).toBe(200);
    expect(r.body.counters.counters[0].colour).toBe('teal');
  });
});

describe('custom counters and settings (CNT-12, CNT-1, DAT-6)', () => {
  it('custom per-student counter with term reset counts across weeks inside the term; English resets weekly', async () => {
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/terms`, { name: { en: 'Autumn term', tr: 'Güz dönemi' }, startsOn: '2026-09-01', endsOn: '2027-01-22' }));
    const custom = await ok(
      s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/counters`, { name: { en: 'Helping hands', tr: 'Yardım eli' }, scope: 'student', resetPeriod: 'term', colour: 'leaf', thresholds: [3] }),
    );
    expect(custom).toMatchObject({ kind: 'custom', scope: 'student', resetPeriod: 'term', colour: 'leaf', labels: { main: { en: 'Helping hands' }, individual: { tr: 'Yardım eli' } } });
    const l1 = await start(s.teacherA, s.ctxA.id);
    const eng = await english(s.teacherA, s.ctxA.id);
    await tap(s.teacherA, s.ctxA.id, l1, custom.id, kids[0]!.id);
    await tap(s.teacherA, s.ctxA.id, l1, eng.id, kids[0]!.id);
    // A student-only counter needs a student.
    expect((await tap(s.teacherA, s.ctxA.id, l1, custom.id)).error?.reason).toBe('STUDENT_REQUIRED');
    await end(s.teacherA, s.ctxA.id, l1);

    await travel({ by: 8 * D }); // next week, same term
    const l2 = await start(s.teacherA, s.ctxA.id);
    await tap(s.teacherA, s.ctxA.id, l2, custom.id, kids[0]!.id);
    await tap(s.teacherA, s.ctxA.id, l2, custom.id, kids[0]!.id);
    const st = await state(s.teacherA, s.ctxA.id);
    const cc = st.counters.counters.find((x: any) => x.id === custom.id);
    expect(cc.period).toEqual({ from: '2026-09-01', to: '2027-01-22' });
    expect(cc.students.find((x: any) => x.studentId === kids[0]!.id)).toMatchObject({ count: 3, level: 1 });
    expect(cc.reached).toBe(false); // per-student scope: no class bar
    const ce = st.counters.counters.find((x: any) => x.id === eng.id);
    expect(weekly(ce, kids[0]!.id)).toBe(0);
  });

  it('a lesson-only counter takes class taps and refuses student taps', async () => {
    const c = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/counters`, { name: { en: 'Quiet minutes' }, scope: 'lesson', barSegments: 3 }));
    const l = await start(s.teacherA, s.ctxA.id);
    expect((await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id)).error?.reason).toBe('CLASS_ONLY_COUNTER');
    for (let i = 0; i < 3; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id);
    const cs = (await state(s.teacherA, s.ctxA.id)).counters.counters.find((x: any) => x.id === c.id);
    expect(cs).toMatchObject({ barValue: 3, reached: true, students: [], activeResponse: null });
  });

  it('labels, thresholds and responses are editable (EN/TR) without breaking history (snapshots)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    const updated = await ok(
      s.teacherA.patch(`/api/teacher/counters/${c.id}`, {
        labels: { main: { en: 'English only!', tr: 'Sadece İngilizce!' }, supporting: { en: '{count} of {limit}' }, individual: { en: 'Turkish words', tr: 'Türkçe kelimeler' } },
        thresholds: [3, 5],
        responses: [
          { id: 'no-breaktime', label: { en: 'No breaktime' }, message: { en: 'Breaktime is for English today.' }, mascot: false, kind: 'no_breaktime' },
          { label: { en: 'Song time' }, message: { en: 'Let us sing an English song!' }, mascot: true, kind: 'custom' },
        ],
        activeResponseId: 'no-breaktime',
      }),
    );
    expect(updated.labels.main).toEqual({ en: 'English only!', tr: 'Sadece İngilizce!' });
    expect(updated.responses[1].id).toMatch(/^r-/);
    expect(updated.activeResponseId).toBe('no-breaktime');
    await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    const hist = await ok(s.teacherA.get(`/api/teacher/counters/${c.id}/history?weeks=1`));
    expect(hist.weeks[0]).toMatchObject({ weekStart: '2026-11-09', weekEnd: '2026-11-15', lessons: 1, total: 2, voided: 0, classOnly: 0 });
    expect(hist.weeks[0].labelsUsed).toEqual(expect.arrayContaining([{ en: 'Turkish reminders' }, { en: 'Turkish words', tr: 'Türkçe kelimeler' }]));
    expect(hist.counter.labels.individual.en).toBe('Turkish words');
    const cs = await english(s.teacherA, s.ctxA.id);
    expect(cs.students.find((x: any) => x.studentId === kids[0]!.id)).toMatchObject({ count: 2, level: 0 });
    // An unknown active response is refused; removing the active response clears the choice.
    expect((await s.teacherA.patch(`/api/teacher/counters/${c.id}`, { activeResponseId: 'nope' })).body.error.details.reason).toBe('RESPONSE_UNKNOWN');
    const cleared = await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { responses: [{ label: { en: 'Only one' }, message: {}, kind: 'message' }] }));
    expect(cleared.activeResponseId).toBeNull();
    // Invalid thresholds are refused.
    expect((await s.teacherA.patch(`/api/teacher/counters/${c.id}`, { thresholds: [5, 3] })).status).toBe(400);
    const audits = env.db.$client.prepare("select count(*) n from audit_events where action = 'counter.update'").get();
    expect(audits).toEqual({ n: 2 });
  });

  it('lowering the limit mid-lesson opens a crossing right away; raising it clears it (D-004)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    for (let i = 0; i < 4; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id);
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { barSegments: 4 }));
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ reached: true, crossingSeq: 1, barSegments: 4 });
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { barSegments: 6 }));
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ reached: false, crossingSeq: null });
  });

  it('history shows explicit weeks, voided taps, class-only taps and lesson denominators, no scores (RPT-5)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    const t1 = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    await tap(s.teacherA, s.ctxA.id, l, c.id);
    await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l, eventId: t1.result.eventId });
    const hist = await ok(s.teacherA.get(`/api/teacher/counters/${c.id}/history?weeks=3`));
    expect(hist.weeks.map((w: any) => w.weekStart)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26']);
    expect(hist.weeks[0]).toMatchObject({ total: 1, classOnly: 1, voided: 1, lessons: 1, counts: {} });
    expect(hist.weeks[1]).toMatchObject({ total: 0, lessons: 0 });
    expect(hist.students.map((x: any) => x.fullName)).toEqual(['Arda Yıldız', 'Ece Deniz Kaya', 'Işıl Çınar', 'Oliver Clarke']);
    expect(JSON.stringify(hist)).not.toMatch(/score|rank/i);
  });

  it('history returns who was enrolled each week, so "not enrolled" and "no lesson" are not shown as 0 (RPT-5)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    await end(s.teacherA, s.ctxA.id, l);
    // Next week a new student joins the class (enrolled from Monday 16 November).
    await travel({ by: 7 * D });
    const late = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Zeynep Aksoy' });
    const hist = await ok(s.teacherA.get(`/api/teacher/counters/${c.id}/history?weeks=3`));
    expect(hist.weeks.map((w: any) => w.weekStart)).toEqual(['2026-11-16', '2026-11-09', '2026-11-02']);
    const all = kids.map((k) => k.id);
    expect(new Set(hist.weeks[0].enrolled)).toEqual(new Set([...all, late.id]));
    expect(hist.weeks[0].lessons).toBe(0); // no lesson yet this week: "not recorded" for everybody
    expect(new Set(hist.weeks[1].enrolled)).toEqual(new Set(all)); // the new student was not in the class yet
    expect(hist.weeks[1]).toMatchObject({ lessons: 1, counts: { [kids[0]!.id]: 1 } });
    expect(hist.weeks[2].enrolled).toEqual([]); // before anyone was enrolled
    expect(hist.students.map((x: any) => x.id)).toContain(late.id);
  });
});

describe('undo of a class reset (S22a, D-175; CNT-11, UX-9, DAT-1, ACC-10)', () => {
  /** A lesson of 3-A whose English bar is full (10 taps, crossing 1) with "Class reset" chosen, then reset. */
  async function resetFullBar() {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { activeResponseId: 'class-reset' }));
    for (let i = 0; i < 10; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id, kids[i % 4]!.id);
    const resetId = v7();
    const r = await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id }, resetId);
    expect(r.ok).toBe(true);
    return { l, c, resetId };
  }
  const undo = (c: Client, l: string, counterId: string, resetId: string, opId?: string, contextId = s.ctxA.id) =>
    cmd(c, 'counter.undoReset', { contextId, lessonId: l, counterId, resetId }, opId);
  const undoAudits = () => env.db.$client.prepare("select count(*) n from audit_events where action = 'counter.reset_undo'").get();

  it('restores exactly the bar and the open crossing the reset took away, audited, and is idempotent', async () => {
    const { l, c, resetId } = await resetFullBar();
    const before = await english(s.teacherA, s.ctxA.id);
    expect(before).toMatchObject({ lessonTotal: 10, barValue: 0, reached: false, crossingSeq: null, crossingCount: 1 });
    expect(before.resetUndo).toEqual({ resetId, until: env.clock.now() + 10 * 60_000, barValue: 10 });
    const opId = v7();
    const u = await undo(s.teacherA, l, c.id, resetId, opId);
    expect(u).toMatchObject({ ok: true, result: { alreadyUndone: false, lessonTotal: 10, barValue: 10, reached: true } });
    const after = await english(s.teacherA, s.ctxA.id);
    // The same crossing is open again (crossingSeq 1, no new crossing), so nothing fires twice (D-059).
    expect(after).toMatchObject({ lessonTotal: 10, barValue: 10, reached: true, crossingSeq: 1, crossingCount: 1, resetUndo: null });
    expect(weekly(after, kids[0]!.id)).toBe(3);
    const audits = env.db.$client.prepare("select entity_id, op_id from audit_events where action = 'counter.reset_undo'").all();
    expect(audits).toEqual([{ entity_id: c.id, op_id: opId }]);
    // The marker is kept (soft), marked undone.
    expect(env.db.$client.prepare('select undone_at is not null u, undo_op_id o from counter_lesson_resets where id = ?').get(resetId)).toEqual({ u: 1, o: opId });
    // A replay (same opId) and a second Undo (new opId) change nothing.
    expect(await undo(s.teacherA, l, c.id, resetId, opId)).toMatchObject({ ok: true, replayed: true });
    expect(await undo(s.teacherA, l, c.id, resetId)).toMatchObject({ ok: true, result: { alreadyUndone: true, barValue: 10 } });
    expect(undoAudits()).toEqual({ n: 1 });
    // Counting goes on from the restored bar, still inside crossing 1.
    await tap(s.teacherA, s.ctxA.id, l, c.id, kids[0]!.id);
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ lessonTotal: 11, barValue: 11, reached: true, crossingSeq: 1, crossingCount: 1 });
  });

  it('an earlier reset counts again after the later one is undone; a half-full bar comes back without a crossing', async () => {
    const { l, c } = await resetFullBar();
    for (let i = 0; i < 4; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id);
    const second = v7();
    expect((await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id }, second)).ok).toBe(true);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toMatchObject({ resetId: second, barValue: 4 });
    expect((await undo(s.teacherA, l, c.id, second)).ok).toBe(true);
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ lessonTotal: 14, barValue: 4, reached: false, crossingSeq: null, crossingCount: 1, resetUndo: null });
  });

  it('is refused after 10 minutes (the classroom stops offering it)', async () => {
    const { l, c, resetId } = await resetFullBar();
    env.clock.advance(9 * 60_000);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).not.toBeNull();
    env.clock.advance(60_000 + 1);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toBeNull();
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('RESET_UNDO_PASSED');
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ barValue: 0, reached: false });
    expect(undoAudits()).toEqual({ n: 0 });
  });

  it('measures the window from when the teacher confirmed a reset queued offline, not from when it synced (review fix)', async () => {
    const l = await start(s.teacherA, s.ctxA.id);
    const c = await english(s.teacherA, s.ctxA.id);
    await ok(s.teacherA.patch(`/api/teacher/counters/${c.id}`, { activeResponseId: 'class-reset' }));
    for (let i = 0; i < 10; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id, kids[i % 4]!.id);
    // Confirmed offline at T, synced 15 minutes later: the Undo was over at T + 10 min.
    const madeAt = env.clock.now();
    env.clock.advance(15 * 60_000);
    const late = v7();
    expect((await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id, resetAt: madeAt }, late)).ok).toBe(true);
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ barValue: 0, resetUndo: null });
    expect((await undo(s.teacherA, l, c.id, late)).error?.reason).toBe('RESET_UNDO_PASSED');
    expect(undoAudits()).toEqual({ n: 0 });
    // Synced after 4 minutes: 6 minutes are left, not 10.
    for (let i = 0; i < 10; i += 1) await tap(s.teacherA, s.ctxA.id, l, c.id);
    const madeAt2 = env.clock.now();
    env.clock.advance(4 * 60_000);
    const soon = v7();
    expect((await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id, resetAt: madeAt2 }, soon)).ok).toBe(true);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toEqual({ resetId: soon, until: madeAt2 + 10 * 60_000, barValue: 10 });
    // A time from the future (a device clock ahead) is not trusted: the server time counts.
    expect((await undo(s.teacherA, l, c.id, soon)).ok).toBe(true);
    const ahead = v7();
    expect((await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id, resetAt: env.clock.now() + 3600_000 }, ahead)).ok).toBe(true);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toMatchObject({ resetId: ahead, until: env.clock.now() + 10 * 60_000 });
  });

  it('is refused after a later tap or a later tap undo on that counter, and for an older reset', async () => {
    const { l, c, resetId } = await resetFullBar();
    const t = await tap(s.teacherA, s.ctxA.id, l, c.id, kids[1]!.id);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toBeNull();
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('RESET_UNDO_AFTER_TAP');
    // Undoing that tap does not bring the Undo back.
    expect((await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l, eventId: t.result.eventId })).ok).toBe(true);
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('RESET_UNDO_AFTER_TAP');
    expect(await english(s.teacherA, s.ctxA.id)).toMatchObject({ barValue: 0, lessonTotal: 10 });

    // Undoing a tap made BEFORE a reset changes the bar the reset took away, so it ends the Undo too.
    const first = (await tap(s.teacherA, s.ctxA.id, l, c.id)).result.eventId as string;
    const second = v7();
    expect((await cmd(s.teacherA, 'counter.resetLessonBar', { contextId: s.ctxA.id, lessonId: l, counterId: c.id }, second)).ok).toBe(true);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toMatchObject({ resetId: second, barValue: 1 });
    expect((await cmd(s.teacherA, 'counter.void', { contextId: s.ctxA.id, lessonId: l, eventId: first })).ok).toBe(true);
    expect((await english(s.teacherA, s.ctxA.id)).resetUndo).toBeNull();
    expect((await undo(s.teacherA, l, c.id, second)).error?.reason).toBe('RESET_UNDO_AFTER_TAP');
    // The first reset is not the latest one any more.
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('RESET_UNDO_AFTER_TAP');
    expect(undoAudits()).toEqual({ n: 0 });
  });

  it("refuses another teacher's class (403), another lesson's or counter's reset, and an ended lesson", async () => {
    const { l, c, resetId } = await resetFullBar();
    expect(await undo(s.teacherB, l, c.id, resetId)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    // Same teacher, another class+subject: that lesson has no such reset.
    const ctxA2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3b.id, subjectId: s.english.id }));
    const lb = await start(s.teacherA, ctxA2.id);
    const cb = await english(s.teacherA, ctxA2.id);
    expect((await undo(s.teacherA, lb, cb.id, resetId, undefined, ctxA2.id)).error?.reason).toBe('RESET_NOT_IN_LESSON');
    expect((await undo(s.teacherA, lb, c.id, resetId, undefined, ctxA2.id)).error?.reason).toBe('WRONG_COUNTER');
    expect((await undo(s.teacherA, l, c.id, v7())).error?.reason).toBe('RESET_NOT_IN_LESSON');
    await end(s.teacherA, s.ctxA.id, l);
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('LESSON_ENDED');
    expect(undoAudits()).toEqual({ n: 0 });
  });

  it('is refused in an archived school year or class (DAT-1)', async () => {
    const { l, c, resetId } = await resetFullBar();
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`));
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('YEAR_ARCHIVED');
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/unarchive`));
    await ok(s.admin.post(`/api/admin/classes/${s.c3a.id}/archive`));
    expect((await undo(s.teacherA, l, c.id, resetId)).error?.reason).toBe('CLASS_ARCHIVED');
    expect(env.db.$client.prepare('select undone_at from counter_lesson_resets where id = ?').get(resetId)).toEqual({ undone_at: null });
  });
});
