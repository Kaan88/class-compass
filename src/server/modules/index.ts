/**
 * Server module registry (SX, D-069). One line per module manifest (`<module>/manifest.ts`); see
 * docs/EXTENDING.md. The order is the registration order of routes and of hooks that run in sequence
 * (attendance listeners: the assistant before Secret Students, as before SX).
 */
import type { FastifyInstance } from 'fastify';
import { registerActivityListener } from '../lib/activity.ts';
import { defineCommand } from '../lib/commands.ts';
import type { AppDeps } from '../lib/context.ts';
import type { Db } from '../db/client.ts';
import type { PolicyKey } from '../../shared/modules.ts';
import { adminManifest } from './admin/manifest.ts';
import { assistantManifest } from './assistant/manifest.ts';
import { registerAttendanceListener } from './attendance/service.ts';
import { attendanceManifest } from './attendance/manifest.ts';
import { authManifest } from './auth/manifest.ts';
import { countersManifest } from './counters/manifest.ts';
import { filesManifest } from './files/manifest.ts';
import { goalsManifest } from './goals/manifest.ts';
import { groupingManifest } from './grouping/manifest.ts';
import { homeworkManifest } from './homework/manifest.ts';
import { importManifest } from './import/manifest.ts';
import { registerEndLessonStep } from './lessons/endSteps.ts';
import { lessonsManifest } from './lessons/manifest.ts';
import { linksManifest } from './links/manifest.ts';
import { registerLessonCloseHook, registerLessonStateContributor } from './lessons/service.ts';
import type { ReportContribution, ServerModuleManifest, StudentPageContribution, TimelineContribution } from './manifest.ts';
import { maintenanceManifest } from './maintenance/manifest.ts';
import { reportsManifest } from './reports/manifest.ts';
import { routinesManifest } from './routines/manifest.ts';
import { schoolManifest } from './school/manifest.ts';
import { isContextModule, isModuleEnabled, registerModuleConfig } from './school/modules.ts';
import { secretManifest } from './secret/manifest.ts';
import { studentsManifest } from './students/manifest.ts';
import { weatherManifest } from './weather/manifest.ts';
import { achievementsManifest } from './achievements/manifest.ts';
import { avatarsManifest } from './avatars/manifest.ts';
import { textChecksManifest } from './textChecks/manifest.ts';
import { superSpeakersManifest } from './superSpeakers/manifest.ts';

export const SERVER_MODULES: readonly ServerModuleManifest[] = [
  authManifest,
  adminManifest,
  schoolManifest,
  studentsManifest,
  lessonsManifest,
  routinesManifest,
  attendanceManifest,
  countersManifest,
  assistantManifest,
  secretManifest,
  groupingManifest,
  homeworkManifest,
  filesManifest,
  importManifest,
  goalsManifest,
  linksManifest,
  reportsManifest,
  maintenanceManifest,
  weatherManifest,
  achievementsManifest,
  avatarsManifest,
  textChecksManifest,
  superSpeakersManifest,
];

/** A contribution as registered: stamped with the policy key of the manifest that declared it. */
export type Registered<T> = T & { readonly module: PolicyKey | null };

let reports: Registered<ReportContribution>[] = [];
let studentPage: Registered<StudentPageContribution>[] = [];
let timeline: Registered<TimelineContribution>[] = [];
let installed = false;

const byOrder = <T extends { order: number; key: string }>(xs: T[]) => xs.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

/**
 * Report and student-page contributions of `manifests`, each stamped with its manifest's policy key
 * (so callers can leave out the sections of a module that is switched off, CFG-2/ACC-12), in order.
 */
export function collectContributions(manifests: readonly ServerModuleManifest[]) {
  const stamp = <T,>(m: ServerModuleManifest, xs: readonly T[] | undefined): Registered<T>[] => (xs ?? []).map((x) => ({ ...x, module: m.policyKey }));
  return {
    reports: byOrder(manifests.flatMap((m) => stamp(m, m.reports))),
    studentPage: byOrder(manifests.flatMap((m) => stamp(m, m.studentPage))),
    timeline: byOrder(manifests.flatMap((m) => stamp(m, m.timeline))),
  };
}

/** Keeps the contributions of core modules and of modules enabled for this class+subject. */
export const enabledContributions = <T extends { module: PolicyKey | null }>(list: readonly T[], db: Db, contextId: string): T[] =>
  list.filter((c) => c.module === null || isModuleEnabled(db, contextId, c.module));

/**
 * Registers every manifest's commands, lesson hooks and config schema, once per process. Throws on a
 * manifest that is inconsistent (duplicate key, an End Lesson step of another module, config without
 * a policy key), so a broken manifest fails at start-up and in tests.
 */
export function installModules(): void {
  if (installed) return;
  const keys = new Set<string>();
  for (const m of SERVER_MODULES) {
    if (keys.has(m.key)) throw new Error(`Duplicate module manifest ${m.key}`);
    keys.add(m.key);
    for (const c of m.commands ?? []) defineCommand(c);
    for (const c of m.lessonState ?? []) registerLessonStateContributor(c);
    for (const s of m.endSteps ?? []) {
      if (s.module !== null && s.module !== m.policyKey) throw new Error(`End Lesson step ${s.key} belongs to ${s.module}, not ${m.key}`);
      registerEndLessonStep(s);
    }
    for (const h of m.lessonCloseHooks ?? []) registerLessonCloseHook(h);
    for (const l of m.attendanceListeners ?? []) registerAttendanceListener(l);
    for (const l of m.activityListeners ?? []) registerActivityListener(l);
    if (m.config) {
      if (!m.policyKey) throw new Error(`Module ${m.key} has a config but no policy key`);
      // School-wide modules (D-127) keep their settings in their own tables, not per class+subject.
      if (!isContextModule(m.policyKey)) throw new Error(`Module ${m.key} is school-wide and cannot have a per-class config`);
      registerModuleConfig(m.policyKey, m.config);
    }
  }
  ({ reports, studentPage, timeline } = collectContributions(SERVER_MODULES));
  installed = true;
}

/** Adds every module's routes to `app` (installing the modules first). */
export function registerModules(app: FastifyInstance, deps: AppDeps) {
  installModules();
  for (const m of SERVER_MODULES) m.routes?.(app, deps);
}

/** Report sections of the modules enabled for `contextId`, in order (a disabled module's section is never served). */
export const reportContributions = (db: Db, contextId: string): Registered<ReportContribution>[] => enabledContributions(reports, db, contextId);
/** S10 hook: student page sections of the modules enabled for `contextId`, in order. */
export const studentPageContributions = (db: Db, contextId: string): Registered<StudentPageContribution>[] => enabledContributions(studentPage, db, contextId);
/** Student timeline contributions of the modules enabled for `contextId`, in order. */
export const timelineContributions = (db: Db, contextId: string): Registered<TimelineContribution>[] => enabledContributions(timeline, db, contextId);
