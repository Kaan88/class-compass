/**
 * Client side of the module manifests (ARCHITECTURE §2, CFG-1). Later stages contribute pieces of
 * the classroom here instead of editing the lesson screens:
 * - dashboard slots (S6 main counter, S7 assistant + Secret Students, S8 groups + homework),
 * - Start Lesson steps between attendance and the routine (S7: today's assistant, LES-1),
 * - End Lesson step screens matching the server's End Lesson step registry (S7: Secret Student
 *   reveal + outcomes; the core reflection step is registered by EndLesson.tsx).
 * A piece is shown only when its module is enabled for the context; nothing is shown for modules
 * that have no registered piece, so the classroom never displays a placeholder for an unbuilt
 * feature.
 */
import type { ComponentType, ReactNode } from 'react';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import type { ContextModule } from '../../../shared/contracts/school.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';

export interface ClassroomContext {
  id: string;
  classId: string;
  className: string;
  subjectName: { en?: string | undefined; tr?: string | undefined };
  timezone: string;
  modules: Partial<Record<ContextModule, boolean>>;
}

export interface DashboardSlot {
  key: string;
  module: ContextModule;
  order: number;
  Component: ComponentType<{ context: ClassroomContext; lesson: LessonState }>;
}

export interface StartStep {
  key: string;
  module: ContextModule;
  order: number;
  title: MessageKey;
  Component: ComponentType<{ context: ClassroomContext }>;
}

export interface EndStepUi<V = unknown> {
  /** Same key as the server step (`lesson.endSteps`). */
  key: string;
  title: MessageKey;
  initial: () => V;
  Component: ComponentType<{ lesson: LessonState; value: V; onChange: (v: V) => void }>;
}

/** Extra props a module puts on every student card (S6: weekly count, level, + button). */
export interface StudentCardExtras {
  weeklyCount?: number;
  level?: 0 | 1 | 2 | 3;
  countLabel?: string;
  periodLabel?: string;
  addLabel?: string;
  onAdd?: () => void;
  notice?: string | null;
}

/**
 * A module's contribution to the student grid. `useAddon` is a React hook: it is called on every
 * dashboard render for every registered addon (with `enabled` false when the module is off), so the
 * number of hook calls never changes; it returns null when it has nothing to add.
 */
export interface StudentCardAddon {
  key: string;
  module: ContextModule;
  useAddon: (context: ClassroomContext, lesson: LessonState, enabled: boolean) => { header?: ReactNode; cardProps: (studentId: string, fullName: string) => StudentCardExtras } | null;
}

const slots: DashboardSlot[] = [];
const cardAddons: StudentCardAddon[] = [];
const startSteps: StartStep[] = [];
const endSteps = new Map<string, EndStepUi>();

const byOrder = <T extends { order: number; key: string }>(xs: T[]) => xs.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

export function registerDashboardSlot(slot: DashboardSlot) {
  if (slots.some((s) => s.key === slot.key)) return;
  slots.push(slot);
  byOrder(slots);
}
export function registerStartStep(step: StartStep) {
  if (startSteps.some((s) => s.key === step.key)) return;
  startSteps.push(step);
  byOrder(startSteps);
}
export function registerStudentCardAddon(addon: StudentCardAddon) {
  if (!cardAddons.some((a) => a.key === addon.key)) cardAddons.push(addon);
}
export function registerEndStepUi<V>(step: EndStepUi<V>) {
  endSteps.set(step.key, step as unknown as EndStepUi);
}

const enabled = (ctx: ClassroomContext, m: ContextModule) => ctx.modules[m] === true;
export const dashboardSlotsFor = (ctx: ClassroomContext) => slots.filter((s) => enabled(ctx, s.module));
export const startStepsFor = (ctx: ClassroomContext) => startSteps.filter((s) => enabled(ctx, s.module));
/** Screens for the server's step list; a step without a screen runs with its defaults. */
export const endStepUis = (keys: readonly string[]) => keys.map((k) => endSteps.get(k)).filter((s): s is EndStepUi => Boolean(s));

/** Calls every registered student-card addon hook (stable order and count) and keeps the active ones. */
export function useStudentCardAddons(ctx: ClassroomContext, lesson: LessonState) {
  const out: Array<NonNullable<ReturnType<StudentCardAddon['useAddon']>> & { key: string }> = [];
  for (const a of cardAddons) {
    const r = a.useAddon(ctx, lesson, enabled(ctx, a.module));
    if (r) out.push({ ...r, key: a.key });
  }
  return out;
}
