/**
 * Server module manifest (SX, D-069; ARCHITECTURE §2). Every folder under `src/server/modules/` has
 * ONE `manifest.ts` that declares everything the module plugs into the app, and
 * `src/server/modules/index.ts` lists the manifests. Nothing registers itself through an import side
 * effect: `installModules()` registers commands, hooks and config schemas once, and
 * `registerModules(app, deps)` adds each manifest's routes to a Fastify instance.
 *
 * Adding a module: see docs/EXTENDING.md (or `npm run new:module -- <key>`).
 */
import type { FastifyInstance } from 'fastify';
import type { PolicyKey } from '../../shared/modules.ts';
import type { ActivityListener } from '../lib/activity.ts';
import type { AnyCommandDef } from '../lib/commands.ts';
import type { AppDeps, RequestContext } from '../lib/context.ts';
import type { AttendanceListener } from './attendance/service.ts';
import type { EndLessonStep } from './lessons/endSteps.ts';
import type { LessonCloseHook, LessonStateContributor } from './lessons/service.ts';
import type { ModuleConfigSpec } from './school/modules.ts';
import type { ClassRow, ContextRow, YearRow } from './school/policy.ts';
import type { StudentRow } from './students/service.ts';
import type { lessons } from '../db/schema.ts';
import type { ReportSectionData, TimelineEvent } from '../../shared/contracts/reports.ts';
import type { StudentPageSection } from '../../shared/contracts/goals.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';

type LessonRow = typeof lessons.$inferSelect;

/**
 * What a report is built for (S11, RPT-2): one class+subject (teaching context), a period of local
 * dates and optionally one student. Built once by the reports module after the access check; section
 * builders only read.
 */
export interface ReportScope {
  context: ContextRow;
  cls: ClassRow;
  year: YearRow;
  from: string;
  to: string;
  today: string;
  timezone: string;
  weekStartsOn: number;
  /** The class+subject's own teacher, or an administrator (who never sees lesson reflection notes). */
  viewer: 'teacher' | 'admin';
  /** null = the whole class. */
  studentId: string | null;
  /** Students in the class at any time in the period (just the chosen one with a student filter), by name. */
  students: StudentRow[];
  /** Was the student in this class on that local date (date-aware enrolments, D-027)? */
  enrolledOn: (studentId: string, date: string) => boolean;
  /** Lessons of this class+subject that were held (ended) in the period, oldest first. */
  lessons: LessonRow[];
}

/**
 * A module's section of the reports (RPT-1..5, D-091). The reports module calls
 * `reportContributions(db, contextId)`, which returns only the contributions of core modules and of
 * modules enabled for that class+subject (each is stamped with its manifest's policy key). `build`
 * returns typed cells only (shared `ReportSection`): counts with denominators, "not recorded",
 * "absent", "not applicable" — never an invented metric or an overall score — or null to leave the
 * section out. It must not return pre-reveal Secret Student identities or private teacher notes.
 */
export interface ReportContribution {
  key: string;
  order: number;
  /**
   * S14e1 (D-153): what the section can contain, for the report catalogue and saved views (the
   * Customise tree). `title` is the section's title; `tables` lists every table `build` may return,
   * by key (`perItem`: one table per item, keyed `<key>-<id>`, e.g. one per counter). Test-enforced
   * against the tables the sections actually produce.
   */
  meta: ReportSectionMeta;
  /**
   * Called only when the section is requested (`ReportInput.sections`); the reports module then
   * keeps only the requested tables.
   */
  build: (ctx: RequestContext, scope: ReportScope) => ReportSectionData | null;
}

export interface ReportTableMeta {
  key: string;
  title: MessageKey;
  perItem?: boolean;
}

export interface ReportSectionMeta {
  title: MessageKey;
  tables: readonly ReportTableMeta[];
}

/** A module's events in one student's timeline (RPT-1): only records the teacher may see. */
export interface TimelineContribution {
  key: string;
  order: number;
  build: (ctx: RequestContext, scope: ReportScope, studentId: string) => TimelineEvent[];
}

/** What a student page section is built for: the student (from the link session only) in one class+subject. */
export interface StudentPageInput {
  studentId: string;
  context: ContextRow;
  cls: ClassRow;
}

/**
 * A module's section of a student's personal page (STU-2). The links module serves
 * `/api/student/page`: for each subject of the classes the student is in today it calls the
 * contributions of the modules enabled there (`studentPageContributions(db, contextId)`), with the
 * student id from the link session only (STU-4/5). `build` returns that student's permitted records
 * only, in the shape of its key in the shared `StudentPageSection` union (an allow-list), or null to
 * leave the section out.
 */
export interface StudentPageContribution {
  key: StudentPageSection['key'];
  order: number;
  build: (ctx: RequestContext, input: StudentPageInput) => StudentPageSection['data'] | null;
}

export interface ServerModuleManifest {
  /** Folder name under src/server/modules (unique). */
  key: string;
  /**
   * Module policy key from the shared catalogue (`src/shared/modules.ts`) that switches this module
   * per class+subject, or null for a core module that is always on (auth, school, lessons…).
   */
  policyKey: PolicyKey | null;
  /** Adds the module's HTTP endpoints (each declared in shared/contracts with `endpoint()` and `route()`). */
  routes?: (app: FastifyInstance, deps: AppDeps) => void;
  /** Outbox commands (`command({...})` from lib/commands.ts). */
  commands?: readonly AnyCommandDef[];
  /** Classroom-safe data added to the polled lesson state (D-045); must be safe for the classroom display. */
  lessonState?: readonly LessonStateContributor[];
  /** End Lesson steps (D-051); `module` must be this manifest's policyKey (or null for core steps). */
  endSteps?: readonly EndLessonStep[];
  /** Runs inside the transaction that ends or abandons a lesson (D-067). */
  lessonCloseHooks?: readonly LessonCloseHook[];
  /** Runs inside every attendance write (D-067). */
  attendanceListeners?: readonly AttendanceListener[];
  /** Runs inside every write that records something a student did (S13c, `lib/activity.ts`). */
  activityListeners?: readonly ActivityListener[];
  /** Report sections (S11, served by the reports module). */
  reports?: readonly ReportContribution[];
  /** Student timeline events (S11, served by the reports module). */
  timeline?: readonly TimelineContribution[];
  /** S10 student page sections (served by the links module's `/api/student/page`). */
  studentPage?: readonly StudentPageContribution[];
  /** Default config + Zod schema for `context_modules.configJson` of `policyKey`. */
  config?: ModuleConfigSpec;
}

/** Identity helper that type-checks a manifest. */
export const defineServerModule = (m: ServerModuleManifest): ServerModuleManifest => m;
