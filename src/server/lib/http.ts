import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Access, Endpoint } from '../../shared/contracts/define.ts';
import { sessions, users } from '../db/schema.ts';
import { AppError } from './errors.ts';
import { tokenHash } from './crypto.ts';
import type { Actor, AppDeps, RequestContext, SessionRow, StudentPrincipal, UserRow } from './context.ts';

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const PIN_UNLOCK_MS = 5 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

export const sessionCookieName = (deps: AppDeps) => (deps.config.isProd ? '__Host-cc' : 'cc');
/**
 * Student link sessions use their own cookie (S10, STU-4): SameSite=Strict, HttpOnly, path=/, and a
 * `__Host-` name in production. A browser may hold a teacher and a student session at the same time;
 * they never mix (see `contextFor`).
 */
export const studentCookieName = (deps: AppDeps) => (deps.config.isProd ? '__Host-ccs' : 'ccs');
/** Student sessions: absolute lifetime 90 days, signed out after 30 days without use. */
export const STUDENT_SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
export const STUDENT_SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/** All endpoints registered on this server (tests enumerate these). */
export const registeredEndpoints: Endpoint[] = [];

/**
 * Student sessions are validated by the links module (re-checks the link is still active on every
 * request, STU-3). Until that module registers a resolver, student sessions are rejected.
 */
type StudentResolver = (deps: AppDeps, session: SessionRow) => StudentPrincipal | null;
let studentResolver: StudentResolver = () => null;
export function setStudentResolver(fn: StudentResolver) {
  studentResolver = fn;
}

export function clientIp(deps: AppDeps, req: FastifyRequest): string {
  if (deps.config.TRUST_PROXY) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** A live session of `kind` for this cookie value (null when unknown, revoked, expired or idle). */
function liveSession(deps: AppDeps, raw: string | undefined, kind: 'user' | 'student'): SessionRow | null {
  if (!raw) return null;
  const now = deps.now();
  const session = deps.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash(deps.config.SECRET_PEPPER, raw)), isNull(sessions.revokedAt)))
    .get();
  const idle = kind === 'student' ? STUDENT_SESSION_IDLE_MS : SESSION_IDLE_MS;
  if (!session || session.kind !== kind || session.expiresAt <= now || session.lastSeenAt + idle <= now) return null;
  return session;
}

function touch(deps: AppDeps, session: SessionRow) {
  const now = deps.now();
  if (now - session.lastSeenAt > TOUCH_INTERVAL_MS) {
    deps.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id)).run();
    session.lastSeenAt = now;
  }
}

function loadUserSession(deps: AppDeps, req: FastifyRequest): { session: SessionRow | null; user: UserRow | null } {
  const session = liveSession(deps, req.cookies?.[sessionCookieName(deps)], 'user');
  if (!session?.userId) return { session: null, user: null };
  const user = deps.db.select().from(users).where(eq(users.id, session.userId)).get() ?? null;
  if (!user || user.disabledAt) return { session: null, user: null };
  touch(deps, session);
  return { session, user };
}

/** The student principal of the student cookie; the links module re-checks the link on every request (STU-3). */
function loadStudentSession(deps: AppDeps, req: FastifyRequest): { session: SessionRow | null; student: StudentPrincipal | null } {
  const session = liveSession(deps, req.cookies?.[studentCookieName(deps)], 'student');
  if (!session) return { session: null, student: null };
  const student = studentResolver(deps, session);
  if (!student) return { session: null, student: null };
  touch(deps, session);
  return { session, student };
}

export function isPinUnlocked(session: SessionRow, now: number): boolean {
  return !session.classroomMode || (session.pinUnlockedUntil !== null && session.pinUnlockedUntil > now);
}

export interface AccessOptions {
  /** See Endpoint.allowWithTemporaryPassword. */
  allowWithTemporaryPassword?: boolean | undefined;
}

