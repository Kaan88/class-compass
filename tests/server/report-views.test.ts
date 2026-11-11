/**
 * Report views (S14e1, D-153; RPT-1, RPT-2, RPT-6, ACC-1): the section catalogue (`ReportContribution.meta`),
 * the `sections` filter (unrequested sections are not built), saved views per account with a default,
 * and the generic user settings registry. Test clock: Monday 2026-11-09 10:00 Europe/Istanbul.
 * Fictional names only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userSettings } from '../../src/server/db/schema.ts';
import { getUserSetting, setUserSetting, USER_SETTINGS } from '../../src/server/lib/userSettings.ts';
import { allReportContributions } from '../../src/server/modules/index.ts';
import type { Report, ReportSection } from '../../src/shared/contracts/reports.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { BUILTIN_VIEWS, BUILTIN_VIEW_IDS, MAX_REPORT_VIEWS, parseSectionsParam, sectionsParam, tableMatches } from '../../src/shared/reportViews.ts';
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
  for (const fullName of ['Ece Deniz Kaya', 'Arda Yıldız']) kids.push(await addStudent(s.teacherA, s.c3a.id, { fullName }));
});
afterEach(async () => env.app.close());

const base = () => `/api/teacher/contexts/${s.ctxA.id}/report`;
const report = (q = ''): Promise<Report> => ok(s.teacherA.get(`${base()}${q}`));

async function lessonWithTap() {
  const l = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
  const st = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`));
  const counter = st.counters.counters.find((x: any) => x.kind === 'english_reminders');
  expect((await cmd(s.teacherA, 'counter.tap', { contextId: s.ctxA.id, lessonId: l, counterId: counter.id, studentId: kids[0]!.id })).ok).toBe(true);
  await endLesson(s.teacherA, s.ctxA.id, l);
  return counter.id as string;
}

/** Every produced section has a contribution, and every produced table one of its catalogue tables. */
function expectMatchesCatalogue(sections: readonly ReportSection[]) {
  const all = allReportContributions();
  const problems: string[] = [];
  for (const sec of sections) {
    const c = all.find((x) => x.key === sec.key);
    if (!c) {
      problems.push(`section ${sec.key} has no contribution`);
      continue;
    }
    for (const t of sec.tables) if (!c.meta.tables.some((m) => tableMatches(m, t.key))) problems.push(`${sec.key}: table ${t.key} is not in its meta`);
  }
  expect(problems).toEqual([]);
}

