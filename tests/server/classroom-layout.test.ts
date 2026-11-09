/**
 * Classroom board layouts (S14b, D-148; DSH-1, PIN-1, PIN-8, ACC-10) and assistant duty ticks on the
 * Start Lesson screen (D-149; AST-6, LES-1, LES-2). Test clock: Monday 2026-11-09 Europe/Istanbul.
 * Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloneLayout, DEFAULT_LAYOUT } from '../../src/shared/classroomLayout.ts';
import { toDock } from '../../src/domain/classroomLayout.ts';
import { classroomLayouts } from '../../src/server/db/schema.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let ctxA2: { id: string };

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  // A second class+subject of the same teacher (3-B English).
  ctxA2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3b.id, subjectId: s.english.id }));
});
afterEach(async () => env.app.close());

const get = (c: Client, contextId: string) => c.get(`/api/classroom/layout?contextId=${contextId}`);
const save = (c: Client, contextId: string, applyTo: 'class' | 'all', layout: unknown) => c.put('/api/teacher/classroom-layout', { contextId, applyTo, layout });
const reset = (c: Client, contextId: string, applyTo: 'class' | 'all') => c.req('DELETE', '/api/teacher/classroom-layout', { contextId, applyTo });

const counterDocked = toDock(DEFAULT_LAYOUT, 'counters');
const timerFirst = (() => {
  const l = cloneLayout(DEFAULT_LAYOUT);
  l.rows[0]!.boxes.reverse();
  return l;
})();

describe('classroom layout endpoints (D-148)', () => {
  it('reads the default (null) until a layout is saved; validates what is saved (DSH-1)', async () => {
    expect(await ok(get(s.teacherA, s.ctxA.id))).toEqual({ layout: null, source: 'default' });
    const bad = cloneLayout(DEFAULT_LAYOUT);
    bad.rows[0]!.boxes[0]!.w = 7; // widths no longer add up to 12
    const r = await save(s.teacherA, s.ctxA.id, 'class', bad);
    expect(r.status).toBe(400);
    expect(r.body.error.details.reason).toBe('INVALID_LAYOUT');
    expect(r.body.error.details.issues).toContain('ROW_WIDTHS:0');
    expect((await save(s.teacherA, s.ctxA.id, 'class', { version: 1, rows: 'x', dock: [] })).status).toBe(400);
    expect((await save(s.teacherA, s.ctxA.id, 'class', { ...DEFAULT_LAYOUT, rows: [...DEFAULT_LAYOUT.rows], dock: ['nonsense'] })).status).toBe(400);
    expect(await ok(save(s.teacherA, s.ctxA.id, 'class', counterDocked))).toEqual({ layout: counterDocked, source: 'class' });
    expect(await ok(get(s.teacherA, s.ctxA.id))).toEqual({ layout: counterDocked, source: 'class' });
  });

  it('a class layout wins over "all my classes"; saving for all classes replaces the per-class ones; reset by scope', async () => {
    await ok(save(s.teacherA, s.ctxA.id, 'class', counterDocked));
    expect((await ok(get(s.teacherA, ctxA2.id))).source).toBe('default');
    await ok(save(s.teacherA, ctxA2.id, 'class', timerFirst));
    // "All my classes": every class shows it, the per-class layouts are forgotten.
    expect(await ok(save(s.teacherA, s.ctxA.id, 'all', DEFAULT_LAYOUT))).toEqual({ layout: DEFAULT_LAYOUT, source: 'all' });
    expect(await ok(get(s.teacherA, ctxA2.id))).toEqual({ layout: DEFAULT_LAYOUT, source: 'all' });
    await ok(save(s.teacherA, ctxA2.id, 'class', timerFirst));
    expect((await ok(get(s.teacherA, ctxA2.id))).source).toBe('class');
    expect((await ok(get(s.teacherA, s.ctxA.id))).source).toBe('all');
    // Reset this class: back to "all classes"; reset all: back to the default everywhere.
    expect((await ok(reset(s.teacherA, ctxA2.id, 'class'))).source).toBe('all');
    await ok(save(s.teacherA, ctxA2.id, 'class', timerFirst));
    expect(await ok(reset(s.teacherA, s.ctxA.id, 'all'))).toEqual({ layout: null, source: 'default' });
    expect((await ok(get(s.teacherA, ctxA2.id))).source).toBe('default');
  });

  it('is personal: another teacher neither reads nor writes it (ACC-10), and it is not audited (a display preference)', async () => {
    await ok(save(s.teacherA, s.ctxA.id, 'class', counterDocked));
    expect((await get(s.teacherB, s.ctxA.id)).status).toBe(403);
    expect((await save(s.teacherB, s.ctxA.id, 'class', DEFAULT_LAYOUT)).status).toBe(403);
    expect((await reset(s.teacherB, s.ctxA.id, 'all')).status).toBe(403);
    // Teacher B's own "all" layout does not touch teacher A's.
    await ok(save(s.teacherB, s.ctxB.id, 'all', timerFirst));
    expect((await ok(get(s.teacherA, s.ctxA.id))).layout).toEqual(counterDocked);
    const audits = env.db.$client.prepare("select count(*) n from audit_events where action like '%layout%'").get() as { n: number };
    expect(audits.n).toBe(0);
  });

  it('a stored layout that is no longer valid is not served: the board falls back to the next one or the default', async () => {
    await ok(save(s.teacherA, s.ctxA.id, 'all', timerFirst));
    await ok(save(s.teacherA, s.ctxA.id, 'class', counterDocked));
    env.db.update(classroomLayouts).set({ layoutJson: { version: 1, rows: [], dock: [] } }).run();
    expect(await ok(get(s.teacherA, s.ctxA.id))).toEqual({ layout: null, source: 'default' });
    await ok(save(s.teacherA, s.ctxA.id, 'all', timerFirst));
    expect(await ok(get(s.teacherA, s.ctxA.id))).toEqual({ layout: timerFirst, source: 'all' });
  });

  it('the classroom display reads it while locked (ETag, 304); saving and resetting answer 423 until the PIN is typed (PIN-1, PIN-8)', async () => {
    expect((await s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await s.teacherA.post('/api/classroom/enter')).status).toBe(200);
    const first = await get(s.teacherA, s.ctxA.id);
    expect(first.status).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"layout\./u);
    expect((await s.teacherA.req('GET', `/api/classroom/layout?contextId=${s.ctxA.id}`, undefined, { 'if-none-match': etag })).status).toBe(304);
    expect((await save(s.teacherA, s.ctxA.id, 'class', counterDocked)).status).toBe(423);
    expect((await reset(s.teacherA, s.ctxA.id, 'class')).status).toBe(423);
    expect((await s.teacherA.post('/api/auth/pin/unlock', { pin: '2468' })).status).toBe(200);
    await ok(save(s.teacherA, s.ctxA.id, 'class', counterDocked));
    // The editor locks again after saving (client `lockNow`): the next teacher-area call is refused.
    expect((await s.teacherA.post('/api/auth/lock')).status).toBe(200);
    expect((await save(s.teacherA, s.ctxA.id, 'class', DEFAULT_LAYOUT)).status).toBe(423);
    const changed = await get(s.teacherA, s.ctxA.id);
    expect(changed.headers.etag).not.toBe(etag);
    expect(changed.body.layout).toEqual(counterDocked);
  });
});

describe('assistant duty ticks on the Start Lesson screen (D-149, AST-6)', () => {
  const ctx = () => s.ctxA.id as string;
  let kids: Array<{ id: string; fullName: string }>;
  beforeEach(async () => {
    kids = [];
    for (const fullName of ['Ada Yılmaz', 'Barış Kaya', 'Cem Demir', 'Deniz Şahin']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
    await ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/assistant/plan`, {}));
  });
  const today = () => ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/assistant/today`));

  it('ticks sent with lesson.start are recorded for today\'s assistant; a replay changes nothing', async () => {
    const t = await today();
    const [r1, r2] = t.responsibilities;
    const steps = { assistant: { studentId: t.assistant.id, check: [r1.id, r2.id], uncheck: [] } };
    const r = await cmd(s.teacherA, 'lesson.start', { contextId: ctx(), othersPresent: true, steps });
    expect(r.ok).toBe(true);
    expect(r.result.dutiesDropped).toBeUndefined();
    expect((await today()).checked.sort()).toEqual([r1.id, r2.id].sort());
    const replay = await cmd(s.teacherA, 'lesson.start', { contextId: ctx(), othersPresent: true, steps }, { opId: r.opId });
    expect(replay.replayed).toBe(true);
    expect(env.db.$client.prepare('select count(*) n from assistant_duty_checks').get()).toEqual({ n: 2 });
    const audits = env.db.$client.prepare("select count(*) n from audit_events where action = 'assistant.duty_check'").get() as { n: number };
    expect(audits.n).toBe(2);
    await endLesson(s.teacherA, ctx(), r.result.lessonId);
  });

  it('on a resumed lesson the ticks still apply (per-day data, LES-2); unticking from the start screen works', async () => {
    const t = await today();
    const [r1] = t.responsibilities;
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true, steps: { assistant: { studentId: t.assistant.id, check: [r1.id] } } });
    const again = await cmd(s.teacherA, 'lesson.start', { contextId: ctx(), steps: { assistant: { studentId: t.assistant.id, check: [], uncheck: [r1.id] } } });
    expect(again.result).toMatchObject({ started: false, reason: 'LESSON_ALREADY_ACTIVE', lessonId });
    expect((await today()).checked).toEqual([]);
    await endLesson(s.teacherA, ctx(), lessonId);
  });

  it('when the start-screen attendance moves the turn to another student, the ticks are dropped and counted', async () => {
    const t = await today();
    const [r1, r2] = t.responsibilities;
    const r = await cmd(s.teacherA, 'lesson.start', {
      contextId: ctx(),
      othersPresent: true,
      attendance: [{ studentId: t.assistant.id, status: 'absent', expected: null }],
      steps: { assistant: { studentId: t.assistant.id, check: [r1.id, r2.id] } },
    });
    expect(r.ok).toBe(true);
    expect(r.result.dutiesDropped).toBe(2);
    const after = await today();
    expect(after.assistant?.id).not.toBe(t.assistant.id);
    expect(after.checked).toEqual([]);
    await endLesson(s.teacherA, ctx(), r.result.lessonId);
  });

  it('module off: the step does not run; an input the schema refuses fails the start with START_STEP_INVALID', async () => {
    const t = await today();
    const [r1] = t.responsibilities;
    const bad = await cmd(s.teacherA, 'lesson.start', { contextId: ctx(), steps: { assistant: { studentId: 42 } } });
    expect(bad.ok).toBe(false);
    expect(bad.error?.reason).toBe('START_STEP_INVALID');
    const mods = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/modules`));
    const m = mods.modules.find((x: any) => x.module === 'assistant');
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/assistant`, { enabled: false, config: m.config }));
    const lessonId = await startLesson(s.teacherA, ctx(), { othersPresent: true, steps: { assistant: { studentId: t.assistant.id, check: [r1.id] } } });
    expect(env.db.$client.prepare('select count(*) n from assistant_duty_checks').get()).toEqual({ n: 0 });
    await endLesson(s.teacherA, ctx(), lessonId);
  });

  it('two modules merge their parts of the one lesson.start: attendance and duty ticks together', async () => {
    const t = await today();
    const [r1] = t.responsibilities;
    const other = kids.find((k) => k.id !== t.assistant.id)!;
    const lessonId = await startLesson(s.teacherA, ctx(), {
      othersPresent: true,
      attendance: [{ studentId: other.id, status: 'late', expected: null }],
      steps: { assistant: { studentId: t.assistant.id, check: [r1.id] } },
    });
    expect((await today()).checked).toEqual([r1.id]);
    const roster = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/roster?lessonId=${lessonId}`));
    expect(roster.students.find((x: any) => x.id === other.id).daily).toBe('late');
    await endLesson(s.teacherA, ctx(), lessonId);
  });
});