function enforceAccess(deps: AppDeps, access: Access, ctx: RequestContext, opts: AccessOptions = {}): void {
  if (access === 'public') return;
  if (access === 'student') {
    if (!ctx.student) throw new AppError('UNAUTHENTICATED', 'Student link session required');
    return;
  }
  const { user, session } = ctx;
  if (!user || !session) throw new AppError('UNAUTHENTICATED', 'Sign in required');
  if (access === 'user') return;
  // A temporary password (admin-issued, ACC-2) is only good for changing it: the server enforces the
  // forced password change, not just the client's routing.
  const mustChange = user.mustChangePassword && !opts.allowWithTemporaryPassword;
  const refuseTemporary = () => {
    throw new AppError('FORBIDDEN', 'Change your temporary password first', { reason: 'MUST_CHANGE_PASSWORD' });
  };
  if (access === 'classroom') {
    if (mustChange) refuseTemporary();
    if (user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Teacher account required');
    return;
  }
  // teacher | admin | account: sensitive — require PIN unlock in classroom mode (PIN-1, PIN-8).
  // Checked before the role so a locked classroom device answers every sensitive URL the same way.
  const now = deps.now();
  if (!isPinUnlocked(session, now)) throw new AppError('PIN_REQUIRED', 'Unlock with your PIN');
  if (mustChange) refuseTemporary();
  if (access === 'teacher' && user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Teacher account required');
  if (access === 'admin' && user.role !== 'admin') throw new AppError('FORBIDDEN', 'Administrator account required');
  if (session.classroomMode) {
    // Sliding inactivity window (PIN-7).
    const until = now + PIN_UNLOCK_MS;
    deps.db.update(sessions).set({ pinUnlockedUntil: until }).where(eq(sessions.id, session.id)).run();
    session.pinUnlockedUntil = until;
  }
}

function actorOf(user: UserRow | null, student: StudentPrincipal | null): Actor {
  if (user) return { type: 'user', id: user.id, role: user.role };
  if (student) return { type: 'student', id: student.studentId };
  return { type: 'system', id: null };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF: same-origin fetches only. Custom header can't be sent cross-site without CORS. */
function enforceCsrf(deps: AppDeps, req: FastifyRequest) {
  if (!MUTATING.has(req.method)) return;
  if (req.headers['x-cc-csrf'] !== '1') throw new AppError('CSRF', 'Missing CSRF header');
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new AppError('CSRF', 'Cross-site request rejected');
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== new URL(deps.config.PUBLIC_ORIGIN).origin) {
    throw new AppError('CSRF', 'Origin mismatch');
  }
}

export type Handler<I extends z.ZodType, O extends z.ZodType> = (
  ctx: RequestContext,
  input: z.infer<I>,
  http: { req: FastifyRequest; reply: FastifyReply },
) => z.input<O> | Promise<z.input<O>>;

/** Build the per-request context and enforce access. Exported for non-JSON routes (files, CSV). */
export function contextFor(deps: AppDeps, req: FastifyRequest, access: Access, opts: AccessOptions = {}): RequestContext {
  enforceCsrf(deps, req);
  // Student endpoints see ONLY the student session (studentId comes from it, STU-4/5); every other
  // endpoint sees only the teacher/admin session, so a browser holding both never mixes them.
  let ctx: RequestContext;
  if (access === 'student') {
    const { session, student } = loadStudentSession(deps, req);
    ctx = { ...deps, ip: clientIp(deps, req), session, user: null, student, actor: actorOf(null, student) };
  } else {
    const { session, user } = loadUserSession(deps, req);
    ctx = { ...deps, ip: clientIp(deps, req), session, user, student: null, actor: actorOf(user, null) };
  }
  enforceAccess(deps, access, ctx, opts);
  return ctx;
}

/**
 * Register a contract-defined endpoint whose request or response is not JSON (multipart uploads,
 * file downloads). Access is enforced exactly like `route()`, before anything is read from the body.
 * The declared input is parsed from the query string and path parameters only (the body is the
 * upload stream); the handler sends the reply itself or returns a value checked against the output
 * schema.
 */
export function rawRoute<I extends z.ZodType, O extends z.ZodType>(
  app: FastifyInstance,
  deps: AppDeps,
  ep: Endpoint<I, O>,
  handler: Handler<I, O>,
  opts: { rateLimit?: { max: number; timeWindow: string } } = {},
) {
  if (!ep.access) throw new Error(`Endpoint ${ep.method} ${ep.path} has no access class`);
  registeredEndpoints.push(ep as unknown as Endpoint);
  app.route({
    method: ep.method,
    url: ep.path,
    config: opts.rateLimit ? { rateLimit: opts.rateLimit } : {},
    handler: async (req, reply) => {
      const ctx = contextFor(deps, req, ep.access, { allowWithTemporaryPassword: ep.allowWithTemporaryPassword });
      const raw = { ...((req.query as object) ?? {}), ...((req.params as object) ?? {}) };
      const parsed = ep.input.safeParse(raw);
      if (!parsed.success) throw new AppError('VALIDATION', 'Invalid input', z.treeifyError(parsed.error));
      const result = await handler(ctx, parsed.data, { req, reply });
      if (reply.sent) return reply;
      return ep.output.parse(result);
    },
  });
}

/** Register a contract-defined JSON endpoint. */
export function route<I extends z.ZodType, O extends z.ZodType>(
  app: FastifyInstance,
  deps: AppDeps,
  ep: Endpoint<I, O>,
  handler: Handler<I, O>,
  opts: { rateLimit?: { max: number; timeWindow: string } } = {},
) {
  if (!ep.access) throw new Error(`Endpoint ${ep.method} ${ep.path} has no access class`);
  registeredEndpoints.push(ep as unknown as Endpoint);
  app.route({
    method: ep.method,
    url: ep.path,
    config: opts.rateLimit ? { rateLimit: opts.rateLimit } : {},
    handler: async (req, reply) => {
      const ctx = contextFor(deps, req, ep.access, { allowWithTemporaryPassword: ep.allowWithTemporaryPassword });
      const params = (req.params ?? {}) as Record<string, unknown>;
      const raw = ep.method === 'GET' ? { ...(req.query as object), ...params } : { ...((req.body as object) ?? {}), ...params };
      const parsed = ep.input.safeParse(raw);
      if (!parsed.success) throw new AppError('VALIDATION', 'Invalid input', z.treeifyError(parsed.error));
      const result = await handler(ctx, parsed.data, { req, reply });
      if (reply.sent) return reply;
      return ep.output.parse(result);
    },
  });
}
