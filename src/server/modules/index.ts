/**
 * Server module registry (SX, D-069). One line per module manifest (`<module>/manifest.ts`); see
 * docs/EXTENDING.md. The order is the registration order of routes and of hooks that run in sequence
 * (attendance listeners: the assistant before Secret Students, as before SX).
 */
import type { FastifyInstance } from 'fastify';
import { defineCommand } from '../lib/commands.ts';
import type { AppDeps } from '../lib/context.ts';
import { adminManifest } from './admin/manifest.ts';
import { assistantManifest } from './assistant/manifest.ts';
import { registerAttendanceListener } from './attendance/service.ts';
import { attendanceManifest } from './attendance/manifest.ts';
import { authManifest } from './auth/manifest.ts';
import { countersManifest } from './counters/manifest.ts';
import { registerEndLessonStep } from './lessons/endSteps.ts';
import { lessonsManifest } from './lessons/manifest.ts';
import { registerLessonCloseHook, registerLessonStateContributor } from './lessons/service.ts';
import type { ReportContribution, ServerModuleManifest, StudentPageContribution } from './manifest.ts';
import { routinesManifest } from './routines/manifest.ts';
import { schoolManifest } from './school/manifest.ts';
import { registerModuleConfig } from './school/modules.ts';
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
];

const reports: ReportContribution[] = [];
const studentPage: StudentPageContribution[] = [];
let installed = false;

const byOrder = <T extends { order: number; key: string }>(xs: T[]) => xs.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

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
    reports.push(...(m.reports ?? []));
    studentPage.push(...(m.studentPage ?? []));
  }
  byOrder(reports);
  byOrder(studentPage);
  installed = true;
}

/** Adds every module's routes to `app` (installing the modules first). */
export function registerModules(app: FastifyInstance, deps: AppDeps) {
  installModules();
  for (const m of SERVER_MODULES) m.routes?.(app, deps);
}

/** S11 hook: report sections contributed by modules, in order. */
export const reportContributions = (): readonly ReportContribution[] => reports;
/** S10 hook: student page sections contributed by modules, in order. */
export const studentPageContributions = (): readonly StudentPageContribution[] => studentPage;