describe('catalogue (ReportContribution.meta)', () => {
  it('every contribution declares a title and unique tables with real i18n keys; built-in views name only known sections and tables', () => {
    const all = allReportContributions();
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    for (const c of all) {
      expect((en as Record<string, string>)[c.meta.title], c.key).toBeTruthy();
      expect(new Set(c.meta.tables.map((t) => t.key)).size, c.key).toBe(c.meta.tables.length);
      for (const t of c.meta.tables) {
        expect(t.key, c.key).toMatch(/^[A-Za-z][A-Za-z0-9]*$/u);
        expect((en as Record<string, string>)[t.title], `${c.key}.${t.key}`).toBeTruthy();
      }
    }
    for (const id of BUILTIN_VIEW_IDS) {
      for (const sec of BUILTIN_VIEWS[id]?.sections ?? []) {
        const c = all.find((x) => x.key === sec.key);
        expect(c, `${id}: ${sec.key}`).toBeTruthy();
        for (const t of sec.tables ?? []) expect(c!.meta.tables.map((m) => m.key), `${id}: ${sec.key}.${t}`).toContain(t);
      }
    }
  });

  it('meta matches the tables each section actually produces (teacher and administrator, whole class and one student)', async () => {
    await lessonWithTap();
    const whole = await report();
    expect(whole.sections.length).toBeGreaterThan(8);
    expectMatchesCatalogue(whole.sections);
    expectMatchesCatalogue((await report(`?studentId=${kids[0]!.id}`)).sections);
    expectMatchesCatalogue((await ok(s.admin.get(`/api/admin/contexts/${s.ctxA.id}/report`))).sections);
  });

  it('GET …/reports/catalog lists sections with their tables; with a class+subject only the modules switched on there (RPT-6)', async () => {
    const all = await ok(s.teacherA.get('/api/teacher/reports/catalog'));
    expect(all.sections.map((x: any) => x.key)).toEqual(allReportContributions().map((c) => c.key));
    const counters = all.sections.find((x: any) => x.key === 'counters');
    expect(counters.title).toEqual({ k: 'report.section.counters' });
    expect(counters.tables.map((t: any) => [t.key, t.perItem])).toEqual([
      ['lessons', true],
      ['weeks', true],
      ['students', true],
    ]);
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/secretStudents`, { enabled: false }));
    const mine = await ok(s.teacherA.get(`/api/teacher/reports/catalog?contextId=${s.ctxA.id}`));
    expect(mine.sections.map((x: any) => x.key)).not.toContain('secretStudents');
    expect(mine.sections.map((x: any) => x.key)).toContain('counters');
    // Another teacher's class+subject: refused, as for its report (ACC-10).
    expect((await s.teacherB.get(`/api/teacher/reports/catalog?contextId=${s.ctxA.id}`)).status).toBe(403);
    expect((await ok(s.admin.get(`/api/admin/reports/catalog?contextId=${s.ctxA.id}`))).sections.length).toBe(mine.sections.length);
  });
});

describe('the sections filter (RPT-2)', () => {
  it('builds only the requested sections and keeps only the requested tables', async () => {
    const counterId = await lessonWithTap();
    const calls = new Map<string, number>();
    const restore: Array<() => void> = [];
    for (const c of allReportContributions()) {
      const orig = c.build;
      c.build = (ctx, scope) => {
        calls.set(c.key, (calls.get(c.key) ?? 0) + 1);
        return orig(ctx, scope);
      };
      restore.push(() => (c.build = orig));
    }
    try {
      const r = await report('?sections=attendance.students,homework,counters.students');
      expect(r.sections.map((x) => x.key)).toEqual(['attendance', 'counters', 'homework']);
      expect(r.sections.find((x) => x.key === 'attendance')!.tables.map((t) => t.key)).toEqual(['students']);
      expect(r.sections.find((x) => x.key === 'counters')!.tables.map((t) => t.key)).toEqual([`students-${counterId}`]);
      // Metrics stay: a section's summary numbers are not tables.
      expect(r.sections.find((x) => x.key === 'counters')!.metrics.length).toBeGreaterThan(0);
      expect([...calls.keys()].sort()).toEqual(['attendance', 'counters', 'homework']);
      // A CSV builds just its own section.
      calls.clear();
      const csv = await s.teacherA.get(`${base()}/csv?section=attendance&table=students`);
      expect(csv.status).toBe(200);
      expect([...calls.keys()]).toEqual(['attendance']);
    } finally {
      for (const r of restore) r();
    }
    // Without the parameter: everything, as before.
    expect((await report()).sections.length).toBeGreaterThan(5);
    // A built-in view round-trips through the parameter.
    const overview = await report(`?sections=${sectionsParam(BUILTIN_VIEWS.studentOverview)}&studentId=${kids[0]!.id}`);
    expect(overview.sections.find((x) => x.key === 'attendance')!.tables.map((t) => t.key)).toEqual(['students']);
    expect(overview.sections.map((x) => x.key)).not.toContain('lessonReflections');
  });

  it('refuses a malformed parameter and ignores unknown keys', async () => {
    expect((await s.teacherA.get(`${base()}?sections=${encodeURIComponent('attendance;drop')}`)).status).toBe(400);
    const r = await report('?sections=nothingHere,attendance.nothingHere');
    expect(r.sections.map((x) => x.key)).toEqual(['attendance']);
    expect(r.sections[0]!.tables).toEqual([]);
    expect(parseSectionsParam('a,a.b,c.d,c.e,..,x.y.z')).toEqual(
      new Map<string, Set<string> | null>([
        ['a', null],
        ['c', new Set(['d', 'e'])],
      ]),
    );
  });
});

describe('saved views (CRUD, isolation, default)', () => {
  const spec = { sections: [{ key: 'attendance', tables: ['students'] }, { key: 'homework', tables: null }] };

  it('a teacher creates, renames, changes and deletes their own views; nobody else sees or changes them (ACC-1)', async () => {
    const v = await ok(s.teacherA.post('/api/teacher/report-views', { name: '  Weekly check  ', spec }));
    expect(v.name).toBe('Weekly check');
    expect(v.spec).toEqual(spec);
    const list = await ok(s.teacherA.get('/api/teacher/report-views'));
    expect(list.views.map((x: any) => x.id)).toEqual([v.id]);
    expect(list.defaultView).toBe('builtin:everything');
    expect(list.max).toBe(MAX_REPORT_VIEWS);

    // Teacher B and the administrator have their own (empty) lists and cannot reach A's view.
    expect((await ok(s.teacherB.get('/api/teacher/report-views'))).views).toEqual([]);
    expect((await ok(s.admin.get('/api/admin/report-views'))).views).toEqual([]);
    expect((await s.teacherB.put(`/api/teacher/report-views/${v.id}`, { name: 'Mine now' })).status).toBe(404);
    expect((await s.teacherB.del(`/api/teacher/report-views/${v.id}`)).status).toBe(404);
    expect((await s.teacherB.put('/api/teacher/reports/default-view', { view: v.id })).status).toBe(404);
    expect((await s.admin.put(`/api/admin/report-views/${v.id}`, { name: 'Mine now' })).status).toBe(404);

    const changed = await ok(s.teacherA.put(`/api/teacher/report-views/${v.id}`, { name: 'Weekly', spec: { sections: [{ key: 'goals', tables: null }] } }));
    expect(changed).toMatchObject({ name: 'Weekly', spec: { sections: [{ key: 'goals', tables: null }] } });
    await ok(s.teacherA.del(`/api/teacher/report-views/${v.id}`));
    expect((await ok(s.teacherA.get('/api/teacher/report-views'))).views).toEqual([]);
    // Deleted for good.
    expect(env.db.$client.prepare('select count(*) as n from report_views').get()).toEqual({ n: 0 });
  });

  it('administrators keep their own views for the admin reports', async () => {
    const v = await ok(s.admin.post('/api/admin/report-views', { name: 'By class: goals', spec: { sections: [{ key: 'goals', tables: null }] } }));
    await ok(s.admin.put('/api/admin/reports/default-view', { view: v.id }));
    expect(await ok(s.admin.get('/api/admin/report-views'))).toMatchObject({ views: [{ id: v.id }], defaultView: v.id });
    expect((await ok(s.teacherA.get('/api/teacher/report-views'))).views).toEqual([]);
  });

  it('names are unique per account (ignoring case, Turkish-aware), specs must name known sections, at most 30 views', async () => {
    await ok(s.teacherA.post('/api/teacher/report-views', { name: 'İlk', spec }));
    const dup = await s.teacherA.post('/api/teacher/report-views', { name: 'ilk', spec });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.reason).toBe('REPORT_VIEW_NAME_TAKEN');
    // Another teacher may use the same name.
    await ok(s.teacherB.post('/api/teacher/report-views', { name: 'İlk', spec }));

    const unknown = await s.teacherA.post('/api/teacher/report-views', { name: 'Odd', spec: { sections: [{ key: 'madeUp', tables: null }] } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.reason).toBe('REPORT_VIEW_UNKNOWN_SECTION');
    const badTable = await s.teacherA.post('/api/teacher/report-views', { name: 'Odd', spec: { sections: [{ key: 'attendance', tables: ['madeUp'] }] } });
    expect(badTable.body.error.details.reason).toBe('REPORT_VIEW_UNKNOWN_SECTION');
    expect((await s.teacherA.post('/api/teacher/report-views', { name: 'Empty', spec: { sections: [] } })).status).toBe(400);
    expect((await s.teacherA.post('/api/teacher/report-views', { name: 'Twice', spec: { sections: [{ key: 'goals', tables: null }, { key: 'goals', tables: null }] } })).status).toBe(400);
    expect((await s.teacherA.post('/api/teacher/report-views', { name: ' ', spec })).status).toBe(400);
    expect((await s.teacherA.post('/api/teacher/report-views', { name: 'x'.repeat(61), spec })).status).toBe(400);

    for (let i = 2; i <= MAX_REPORT_VIEWS; i++) await ok(s.teacherA.post('/api/teacher/report-views', { name: `View ${i}`, spec }));
    const over = await s.teacherA.post('/api/teacher/report-views', { name: 'One too many', spec });
    expect(over.status).toBe(409);
    expect(over.body.error.details.reason).toBe('REPORT_VIEWS_LIMIT');
  });

  it('the default view is a built-in or an own view; deleting the default puts "Everything" back', async () => {
    await ok(s.teacherA.put('/api/teacher/reports/default-view', { view: 'builtin:studentOverview' }));
    expect((await ok(s.teacherA.get('/api/teacher/report-views'))).defaultView).toBe('builtin:studentOverview');
    expect((await s.teacherA.put('/api/teacher/reports/default-view', { view: 'builtin:nothing' })).status).toBe(404);
    expect((await s.teacherA.put('/api/teacher/reports/default-view', { view: 'not a view' })).status).toBe(400);
    const v = await ok(s.teacherA.post('/api/teacher/report-views', { name: 'Mine', spec }));
    await ok(s.teacherA.put('/api/teacher/reports/default-view', { view: v.id }));
    expect((await ok(s.teacherA.get('/api/teacher/report-views'))).defaultView).toBe(v.id);
    // Teacher B's default is untouched.
    expect((await ok(s.teacherB.get('/api/teacher/report-views'))).defaultView).toBe('builtin:everything');
    await ok(s.teacherA.del(`/api/teacher/report-views/${v.id}`));
    expect((await ok(s.teacherA.get('/api/teacher/report-views'))).defaultView).toBe('builtin:everything');
  });

  it('answers 423 to the view endpoints while the classroom lock is engaged (PIN-8)', async () => {
    expect((await s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await s.teacherA.post('/api/classroom/enter')).status).toBe(200);
    for (const [m, url] of [
      ['GET', '/api/teacher/report-views'],
      ['GET', '/api/teacher/reports/catalog'],
      ['POST', '/api/teacher/report-views'],
      ['PUT', '/api/teacher/reports/default-view'],
    ] as const) {
      expect((await s.teacherA.req(m, url, m === 'GET' ? undefined : { name: 'x', spec, view: 'builtin:everything' })).status, url).toBe(423);
    }
  });
});

describe('user settings registry (server/lib/userSettings.ts)', () => {
  it('returns the default when nothing or an invalid value is stored, and validates writes', () => {
    const uid = s.ayse.id;
    expect(getUserSetting(env.db, uid, 'reports.defaultView.teacher')).toBe(USER_SETTINGS['reports.defaultView.teacher'].default);
    setUserSetting(env.db, uid, 'reports.defaultView.teacher', 'builtin:goalsReflections', env.clock.now());
    expect(getUserSetting(env.db, uid, 'reports.defaultView.teacher')).toBe('builtin:goalsReflections');
    // The admin key is a different setting.
    expect(getUserSetting(env.db, uid, 'reports.defaultView.admin')).toBe('builtin:everything');
    env.db.update(userSettings).set({ valueJson: { not: 'a view' } }).run();
    expect(getUserSetting(env.db, uid, 'reports.defaultView.teacher')).toBe('builtin:everything');
    expect(() => setUserSetting(env.db, uid, 'reports.defaultView.teacher', 'DROP TABLE', env.clock.now())).toThrow();
  });
});
