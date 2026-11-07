import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { sessions, users } from '../db/schema.ts';

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export type Actor =
  | { type: 'user'; id: string; role: 'admin' | 'teacher' }
  | { type: 'student'; id: string }
  | { type: 'system'; id: null };

export interface StudentPrincipal {
  studentId: string;
  linkId: string;
}

/** Shared application services handed to every handler. */
export interface AppDeps {
  db: Db;
  config: Config;
  /** Injectable clock (tests travel in time). */
  now: () => number;
}

export interface RequestContext extends AppDeps {
  ip: string;
  session: SessionRow | null;
  user: UserRow | null;
  student: StudentPrincipal | null;
  actor: Actor;
}

/** Narrow helpers for handlers. Access checks already ran; these only refine types. */
export function requireUser(ctx: RequestContext): UserRow {
  if (!ctx.user) throw new Error('requireUser called on non-user context');
  return ctx.user;
}
export function requireStudent(ctx: RequestContext): StudentPrincipal {
  if (!ctx.student) throw new Error('requireStudent called on non-student context');
  return ctx.student;
}
