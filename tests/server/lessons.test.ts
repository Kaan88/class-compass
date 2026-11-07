/**
 * Lesson lifecycle, routines and attendance (S5): LES-1..4, DSH-2, RTN-1..3, ATT-1/2, ACC-8/9,
 * CFG-1/2, UX-11. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { DEFAULT_ROUTINE_ID } from '../../src/domain/routines.ts';
import type { Client } from '../helpers.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let studentsA: Array<{ id: string; fullName: string }>;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  studentsA = [];
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız', 'Işıl Çınar', 'Oliver Clarke']) studentsA.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

async function cmd(c: Client, type: string, payload: unknown, meta: { opId?: string; lessonId?: string; contextId?: string } = {}) {
  const { opId = v7(), ...rest } = meta;
  const r = await ok(c.post('/api/commands', { commands: [{ opId, type, payload, ...rest }] }));
  return r.results[0] as { ok: boolean; replayed: boolean; result?: any; error?: { code: string; reason?: string } };
}

async function start(c: Client, contextId: string, extra: Record<string, unknown> = {}) {
  const opId = v7();
  const r = await cmd(c, 'lesson.start', { contextId, ...extra }, { opId, contextId });
  expect(r.ok).toBe(true);
  return r.result as { started: boolean; lessonId: string; reason?: string };
}

const state = (c: Client, contextId: string) => ok(c.get(`/api/classroom/contexts/${contextId}/lesson`));
const roster = (c: Client, contextId: string, lessonId?: string) => ok(c.get(`/api/classroom/contexts/${contextId}/roster${lessonId ? `?lessonId=${lessonId}` : ''}`));

describe('start and resume (LES-1, LES-2)', () => {
  it('starts a lesson with the default routine; refresh and a second start resume it instead of creating another', async () => {
    const before = await state(s.teacherA, s.ctxA.id);
    expect(before.lesson).toBeNull();
    expect(before.today).toEqual({ localDate: '2026-11-09', weekday: 1, timezone: 'Europe/Istanbul' });

    const first = await start(s.teacherA, s.ctxA.id);
    expect(first.started).toBe(true);
    const st = await state(s.teacherA, s.ctxA.id);
    expect(st.lesson).toMatchObject({ id: first.lessonId, status: 'active', stageIndex: 0, className: '3-A', subjectName: { en: 'English' }, localDate: '2026-11-09' });
    expect(st.lesson.routine.templateId).toBe(DEFAULT_ROUTINE_ID);
    expect(st.lesson.routine.stages.map((x: any) => x.name.en)).toEqual(['Greeting', 'Date and weather', 'Assistant', 'Learning goal', 'Activities', 'Reflection']); // RTN-1
    expect(st.lesson.routine.stages[2].name.tr).toBe('Günün yardımcısı');

    // "Refresh": the same state comes back, nothing new is created.
    expect((await state(s.teacherA, s.ctxA.id)).lesson.id).toBe(first.lessonId);

    // A second start with ANOTHER opId (second device, double tap) returns the running lesson.
    const second = await start(s.teacherA, s.ctxA.id);
    expect(second).toEqual({ started: false, reason: 'LESSON_ALREADY_ACTIVE', lessonId: first.lessonId, attendanceKept: 0 });
    const active = await ok(s.teacherA.get('/api/classroom/lessons/active'));
    expect(active.lessons).toHaveLength(1);
    expect(env.db.$client.prepare("select count(*) n from lessons where context_id = ?").get(s.ctxA.id)).toEqual({ n: 1 });
  });

  it('replays the same start opId without effect (UX-11)', async () => {
    const opId = v7();
    const a = await cmd(s.teacherA, 'lesson.start', { contextId: s.ctxA.id }, { opId });
    const b = await cmd(s.teacherA, 'lesson.start', { contextId: s.ctxA.id }, { opId });
    expect(a).toMatchObject({ ok: true, replayed: false, result: { started: true, lessonId: opId } });
    expect(b).toMatchObject({ ok: true, replayed: true, result: { started: true, lessonId: opId } });
  });

  it('applies the attendance confirmed on the start screen as daily attendance (LES-1)', async () => {
    const r = await start(s.teacherA, s.ctxA.id, {
      attendance: studentsA.map((x, i) => ({ studentId: x.id, status: i === 1 ? 'absent' : 'present' })),
    });
    const ro = await roster(s.teacherA, s.ctxA.id, r.lessonId);
    expect(ro.attendanceEnabled).toBe(true);
    expect(ro.students.map((x: any) => x.effective).sort()).toEqual(['absent', 'present', 'present', 'present']);
    // Classroom roster never carries notes.
    expect(JSON.stringify(ro)).not.toContain('note');
  });

  it('a second start (another opId) still records the attendance confirmed on its start screen (LES-1, UX-11, review fix)', async () => {
    const first = await start(s.teacherA, s.ctxA.id);
    const kid = studentsA[2]!;
    const second = await start(s.teacherA, s.ctxA.id, { attendance: [{ studentId: kid.id, status: 'absent', expected: null }], othersPresent: true });
    expect(second).toEqual({ started: false, reason: 'LESSON_ALREADY_ACTIVE', lessonId: first.lessonId, attendanceKept: 0 });
    const ro = await roster(s.teacherA, s.ctxA.id, first.lessonId);
    expect(ro.students.find((x: any) => x.id === kid.id)).toMatchObject({ daily: 'absent', effective: 'absent' });
    expect(ro.students.filter((x: any) => x.effective === 'present')).toHaveLength(3);
  });

  it("never silently overwrites a colleague's newer daily record from a stale start screen (ACC-8, review fix)", async () => {
    await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.maths.id }));
    const [x, y, z] = studentsA;
    // Ayşe's start screen loaded while nobody had a record. Meanwhile Mehmet records X absent, Y late.
    await ok(s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: x!.id, status: 'absent' }));
    await ok(s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: y!.id, status: 'late' }));
    // She never touched X (only the default "present" applies) but tapped Y to excused and Z to absent.
    const r = await start(s.teacherA, s.ctxA.id, {
      attendance: [
        { studentId: y!.id, status: 'excused', expected: null },
        { studentId: z!.id, status: 'absent', expected: null },
      ],
      othersPresent: true,
    });
    expect(r).toMatchObject({ started: true, attendanceKept: 1 });
    const ro = await roster(s.teacherA, s.ctxA.id, r.lessonId);
    const by = (id: string) => ro.students.find((k: any) => k.id === id).daily;
    expect(by(x!.id)).toBe('absent'); // untouched: Mehmet's record stays
    expect(by(y!.id)).toBe('late'); // changed since the screen loaded: kept, reported
    expect(by(z!.id)).toBe('absent');
    expect(by(studentsA[3]!.id)).toBe('present'); // no record: default present
  });

  it('only the owner of the context can start or read its lesson (ACC-10)', async () => {
    const r = await cmd(s.teacherB, 'lesson.start', { contextId: s.ctxA.id });
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect((await s.teacherB.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`)).status).toBe(403);
  });
});

describe('class switching (LES-4)', () => {
  it('rejects queued commands that name another lesson with WRONG_LESSON, and ended lessons with LESSON_ENDED', async () => {
    // Ayşe also teaches English in 3-B.
    const ctxA2 = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.ayse.id, classId: s.c3b.id, subjectId: s.english.id }));
    const a = await start(s.teacherA, s.ctxA.id);
    const b = await start(s.teacherA, ctxA2.id);

    // A tap queued while 3-A was on screen, replayed after switching: names 3-A's lesson but 3-B's context.
    const wrong = await cmd(s.teacherA, 'lesson.setStage', { contextId: ctxA2.id, lessonId: a.lessonId, stageIndex: 1 }, { contextId: ctxA2.id, lessonId: a.lessonId });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'CONFLICT', reason: 'WRONG_LESSON' } });
    // Envelope meta that disagrees with the payload is refused too.
    const meta = await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId: a.lessonId, stageIndex: 1 }, { contextId: ctxA2.id, lessonId: b.lessonId });
    expect(meta.error?.reason).toBe('WRONG_LESSON');
    // Attendance taps too.
    const att = await cmd(s.teacherA, 'attendance.setDaily', { contextId: ctxA2.id, lessonId: a.lessonId, studentId: studentsA[0]!.id, status: 'absent' });
    expect(att.error?.reason).toBe('WRONG_LESSON');

    // Each class keeps its own state.
    expect((await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId: a.lessonId, stageIndex: 3 })).ok).toBe(true);
    expect((await state(s.teacherA, s.ctxA.id)).lesson.stageIndex).toBe(3);
    expect((await state(s.teacherA, ctxA2.id)).lesson.stageIndex).toBe(0);
    const active = await ok(s.teacherA.get('/api/classroom/lessons/active'));
    expect(active.lessons.map((l: any) => l.contextId).sort()).toEqual([s.ctxA.id, ctxA2.id].sort());

    // After the lesson ends, a late tap for it is refused, never applied to the next lesson.
    expect((await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: a.lessonId, steps: {} })).ok).toBe(true);
    const late = await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId: a.lessonId, stageIndex: 1 });
    expect(late.error?.reason).toBe('LESSON_ENDED');
    const next = await start(s.teacherA, s.ctxA.id);
    expect(next.started).toBe(true);
    expect((await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId: a.lessonId, stageIndex: 1 })).error?.reason).toBe('LESSON_ENDED');
    expect((await state(s.teacherA, s.ctxA.id)).lesson.stageIndex).toBe(0);
  });
});

describe('polling (LES-2, DSH)', () => {
  it('answers 304 to an unchanged ETag and a new ETag after any lesson or attendance change', async () => {
    const empty = await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`);
    const etag0 = empty.headers.etag as string;
    expect(etag0).toBeTruthy();
    expect((await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': etag0 })).status).toBe(304);

    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const r1 = await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': etag0 });
    expect(r1.status).toBe(200);
    const etag1 = r1.headers.etag as string;
    expect((await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': etag1 })).status).toBe(304);

    await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId, stageIndex: 1 });
    const r2 = await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': etag1 });
    expect(r2.status).toBe(200);
    expect(r2.body.lesson.version).toBe(2);
    const etag2 = r2.headers.etag as string;

    // Another teacher of the class changes shared daily attendance: the ETag changes (ACC-8).
    await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.maths.id }));
    await ok(s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: studentsA[0]!.id, status: 'late' }));
    expect((await s.teacherA.req('GET', `/api/classroom/contexts/${s.ctxA.id}/lesson`, undefined, { 'if-none-match': etag2 })).status).toBe(200);
  });
});

describe('attendance (ACC-8, ACC-9, ATT-2)', () => {
  it('shares daily attendance between the teachers of a class and audits every change with its actor', async () => {
    const ctxM = await ok(s.admin.post('/api/admin/teaching-contexts', { teacherId: s.mehmet.id, classId: s.c3a.id, subjectId: s.maths.id }));
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const kid = studentsA[1]!;
    expect((await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId, studentId: kid.id, status: 'absent' })).ok).toBe(true);

    // Mehmet (Mathematics in 3-A) sees the same daily status in his own lesson.
    const m = await start(s.teacherB, ctxM.id);
    const mr = await roster(s.teacherB, ctxM.id, m.lessonId);
    expect(mr.students.find((x: any) => x.id === kid.id)).toMatchObject({ daily: 'absent', effective: 'absent' });

    // He corrects it to late; Ayşe's lesson sees the correction.
    expect((await cmd(s.teacherB, 'attendance.setDaily', { contextId: ctxM.id, lessonId: m.lessonId, studentId: kid.id, status: 'late' })).ok).toBe(true);
    expect((await roster(s.teacherA, s.ctxA.id, lessonId)).students.find((x: any) => x.id === kid.id).effective).toBe('late');

    // Who changed what (ACC-9): audit actors and the teacher-area change log.
    const rows = env.db.$client.prepare("select actor_id, before_json, after_json from audit_events where entity = 'attendance_daily' order by at, rowid").all() as any[];
    expect(rows.map((r) => r.actor_id)).toEqual([s.ayse.id, s.mehmet.id]);
    expect(JSON.parse(rows[1].before_json).status).toBe('absent');
    const hist = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/attendance/history?date=2026-11-09`));
    expect(hist.changes.map((c: any) => [c.actorName, c.studentName, c.before, c.after])).toEqual([
      ['Test mehmet.teacher', 'Arda Yıldız', 'absent', 'late'],
      ['Test ayse.teacher', 'Arda Yıldız', null, 'absent'],
    ]);
    expect(hist.days[0]).toMatchObject({ date: '2026-11-09', late: 1, not_recorded: 3 });

    // The teacher-area view shows who recorded it.
    const day = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/attendance?date=2026-11-09`));
    expect(day.students.find((x: any) => x.studentId === kid.id)).toMatchObject({ status: 'late', recordedByName: 'Test mehmet.teacher' });
    // Only her own lessons are listed (lesson records are context-owned, ACC-10).
    expect(day.lessons.map((l: any) => l.id)).toEqual([lessonId]);
  });

  it('effective attendance = lesson exception › daily › not recorded (ATT-2)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const k1 = studentsA[0]!;
    const k2 = studentsA[1]!;
    const eff = async (id: string) => (await roster(s.teacherA, s.ctxA.id, lessonId)).students.find((x: any) => x.id === id);
    expect(await eff(k1.id)).toMatchObject({ daily: null, exception: null, effective: 'not_recorded' });

    await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId, studentId: k1.id, status: 'absent' });
    expect((await eff(k1.id)).effective).toBe('absent');
    // Came back for this lesson only.
    await cmd(s.teacherA, 'attendance.setLessonException', { contextId: s.ctxA.id, lessonId, studentId: k1.id, status: 'present' });
    expect(await eff(k1.id)).toMatchObject({ daily: 'absent', exception: 'present', effective: 'present' });
    // The day stays "absent" for other lessons.
    const day = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/attendance?date=2026-11-09`));
    expect(day.students.find((x: any) => x.studentId === k1.id).status).toBe('absent');
    expect(day.lessons[0].exceptions).toEqual([{ studentId: k1.id, status: 'present', note: null }]);
    // Clearing the exception falls back to the daily status.
    await cmd(s.teacherA, 'attendance.setLessonException', { contextId: s.ctxA.id, lessonId, studentId: k1.id, status: null });
    expect((await eff(k1.id)).effective).toBe('absent');

    // "All present" only fills students without a record; it never overwrites.
    const all = await cmd(s.teacherA, 'attendance.markAllPresent', { contextId: s.ctxA.id, lessonId });
    expect(all.result).toEqual({ marked: 3 });
    expect((await eff(k1.id)).effective).toBe('absent');
    expect((await eff(k2.id)).effective).toBe('present');
  });

  it('refuses teacher-area exception edits once the teaching assignment has ended (ACC-10, review fix)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const body = { studentId: studentsA[0]!.id, status: 'absent' };
    await ok(s.teacherA.put(`/api/teacher/lessons/${lessonId}/exceptions`, body));
    await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId, steps: {} });
    await ok(s.admin.post(`/api/admin/teaching-contexts/${s.ctxA.id}/end`));
    expect((await s.teacherA.put(`/api/teacher/lessons/${lessonId}/exceptions`, { ...body, status: 'present' })).status).toBe(403);
    expect(env.db.$client.prepare('select status from attendance_lesson_exceptions where lesson_id = ?').get(lessonId)).toEqual({ status: 'absent' });
  });

  it('refuses students outside the class and teachers outside the class', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const other = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Toprak Güneş' });
    const r = await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId, studentId: other.id, status: 'absent' });
    expect(r.error?.reason).toBe('STUDENT_NOT_IN_CLASS');
    expect((await s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: studentsA[0]!.id, status: 'absent' })).status).toBe(403);
    expect((await s.teacherB.get(`/api/teacher/classes/${s.c3a.id}/attendance`)).status).toBe(403);
  });

  // ATT-1: attendance lives in its own tables; S8 adds homework and the cross-test.
  it('stores attendance separately from everything else (ATT-1)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const tables = () => Object.fromEntries((env.db.$client.prepare("select name from sqlite_master where type='table' and name not like '\\_\\_%' escape '\\'").all() as any[]).map((t) => [t.name, (env.db.$client.prepare(`select count(*) n from "${t.name}"`).get() as any).n]));
    const before = tables();
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId, studentId: studentsA[0]!.id, status: 'excused' });
    const after = tables();
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]).sort();
    expect(changed).toEqual(['attendance_daily', 'audit_events', 'command_log']);
  });
  it.todo('S8: homework marks and attendance stay independent of each other (ATT-1, ENG-3 cross-test)');
});

describe('routines (RTN-1..3)', () => {
  it('template edits never change the snapshot of a lesson in progress', async () => {
    const t = await ok(s.teacherA.post('/api/teacher/routines', { name: { en: 'Story time' }, contextId: s.ctxA.id, stages: [{ name: { en: 'Warm-up' } }, { name: { en: 'Story', tr: 'Hikâye' } }] }));
    expect(t.stages).toHaveLength(2);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/routine`, { templateId: t.id }));
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    let st = (await state(s.teacherA, s.ctxA.id)).lesson;
    expect(st.routine).toMatchObject({ templateId: t.id, name: { en: 'Story time' } });

    // Reorder, rename, add, remove — saved as one list.
    const updated = await ok(
      s.teacherA.patch(`/api/teacher/routines/${t.id}`, {
        name: { en: 'Story hour' },
        stages: [{ id: t.stages[1].id, name: { en: 'Big story' } }, { name: { en: 'Song' } }],
      }),
    );
    expect(updated.stages.map((x: any) => x.name.en)).toEqual(['Big story', 'Song']);
    expect(updated.stages[0].id).toBe(t.stages[1].id);

    st = (await state(s.teacherA, s.ctxA.id)).lesson;
    expect(st.routine.name.en).toBe('Story time');
    expect(st.routine.stages.map((x: any) => x.name.en)).toEqual(['Warm-up', 'Story']);
    expect((await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId, stageIndex: 1 })).ok).toBe(true);
    expect((await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId, stageIndex: 2 })).error?.reason).toBe('STAGE_OUT_OF_RANGE');

    // The next lesson uses the edited template.
    await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId, steps: {} });
    await start(s.teacherA, s.ctxA.id);
    expect((await state(s.teacherA, s.ctxA.id)).lesson.routine.stages.map((x: any) => x.name.en)).toEqual(['Big story', 'Song']);
  });

  it('templates are private to their teacher and archived ones cannot be used', async () => {
    const t = await ok(s.teacherA.post('/api/teacher/routines', { name: { tr: 'Sabah rutini' } }));
    expect(t.stages).toHaveLength(6); // starts as a copy of the default routine
    expect((await s.teacherB.patch(`/api/teacher/routines/${t.id}`, { name: { en: 'Mine' } })).status).toBe(404);
    expect((await s.teacherB.put(`/api/teacher/contexts/${s.ctxB.id}/routine`, { templateId: t.id })).body.error.details.reason).toBe('ROUTINE_NOT_USABLE');
    const list = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/routines`));
    expect(list.templates.map((x: any) => x.id)).toEqual([DEFAULT_ROUTINE_ID, t.id]);
    await ok(s.teacherA.post(`/api/teacher/routines/${t.id}/archive`));
    expect((await cmd(s.teacherA, 'lesson.start', { contextId: s.ctxA.id, routineTemplateId: t.id })).error?.reason).toBe('ROUTINE_NOT_USABLE');
  });

  it('runs a server-timed classroom timer (RTN-3)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const ref = { contextId: s.ctxA.id, lessonId };
    await cmd(s.teacherA, 'lesson.timer.set', { ...ref, durationMs: 120_000 });
    await cmd(s.teacherA, 'lesson.timer.start', ref);
    env.clock.advance(30_000);
    const paused = await cmd(s.teacherA, 'lesson.timer.pause', ref);
    expect(paused.result.timer).toEqual({ durationMs: 120_000, startedAt: null, remainingMs: 90_000, running: false });
    const reset = await cmd(s.teacherA, 'lesson.timer.reset', ref);
    expect(reset.result.timer.remainingMs).toBe(120_000);
  });

  it('starts a finished timer again from its full duration (RTN-3, review fix)', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id);
    const ref = { contextId: s.ctxA.id, lessonId };
    await cmd(s.teacherA, 'lesson.timer.set', { ...ref, durationMs: 60_000 });
    await cmd(s.teacherA, 'lesson.timer.start', ref);
    env.clock.advance(120_000);
    const restarted = await cmd(s.teacherA, 'lesson.timer.start', ref);
    expect(restarted.result.timer).toEqual({ durationMs: 60_000, startedAt: env.clock.now(), remainingMs: 60_000, running: true });
  });
});

describe('end lesson (LES-3, CFG-1/2)', () => {
  it('ends a lesson with every optional module switched off, keeping the reflection', async () => {
    for (const module of ['routines', 'attendance', 'counters', 'secretStudents', 'assistant', 'grouping', 'homework', 'goals']) {
      await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/${module}`, { enabled: false }));
    }
    const { lessonId } = await start(s.teacherA, s.ctxA.id, { attendance: [{ studentId: studentsA[0]!.id, status: 'absent' }] });
    const st = (await state(s.teacherA, s.ctxA.id)).lesson;
    expect(st.routine.stages).toEqual([]);
    expect(st.endSteps).toEqual(['reflection']);
    expect((await roster(s.teacherA, s.ctxA.id, lessonId)).attendanceEnabled).toBe(false);
    expect((await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId, stageIndex: 0 })).error?.code).toBe('FEATURE_DISABLED');
    expect((await cmd(s.teacherA, 'attendance.markAllPresent', { contextId: s.ctxA.id, lessonId })).error?.code).toBe('FEATURE_DISABLED');

    env.clock.advance(40 * 60_000);
    const end = await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId, steps: { reflection: { rating: 3, note: '  Lovely singing  ' } } });
    expect(end.ok).toBe(true);
    expect(end.result).toMatchObject({ status: 'ended', attendance: null, stageCount: 0, reflection: { rating: 3, note: 'Lovely singing' } });
    expect(end.result.endedAt - end.result.startedAt).toBe(40 * 60_000);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toBeNull();
    // No attendance was written while the module was off.
    expect(env.db.$client.prepare('select count(*) n from attendance_daily').get()).toEqual({ n: 0 });
    // Summary stays readable later.
    expect((await ok(s.teacherA.get(`/api/classroom/lessons/${lessonId}/summary`))).reflection.rating).toBe(3);
    expect((await s.teacherB.get(`/api/classroom/lessons/${lessonId}/summary`)).status).toBe(404);
  });

  it('summarises attendance when the module is on', async () => {
    const { lessonId } = await start(s.teacherA, s.ctxA.id, { attendance: [{ studentId: studentsA[0]!.id, status: 'late' }] });
    const end = await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId, steps: {} });
    expect(end.result.attendance).toEqual({ present: 0, absent: 0, late: 1, excused: 0, not_recorded: 3 });
    expect(end.result.reflection).toEqual({ rating: null, note: null });
  });
});

describe('local day boundaries (DSH-2)', () => {
  // Sessions expire after 12 idle hours; the test clock jumps further than that.
  const signInAgain = async () => {
    await s.teacherA.login('ayse.teacher');
    await s.teacherB.login('mehmet.teacher');
    await s.admin.login('root.admin');
  };

  it('dates a lesson in the class timezone near midnight UTC', async () => {
    env.clock.t = Date.UTC(2026, 10, 9, 21, 30); // 00:30 on Tuesday 10 November in Istanbul
    await signInAgain();
    const st0 = await state(s.teacherA, s.ctxA.id);
    expect(st0.today).toMatchObject({ localDate: '2026-11-10', weekday: 2 });
    await start(s.teacherA, s.ctxA.id);
    expect((await state(s.teacherA, s.ctxA.id)).lesson.localDate).toBe('2026-11-10');
    // A class configured for London is still on Monday.
    await ok(s.admin.patch(`/api/admin/classes/${s.c3b.id}`, { timezone: 'Europe/London' }));
    expect((await state(s.teacherB, s.ctxB.id)).today).toMatchObject({ localDate: '2026-11-09', weekday: 1, timezone: 'Europe/London' });
  });

  it('abandons a lesson left running overnight when the next lesson starts (not ended, data kept)', async () => {
    const old = await start(s.teacherA, s.ctxA.id, { attendance: [{ studentId: studentsA[0]!.id, status: 'absent' }] });
    await cmd(s.teacherA, 'lesson.setStage', { contextId: s.ctxA.id, lessonId: old.lessonId, stageIndex: 2 });
    env.clock.advance(24 * 3600_000);
    await signInAgain();
    // The next morning nothing is resumed by mistake.
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toBeNull();
    expect((await ok(s.teacherA.get('/api/classroom/lessons/active'))).lessons).toEqual([]);
    const fresh = await start(s.teacherA, s.ctxA.id);
    expect(fresh.started).toBe(true);
    expect(fresh.lessonId).not.toBe(old.lessonId);
    const prev = await ok(s.teacherA.get(`/api/classroom/lessons/${old.lessonId}/summary`));
    expect(prev).toMatchObject({ status: 'abandoned', endedAt: null, stageReached: 3, localDate: '2026-11-09' });
    expect(prev.attendance.absent).toBe(1);
    expect((await state(s.teacherA, s.ctxA.id)).lesson).toMatchObject({ id: fresh.lessonId, localDate: '2026-11-10', stageIndex: 0 });
    // An earlier day's private reflection note is not readable through the classroom endpoint (PIN-1/PIN-8).
    await cmd(s.teacherA, 'lesson.end', { contextId: s.ctxA.id, lessonId: fresh.lessonId, steps: { reflection: { rating: 2, note: 'Private thought' } } });
    expect((await ok(s.teacherA.get(`/api/classroom/lessons/${fresh.lessonId}/summary`))).reflection).toEqual({ rating: 2, note: 'Private thought' });
    env.clock.advance(24 * 3600_000);
    await signInAgain();
    expect((await ok(s.teacherA.get(`/api/classroom/lessons/${fresh.lessonId}/summary`))).reflection).toEqual({ rating: 2, note: null });
    await ok(s.admin.post(`/api/admin/teaching-contexts/${s.ctxA.id}/end`));
    expect((await s.teacherA.get(`/api/classroom/lessons/${fresh.lessonId}/summary`)).status).toBe(404);
  });
});
