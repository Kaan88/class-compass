/**
 * Fictional demo history (seed:demo-history, test VM only). Runs after `seed:demo` on the demo school
 * and fills the past school weeks (default 9 full weeks plus the days of this week before today) with
 * what the app would have recorded: lessons on a weekly timetable (school days only, in the school
 * timezone), attendance, counters, groups, assistants, Secret Students, homework, goals, reflections,
 * feedback, evidence and private notes, achievements (automatic and given by teachers), avatars and
 * Super Speakers points (the school-wide module is switched on, with one scorer and one board link).
 *
 * - Everything goes through the real command processor (`executeCommand`) and module services, with a
 *   backdated clock (`deps.now`), so the rows are what the app itself would write (audit rows, command
 *   log, snapshots). The only direct write: the demo teaching assignments' `activeFrom` is moved to the
 *   start of the school year, because the demo seed creates them "now" and no service backdates them.
 * - Per-module generators live in `seed/history/` and are listed in `HISTORY_GENERATORS`; a generator
 *   is skipped where its module is switched off, or everywhere when its module is not in this build.
 * - Deterministic randomness (mulberry32). Some modules draw with their own server randomness
 *   (Secret Students), so those choices differ between runs.
 * - Refuses in production, without the demo school, and when any history exists already. The whole
 *   run is one transaction: a failure leaves nothing behind.
 */
import { TZDate } from '@date-fns/tz';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import type { z } from 'zod';
import { isAway } from '../../domain/attendance.ts';
import { weekStartOfDate } from '../../domain/counters.ts';
import { addDays, localDate, weekdayOf } from '../../domain/dates.ts';
import { CONTEXT_MODULES, SCHOOL_MODULES, type ContextModule, type SchoolModule } from '../../shared/modules.ts';
import { tx } from '../db/client.ts';
import { classes, goals, homeworkAssignments, lessons, schoolYears, studentLinks, subjects, teachingContexts, users } from '../db/schema.ts';
import { audit } from '../lib/audit.ts';
import { executeCommand } from '../lib/commands.ts';
import type { Actor, AppDeps, RequestContext, UserRow } from '../lib/context.ts';
import { AppError } from '../lib/errors.ts';
import { ensureAchievementDefaults } from '../modules/achievements/defaults.ts';
import { installModules } from '../modules/index.ts';
import { rosterWithAttendance } from '../modules/attendance/service.ts';
import { ensureGoalDefaults } from '../modules/goals/library.ts';
import { lessonState } from '../modules/lessons/service.ts';
import { ensureSchoolDefaults } from '../modules/school/defaults.ts';
import { isModuleAvailable, isModuleEnabled } from '../modules/school/modules.ts';
import { getSchoolSettings, type ClassRow } from '../modules/school/policy.ts';
import { rosterRowsOn } from '../modules/students/service.ts';
import { mulberry32, SeedRefused } from './demo.ts';
import { isSchoolDay } from './history/calendar.ts';
import { HISTORY_GENERATORS } from './history/generators.ts';
import type { ContextPlan, HistoryGenerator, HistoryRun, HistoryWeek, LessonRun } from './history/types.ts';

export const DEMO_SCHOOL_NAME = 'Demo Primary School';
const DEMO_LOGINS = { admin: 'admin', teachers: ['english', 'classroom3a'] } as const;
const DEMO_CLASSES = ['3-A', '3-B', '4-C', '2-D'] as const;
/** Lesson start times (local) and length. */
const PERIODS = ['08:40', '09:30', '10:30', '11:20', '13:10', '14:00'] as const;
const LESSON_MINUTES = 38;
const WEEKLY_PATTERNS: Record<number, number[]> = { 1: [3], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] };

export interface HistoryOptions {
  /** Full school weeks before the current one (1–20, default 9). */
  weeks?: number;
}

export interface HistoryResult {
  from: string;
  to: string;
  weeks: number;
  schoolDays: number;
  lessons: number;
  abandoned: number;
  contexts: number;
  /** Per generator key: what it created. */
  counts: Record<string, Record<string, number>>;
  elapsedMs: number;
}

