/**
 * Reports (S11): RPT-1..6, DAT-2/6. Test clock starts Monday 2026-11-09 10:00 Europe/Istanbul.
 * Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CSV_BOM } from '../../src/domain/csv.ts';
import type { Report, ReportCell, ReportSection } from '../../src/shared/contracts/reports.ts';
import { reportCellText } from '../../src/shared/reportText.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let kids: Array<{ id: string; fullName: string }>;

beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  kids = [];
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız', '=Işıl Çınar']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const report = (c = s.teacherA, q = ''): Promise<Report> => ok(c.get(`/api/teacher/contexts/${s.ctxA.id}/report${q}`));
const section = (r: Report, key: string): ReportSection => {
  const sec = r.sections.find((x) => x.key === key);
  if (!sec) throw new Error(`no section ${key}: ${r.sections.map((x) => x.key).join(', ')}`);
  return sec;
};
const rowOf = (sec: ReportSection, table: string, rowKey: string): ReportCell[] => sec.tables.find((t) => t.key === table)!.rows.find((r) => r.key === rowKey)!.cells;

async function lessonWithTaps(taps: Array<[number, number]>, absent: number[] = []) {
  const l = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
  for (const i of absent) expect((await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId: l, studentId: kids[i]!.id, status: 'absent' })).ok).toBe(true);
  const st = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`));
  const counter = st.counters.counters.find((x: any) => x.kind === 'english_reminders');
  for (const [i, n] of taps) for (let k = 0; k < n; k++) expect((await cmd(s.teacherA, 'counter.tap', { contextId: s.ctxA.id, lessonId: l, counterId: counter.id, studentId: kids[i]!.id })).ok).toBe(true);
  await endLesson(s.teacherA, s.ctxA.id, l);
  return { lessonId: l, counterId: counter.id as string };
}

describe('access (RPT-6, ACC-4)', () => {
  it('teachers see only their own class+subject contexts; administrators see all', async () => {
    const mine = await ok(s.teacherA.get('/api/teacher/reports/contexts'));
    expect(mine.contexts.map((c: any) => c.id)).toEqual([s.ctxA.id]);
    expect((await s.teacherB.get(`/api/teacher/contexts/${s.ctxA.id}/report`)).status).toBe(403);
    expect((await s.teacherB.get(`/api/teacher/contexts/${s.ctxA.id}/report/csv?section=overview&table=lessonsPerWeek`)).status).toBe(403);
    expect((await s.teacherA.get('/api/admin/reports/usage')).status).toBe(403);
    const all = await ok(s.admin.get('/api/admin/reports/contexts'));
    expect(all.contexts).toHaveLength(2);
    expect((await s.admin.get(`/api/admin/contexts/${s.ctxB.id}/report`)).status).toBe(200);
  });

  it('answers 423 to every report endpoint while the classroom lock is engaged (PIN-8)', async () => {
    expect((await s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await s.teacherA.post('/api/classroom/enter')).status).toBe(200);
    for (const url of ['/api/teacher/reports/contexts', `/api/teacher/contexts/${s.ctxA.id}/report`, `/api/teacher/contexts/${s.ctxA.id}/report/csv?section=overview&table=lessonsPerWeek`, `/api/teacher/contexts/${s.ctxA.id}/students/${kids[0]!.id}/timeline`]) {
      expect((await s.teacherA.get(url)).status, url).toBe(423);
    }
  });

  it('administrators do not see the teacher’s lesson reflection notes', async () => {
    const { lessonId } = await lessonWithTaps([]);
    env.db.$client.prepare('update lessons set reflection_json = ? where id = ?').run(JSON.stringify({ rating: 4, note: 'Fictional private remark' }), lessonId);
    const t = await report();
    expect(JSON.stringify(section(t, 'lessonReflections'))).toContain('Fictional private remark');
    const a: Report = await ok(s.admin.get(`/api/admin/contexts/${s.ctxA.id}/report`));
    expect(JSON.stringify(a)).not.toContain('Fictional private remark');
    expect(rowOf(section(a, 'lessonReflections'), 'lessons', lessonId)[2]).toEqual({ t: 'n', v: 4, d: 5 });
  });
});

describe('RPT-5: zero, absent, not recorded and denominators', () => {
  it('counters keep zero, not recorded and per-attended-lesson numerator / denominator apart', async () => {
    const { counterId } = await lessonWithTaps([[0, 2]], [1]);
    const r = await report();
    const counters = section(r, 'counters');
    const perStudent = (i: number) => rowOf(counters, `students-${counterId}`, kids[i]!.id);
    const cols = counters.tables.find((t) => t.key === `students-${counterId}`)!.columns.map((c) => c.key);
    const at = (k: string) => cols.indexOf(k);
    // Ece: 2 reminders in 1 attended lesson; Arda: absent → no attended lesson; Işıl: present, 0.
    expect(perStudent(0)[at('perAttended')]).toEqual({ t: 'n', v: 2, d: 1 });
    expect(perStudent(1)[at('perAttended')]).toEqual({ t: 'n', v: 0, d: 0 });
    expect(perStudent(2)[at('perAttended')]).toEqual({ t: 'n', v: 0, d: 1 });
    // The current week had a lesson: counts. Earlier weeks of the term without lessons: not recorded.
    expect(perStudent(2)[at('w-2026-11-09')]).toEqual({ t: 'n', v: 0 });
    expect(perStudent(2)[at('w-2026-11-02')]).toEqual({ t: 'na' });
    // No overall score anywhere.
    expect(JSON.stringify(r)).not.toMatch(/"score"/i);
  });

  it('a week without lessons is "not recorded", never 0', async () => {
    await lessonWithTaps([[0, 1]]);
    env.clock.advance(7 * 24 * 3600_000);
    await s.teacherA.login('ayse.teacher');
    await lessonWithTaps([[0, 1]]);
    env.clock.advance(14 * 24 * 3600_000);
    await s.teacherA.login('ayse.teacher');
    const r = await report();
    const counters = section(r, 'counters');
    const weeks = counters.tables.find((t) => t.key.startsWith('weeks-'))!;
    const byWeek = new Map(weeks.rows.map((row) => [row.key, row.cells[2]]));
    expect(byWeek.get('2026-11-09')).toEqual({ t: 'n', v: 1 });
    expect(byWeek.get('2026-11-23')).toEqual({ t: 'nr' });
  });

  it('attendance coverage is days recorded out of school days, and not recorded stays separate', async () => {
    await lessonWithTaps([], [1]);
    const r = await report(s.teacherA, '?from=2026-11-09&to=2026-11-09');
    const att = section(r, 'attendance');
    expect(att.metrics.find((m) => m.key === 'coverage')!.cell).toEqual({ t: 'n', v: 1, d: 1 });
    const arda = rowOf(att, 'students', kids[1]!.id);
    expect(arda[0]).toMatchObject({ t: 'student' });
    expect(arda.slice(1)).toEqual([{ t: 'n', v: 1 }, { t: 'n', v: 0, d: 1 }, { t: 'n', v: 0, d: 1 }, { t: 'n', v: 1, d: 1 }, { t: 'n', v: 0, d: 1 }, { t: 'n', v: 0, d: 1 }]);
    const wider = await report(s.teacherA, '?from=2026-11-02&to=2026-11-09');
    expect(section(wider, 'attendance').metrics.find((m) => m.key === 'coverage')!.cell).toEqual({ t: 'n', v: 1, d: 6 });
  });

  it('renders zero, absent and not recorded as different words', () => {
    expect(reportCellText({ t: 'n', v: 0 }, 'en')).toBe('0');
    expect(reportCellText({ t: 'n', v: 0, d: 0 }, 'en')).toBe('0 / 0');
    expect(reportCellText({ t: 'nr' }, 'en')).toBe('not recorded');
    expect(reportCellText({ t: 'absent' }, 'en')).toBe('absent');
    expect(reportCellText({ t: 'na' }, 'tr')).toBe('sınıfta değil');
    expect(reportCellText({ t: 'days', v: null }, 'en')).toBe('never');
  });
});

describe('long-term data (DAT-2, DAT-6)', () => {
  it('a renamed counter and class show the old name with the current one', async () => {
    const { counterId } = await lessonWithTaps([[0, 1]]);
    await ok(s.teacherA.patch(`/api/teacher/counters/${counterId}`, { labels: { main: { en: 'English only!', tr: 'Sadece İngilizce!' }, supporting: { en: '{count} of {limit}' }, individual: { en: 'Turkish words', tr: 'Türkçe kelimeler' } } }));
    await ok(s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { name: '3-Alpha' }));
    const r = await report();
    const metric = section(r, 'counters').metrics.find((m) => m.key === counterId)!;
    expect(metric.label).toEqual({ text: { en: 'Our English Time', tr: expect.any(String) }, now: { en: 'English only!', tr: 'Sadece İngilizce!' } });
    expect(r.context.className).toBe('3-Alpha');
    expect(r.context.classNames).toEqual(['3-A']);
    expect(section(r, 'overview').notes).toEqual([{ k: 'report.overview.formerNames', p: { names: '3-A', now: '3-Alpha' } }]);
  });

  it('a deactivated student stays in the reports of the period they were in the class', async () => {
    await lessonWithTaps([[1, 3]]);
    await ok(s.admin.post(`/api/admin/students/${kids[1]!.id}/deactivate`));
    const r = await report();
    expect(r.students.find((x) => x.id === kids[1]!.id)).toMatchObject({ active: false });
    const counters = section(r, 'counters');
    const t = counters.tables.find((x) => x.key.startsWith('students-'))!;
    const total = t.rows.find((x) => x.key === kids[1]!.id)!.cells[t.columns.findIndex((c) => c.key === 'total')];
    expect(total).toEqual({ t: 'n', v: 3 });
  });
});

describe('CSV (RPT-4)', () => {
  it('is UTF-8 with a BOM, formula-safe, with denominators in their own column, and audited', async () => {
    const { counterId } = await lessonWithTaps([[2, 1]]);
    const r = await s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report/csv?section=counters&table=students-${counterId}&delimiter=semicolon`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.csv"$/);
    const body = String(r.body);
    expect(body.startsWith(CSV_BOM)).toBe(true);
    expect(body).toContain("'=Işıl Çınar");
    expect(body).not.toMatch(/(^|;)=Işıl/m);
    expect(body).toContain('Per attended lesson – out of');
    const audits = env.db.$client.prepare("select count(*) as n from audit_events where action = 'report.csv_exported'").get() as { n: number };
    expect(audits.n).toBe(1);
    expect((await s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report/csv?section=counters&table=nope`)).status).toBe(404);
  });
});

describe('timeline and other sections', () => {
  it('lists a student’s events in date order, and every section is present when its module is on', async () => {
    await lessonWithTaps([[0, 2]]);
    const tl = await ok(s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/students/${kids[0]!.id}/timeline`));
    expect(tl.events.map((e: any) => e.module)).toEqual([null, 'counters']);
    const r = await report();
    expect(r.sections.map((x) => x.key)).toEqual(['overview', 'attendance', 'counters', 'homework', 'goals', 'lessonReflections', 'studentReflections', 'assistant', 'secretStudents', 'groupingHistory']);
    const one = await report(s.teacherA, `?studentId=${kids[0]!.id}`);
    expect(one.student?.id).toBe(kids[0]!.id);
    expect(one.students).toHaveLength(3);
    expect((await s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report?studentId=${kids[0]!.id.replace(/.$/, '0')}`)).status).toBe(404);
  });

  it('the school-wide usage report has no student names', async () => {
    await lessonWithTaps([[0, 1]]);
    const u = await ok(s.admin.get('/api/admin/reports/usage'));
    const text = JSON.stringify(u);
    for (const k of kids) expect(text).not.toContain(k.fullName);
    expect(u.sections[0].tables[0].rows).toHaveLength(2);
    const csv = await s.admin.get('/api/admin/reports/usage/csv?section=usage&table=contexts');
    expect(csv.status).toBe(200);
  });
});
