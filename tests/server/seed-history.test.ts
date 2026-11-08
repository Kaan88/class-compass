/**
 * Demo history (seed:demo-history, OPS-5, ENG-4): fictional past weeks on the demo school, written
 * through the real commands and services. Test clock: Monday 2026-11-09 10:00 Europe/Istanbul.
 */
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { weekdayOf } from '../../src/domain/dates.ts';
import { lessons, schoolSettings, students, teachingContexts } from '../../src/server/db/schema.ts';
import { privateNotesCount } from '../../src/server/modules/goals/history.ts';
import { isModuleEnabled } from '../../src/server/modules/school/modules.ts';
import { SeedRefused, seedDemo } from '../../src/server/seed/demo.ts';
import { seedDemoHistory } from '../../src/server/seed/history.ts';
import { HISTORY_GENERATORS } from '../../src/server/seed/history/generators.ts';
import { CONTEXT_MODULES, type ContextModule } from '../../src/shared/modules.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { ok } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

const PASSWORD = 'demo-history-password';
const rows = (table: string) => (env.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe('seed:demo-history', () => {
  it('fills past school weeks for every module through the real services, then refuses a second run', async () => {
    env = await makeEnv();
    await seedDemo(env.deps, { fixedPassword: PASSWORD });
    const r = seedDemoHistory(env.deps);
    expect(r.weeks).toBeGreaterThanOrEqual(8);
    expect(r.weeks).toBeLessThanOrEqual(10);
    expect(r.contexts).toBe(7);
    expect(r.lessons).toBeGreaterThan(120);
    expect(r.elapsedMs).toBeLessThan(60_000);

    // Every generator of a module that is in this build and switched on somewhere produced something.
    const contextIds = env.db.select().from(teachingContexts).all().map((c) => c.id);
    for (const g of HISTORY_GENERATORS) {
      if (g.module && !(CONTEXT_MODULES as readonly string[]).includes(g.module)) continue;
      if (g.module && !contextIds.some((id) => isModuleEnabled(env.db, id, g.module as ContextModule))) continue;
      expect(Object.values(r.counts[g.key] ?? {}).reduce((a, b) => a + b, 0), g.key).toBeGreaterThan(0);
    }
    const tables = [
      'lessons',
      'attendance_daily',
      'attendance_lesson_exceptions',
      'counter_events',
      'lesson_groupings',
      'assistant_assignments',
      'assistant_duty_checks',
      'secret_rounds',
      'homework_assignments',
      'homework_marks',
      'goals',
      'goal_entries',
      'teacher_assessments',
      'teacher_feedback',
      'evidence',
      'command_log',
    ];
    for (const t of tables) expect(rows(t), t).toBeGreaterThan(0);
    expect(privateNotesCount(env.db)).toBeGreaterThan(0);
    const statuses = env.db.$client.prepare(`select distinct status from attendance_daily`).all() as Array<{ status: string }>;
    expect(statuses.map((s) => s.status).sort()).toEqual(['absent', 'excused', 'late', 'present']);
    const marks = env.db.$client.prepare(`select distinct status from homework_marks`).all() as Array<{ status: string }>;
    expect(marks.length).toBeGreaterThanOrEqual(4);
    expect(rows(`goals where status = 'achieved'`)).toBeGreaterThan(0);
    expect(rows(`goal_entries where kind = 'self_assessment'`)).toBeGreaterThan(0);
    expect(rows(`evidence where kind = 'link'`)).toBeGreaterThan(0);

    // No lesson on a weekend or in the future; nothing is left running.
    const all = env.db.select().from(lessons).all();
    for (const l of all) {
      expect([0, 6]).not.toContain(weekdayOf(l.localDate));
      expect(l.localDate < '2026-11-09').toBe(true);
      expect(l.startedAt).toBeLessThan(env.clock.now());
    }
    expect(all.filter((l) => l.status === 'active')).toEqual([]);
    expect(all.some((l) => l.status === 'abandoned')).toBe(true);
    const latest = env.db.$client.prepare(`select max(at) as t from audit_events where action <> 'demo.seed_history'`).get() as { t: number };
    expect(latest.t).toBeLessThanOrEqual(env.clock.now());

    // The teacher report, the student timeline and the personal student page show the history.
    const english = new Client(env);
    await english.login('english', PASSWORD);
    const contexts = (await ok(english.get('/api/teacher/reports/contexts'))).contexts as Array<{ id: string; className: string; classId: string }>;
    const c3a = contexts.find((c) => c.className === '3-A')!;
    const report = await ok(english.get(`/api/teacher/contexts/${c3a.id}/report?from=2026-09-01&to=2026-11-08`));
    const keys = report.sections.map((s: any) => s.key);
    for (const k of ['overview', 'attendance', 'counters', 'homework', 'goals', 'lessonReflections', 'assistant', 'secretStudents', 'groupingHistory']) expect(keys, k).toContain(k);
    expect(report.sections.every((s: any) => s.tables.length + s.metrics.length > 0)).toBe(true);
    const kid = report.students[0];
    const timeline = await ok(english.get(`/api/teacher/contexts/${c3a.id}/students/${kid.id}/timeline`));
    expect(JSON.stringify(timeline).length).toBeGreaterThan(500);
    const goalsPage = await ok(english.get(`/api/teacher/contexts/${c3a.id}/goals`));
    expect(JSON.stringify(goalsPage)).toContain('activeGoals');

    const page = await ok((await openLink(env, await linkUrl(english, c3a.classId, kid.id))).get('/api/student/page'));
    const sectionKeys = page.subjects.flatMap((s: any) => s.sections.map((x: any) => x.key));
    expect(sectionKeys).toContain('goals');
    expect(sectionKeys).toContain('homework');

    // A second run refuses with a clear message and writes nothing.
    const before = rows('audit_events');
    expect(() => seedDemoHistory(env.deps)).toThrow(SeedRefused);
    expect(() => seedDemoHistory(env.deps)).toThrow(/already has history/);
    expect(rows('audit_events')).toBe(before);
  }, 120_000); // the whole history run (about 12 s alone; slower while every test file runs in parallel)

  it('refuses in production and on a database that is not the demo school', async () => {
    env = await makeEnv({ NODE_ENV: 'production', isProd: true });
    expect(() => seedDemoHistory(env.deps)).toThrow(/NODE_ENV=production/);
    await env.app.close();

    env = await makeEnv();
    expect(() => seedDemoHistory(env.deps)).toThrow(/not the demo school/);
    await seedDemo(env.deps);
    env.db.update(schoolSettings).set({ schoolName: 'Real School' }).run();
    expect(() => seedDemoHistory(env.deps)).toThrow(/not the demo school/);
    expect(env.db.select({ n: sql<number>`count(*)` }).from(lessons).get()!.n).toBe(0);
    expect(env.db.select().from(students).all().length).toBe(76);
  });
});
