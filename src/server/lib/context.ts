import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { sessions, users } from '../db/schema.ts';
import type { Mailer } from './mailer.ts';
import type { WeatherFetch } from '../modules/weather/service.ts';

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export type Actor =
  | { type: 'user'; id: string; role: 'admin' | 'teacher' }
  | { type: 'student'; id: string }
  /** A Super Speakers scorer link (S12): `id` is the link id, never a user id. */
  | { type: 'scorer'; id: string }
  /** A Super Speakers board link (S12): read-only, so it only appears on the link-opened audit row. */
  | { type: 'display'; id: string }
  | { type: 'system'; id: null };

export interface StudentPrincipal {
  studentId: string;
  linkId: string;
}

/** Super Speakers scorer (S12, D-128): only from a scorer link session, re-checked on every request. */
export interface ScorerPrincipal {
  scorerLinkId: string;
  /** The teacher account the administrator linked to the scorer link (recorded on awards), or null. */
  userId: string | null;
  label: string;
  locale: 'en' | 'tr';
}

/** Super Speakers board display (S12, D-128): read-only. */
export interface DisplayPrincipal {
  displayLinkId: string;
}

/** Shared application services handed to every handler. */
export interface AppDeps {
  db: Db;
  config: Config;
  /** Injectable clock (tests travel in time). */
  now: () => number;
  /**
   * Outgoing mail; absent when SMTP is not configured (email reset then disabled, D-015).
   * Tests inject a fake transport here.
   */
  mailer?: Mailer | null;
  /** Classroom weather fetcher (S13b); tests inject a fake, production uses HTTPS to Open-Meteo. */
  weatherFetch?: WeatherFetch;
}

export interface RequestContext extends AppDeps {
  ip: string;
  session: SessionRow | null;
  user: UserRow | null;
  student: StudentPrincipal | null;
  /** S12: set only for `scorer` endpoints (from the scorer cookie). */
  scorer?: ScorerPrincipal | null;
  /** S12: set only for `display` endpoints (from the board cookie). */
  display?: DisplayPrincipal | null;
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
export function requireScorer(ctx: RequestContext): ScorerPrincipal {
  if (!ctx.scorer) throw new Error('requireScorer called on non-scorer context');
  return ctx.scorer;
}
