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
import type { ContextModule } from '../../shared/modules.ts';
import type { AnyCommandDef } from '../lib/commands.ts';
import type { AppDeps, RequestContext } from '../lib/context.ts';
import type { AttendanceListener } from './attendance/service.ts';
import type { EndLessonStep } from './lessons/endSteps.ts';
import type { LessonCloseHook, LessonStateContributor } from './lessons/service.ts';
import type { ModuleConfigSpec } from './school/modules.ts';
import type { ClassRow, ContextRow } from './school/policy.ts';
import type { StudentPageSection } from '../../shared/contracts/goals.ts';

/** Filter of a report request (S11). */
export interface ReportQuery {
  contextId: string;
  from: string;
  to: string;
}

/**
 * A module's section of the teacher reports (RPT-1..5). Hook for S11: the reports module calls
 * `reportContributions(db, contextId)`, which returns only the contributions of core modules and of
 * modules enabled for that class+subject (each is stamped with its manifest's policy key at
 * registration); until then nothing serves them.
 */
export interface ReportContribution {
  key: string;
  order: number;
  build: (ctx: RequestContext, query: ReportQuery) => unknown;
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
  policyKey: ContextModule | null;
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
  /** S11 reports hook (collected, not yet served). */
  reports?: readonly ReportContribution[];
  /** S10 student page sections (served by the links module's `/api/student/page`). */
  studentPage?: readonly StudentPageContribution[];
  /** Default config + Zod schema for `context_modules.configJson` of `policyKey`. */
  config?: ModuleConfigSpec;
}

/** Identity helper that type-checks a manifest. */
export const defineServerModule = (m: ServerModuleManifest): ServerModuleManifest => m;
