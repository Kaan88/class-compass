/**
 * Server module registry (SX, D-069). One line per module manifest (`<module>/manifest.ts`); see
 * docs/EXTENDING.md. The order is the registration order of routes and of hooks that run in sequence
 * (attendance listeners: the assistant before Secret Students, as before SX).
 */
import type { FastifyInstance } from 'fastify';
import { defineCommand } from '../lib/commands.ts';
import type { AppDeps } from '../lib/context.ts';
import type { Db } from '../db/client.ts';
import type { ContextModule } from '../../shared/modules.ts';
import { adminManifest } from './admin/manifest.ts';
import { assistantManifest } from './assistant/manifest.ts';
import { registerAttendanceListener } from './attendance/service.ts';
import { attendanceManifest } from './attendance/manifest.ts';
import { authManifest } from './auth/manifest.ts';
import { countersManifest } from './counters/manifest.ts';
import { groupingManifest } from './grouping/manifest.ts';
import { homeworkManifest } from './homework/manifest.ts';
import { registerEndLessonStep } from './lessons/endSteps.ts';
import { lessonsManifest } from './lessons/manifest.ts';
import { registerLessonCloseHook, registerLessonStateContributor } from './lessons/service.ts';
import type { ReportContribution, ServerModuleManifest, StudentPageContribution } from './manifest.ts';
import { routinesManifest } from './routines/manifest.ts';
import { schoolManifest } from './school/manifest.ts';
import { isModuleEnabled, registerModuleConfig } from './school/modules.ts';
import { secretManifest } from './secret/manifest.ts';
import { studentsManifest } from './students/manifest.ts';

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
];

/** A contribution as registered: stamped with the policy key of the manifest that declared it. */
export type Registered<T> = T & { readonly module: ContextModule | null };

let reports: Registered<ReportContribution>[] = [];
let studentPage: Registered<StudentPageContribution>[] = [];
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
  };
}

/** Keeps the contributions of core modules and of modules enabled for this class+subject. */
export const enabledContributions = <T extends { module: ContextModule | null }>(list: readonly T[], db: Db, contextId: string): T[] =>
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
    if (m.config) {
      if (!m.policyKey) throw new Error(`Module ${m.key} has a config but no policy key`);
      registerModuleConfig(m.policyKey, m.config);
    }
  }
  ({ reports, studentPage } = collectContributions(SERVER_MODULES));
  installed = true;
}

/** Adds every module's routes to `app` (installing the modules first). */
export function registerModules(app: FastifyInstance, deps: AppDeps) {
  installModules();
  for (const m of SERVER_MODULES) m.routes?.(app, deps);
}

/** S11 hook: report sections of the modules enabled for `contextId`, in order (a disabled module's section is never served). */
export const reportContributions = (db: Db, contextId: string): Registered<ReportContribution>[] => enabledContributions(reports, db, contextId);
/** S10 hook: student page sections of the modules enabled for `contextId`, in order. */
export const studentPageContributions = (db: Db, contextId: string): Registered<StudentPageContribution>[] => enabledContributions(studentPage, db, contextId);
