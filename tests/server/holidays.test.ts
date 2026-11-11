/**
 * School holiday calendar (S25b, D-186; DAT-1, RPT-5, LES-1, AST-1). Test clock: Monday 2026-11-09
 * 10:00 Europe/Istanbul; the fixture's school year runs 2026-09-01 to 2027-06-30. Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Report, ReportCell, ReportSection } from '../../src/shared/contracts/reports.ts';
import { reportCellText } from '../../src/shared/reportText.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, lessonState, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kid: string;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız']) kid = (await addStudent(s.teacherA, s.c3a.id, { fullName })).id;
});
afterEach(async () => env.app.close());

const auditCount = (action: string) => (env.db.$client.prepare('select count(*) as n from audit_events where action = ?').get(action) as { n: number }).n;
const closures = async () => (await ok(s.admin.get(`/api/admin/years/${s.year.id}/closures`))).closures as Array<{ id: string; name: { en?: string; tr?: string }; startsOn: string; endsOn: string; schoolDays: number }>;
const addClosure = (body: Record<string, unknown>) => s.admin.post(`/api/admin/years/${s.year.id}/closures`, body);
const section = (r: Report, key: string): ReportSection => r.sections.find((x) => x.key === key)!;
const metric = (sec: ReportSection, key: string): ReportCell => sec.metrics.find((m) => m.key === key)!.cell;
const CLOSED: ReportCell = { t: 'closed' };
const weekCell = (sec: ReportSection, table: string, week: string, i: number): ReportCell => sec.tables.find((t) => t.key === table)!.rows.find((r) => r.key === week)!.cells[i]!;

describe('the holiday calendar (D-186, DAT-1)', () => {
  it('an administrator adds, changes and deletes a closure inside the year; every change is audited', async () => {
    const created = await ok(addClosure({ name: { en: 'Semester break', tr: 'Yarıyıl tatili' }, startsOn: '2027-01-25', endsOn: '2027-02-05' }));
    expect(created).toMatchObject({ name: { en: 'Semester break', tr: 'Yarıyıl tatili' }, startsOn: '2027-01-25', endsOn: '2027-02-05', schoolDays: 10 });
    const changed = await ok(s.admin.patch(`/api/admin/closures/${created.id}`, { endsOn: '2027-01-29' }));
    expect(changed.schoolDays).toBe(5);
    expect((await closures()).map((c) => c.endsOn)).toEqual(['2027-01-29']);
    expect((await s.admin.del(`/api/admin/closures/${created.id}`)).status).toBe(200);
    expect(await closures()).toEqual([]);
    expect([auditCount('closure.create'), auditCount('closure.update'), auditCount('closure.delete')]).toEqual([1, 1, 1]);
  });

  it('refuses dates outside the year, reversed dates, an empty name and a teacher', async () => {
    expect((await addClosure({ name: { tr: 'Yaz' }, startsOn: '2027-06-28', endsOn: '2027-07-10' })).body.error.details.reason).toBe('CLOSURE_OUTSIDE_YEAR');
    expect((await addClosure({ name: { tr: 'Ters' }, startsOn: '2026-12-10', endsOn: '2026-12-01' })).body.error.details.reason).toBe('DATES_REVERSED');
    expect((await addClosure({ name: { en: ' ' }, startsOn: '2026-12-01', endsOn: '2026-12-01' })).status).toBe(400);
    expect((await s.teacherA.post(`/api/admin/years/${s.year.id}/closures`, { name: { en: 'X' }, startsOn: '2026-12-01', endsOn: '2026-12-01' })).status).toBe(403);
    expect((await s.teacherA.get(`/api/admin/years/${s.year.id}/closures`)).status).toBe(403);
  });

  it('an archived year is read-only (assertYearWritable) and a year cannot shrink past its closures', async () => {
    const c = await ok(addClosure({ name: { en: 'Spring break' }, startsOn: '2027-04-12', endsOn: '2027-04-16' }));
    expect((await s.admin.patch(`/api/admin/years/${s.year.id}`, { endsOn: '2027-04-13' })).body.error.details.reason).toBe('CLOSURE_OUTSIDE_YEAR');
    await ok(s.admin.post(`/api/admin/years/${s.year.id}/archive`));
    expect((await addClosure({ name: { en: 'Late' }, startsOn: '2026-12-01', endsOn: '2026-12-01' })).body.error.details.reason).toBe('YEAR_ARCHIVED');
    expect((await s.admin.patch(`/api/admin/closures/${c.id}`, { endsOn: '2027-04-14' })).body.error.details.reason).toBe('YEAR_ARCHIVED');
    expect((await s.admin.del(`/api/admin/closures/${c.id}`)).body.error.details.reason).toBe('YEAR_ARCHIVED');
    expect((await s.admin.post(`/api/admin/years/${s.year.id}/closures/public-holidays`)).body.error.details.reason).toBe('YEAR_ARCHIVED');
    expect((await ok(s.admin.get(`/api/admin/years/${s.year.id}/closures`))).archived).toBe(true);
  });

  it('"Add Turkish public holidays" adds the fixed-date holidays inside the year once, never the religious ones', async () => {
    // 1 January already covered by a hand-made closure: skipped, not doubled.
    await ok(addClosure({ name: { tr: 'Yılbaşı tatili' }, startsOn: '2026-12-31', endsOn: '2027-01-01' }));
    expect(await ok(s.admin.post(`/api/admin/years/${s.year.id}/closures/public-holidays`))).toEqual({ added: 4, skipped: 1 });
    const list = await closures();
    expect(list.map((c) => c.startsOn)).toEqual(['2026-10-29', '2026-12-31', '2027-04-23', '2027-05-01', '2027-05-19']);
    expect(list[0]!.name).toEqual({ en: 'Republic Day', tr: '29 Ekim Cumhuriyet Bayramı' });
    expect(JSON.stringify(list)).not.toMatch(/Ramazan|Kurban/u);
    // 15 July and 30 August fall in the summer, outside this school year. Pressing again adds nothing.
    expect(await ok(s.admin.post(`/api/admin/years/${s.year.id}/closures/public-holidays`))).toEqual({ added: 0, skipped: 5 });
    expect(auditCount('closure.add_public_holidays')).toBe(2);
  });
});

describe('coverage and denominators leave closure days out (RPT-5, D-186)', () => {
  it('attendance coverage, weekly rows, lessons per week and the usage report count only school days', async () => {
    const l = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    await endLesson(s.teacherA, s.ctxA.id, l);
    const q = `/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-02&to=2026-11-09`;
    const before: Report = await ok(s.teacherA.get(q));
    expect(metric(section(before, 'attendance'), 'coverage')).toEqual({ t: 'n', v: 1, d: 6 });
    expect(weekCell(section(before, 'attendance'), 'weeks', '2026-11-02', 1)).toEqual({ t: 'n', v: 0, d: 5 });
    expect(weekCell(section(before, 'overview'), 'lessonsPerWeek', '2026-11-02', 1)).toEqual({ t: 'n', v: 0 });
    const usageBefore = await ok(s.admin.get('/api/admin/reports/usage?from=2026-11-02&to=2026-11-09'));

    // A whole week off, Friday to the next Friday across a weekend.
    await ok(addClosure({ name: { en: 'Autumn break' }, startsOn: '2026-10-30', endsOn: '2026-11-06' }));
    const after: Report = await ok(s.teacherA.get(q));
    const att = section(after, 'attendance');
    expect(metric(att, 'coverage')).toEqual({ t: 'n', v: 1, d: 1 });
    // A week of holidays is "no school": never 0 / 0 and never "not recorded".
    expect(weekCell(att, 'weeks', '2026-11-02', 1)).toEqual({ t: 'closed' });
    expect(weekCell(section(after, 'overview'), 'lessonsPerWeek', '2026-11-02', 1)).toEqual({ t: 'closed' });
    expect(weekCell(att, 'weeks', '2026-11-09', 1)).toEqual({ t: 'n', v: 1, d: 1 });
    // Per student: school days in the class are out of 1, not 6.
    const perStudent = att.tables.find((t) => t.key === 'students')!.rows[0]!.cells;
    expect(perStudent[1]).toEqual({ t: 'n', v: 1 });
    const usageAfter = await ok(s.admin.get('/api/admin/reports/usage?from=2026-11-02&to=2026-11-09'));
    const schoolDays = (u: { sections: ReportSection[] }) => u.sections[0]!.metrics.find((m) => m.key === 'schoolDays')!.cell;
    expect(schoolDays(usageBefore)).toEqual({ t: 'n', v: 6 });
    expect(schoolDays(usageAfter)).toEqual({ t: 'n', v: 1 });
  });

  it('counters show a week of holidays as "no school", in the weekly table and per student', async () => {
    const l = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    const counter = (await lessonState(s.teacherA, s.ctxA.id)).counters.counters.find((x: { kind: string }) => x.kind === 'english_reminders');
    expect((await cmd(s.teacherA, 'counter.tap', { contextId: s.ctxA.id, lessonId: l, counterId: counter.id, studentId: kid })).ok).toBe(true);
    await endLesson(s.teacherA, s.ctxA.id, l);
    await ok(addClosure({ name: { en: 'Autumn break' }, startsOn: '2026-11-02', endsOn: '2026-11-06' }));
    // The students were in the class since the start of the year (the fixture enrols them today).
    env.db.$client.prepare("update enrolments set from_date = '2026-09-01'").run();
    const r: Report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-10-26&to=2026-11-09`));
    const counters = section(r, 'counters');
    const weeks = counters.tables.find((t) => t.key.startsWith('weeks-'))!;
    expect(weeks.rows.find((x) => x.key === '2026-11-02')!.cells.slice(1)).toEqual([{ t: 'closed' }, { t: 'closed' }]);
    expect(weeks.rows.find((x) => x.key === '2026-10-26')!.cells[2]).toEqual({ t: 'nr' });
    const perStudent = counters.tables.find((t) => t.key.startsWith('students-'))!;
    const col = perStudent.columns.findIndex((c) => c.key === 'w-2026-11-02');
    expect(perStudent.rows[0]!.cells[col]).toEqual({ t: 'closed' });
  });

  it('a period of only closure days reads "no school": coverage, every student, the weeks, goals and usage (review fix)', async () => {
    env.db.$client.prepare("update enrolments set from_date = '2026-09-01'").run();
    await ok(addClosure({ name: { en: 'Autumn break' }, startsOn: '2026-11-02', endsOn: '2026-11-06' }));
    const r: Report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-02&to=2026-11-06`));
    const att = section(r, 'attendance');
    expect(metric(att, 'coverage')).toEqual(CLOSED);
    // Enrolled all along: "no school", never "not in the class".
    for (const row of att.tables.find((t) => t.key === 'students')!.rows) expect(row.cells.slice(1)).toEqual(Array(6).fill(CLOSED));
    // Every count of a week of holidays, not just the recorded days: never a bare 0.
    expect(att.tables.find((t) => t.key === 'weeks')!.rows.find((x) => x.key === '2026-11-02')!.cells.slice(1)).toEqual(Array(5).fill(CLOSED));
    expect(section(r, 'goals').tables.find((t) => t.key === 'confidenceHistory')!.rows.find((x) => x.key === '2026-11-02')!.cells.slice(1)).toEqual(Array(6).fill(CLOSED));
    const usage = (await ok(s.admin.get('/api/admin/reports/usage?from=2026-11-02&to=2026-11-06'))).sections[0] as ReportSection;
    expect(metric(usage, 'schoolDays')).toEqual(CLOSED);
    const ctxRow = usage.tables.find((t) => t.key === 'contexts')!.rows.find((x) => x.key === s.ctxA.id)!;
    expect(ctxRow.cells[4]).toEqual(CLOSED);
    for (const row of usage.tables.find((t) => t.key === 'teachers')!.rows) expect(row.cells[3]).toEqual(CLOSED);
  });

  it('the current week is decided by its days up to today: Monday a holiday reads "no school" on Monday (review fix)', async () => {
    env.db.$client.prepare("update enrolments set from_date = '2026-09-01'").run();
    await ok(addClosure({ name: { en: 'Snow day' }, startsOn: '2026-11-09', endsOn: '2026-11-09' }));
    const r: Report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-02&to=2026-11-13`));
    const att = section(r, 'attendance');
    expect(att.tables.find((t) => t.key === 'weeks')!.rows.find((x) => x.key === '2026-11-09')!.cells.slice(1)).toEqual(Array(5).fill(CLOSED));
    expect(metric(att, 'coverage')).toEqual({ t: 'n', v: 0, d: 5 });
  });

  it('attendance taken on a closure day (a make-up lesson) is left out of every attendance table, so they agree (review fix)', async () => {
    env.db.$client.prepare("update enrolments set from_date = '2026-09-01'").run();
    const [ece, arda] = (env.db.$client.prepare('select id from students order by full_name').all() as Array<{ id: string }>).map((x) => x.id);
    const ins = env.db.$client.prepare('insert into attendance_daily (id, student_id, class_id, local_date, status, recorded_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)');
    const now = env.clock.now();
    for (const [sid, d, st] of [[arda, '2026-10-19', 'present'], [ece, '2026-10-19', 'absent'], [arda, '2026-10-20', 'present'], [ece, '2026-10-20', 'present']] as const) ins.run(crypto.randomUUID(), sid, s.c3a.id, d, st, s.ayse.id, now, now);
    await ok(addClosure({ name: { en: 'Make-up Monday' }, startsOn: '2026-10-19', endsOn: '2026-10-19' }));
    const att = section(await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-10-19&to=2026-10-23`)), 'attendance');
    expect(att.tables.find((t) => t.key === 'weeks')!.rows[0]!.cells.slice(1)).toEqual([{ t: 'n', v: 1, d: 4 }, { t: 'n', v: 2 }, { t: 'n', v: 0 }, { t: 'n', v: 0 }, { t: 'n', v: 0 }]);
    const students = att.tables.find((t) => t.key === 'students')!;
    const present = students.rows.map((row) => row.cells[2] as { v: number }).reduce((a, c) => a + c.v, 0);
    const absent = students.rows.map((row) => row.cells[4] as { v: number }).reduce((a, c) => a + c.v, 0);
    expect([present, absent]).toEqual([2, 0]);
  });

  it('"no school" is a word in both languages, never 0', () => {
    expect(reportCellText({ t: 'closed' }, 'en')).toBe('no school');
    expect(reportCellText({ t: 'closed' }, 'tr')).toBe('okul yok');
  });
});

describe('the classroom on a closure day (LES-1, AST-1, D-186)', () => {
  it('shows today’s closure and still starts a (make-up) lesson; no assistant is on duty', async () => {
    await ok(addClosure({ name: { en: 'Teacher training day', tr: 'Öğretmen eğitim günü' }, startsOn: '2026-11-09', endsOn: '2026-11-09' }));
    const st = await lessonState(s.teacherA, s.ctxA.id);
    expect(st.today.closure).toEqual({ name: { en: 'Teacher training day', tr: 'Öğretmen eğitim günü' } });
    expect(st.assistant).toMatchObject({ schoolDay: false, assistant: null });
    const l = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    expect((await lessonState(s.teacherA, s.ctxA.id)).lesson.id).toBe(l);
  });

  it('an assistant planned before the day became a closure is not shown and not counted as a turn (AST-4/5, review fix)', async () => {
    const before = await lessonState(s.teacherA, s.ctxA.id);
    expect(before.assistant.assistant).not.toBeNull();
    await ok(addClosure({ name: { en: 'Teacher training day' }, startsOn: '2026-11-09', endsOn: '2026-11-09' }));
    expect((await lessonState(s.teacherA, s.ctxA.id)).assistant).toMatchObject({ schoolDay: false, assistant: null });
    const r: Report = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?from=2026-11-02&to=2026-11-09`));
    const asst = section(r, 'assistant');
    expect(metric(asst, 'days')).toEqual({ t: 'n', v: 0, d: 0 });
    for (const row of asst.tables.find((t) => t.key === 'students')!.rows) expect(row.cells[1]).not.toEqual({ t: 'n', v: 1, d: 1 });
  });

  it('a closure added for today changes the polled ETag', async () => {
    const first = await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`);
    expect(first.body.today.closure).toBeNull();
    await ok(addClosure({ name: { en: 'Snow day' }, startsOn: '2026-11-09', endsOn: '2026-11-10' }));
    const second = await s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`);
    expect(second.headers.etag).not.toBe(first.headers.etag);
  });
});
