/**
 * Teacher notification emitter (S14e3, D-155). A module that records something a student did (or
 * that happened to a student) calls `notify(deps, event)` inside its writing transaction; the
 * notifications module's sink (its manifest's `notificationSink`, registered by `installModules()`)
 * decides who gets a row and writes it in the same transaction.
 *
 * This is deliberately NOT the student activity hook (`lib/activity.ts`): activity re-runs the
 * achievement rules, and an award would then emit activity again. `notify` never calls back into a
 * module, so it cannot recurse.
 *
 * Events carry ids only (no text): the student, the subject (null = about the student as a whole,
 * e.g. their avatar), optionally the class+subject, and the record it is about. The sink writes only
 * for the student's current teachers of that subject, with the category's module on and the category
 * switched on in the teacher's settings, and never for `actorUserId` (the teacher who caused it).
 */
import type { NotificationCategory, NotificationEntity } from '../../shared/notifications.ts';
import type { AppDeps } from './context.ts';

export interface NotifyEvent {
  category: NotificationCategory;
  studentId: string;
  /** The subject the event belongs to; null = the student as a whole (every current teacher). */
  subjectId: string | null;
  /** The class+subject it happened in, when there is one (achievements). */
  contextId?: string | null;
  entity: NotificationEntity;
  /** The record it is about (null for daily aggregates). */
  entityId: string | null;
  /** A teacher who caused it (an award they gave): they get no notification about it. */
  actorUserId?: string | null;
  /** How many (aggregates: points given in one go). Default 1. */
  count?: number;
}

export type NotifyDeps = Pick<AppDeps, 'db' | 'now'>;
export type NotificationSink = (deps: NotifyDeps, event: NotifyEvent) => void;

const sinks: NotificationSink[] = [];

export function registerNotificationSink(s: NotificationSink): void {
  if (!sinks.includes(s)) sinks.push(s);
}

/** Call inside the writing transaction, after the write. Sinks are small and synchronous. */
export function notify(deps: NotifyDeps, event: NotifyEvent): void {
  for (const s of sinks) s(deps, event);
}