const isoWeekday = (date: string) => (weekdayOf(date) === 0 ? 7 : weekdayOf(date));
const countRows = (deps: AppDeps, table: typeof lessons | typeof homeworkAssignments | typeof goals) => deps.db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;

/** Refuses (SeedRefused) unless this is the untouched demo school; returns its accounts and year. */
function checkDemoSchool(deps: AppDeps) {
  const settings = getSchoolSettings(deps.db);
  if (settings.schoolName !== DEMO_SCHOOL_NAME) throw new SeedRefused(`This is not the demo school (school name "${settings.schoolName ?? ''}"). Run seed:demo on an empty database first.`);
  const accounts = deps.db.select().from(users).where(inArray(users.login, [DEMO_LOGINS.admin, ...DEMO_LOGINS.teachers])).all();
  const roleOf = (login: string) => accounts.find((u) => u.login === login)?.role;
  if (roleOf(DEMO_LOGINS.admin) !== 'admin' || DEMO_LOGINS.teachers.some((t) => roleOf(t) !== 'teacher')) {
    throw new SeedRefused('The demo accounts (admin, english, classroom3a) are missing. Run seed:demo on an empty database first.');
  }
  const found = deps.db.select().from(classes).where(and(inArray(classes.name, [...DEMO_CLASSES]), isNull(classes.archivedAt))).all();
  if (found.length < DEMO_CLASSES.length) throw new SeedRefused('The demo classes (3-A, 3-B, 4-C, 2-D) are missing or archived. Run seed:demo on an empty database first.');
  const year = deps.db.select().from(schoolYears).where(eq(schoolYears.id, found[0]!.schoolYearId)).get();
  if (!year || year.archivedAt) throw new SeedRefused('The demo school year is archived.');
  const existing = { lessons: countRows(deps, lessons), homework: countRows(deps, homeworkAssignments), goals: countRows(deps, goals) };
  if (existing.lessons || existing.homework || existing.goals) {
    throw new SeedRefused(
      `The demo school already has history (${existing.lessons} lessons, ${existing.homework} homework, ${existing.goals} goals). seed:demo-history runs once, on a fresh demo school: start again with an empty database and seed:demo.`,
    );
  }
  return { year, classIds: new Set(found.map((c) => c.id)), admin: accounts.find((u) => u.login === DEMO_LOGINS.admin)! };
}

/** School days of the history: `weeks` full weeks before this one plus this week's days before today. */
function historyWeeks(today: string, yearStart: string, weeks: number, weekStartsOn: number): HistoryWeek[] {
  const first = addDays(weekStartOfDate(today, weekStartsOn), -7 * weeks);
  const out: HistoryWeek[] = [];
  for (let d = first < yearStart ? yearStart : first; d < today; d = addDays(d, 1)) {
    if (!isSchoolDay(d)) continue;
    const ws = weekStartOfDate(d, weekStartsOn);
    let w = out[out.length - 1];
    if (!w || w.weekStart !== ws) out.push((w = { index: out.length, weekStart: ws, days: [], last: false }));
    w.days.push(d);
  }
  if (out.length) out[out.length - 1]!.last = true;
  return out;
}

const subjectKey = (name: { en?: string; tr?: string }) => (name.en ?? name.tr ?? 'other').trim().toLowerCase();
const lessonsPerWeek = (subject: string, students: number) => (subject === 'english' ? (students <= 5 ? 2 : 3) : subject === 'mathematics' ? 5 : 2);

