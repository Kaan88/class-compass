/**
 * Demo history generators (seed:demo-history): the shapes every per-module generator works with.
 * See docs/EXTENDING.md "Demo history generators". Fictional data only.
 */
import type { z } from 'zod';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import type { AssistantToday } from '../../../shared/contracts/assistant.ts';
import type { CountersLessonState } from '../../../shared/contracts/counters.ts';
import type { GroupingLessonState } from '../../../shared/contracts/grouping.ts';
import type { AppDeps, RequestContext, UserRow } from '../../lib/context.ts';
import type { ClassRow, ContextRow } from '../../modules/school/policy.ts';
import type { StudentRow } from '../../modules/students/service.ts';

/** One class+subject (teaching context) with its fictional weekly timetable. */
export interface ContextPlan {
  context: ContextRow;
  cls: ClassRow;
  /** Lower-case English subject name ('english', 'mathematics', 'science', …) for text banks. */
  subject: string;
  teacher: UserRow;
  /** Teacher request context on the backdated clock. */
  ctx: RequestContext;
  /** ISO weekday (1 = Monday) → local start time 'HH:MM' of the lesson that day. */
  timetable: ReadonlyMap<number, string>;
  /** Every history day with a lesson of this context (cancelled lessons left out), ascending. */
  lessonDates: string[];
  /** Students of the class on the first history day (fixed for the demo). */
  students: StudentRow[];
  /** True for the first context of this class+subject (student-side work is done once per subject). */
  primaryForSubject: boolean;
}

/** One school week of the history. */
export interface HistoryWeek {
  index: number;
  weekStart: string;
  /** School days of this week inside the history, ascending. */
  days: string[];
  last: boolean;
}

/** One lesson while it runs. Generators may keep their own per-lesson notes in `scratch`. */
export interface LessonRun {
  plan: ContextPlan;
  date: string;
  week: HistoryWeek;
  lessonId: string;
  /** Planned start and end (epoch ms); `at(f)` is the instant at fraction f of the lesson. */
  startAt: number;
  endAt: number;
  /** Polled lesson state right after the start (as the classroom screen sees it). */
  state: {
    lesson: LessonState | null;
    counters: CountersLessonState | null;
    assistant: AssistantToday | null;
    grouping: GroupingLessonState | null;
  };
  /** n-th lesson of this context in the history (0-based) and whether it is the last one. */
  index: number;
  isLast: boolean;
  /** False for the rare lesson the teacher forgets to end (abandoned when the next one starts). */
  ends: boolean;
  scratch: Record<string, unknown>;
}

/** What the run hands to every generator. */
export interface HistoryRun {
  deps: AppDeps;
  tz: string;
  /** First and last history day and the first day that is NOT history (today, local). */
  from: string;
  to: string;
  today: string;
  weeks: readonly HistoryWeek[];
  plans: readonly ContextPlan[];
  // ---- deterministic randomness (mulberry32)
  rand(): number;
  chance(p: number): boolean;
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  shuffle<T>(xs: readonly T[]): T[];
  // ---- the backdated clock
  now(): number;
  setTime(ms: number): void;
  /** Epoch ms of local wall time `hhmm` on local date `date` in the school timezone. */
  at(date: string, hhmm: string): number;
  /** Sets the clock to fraction `f` (0…1) of a lesson. */
  during(lesson: LessonRun, f: number): void;
  // ---- acting like the app
  /** A student request context (the personal page), on the same clock. */
  student(studentId: string): RequestContext;
  /** Runs an outbox command through the real command processor. Throws on a rejection unless its reason is in `allow`. */
  command(ctx: RequestContext, type: string, payload: Record<string, unknown>, allow?: readonly string[]): { ok: boolean; result: any; reason?: string };
  /** Validates `input` with the endpoint's schema (defaults applied) and calls the service with it. */
  call<E extends { input: z.ZodType }, R>(ep: E, fn: (ctx: RequestContext, input: z.infer<E['input']>) => R, ctx: RequestContext, input: z.input<E['input']>): R;
  /** Runs `fn`; a business refusal (AppError) is swallowed and returns undefined. */
  attempt<R>(fn: () => R): R | undefined;
  /** Adds to the summary printed at the end (per generator key). */
  count(key: string, what: string, n?: number): void;
  /** Per-generator memory shared across hooks (created on first use). */
  memo<T>(key: string, init: () => T): T;
  /** Students of the class who are in the room for this lesson (not absent or excused), from the database. */
  present(lesson: LessonRun): string[];
}

/**
 * One generator per module, keyed by the module's catalogue key (`module`, null = core). The run
 * skips a generator for a class+subject where its module is switched off, and skips it everywhere
 * when the key is not in this build's catalogue (a module that is not merged yet). Hooks run in
 * registry order; all of them are optional and synchronous.
 */
export interface HistoryGenerator {
  key: string;
  module: string | null;
  /** Once per class+subject before the first lesson (settings, default rows, plans). */
  setup?(h: HistoryRun, plan: ContextPlan): void;
  /** Monday morning of each week, before its first lesson. */
  startOfWeek?(h: HistoryRun, plan: ContextPlan, week: HistoryWeek): void;
  /** Fields merged into the 'lesson.start' payload. */
  startInput?(h: HistoryRun, plan: ContextPlan, date: string): Record<string, unknown>;
  /** While the lesson runs (use `h.during(lesson, f)` to place events in the lesson). */
  duringLesson?(h: HistoryRun, lesson: LessonRun): void;
  /** End Lesson step inputs (`payload.steps`) merged into 'lesson.end'. */
  endSteps?(h: HistoryRun, lesson: LessonRun): Record<string, unknown>;
  /** Teacher-area work after the lesson (marking, planning). Also runs for an abandoned lesson. */
  afterLesson?(h: HistoryRun, lesson: LessonRun): void;
  /** After the last school day of each week (evening and weekend work). */
  endOfWeek?(h: HistoryRun, plan: ContextPlan, week: HistoryWeek): void;
}
