/**
 * Demo history (seed:demo-history, OPS-5, ENG-4): fictional past weeks on the demo school, written
 * through the real commands and services. Test clock: Monday 2026-11-09 10:00 Europe/Istanbul.
 */
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { weekdayOf } from '../../src/domain/dates.ts';
import { lessons, schoolSettings, students, teachingContexts } from '../../src/server/db/schema.ts';
import { privateNotesCount } from '../../src/server/modules/goals/history.ts';
import { allReportContributions } from '../../src/server/modules/index.ts';
import { tableMatches } from '../../src/shared/reportViews.ts';
import { isModuleAvailable, isModuleEnabled } from '../../src/server/modules/school/modules.ts';
import { buildBoard } from '../../src/server/modules/superSpeakers/service.ts';
import { urlWords } from '../../src/server/modules/textChecks/service.ts';
import { SeedRefused, seedDemo } from '../../src/server/seed/demo.ts';
import { seedDemoHistory } from '../../src/server/seed/history.ts';
import { HISTORY_GENERATORS } from '../../src/server/seed/history/generators.ts';
import * as TEXT from '../../src/server/seed/history/text.ts';
import { AvatarSpec } from '../../src/shared/contracts/avatars.ts';
import { CONTEXT_MODULES, SCHOOL_MODULES, type ContextModule } from '../../src/shared/modules.ts';
import { checkStudentText, findRiskyWord, type TextKind } from '../../src/shared/text/textQuality.ts';
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
    expect(r.elapsedMs).toBeLessThan(120_000); // about 20 s alone on a laptop; the whole suite runs in parallel

    // Every generator of a module that is in this build and switched on somewhere produced something.
    const contextIds = env.db.select().from(teachingContexts).all().map((c) => c.id);
    // A school-wide module's generator switches the module on itself (Super Speakers).
    for (const g of HISTORY_GENERATORS) {
      const school = g.module !== null && (SCHOOL_MODULES as readonly string[]).includes(g.module);
      if (g.module && !school && !(CONTEXT_MODULES as readonly string[]).includes(g.module)) continue;
      if (g.module && !school && !contextIds.some((id) => isModuleEnabled(env.db, id, g.module as ContextModule))) continue;
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

    // Holiday calendar (S25b, D-186): the demo year got the Turkish fixed-date holidays (audited once),
    // and no lesson or attendance falls on a closure day (29 October 2026 is a Thursday in the history).
    const closures = env.db.$client.prepare('select starts_on as d from school_closures order by starts_on').all() as Array<{ d: string }>;
    expect(closures.map((c) => c.d)).toContain('2026-10-29');
    expect(rows(`audit_events where action = 'closure.add_public_holidays'`)).toBe(1);
    expect(rows(`lessons where local_date in (select starts_on from school_closures)`)).toBe(0);
    expect(rows(`attendance_daily where local_date in (select starts_on from school_closures)`)).toBe(0);

    // Achievements (S13c): the quiet backfill and later automatic badges, about 40 manual badges (some
    // given in class), the teachers' own badges and one mistaken award revoked with a reason.
    expect(rows(`student_achievements where source = 'backfill' and quiet = 1`)).toBeGreaterThan(0);
    expect(rows(`student_achievements where source = 'auto'`)).toBeGreaterThan(0);
    const manual = rows(`student_achievements where source = 'manual' and revoked_at is null`);
    expect(manual).toBeGreaterThanOrEqual(25);
    expect(manual).toBeLessThanOrEqual(65);
    expect(rows(`student_achievements where source = 'manual' and lesson_id is not null`)).toBeGreaterThan(0);
    expect(rows(`student_achievements where revoke_reason = 'Given to the wrong student by mistake.'`)).toBe(1);
    expect(rows(`achievement_definitions where created_by is not null`)).toBeGreaterThanOrEqual(3);
    expect(rows(`student_achievements where achievement_id in (select id from achievement_definitions where key like 'speakers.%')`)).toBeGreaterThan(0);

    // Avatars (S13c): about 70 % chose one (ready-made or built), every stored spec passes the catalogue.
    const specs = env.db.select({ spec: students.avatarJson }).from(students).all();
    const chosen = specs.filter((s) => s.spec !== null);
    expect(chosen.length / specs.length).toBeGreaterThan(0.55);
    expect(chosen.length / specs.length).toBeLessThan(0.85);
    for (const s of chosen) expect(AvatarSpec.safeParse(s.spec).success).toBe(true);
    expect(chosen.some((s) => s.spec!.type === 'person') && chosen.some((s) => s.spec!.type === 'creature')).toBe(true);

    // Super Speakers (S12): switched on, one scorer link for the English teacher and one board link,
    // weeks of points with a few voided ones, points in every class, and a podium on this week's board.
    expect(isModuleAvailable(env.db, 'superSpeakers')).toBe(true);
    const scorerRows = env.db.$client.prepare(`select l.label, u.login from scorer_links l join users u on u.id = l.user_id`).all();
    expect(scorerRows).toEqual([{ label: 'Demo scorer', login: 'english' }]);
    expect(rows('display_links')).toBe(1);
    expect(rows('point_events where voided_at is null')).toBeGreaterThan(200);
    expect(rows('point_events where voided_at is not null')).toBeGreaterThanOrEqual(2);
    expect(rows(`point_events where void_reason is not null`)).toBe(1);
    expect(rows('(select distinct class_id_snapshot from point_events)')).toBe(rows('classes where archived_at is null'));
    expect(rows('(select distinct week_start from point_events)')).toBeGreaterThanOrEqual(9);
    const board = buildBoard(env.db, env.clock.now());
    expect(board.places.length).toBe(3);
    expect(board.week.start).toBe('2026-11-09');

    // Lesson goals (S28a, D-197): the opt-in module is switched on (audited, by the teacher) in 3-B and
    // 4-C English and 3-A Mathematics only; about two lessons in three there have a goal, most of them
    // answered with all three answers, some not (the report's "not recorded"); no goal anywhere else.
    const goalContexts = env.db.$client
      .prepare(
        `select c.name as cls, json_extract(s.name, '$.en') as subject from context_modules m join teaching_contexts t on t.id = m.context_id join classes c on c.id = t.class_id join subjects s on s.id = t.subject_id where m.module = 'lessonGoals' and m.enabled = 1 order by c.name, subject`,
      )
      .all();
    expect(goalContexts).toEqual([
      { cls: '3-A', subject: 'Mathematics' },
      { cls: '3-B', subject: 'English' },
      { cls: '4-C', subject: 'English' },
    ]);
    for (const id of contextIds) expect(isModuleEnabled(env.db, id, 'lessonGoals')).toBe(rows(`context_modules where module = 'lessonGoals' and enabled = 1 and context_id = '${id}'`) === 1);
    const goalLessons = rows(`lessons where context_id in (select context_id from context_modules where module = 'lessonGoals' and enabled = 1)`);
    const goalsSet = rows('lesson_goals');
    expect(goalsSet / goalLessons).toBeGreaterThan(0.5);
    expect(goalsSet / goalLessons).toBeLessThan(0.85);
    expect(rows(`lesson_goals where context_id not in (select context_id from context_modules where module = 'lessonGoals' and enabled = 1)`)).toBe(0);
    const answered = rows('lesson_goals where outcome is not null');
    expect(answered / goalsSet).toBeGreaterThan(0.7);
    expect(answered).toBeLessThan(goalsSet);
    const outcomes = env.db.$client.prepare(`select distinct outcome from lesson_goals where outcome is not null order by outcome`).all() as Array<{ outcome: string }>;
    expect(outcomes.map((o) => o.outcome)).toEqual(['notYet', 'partly', 'reached']);
    expect(rows(`audit_events where action = 'context_module.set'`)).toBeGreaterThanOrEqual(3);
    expect(rows(`audit_events where action = 'lesson_goal.set'`)).toBeGreaterThanOrEqual(goalsSet);
    expect(rows(`audit_events where action = 'lesson_goal.review'`)).toBe(answered);
    for (const text of env.db.$client.prepare('select text from lesson_goals').all() as Array<{ text: string }>) expect(text.text.length).toBeLessThanOrEqual(140);

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
    // S14e1 (D-153): with weeks of history in every module, each produced section and table is in
    // the report catalogue (`ReportContribution.meta`), so saved views can name it.
    const catalogue = allReportContributions();
    for (const c of contexts) {
      const r = await ok(english.get(`/api/teacher/contexts/${c.id}/report?from=2026-09-01&to=2026-11-08`));
      for (const sec of r.sections as Array<{ key: string; tables: Array<{ key: string }> }>) {
        const meta = catalogue.find((x) => x.key === sec.key)?.meta;
        expect(meta, sec.key).toBeTruthy();
        for (const t of sec.tables) expect(meta!.tables.some((m) => tableMatches(m, t.key)), `${sec.key}.${t.key}`).toBe(true);
      }
    }
    // The report section "Lesson goals" (D-188) has data in 3-B English and is not in 3-A English (off).
    const c3b = contexts.find((c) => c.className === '3-B')!;
    const goals3b = (await ok(english.get(`/api/teacher/contexts/${c3b.id}/report?from=2026-09-01&to=2026-11-08`))).sections.find((s: any) => s.key === 'lessonGoals');
    expect(goals3b?.tables.map((t: any) => t.key)).toEqual(['outcomes', 'lessons']);
    expect(goals3b.metrics.length).toBe(3);
    expect(keys).not.toContain('lessonGoals');
    const kid = report.students[0];
    const timeline = await ok(english.get(`/api/teacher/contexts/${c3a.id}/students/${kid.id}/timeline`));
    expect(JSON.stringify(timeline).length).toBeGreaterThan(500);
    const goalsPage = await ok(english.get(`/api/teacher/contexts/${c3a.id}/goals`));
    expect(JSON.stringify(goalsPage)).toContain('activeGoals');

    const page = await ok((await openLink(env, await linkUrl(english, c3a.classId, kid.id))).get('/api/student/page'));
    const sectionKeys = page.subjects.flatMap((s: any) => s.sections.map((x: any) => x.key));
    expect(sectionKeys).toContain('goals');
    expect(sectionKeys).toContain('homework');
    expect(sectionKeys).toContain('achievements');

    // A second run refuses with a clear message and writes nothing.
    const before = rows('audit_events');
    expect(() => seedDemoHistory(env.deps)).toThrow(SeedRefused);
    expect(() => seedDemoHistory(env.deps)).toThrow(/already has history/);
    expect(rows('audit_events')).toBe(before);
  }, 240_000); // the whole history run (about 20 s alone; much slower while every test file runs in parallel)

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

  it('uses only student text that passes the S13c text checks (D-123)', () => {
    const fails: string[] = [];
    const check = (texts: readonly string[], kind: TextKind) => {
      for (const t of texts) {
        const res = checkStudentText(t, kind);
        if (!res.ok) fails.push(`${kind}: ${t} (${res.reason})`);
      }
    };
    check(Object.values(TEXT.STUDENT_GOALS).flat(), 'goal');
    check(TEXT.REFLECTIONS, 'reflection');
    check(TEXT.REFLECTIONS, 'selfAssessment');
    check(TEXT.STUDENT_NOTES, 'note');
    check(TEXT.TEXT_EVIDENCE, 'evidenceText');
    check(Object.values(TEXT.PRACTICE_CHOICES).flat(), 'practiceChoice');
    check(TEXT.LINK_TITLES, 'linkTitle');
    for (const url of TEXT.LINK_EVIDENCE) if (findRiskyWord(urlWords(url))) fails.push(`link: ${url}`);
    expect(fails).toEqual([]);
  });
});
