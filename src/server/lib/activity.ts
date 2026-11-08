/**
 * Student activity hook (S13c, D-121). Modules that record something a student DID (a goal, an
 * entry, evidence, a homework mark, an assistant day, a Secret Student outcome) call
 * `emitStudentActivity` inside their write transaction; listeners declared in module manifests
 * (`activityListeners`, registered by `installModules()`) react synchronously in the same
 * transaction — the achievements rule engine re-evaluates the student's automatic badges, so an
 * award is never lost and a replay never awards twice (the evaluation is idempotent).
 *
 * The event carries ids only (no text), so a listener can never learn what a student wrote, and a
 * pre-reveal Secret Student identity is never emitted (the secret module emits after the reveal).
 */
import type { RequestContext } from './context.ts';

export const ACTIVITY_SOURCES = ['goals', 'homework', 'assistant', 'secretStudents'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export interface StudentActivity {
  source: ActivitySource;
  studentIds: readonly string[];
  /** The class+subject (homework, assistant, Secret Students). */
  contextId?: string;
  /** The subject (goals and evidence belong to a student and a subject). */
  subjectId?: string;
}

export type ActivityListener = (ctx: RequestContext, activity: StudentActivity) => void;

const listeners: ActivityListener[] = [];

export function registerActivityListener(l: ActivityListener): void {
  listeners.push(l);
}

/** Call inside the writing transaction, after the write. Listeners must be small and synchronous. */
export function emitStudentActivity(ctx: RequestContext, activity: StudentActivity): void {
  if (!activity.studentIds.length) return;
  for (const l of listeners) l(ctx, activity);
}
