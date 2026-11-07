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

function loadSession(deps: AppDeps, req: FastifyRequest) {
  const raw = req.cookies?.[sessionCookieName(deps)];
  if (!raw) return { session: null, user: null, student: null };
  const now = deps.now();
  const session = deps.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash(deps.config.SECRET_PEPPER, raw)), isNull(sessions.revokedAt)))
    .get();
  if (!session || session.expiresAt <= now || session.lastSeenAt + SESSION_IDLE_MS <= now) {
    return { session: null, user: null, student: null };
  }
  let user: UserRow | null = null;
  let student: StudentPrincipal | null = null;
  if (session.kind === 'user' && session.userId) {
    user = deps.db.select().from(users).where(eq(users.id, session.userId)).get() ?? null;
    if (!user || user.disabledAt) return { session: null, user: null, student: null };
  } else if (session.kind === 'student') {
    student = studentResolver(deps, session);
    if (!student) return { session: null, user: null, student: null };
  }
  if (now - session.lastSeenAt > TOUCH_INTERVAL_MS) {
    deps.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id)).run();
    session.lastSeenAt = now;
  }
  return { session, user, student };
}

export function isPinUnlocked(session: SessionRow, now: number): boolean {
  return !session.classroomMode || (session.pinUnlockedUntil !== null && session.pinUnlockedUntil > now);
}

function enforceAccess(deps: AppDeps, access: Access, ctx: RequestContext): void {
  if (access === 'public') return;
  if (access === 'student') {
    if (!ctx.student) throw new AppError('UNAUTHENTICATED', 'Student link session required');
    return;
  }
  const { user, session } = ctx;
  if (!user || !session) throw new AppError('UNAUTHENTICATED', 'Sign in required');
  if (access === 'user') return;
  if (access === 'classroom') {
    if (user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Teacher account required');
    return;
  }
  if (access === 'teacher' && user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Teacher account required');
  if (access === 'admin' && user.role !== 'admin') throw new AppError('FORBIDDEN', 'Administrator account required');
  // teacher | admin | account: sensitive — require PIN unlock in classroom mode (PIN-1, PIN-8).
  const now = deps.now();
  if (!isPinUnlocked(session, now)) throw new AppError('PIN_REQUIRED', 'Unlock with your PIN');
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
export function contextFor(deps: AppDeps, req: FastifyRequest, access: Access): RequestContext {
  enforceCsrf(deps, req);
  const { session, user, student } = loadSession(deps, req);
  const ctx: RequestContext = { ...deps, ip: clientIp(deps, req), session, user, student, actor: actorOf(user, student) };
  enforceAccess(deps, access, ctx);
  return ctx;
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
      const ctx = contextFor(deps, req, ep.access);
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
