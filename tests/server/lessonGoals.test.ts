/**
 * Lesson goals (S25d, D-188): opt-in per class+subject (off by default, CFG-1), the goal set at Start
 * Lesson (LES-1) or on the board ('lessonGoals.set', LES-4), shown in the polled lesson state (DSH-4),
 * reviewed at End Lesson only when the lesson has one (LES-3), audited, kept when the module is
 * switched off (CFG-2) and listed in the reports with denominators (RPT-1, RPT-5). Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { auditEvents } from '../../src/server/db/schema.ts';
import { isModuleEnabled } from '../../src/server/modules/school/modules.ts';
import { SERVER_MODULES } from '../../src/server/modules/index.ts';
import { CONTEXT_MODULES, contextDefaultOn } from '../../src/shared/modules.ts';
import type { Client } from '../helpers.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız']) await addStudent(s.teacherA, s.c3a.id, { fullName });
});
afterEach(async () => env.app.close());

async function cmd(c: Client, type: string, payload: Record<string, unknown>, meta: { opId?: string } = {}) {
  const opId = meta.opId ?? v7();
  const r = await ok(c.post('/api/commands', { commands: [{ opId, type, payload, contextId: payload.contextId, lessonId: payload.lessonId }] }));
  return r.results[0] as { ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };
}

async function start(c: Client, contextId: string, extra: Record<string, unknown> = {}) {
  const r = await cmd(c, 'lesson.start', { contextId, ...extra });
  expect(r.ok).toBe(true);
  return r.result.lessonId as string;
}

const state = (c: Client, contextId: string) => ok(c.get(`/api/classroom/contexts/${contextId}/lesson`));
const switchOn = (on = true) => ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/lessonGoals`, { enabled: on }));
const auditOf = (action: string) => env.db.select().from(auditEvents).all().filter((a) => a.action === action);

describe('opt-in per class+subject (CFG-1, D-188)', () => {
  it('is a context module that is off in every class+subject until its teacher turns it on', async () => {
    expect(CONTEXT_MODULES).toContain('lessonGoals');
    expect(SERVER_MODULES.find((m) => m.key === 'lessonGoals')?.policyKey).toBe('lessonGoals');
    expect(contextDefaultOn('lessonGoals')).toBe(false);
    expect(contextDefaultOn('routines')).toBe(true);
    expect(isModuleEnabled(env.db, s.ctxA.id, 'lessonGoals')).toBe(false);
    const ctx = (await ok(s.teacherA.get('/api/teacher/contexts'))).contexts[0];
    expect(ctx.modules.lessonGoals).toBe(false);
    const states = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/modules`));
    expect(states.modules.find((m: any) => m.module === 'lessonGoals')).toMatchObject({ available: true, enabled: false, effective: false });

    await switchOn();
    expect(isModuleEnabled(env.db, s.ctxA.id, 'lessonGoals')).toBe(true);
    // Only that class+subject: the other teacher's class stays off.
    expect(isModuleEnabled(env.db, s.ctxB.id, 'lessonGoals')).toBe(false);
  });

  it('while off: no goal in the lesson state, the start step input is ignored, the command is refused, no review step', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id, { steps: { lessonGoal: { text: 'We can name ten animals.' } } });
    const st = await state(s.teacherA, s.ctxA.id);
    expect(st.lessonGoal).toBeNull();
    expect(st.lesson.endSteps).not.toContain('lessonGoal');
    const r = await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: 'We can count to twenty.' });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('FEATURE_DISABLED');
    expect(auditOf('lesson_goal.set')).toHaveLength(0);
  });
});

describe('a lesson with a goal (LES-1, LES-3, DSH-4)', () => {
  beforeEach(async () => {
    await switchOn();
  });

  it('starts with the goal typed on the start screen, shows it to the board and reviews it at the end', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id, { othersPresent: true, steps: { lessonGoal: { text: '  We can ask and answer about the weather.  ' } } });
    const st = await state(s.teacherA, s.ctxA.id);
    expect(st.lessonGoal).toEqual({ text: 'We can ask and answer about the weather.', outcome: null });
    // The review step comes before the core reflection (LES-3).
    expect(st.lesson.endSteps.slice(-2)).toEqual(['lessonGoal', 'reflection']);
    expect(auditOf('lesson_goal.set')).toHaveLength(1);

    const end = await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId, steps: { lessonGoal: { outcome: 'partly' }, reflection: { rating: 3, note: null } } });
    expect(end.ok).toBe(true);
    const review = auditOf('lesson_goal.review');
    expect(review).toHaveLength(1);
    expect(JSON.parse(review[0]!.afterJson!)).toEqual({ outcome: 'partly' });
  });

  it('without a goal: the board offers to set one, and End Lesson has no review step', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id);
    const st = await state(s.teacherA, s.ctxA.id);
    expect(st.lessonGoal).toEqual({ text: null, outcome: null });
    expect(st.lesson.endSteps).not.toContain('lessonGoal');
    // An outcome sent anyway is ignored (there is nothing to review).
    expect((await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId, steps: { lessonGoal: { outcome: 'reached' } } })).ok).toBe(true);
    expect(auditOf('lesson_goal.review')).toHaveLength(0);
  });

  it('sets, changes and clears the goal during the lesson; the ETag follows; a replayed command is applied once', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id);
    const first = await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`);
    const etag = first.headers?.etag as string | undefined;

    const opId = v7();
    expect((await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: 'We can spell five colours.' }, { opId })).ok).toBe(true);
    const replay = await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: 'We can spell five colours.' }, { opId });
    expect(replay.replayed).toBe(true);
    expect(auditOf('lesson_goal.set')).toHaveLength(1);
    const st = await state(s.teacherA, s.ctxA.id);
    expect(st.lessonGoal.text).toBe('We can spell five colours.');
    expect(st.lesson.endSteps).toContain('lessonGoal');
    // The polled state's ETag changed with the goal (no 304 for the old one).
    expect(etag).toBeTruthy();
    const again = await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': etag! });
    expect(again.status).toBe(200);
    const same = await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': again.headers.etag as string });
    expect(same.status).toBe(304);

    expect((await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: 'We can spell six colours.' })).ok).toBe(true);
    expect((await state(s.teacherA, s.ctxA.id)).lessonGoal.text).toBe('We can spell six colours.');
    // The same text again changes nothing and writes no audit row.
    expect((await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: 'We can spell six colours.' })).result).toMatchObject({ changed: false });
    expect((await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: '' })).ok).toBe(true);
    expect((await state(s.teacherA, s.ctxA.id)).lessonGoal).toEqual({ text: null, outcome: null });
    const sets = auditOf('lesson_goal.set');
    expect(sets).toHaveLength(3);
    expect(JSON.parse(sets[2]!.afterJson ?? 'null')).toBeNull();
  });

  it('refuses a goal that is too long, a goal for another lesson and a goal from another teacher (LES-4)', async () => {
    const lessonId = await start(s.teacherA, s.ctxA.id);
    const long = await s.teacherA.post('/api/commands', { commands: [{ opId: v7(), type: 'lessonGoals.set', payload: { contextId: s.ctxA.id, lessonId, text: 'x'.repeat(141) } }] });
    const longResult = long.status === 200 ? long.body.results[0] : null;
    expect(longResult === null || longResult.ok === false).toBe(true);
    const wrong = await cmd(s.teacherA, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId: v7(), text: 'We can read a short story.' });
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.reason).toBe('WRONG_LESSON');
    const other = await cmd(s.teacherB, 'lessonGoals.set', { contextId: s.ctxA.id, lessonId, text: 'We can read a short story.' });
    expect(other.ok).toBe(false);
    expect((await state(s.teacherA, s.ctxA.id)).lessonGoal.text).toBeNull();
  });

  it('a start that resumes the running lesson keeps its goal', async () => {
    await start(s.teacherA, s.ctxA.id, { steps: { lessonGoal: { text: 'We can say the days of the week.' } } });
    const again = await cmd(s.teacherA, 'lesson.start', { contextId: s.ctxA.id, steps: { lessonGoal: { text: 'Something else.' } } });
    expect(again.result).toMatchObject({ started: false, reason: 'LESSON_ALREADY_ACTIVE' });
    expect((await state(s.teacherA, s.ctxA.id)).lessonGoal.text).toBe('We can say the days of the week.');
  });
});

describe('reports (RPT-1, RPT-5) and switching off (CFG-2)', () => {
  it('lists each lesson goal with its answer; an unanswered goal is "not recorded", never "not yet"; kept after switching off', async () => {
    await switchOn();
    const l1 = await start(s.teacherA, s.ctxA.id, { steps: { lessonGoal: { text: 'We can ask for a pencil politely.' } } });
    expect((await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: l1, steps: { lessonGoal: { outcome: 'reached' } } })).ok).toBe(true);
    env.clock.advance(60 * 60 * 1000);
    const l2 = await start(s.teacherA, s.ctxA.id, { steps: { lessonGoal: { text: 'We can describe our classroom.' } } });
    expect((await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: l2, steps: {} })).ok).toBe(true);
    env.clock.advance(60 * 60 * 1000);
    const l3 = await start(s.teacherA, s.ctxA.id);
    expect((await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: l3, steps: {} })).ok).toBe(true);

    const report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report`));
    const sec = report.sections.find((x: any) => x.key === 'lessonGoals');
    expect(sec).toBeTruthy();
    const metric = (k: string) => sec.metrics.find((m: any) => m.key === k).cell;
    expect(metric('withGoal')).toEqual({ t: 'n', v: 2, d: 3 });
    expect(metric('reviewed')).toEqual({ t: 'n', v: 1, d: 2 });
    expect(metric('reached')).toEqual({ t: 'n', v: 1, d: 1 });
    const lessonsTable = sec.tables.find((t: any) => t.key === 'lessons');
    expect(lessonsTable.rows.map((r: any) => r.key)).toEqual([l1, l2]);
    expect(lessonsTable.rows[0].cells[1]).toEqual({ t: 'label', v: { raw: 'We can ask for a pencil politely.' } });
    expect(lessonsTable.rows[0].cells[2]).toEqual({ t: 'label', v: { k: 'lessonGoals.outcome.reached' } });
    expect(lessonsTable.rows[1].cells[2]).toEqual({ t: 'nr' });
    const outcomes = sec.tables.find((t: any) => t.key === 'outcomes');
    expect(outcomes.rows.find((r: any) => r.key === 'notYet').cells[1]).toEqual({ t: 'n', v: 0, d: 1 });

    // Administrators see the section too (the goal is what the class saw, not a private note).
    const admin = await ok(s.admin.get(`/api/admin/contexts/${s.ctxA.id}/report`));
    expect(admin.sections.some((x: any) => x.key === 'lessonGoals')).toBe(true);

    // CFG-2: switching the module off hides the section but keeps the data; on again, it is back.
    await switchOn(false);
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report`))).sections.some((x: any) => x.key === 'lessonGoals')).toBe(false);
    await switchOn(true);
    expect((await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report`))).sections.find((x: any) => x.key === 'lessonGoals').tables.find((t: any) => t.key === 'lessons').rows).toHaveLength(2);
  });
});
