/**
 * Read side of the client module manifests (SX, D-069). Screens ask here for the pieces of enabled
 * modules instead of importing modules directly. Everything is computed lazily from
 * `CLIENT_MODULES`, so manifests may import screens that import this file.
 */
import { registerInvalidation } from '../lib/outbox-client.ts';
import { CLIENT_MODULES } from './index.ts';
import { availableBoxes, type BoxKey } from '../../shared/classroomLayout.ts';
import type { ClassroomContext, ClientModuleManifest, DashboardSlot, EndStepUi, StartLessonContribution, StartStep, StudentCardAddon, TeacherPage } from './types.ts';

export type { ClassroomContext, StudentCardExtras } from './types.ts';

/** Deterministic order: `order`, then key (test-enforced: no two pieces share an order). */
export const byOrder = <T extends { order: number; key: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

const all = <T,>(pick: (m: ClientModuleManifest) => readonly T[] | undefined): T[] => CLIENT_MODULES.flatMap((m) => [...(pick(m) ?? [])]);

// School-wide modules (D-127) contribute no classroom pieces, so they are never "on" here.
const enabled = (ctx: ClassroomContext, m: ClientModuleManifest['policyKey']) => m === null || (ctx.modules as Record<string, boolean | undefined>)[m] === true;

export const allDashboardSlots = (): DashboardSlot[] => byOrder(all((m) => m.dashboardSlots));
export const allStartSteps = (): StartStep[] => byOrder(all((m) => m.startSteps));
export const allTeacherPages = (): TeacherPage[] => byOrder(all((m) => m.teacherPages));
/** Pages with a menu tile and nav link (sub-pages with `menu: false` are routes only). */
export const menuTeacherPages = (): TeacherPage[] => allTeacherPages().filter((p) => p.menu !== false);
const cardAddons = (): StudentCardAddon[] => all((m) => m.studentCardAddons);

/** The dashboard slots of the modules enabled for this class+subject (core slots always). */
export const dashboardSlotsFor = (ctx: ClassroomContext) => allDashboardSlots().filter((s) => enabled(ctx, s.module));
/** The slot behind a board box key (S14b), or undefined for a core box or a module that is off. */
export const slotForBox = (ctx: ClassroomContext, key: BoxKey) => dashboardSlotsFor(ctx).find((s) => s.key === key);
/** The board boxes available in this class+subject: the core boxes and the enabled modules' slots (S14b, D-148). */
export const availableBoxKeys = (ctx: ClassroomContext) => availableBoxes(dashboardSlotsFor(ctx).map((s) => s.key));
export const startStepsFor = (ctx: ClassroomContext) => allStartSteps().filter((s) => enabled(ctx, s.module));

/** Initial values of every registered Start Lesson step, by key. */
export const initialStartValues = (): Record<string, unknown> => Object.fromEntries(allStartSteps().map((s) => [s.key, s.initial()]));

/**
 * Calls every registered start step's `useContribution` hook (stable order and count) and merges what
 * the enabled ones add to 'lesson.start'; `ready` is false while any enabled step is not ready.
 */
export function useStartContributions(ctx: ClassroomContext, values: Readonly<Record<string, unknown>>): { input: StartLessonContribution; ready: boolean } {
  let input: StartLessonContribution = {};
  let ready = true;
  for (const s of allStartSteps()) {
    if (!s.useContribution) continue;
    const on = enabled(ctx, s.module);
    const r = s.useContribution(ctx, values[s.key], on);
    if (!on) continue;
    // `steps` holds one entry per server start step: merged key by key (S14b), never replaced.
    const steps = input.steps || r.input.steps ? { ...input.steps, ...r.input.steps } : undefined;
    input = { ...input, ...r.input, ...(steps ? { steps } : {}) };
    ready &&= r.ready;
  }
  return { input, ready };
}

/** Screens for the server's step list (the server decides which steps run); a step without a screen runs with its defaults. */
export function endStepUis(keys: readonly string[]): EndStepUi[] {
  const byKey = new Map(all((m) => m.endSteps).map((s) => [s.key, s]));
  return keys.map((k) => byKey.get(k)).filter((s): s is EndStepUi => Boolean(s));
}

/** Settings panels of the modules that have one, by policy key. */
export const settingsPanelFor = (policyKey: string) => CLIENT_MODULES.find((m) => m.policyKey === policyKey)?.settingsPanel ?? null;

/** Calls every registered student-card addon hook (stable order and count) and keeps the active ones. */
export function useStudentCardAddons(ctx: ClassroomContext, lesson: Parameters<StudentCardAddon['useAddon']>[1]) {
  const out: Array<NonNullable<ReturnType<StudentCardAddon['useAddon']>> & { key: string }> = [];
  for (const a of cardAddons()) {
    const r = a.useAddon(ctx, lesson, enabled(ctx, a.module));
    if (r) out.push({ ...r, key: a.key });
  }
  return out;
}

let installed = false;
/** Registers the manifests' outbox invalidations once (main.tsx, before the outbox starts). */
export function installClientModules(): void {
  if (installed) return;
  installed = true;
  for (const inv of all((m) => m.invalidations)) registerInvalidation(inv.prefix, inv.keys);
}