export function seedDemoHistory(deps: AppDeps, opts: HistoryOptions = {}): HistoryResult {
  if (deps.config.isProd) throw new SeedRefused('Refusing to seed demo history when NODE_ENV=production.');
  const started = Date.now();
  const weeksWanted = opts.weeks ?? 9;
  if (!Number.isInteger(weeksWanted) || weeksWanted < 1 || weeksWanted > 20) throw new SeedRefused('--weeks must be a whole number from 1 to 20.');
  ensureSchoolDefaults(deps);
  ensureGoalDefaults(deps.db, deps.now());
  // Started by the achievements routes in the app; the CLI does not register routes.
  ensureAchievementDefaults(deps.db, deps.now());
  installModules();
  const { year, classIds, admin } = checkDemoSchool(deps);
  const settings = getSchoolSettings(deps.db);
  const tz = settings.timezone;
  const realNow = deps.now();
  const today = localDate(realNow, tz);
  const weeks = historyWeeks(today, year.startsOn, weeksWanted, settings.weekStartsOn);
  const days = weeks.flatMap((w) => w.days);
  if (!days.length) throw new SeedRefused('There are no past school days in this school year yet, so there is no history to fill.');

  // ---------------------------------------------------------------- the run (clock, randomness, helpers)
  let clock = realNow;
  const now = () => clock;
  const rand = mulberry32(20261108);
  const counts: Record<string, Record<string, number>> = {};
  const memos = new Map<string, unknown>();
  const at = (date: string, hhmm: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
    return new TZDate(y, m - 1, d, hh, mm, 0, tz).getTime();
  };
  const requestContext = (user: UserRow | null, student: { studentId: string; linkId: string } | null, actor: Actor): RequestContext => ({
    db: deps.db,
    config: deps.config,
    now,
    mailer: null,
    ip: '127.0.0.1',
    session: null,
    user,
    student,
    actor,
  });
  const studentCtx = new Map<string, RequestContext>();
  const plans: ContextPlan[] = [];

  const h: HistoryRun = {
    deps: { ...deps, now },
    tz,
    from: days[0]!,
    to: days[days.length - 1]!,
    today,
    realNow,
    weeks,
    plans,
    rand,
    chance: (p) => rand() < p,
    int: (min, max) => min + Math.floor(rand() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(rand() * xs.length)]!,
    shuffle: (xs) => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
    now,
    setTime: (ms) => {
      // History never reaches today: anything placed at or after the real "now" would be in the future.
      if (ms >= realNow) throw new Error(`demo history tried to write at ${new Date(ms).toISOString()}, which is not in the past`);
      clock = ms;
    },
    at,
    during: (lesson, f) => h.setTime(Math.round(lesson.startAt + Math.min(1, Math.max(0, f)) * (lesson.endAt - lesson.startAt))),
    admin: requestContext(admin, null, { type: 'user', id: admin.id, role: 'admin' }),
    student: (studentId) => {
      let c = studentCtx.get(studentId);
      if (!c) {
        // The student's permanent link (made automatically with the student, D-115), as if they opened it.
        const link = deps.db.select({ id: studentLinks.id }).from(studentLinks).where(and(eq(studentLinks.studentId, studentId), isNull(studentLinks.revokedAt))).get();
        studentCtx.set(studentId, (c = requestContext(null, { studentId, linkId: link?.id ?? 'demo-history' }, { type: 'student', id: studentId })));
      }
      return c;
    },
    command: (ctx, type, payload, allow = []) => {
      const r = executeCommand(ctx, {
        opId: v7({ msecs: clock }),
        type,
        payload,
        ...(typeof payload.contextId === 'string' ? { contextId: payload.contextId } : {}),
        ...(typeof payload.lessonId === 'string' ? { lessonId: payload.lessonId } : {}),
        clientTime: clock,
      });
      if (!r.ok && !(r.error?.reason && allow.includes(r.error.reason))) throw new Error(`demo history: ${type} was refused (${r.error?.code} ${r.error?.reason ?? ''}: ${r.error?.message})`);
      return { ok: r.ok, result: r.result as any, ...(r.error?.reason ? { reason: r.error.reason } : {}) };
    },
    call: <E extends { input: z.ZodType }, R>(ep: E, fn: (ctx: RequestContext, input: z.infer<E['input']>) => R, ctx: RequestContext, input: z.input<E['input']>): R => fn(ctx, ep.input.parse(input) as z.infer<E['input']>),
    attempt: (fn) => {
      try {
        return fn();
      } catch (err) {
        if (err instanceof AppError) return undefined;
        throw err;
      }
    },
    count: (key, what, n = 1) => {
      if (!n) return;
      const c = (counts[key] ??= {});
      c[what] = (c[what] ?? 0) + n;
    },
    memo: <T,>(key: string, init: () => T): T => {
      if (!memos.has(key)) memos.set(key, init());
      return memos.get(key) as T;
    },
    present: (lesson) =>
      rosterWithAttendance(deps.db, lesson.plan.cls.id, lesson.date, lesson.lessonId, isModuleEnabled(deps.db, lesson.plan.context.id, 'attendance'))
        .filter((s) => !isAway(s.effective))
        .map((s) => s.id),
  };

  const isContextModule = (m: string): m is ContextModule => (CONTEXT_MODULES as readonly string[]).includes(m);
  const isSchoolModule = (m: string): m is SchoolModule => (SCHOOL_MODULES as readonly string[]).includes(m);
  /** Class+subject hooks: core, an enabled context module, or a school-wide module that is on. */
  const enabled = (g: HistoryGenerator, contextId: string) =>
    g.module === null || (isContextModule(g.module) ? isModuleEnabled(deps.db, contextId, g.module) : isSchoolModule(g.module) && isModuleAvailable(deps.db, g.module));
  const generatorsFor = (contextId: string) => HISTORY_GENERATORS.filter((g) => enabled(g, contextId));
  /** School-level hooks: every generator whose module is in this build (a school-wide one switches itself on). */
  const schoolGenerators = HISTORY_GENERATORS.filter((g) => g.module === null || isSchoolModule(g.module) || (isContextModule(g.module) && isModuleAvailable(deps.db, g.module)));

  return tx(deps.db, () => {
    // ---------------------------------------------------------------- teaching contexts and the timetable
    const yearStartAt = at(year.startsOn, '08:00');
    const rows = deps.db
      .select({ context: teachingContexts, cls: classes, subject: subjects, teacher: users })
      .from(teachingContexts)
      .innerJoin(classes, eq(classes.id, teachingContexts.classId))
      .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
      .innerJoin(users, eq(users.id, teachingContexts.teacherId))
      .where(and(isNull(teachingContexts.endedAt), eq(users.role, 'teacher')))
      .all()
      .filter((r) => classIds.has(r.cls.id))
      .sort((a, b) => a.cls.name.localeCompare(b.cls.name) || subjectKey(a.subject.name).localeCompare(subjectKey(b.subject.name)) || a.teacher.login.localeCompare(b.teacher.login));
    // The demo seed creates its teaching assignments "now"; the history needs them from the first day.
    for (const r of rows) {
      if (r.context.activeFrom > yearStartAt) {
        deps.db.update(teachingContexts).set({ activeFrom: yearStartAt, createdAt: Math.min(r.context.createdAt, yearStartAt) }).where(eq(teachingContexts.id, r.context.id)).run();
        r.context = { ...r.context, activeFrom: yearStartAt, createdAt: Math.min(r.context.createdAt, yearStartAt) };
      }
    }
    const classBusy = new Set<string>();
    const teacherBusy = new Set<string>();
    const subjectSeen = new Set<string>();
    const classIndex = new Map<string, number>();
    const perClass = new Map<string, number>();
    for (const r of rows) {
      const ci = classIndex.get(r.cls.id) ?? classIndex.size;
      classIndex.set(r.cls.id, ci);
      const k = perClass.get(r.cls.id) ?? 0;
      perClass.set(r.cls.id, k + 1);
      const subject = subjectKey(r.subject.name);
      const roster = rosterRowsOn(deps.db, r.cls.id, days[0]!).map((x) => x.student);
      const pattern = WEEKLY_PATTERNS[lessonsPerWeek(subject, roster.length)]!;
      const timetable = new Map<number, string>();
      for (const d of pattern.map((x) => ((x - 1 + ci + k) % 5) + 1)) {
        for (let p = 0; p < PERIODS.length; p++) {
          const period = PERIODS[(p + ci * 2 + k) % PERIODS.length]!;
          if (classBusy.has(`${r.cls.id}:${d}:${period}`) || teacherBusy.has(`${r.teacher.id}:${d}:${period}`)) continue;
          classBusy.add(`${r.cls.id}:${d}:${period}`);
          teacherBusy.add(`${r.teacher.id}:${d}:${period}`);
          timetable.set(d, period);
          break;
        }
      }
      const subjectOfClass = `${r.cls.id}:${r.context.subjectId}`;
      const user = r.teacher;
      plans.push({
        context: r.context,
        cls: r.cls as ClassRow,
        subject,
        teacher: user,
        ctx: requestContext(user, null, { type: 'user', id: user.id, role: 'teacher' }),
        timetable,
        // A few lessons do not happen (a trip, a school event); never the first or the last one.
        lessonDates: days.filter((d, i) => timetable.has(isoWeekday(d)) && !(i > 2 && i < days.length - 3 && rand() < 0.03)),
        students: roster,
        primaryForSubject: !subjectSeen.has(subjectOfClass),
      });
      subjectSeen.add(subjectOfClass);
    }

    // ---------------------------------------------------------------- setup, then week by week
    clock = Math.min(at(days[0]!, '07:30'), realNow - 60_000);
    for (const g of schoolGenerators) g.setupSchool?.(h);
    clock = Math.min(at(days[0]!, '07:30'), realNow - 60_000);
    for (const plan of plans) for (const g of generatorsFor(plan.context.id)) g.setup?.(h, plan);

    const lessonIndex = new Map<string, number>();
    let lessonCount = 0;
    let abandoned = 0;
    for (const week of weeks) {
      for (const plan of plans) for (const g of generatorsFor(plan.context.id)) g.startOfWeek?.(h, plan, week);
      const slots = plans
        .flatMap((plan) => week.days.filter((d) => plan.lessonDates.includes(d)).map((date) => ({ plan, date, startAt: at(date, plan.timetable.get(isoWeekday(date))!) })))
        .sort((a, b) => a.startAt - b.startAt);
      for (const { plan, date, startAt } of slots) {
        const gens = generatorsFor(plan.context.id);
        const index = lessonIndex.get(plan.context.id) ?? 0;
        lessonIndex.set(plan.context.id, index + 1);
        const isLast = index === plan.lessonDates.length - 1;
        h.setTime(startAt);
        const start: Record<string, unknown> = { contextId: plan.context.id };
        for (const g of gens) Object.assign(start, g.startInput?.(h, plan, date));
        const res = h.command(plan.ctx, 'lesson.start', start).result as { started: boolean; lessonId: string };
        if (!res.started) throw new Error(`demo history: a lesson of ${plan.cls.name} was already running on ${date}`);
        h.setTime(startAt + 60_000);
        const body = lessonState(plan.ctx, plan.context.id).body;
        const lesson: LessonRun = {
          plan,
          date,
          week,
          lessonId: res.lessonId,
          startAt,
          endAt: startAt + LESSON_MINUTES * 60_000,
          state: { lesson: body.lesson, counters: body.counters, assistant: body.assistant, grouping: body.grouping },
          index,
          isLast,
          ends: isLast || rand() >= 0.015,
          scratch: {},
        };
        for (const g of gens) g.duringLesson?.(h, lesson);
        if (lesson.ends) {
          h.setTime(Math.max(lesson.endAt, clock + 1000));
          const steps: Record<string, unknown> = {};
          for (const g of gens) Object.assign(steps, g.endSteps?.(h, lesson));
          h.command(plan.ctx, 'lesson.end', { contextId: plan.context.id, lessonId: lesson.lessonId, steps });
        } else abandoned++;
        h.setTime(Math.max(lesson.endAt, clock) + 2 * 60_000);
        for (const g of gens) g.afterLesson?.(h, lesson);
        lessonCount++;
      }
      for (const plan of plans) for (const g of generatorsFor(plan.context.id)) g.endOfWeek?.(h, plan, week);
      for (const g of schoolGenerators) g.endOfSchoolWeek?.(h, week);
    }
    for (const g of schoolGenerators) g.finish?.(h);
    // An abandoned last lesson cannot happen (the last one always ends), so nothing is left running.
    clock = realNow;
    audit(deps.db, { type: 'system', id: null }, { action: 'demo.seed_history', entity: 'school', after: { from: h.from, to: h.to, lessons: lessonCount } }, realNow);
    return {
      from: h.from,
      to: h.to,
      weeks: weeks.length,
      schoolDays: days.length,
      lessons: lessonCount,
      abandoned,
      contexts: plans.length,
      counts,
      elapsedMs: Date.now() - started,
    };
  });
}
