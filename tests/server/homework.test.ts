/**
 * Homework (S8): HW-1..4, ATT-1, DSH-8, RPT-5, UX-9, CFG-1/2, ENG-3 "attendance/homework independence".
 * Test clock: Monday 2026-11-09 10:00, Europe/Istanbul. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;
const NOTE = 'PRIVATENOTE-forgot-book';

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of ['Ada Yılmaz', 'Barış Kaya', 'Cem Demir', 'Deniz Şahin', 'Ece Çelik', 'Fırat Arslan']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const ctx = () => s.ctxA.id as string;
const create = (body: Record<string, unknown>) => ok(s.teacherA.post(`/api/teacher/contexts/${ctx()}/homework`, body));
const check = (id: string) => ok(s.teacherA.get(`/api/teacher/homework/${id}/check`));
const statusOf = (c: any, studentId: string) => c.rows.find((r: any) => r.student.id === studentId).status;
const tables = () =>
  Object.fromEntries(
    (env.db.$client.prepare("select name from sqlite_master where type='table' and name not like '\\_\\_%' escape '\\'").all() as any[]).map((t) => [t.name, JSON.stringify(env.db.$client.prepare(`select * from "${t.name}"`).all())]),
  );
const changedTables = (before: Record<string, string>, after: Record<string, string>) => Object.keys(after).filter((k) => after[k] !== before[k]).sort();

describe('not checked is not missing (HW-4, RPT-5)', () => {
  it('a new assignment shows every student as not checked, never missing; only a review makes it missing', async () => {
    const hw = await create({ title: 'Workbook p. 12', details: 'Exercises 1–3', dueOn: '2026-11-09', assignedOn: '2026-11-06', notes: NOTE });
    expect(hw.statuses.map((x: any) => x.key)).toEqual(['not_checked', 'completed', 'partly_completed', 'missing', 'submitted_late', 'excused']);
    expect(hw.counts).toEqual({ total: 6, byStatus: { not_checked: 6, completed: 0, partly_completed: 0, missing: 0, submitted_late: 0, excused: 0 } });
    const c = await check(hw.id);
    expect(c.rows.every((r: any) => r.status === 'not_checked' && r.reviewed === false)).toBe(true);
    expect(env.db.$client.prepare('select count(*) n from homework_marks').get()).toEqual({ n: 0 }); // no row = not checked
    let out = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/homework/outstanding`));
    expect(out.items).toEqual([expect.objectContaining({ notChecked: 6, total: 6, students: [] })]);
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'missing' }] }));
    out = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/homework/outstanding`));
    expect(out.items[0]).toMatchObject({ notChecked: 5, students: [{ student: { id: kids[0]!.id }, status: 'missing' }] });
    // Setting "not checked" again removes the mark (no row), keeping the history in the change log.
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'not_checked' }] }));
    expect(env.db.$client.prepare('select count(*) n from homework_marks').get()).toEqual({ n: 0 });
    expect(env.db.$client.prepare('select count(*) n from homework_mark_changes').get()).toEqual({ n: 2 });
  });
});

describe('fast checking: bulk, individual corrections, undo (HW-4, UX-9, ACC-9)', () => {
  it('marks the rest completed, corrects one, undoes, and audits every change', async () => {
    const hw = await create({ title: 'Spelling list', dueOn: '2026-11-09' });
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'missing', note: NOTE }] }));
    const bulkId = v7();
    const bulk = await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks/remaining`, { batchId: bulkId, status: 'completed' }));
    expect(bulk.changed).toBe(5);
    expect(statusOf(bulk.check, kids[0]!.id)).toBe('missing'); // already reviewed: untouched
    expect(bulk.check.assignment.counts.byStatus).toMatchObject({ completed: 5, missing: 1, not_checked: 0 });
    // A retried request (same batch id) changes nothing (UX-11).
    const replay = await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks/remaining`, { batchId: bulkId, status: 'completed' }));
    expect(replay).toMatchObject({ replayed: true, changed: 5 });
    // Individual correction, then undo it.
    const fixId = v7();
    const fix = await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { batchId: fixId, changes: [{ studentId: kids[1]!.id, status: 'partly_completed' }] }));
    expect(statusOf(fix.check, kids[1]!.id)).toBe('partly_completed');
    const undoFix = await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks/undo`, { batchId: fixId }));
    expect(undoFix).toMatchObject({ undone: 1, skipped: 0 });
    expect(statusOf(undoFix.check, kids[1]!.id)).toBe('completed');
    // Correct someone again, then undo the bulk action: the corrected student is kept, the rest go back to not checked.
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[2]!.id, status: 'submitted_late' }] }));
    const undoBulk = await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks/undo`, { batchId: bulkId }));
    expect(undoBulk).toMatchObject({ undone: 4, skipped: 1 });
    expect(statusOf(undoBulk.check, kids[2]!.id)).toBe('submitted_late');
    expect(statusOf(undoBulk.check, kids[3]!.id)).toBe('not_checked');
    expect(statusOf(undoBulk.check, kids[0]!.id)).toBe('missing');
    const actions = (env.db.$client.prepare("select action from audit_events where action like 'homework.marks%' order by at, rowid").all() as any[]).map((r) => r.action);
    expect(actions).toEqual(['homework.marks_set', 'homework.marks_remaining', 'homework.marks_set', 'homework.marks_undo', 'homework.marks_set', 'homework.marks_undo']);
    expect(JSON.stringify(env.db.$client.prepare("select after_json from audit_events where action like 'homework.%'").all())).not.toContain(NOTE);
    // Unknown status and students from another class are refused.
    expect((await s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'brilliant' }] })).body.error.details.reason).toBe('UNKNOWN_STATUS');
    const other = await addStudent(s.teacherB, s.c3b.id, { fullName: 'Toprak Güneş' });
    expect((await s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: other.id, status: 'completed' }] })).status).toBe(403);
    // Another teacher cannot read or check it (ACC-10).
    expect((await s.teacherB.get(`/api/teacher/homework/${hw.id}/check`)).status).toBe(403);
  });
});

describe('daily, weekly and monthly views in the class timezone (HW-1)', () => {
  it('lists by due date or assigned date for the day, the school week and the month', async () => {
    const mk = (title: string, assignedOn: string, dueOn: string) => create({ title, assignedOn, dueOn });
    await mk('Mon', '2026-11-02', '2026-11-09');
    await mk('Sun', '2026-11-09', '2026-11-15');
    await mk('Next Mon', '2026-11-10', '2026-11-16');
    await mk('End of month', '2026-11-16', '2026-11-30');
    await mk('December', '2026-11-30', '2026-12-01');
    const titles = async (q: string) => (await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/homework?${q}`))).assignments.map((a: any) => a.title);
    expect(await titles('view=day')).toEqual(['Mon']);
    expect(await titles('view=week')).toEqual(['Mon', 'Sun']);
    expect(await titles('view=month')).toEqual(['Mon', 'Sun', 'Next Mon', 'End of month']);
    expect(await titles('view=month&date=2026-12-15')).toEqual(['December']);
    expect(await titles('view=week&by=assigned')).toEqual(['Sun', 'Next Mon']);
    const r = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/homework?view=week`));
    expect(r.range).toEqual({ view: 'week', by: 'due', from: '2026-11-09', to: '2026-11-15' });
    // Sunday 21:30 UTC is already Monday 00:30 in Istanbul: "this week" moves on.
    env.clock.t = Date.parse('2026-11-15T21:30:00Z');
    await s.teacherA.login('ayse.teacher');
    const next = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/homework?view=week`));
    expect(next.today).toBe('2026-11-16');
    expect(next.range).toMatchObject({ from: '2026-11-16', to: '2026-11-22' });
    expect(next.assignments.map((a: any) => a.title)).toEqual(['Next Mon']);
    // Dates are validated.
    expect((await s.teacherA.post(`/api/teacher/contexts/${ctx()}/homework`, { title: 'x', assignedOn: '2026-11-10', dueOn: '2026-11-09' })).body.error.details.reason).toBe('DUE_BEFORE_ASSIGNED');
    expect((await s.teacherA.post(`/api/teacher/contexts/${ctx()}/homework`, { title: 'x', dueOn: '2027-08-01' })).body.error.details.reason).toBe('DATE_OUTSIDE_YEAR');
  });
});

describe('attendance and homework stay independent (ATT-1, ENG-3 cross-test)', () => {
  it('absent with completed homework, present with missing homework; changing one never changes the other', async () => {
    const hw = await create({ title: 'Story', dueOn: '2026-11-09' });
    const [absentKid, presentKid] = kids;
    // Attendance first: the absent student sent the homework in anyway; the present one did not do it.
    let before = tables();
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: absentKid!.id, status: 'absent' }));
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: presentKid!.id, status: 'present' }));
    expect(changedTables(before, tables())).toEqual(['attendance_daily', 'audit_events']);
    before = tables();
    await ok(
      s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, {
        changes: [
          { studentId: absentKid!.id, status: 'completed' },
          { studentId: presentKid!.id, status: 'missing' },
        ],
      }),
    );
    expect(changedTables(before, tables())).toEqual(['audit_events', 'homework_mark_changes', 'homework_marks']);
    let c = await check(hw.id);
    const row = (id: string) => c.rows.find((r: any) => r.student.id === id);
    expect(row(absentKid!.id)).toMatchObject({ status: 'completed', attendance: 'absent' });
    expect(row(presentKid!.id)).toMatchObject({ status: 'missing', attendance: 'present' });
    expect(row(kids[2]!.id)).toMatchObject({ status: 'not_checked', attendance: 'not_recorded' });
    // Changing attendance leaves homework alone…
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { date: '2026-11-09', studentId: absentKid!.id, status: 'present' }));
    c = await check(hw.id);
    expect(row(absentKid!.id)).toMatchObject({ status: 'completed', attendance: 'present' });
    // …and changing homework leaves attendance alone.
    const att = () => env.db.$client.prepare('select student_id, status, updated_at from attendance_daily order by student_id').all();
    const attBefore = att();
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks/remaining`, { status: 'excused' }));
    expect(att()).toEqual(attBefore);
    // With the Attendance module off the grid shows no attendance (and still never stores any).
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/attendance`, { enabled: false }));
    c = await check(hw.id);
    expect(c.attendanceEnabled).toBe(false);
    expect(c.rows.every((r: any) => r.attendance === null)).toBe(true);
  });
});

describe('classroom panel and classroom checking (DSH-8, D-075, PIN-1)', () => {
  it('the display lists current homework without statuses or notes; checking is teacher-area unless the class allows it', async () => {
    const hw = await create({ title: 'Read chapter 2', details: 'Pages 10–14', dueOn: '2026-11-11', notes: NOTE });
    await create({ title: 'Old', assignedOn: '2026-10-01', dueOn: '2026-10-05' });
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'missing', note: NOTE }] }));
    const panel = await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/homework/current`));
    expect(panel).toEqual({ today: '2026-11-09', checkingInClassroom: false, assignments: [{ id: hw.id, title: 'Read chapter 2', details: 'Pages 10–14', assignedOn: '2026-11-09', dueOn: '2026-11-11' }] });
    const denied = await s.teacherA.get(`/api/classroom/homework/${hw.id}/check`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.details.reason).toBe('CHECKING_TEACHER_ONLY');
    expect((await s.teacherA.post(`/api/classroom/homework/${hw.id}/marks/remaining`, { status: 'completed' })).status).toBe(403);
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/homework/settings`, { checkingInClassroom: true }));
    const grid = await ok(s.teacherA.get(`/api/classroom/homework/${hw.id}/check`));
    expect(JSON.stringify(grid)).not.toContain(NOTE);
    expect(statusOf(grid, kids[0]!.id)).toBe('missing');
    // Classroom corrections keep the private note untouched.
    await ok(s.teacherA.post(`/api/classroom/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'submitted_late', note: 'ignored' }] }));
    const teacherView = await check(hw.id);
    expect(teacherView.rows[0]).toMatchObject({ status: 'submitted_late', note: NOTE });
    // Review fix: "not checked" would delete the mark and its private note, so the classroom refuses it.
    const cleared = await s.teacherA.post(`/api/classroom/homework/${hw.id}/marks`, { changes: [{ studentId: kids[0]!.id, status: 'not_checked' }] });
    expect(cleared.status).toBe(409);
    expect(cleared.body.error.details.reason).toBe('MARK_HAS_NOTE');
    // A teacher-area batch that changed a note cannot be undone from the classroom.
    const noted = await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks`, { changes: [{ studentId: kids[1]!.id, status: 'missing', note: NOTE }] }));
    const undo = await s.teacherA.post(`/api/classroom/homework/${hw.id}/marks/undo`, { batchId: noted.batchId });
    expect(undo.status).toBe(403);
    expect(undo.body.error.details.reason).toBe('MARK_HAS_NOTE');
    const after = await check(hw.id);
    expect(after.rows.find((r: any) => r.student.id === kids[0]!.id)).toMatchObject({ status: 'submitted_late', note: NOTE });
    expect(after.rows.find((r: any) => r.student.id === kids[1]!.id)).toMatchObject({ status: 'missing', note: NOTE });
  });

  it('statuses are configurable per class+subject; an assignment keeps the list it was created with (HW-2, DAT-6)', async () => {
    const before = await create({ title: 'Before', dueOn: '2026-11-12' });
    const settings = await ok(s.teacherA.get(`/api/teacher/contexts/${ctx()}/homework/settings`));
    const statuses = [...settings.statuses.map((x: any) => (x.key === 'completed' ? { ...x, label: { en: 'Done', tr: 'Bitti' } } : x)), { key: 'redo', kind: 'other', label: { en: 'Redo', tr: 'Tekrar yap' } }];
    const saved = await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/homework/settings`, { statuses }));
    expect(saved.statuses).toHaveLength(7);
    const after = await create({ title: 'After', dueOn: '2026-11-12' });
    expect(after.statuses.map((x: any) => x.key)).toContain('redo');
    expect(after.statuses.find((x: any) => x.key === 'completed').label.en).toBe('Done');
    expect((await check(before.id)).assignment.statuses.map((x: any) => x.key)).not.toContain('redo');
    const bad = await s.teacherA.put(`/api/teacher/contexts/${ctx()}/homework/settings`, { statuses: statuses.slice(1) });
    expect(bad.body.error.details.reason).toBe('INVALID_STATUS_LIST');
  });

  it('switching Homework off keeps every assignment and mark; writes and the classroom panel are refused (CFG-1, CFG-2)', async () => {
    const hw = await create({ title: 'Kept', dueOn: '2026-11-10' });
    await ok(s.teacherA.post(`/api/teacher/homework/${hw.id}/marks/remaining`, { status: 'completed' }));
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/homework`, { enabled: false }));
    expect((await s.teacherA.get(`/api/classroom/contexts/${ctx()}/homework/current`)).body.error.code).toBe('FEATURE_DISABLED');
    expect((await s.teacherA.post(`/api/teacher/contexts/${ctx()}/homework`, { title: 'New', dueOn: '2026-11-10' })).body.error.code).toBe('FEATURE_DISABLED');
    expect((await check(hw.id)).assignment.counts.byStatus.completed).toBe(6); // history readable
    await ok(s.teacherA.put(`/api/teacher/contexts/${ctx()}/modules/homework`, { enabled: true }));
    expect((await ok(s.teacherA.get(`/api/classroom/contexts/${ctx()}/homework/current`))).assignments).toHaveLength(1);
  });
});
