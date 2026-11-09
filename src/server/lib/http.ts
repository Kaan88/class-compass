import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Access, Endpoint } from '../../shared/contracts/define.ts';
import { sessions, users } from '../db/schema.ts';
import { AppError } from './errors.ts';
import { tokenHash } from './crypto.ts';
import type { Actor, AppDeps, DisplayPrincipal, McpPrincipal, RequestContext, ScorerPrincipal, SessionRow, StudentPrincipal, UserRow } from './context.ts';

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

/**
 * Super Speakers (S12, D-128): the scorer app and the board use their own strict cookies, like the
 * student page. A browser can hold a teacher, a student, a scorer and a board session at once; each
 * access class reads only its own cookie, so they never mix.
 */
export const scorerCookieName = (deps: AppDeps) => (deps.config.isProd ? '__Host-ccp' : 'ccp');
export const displayCookieName = (deps: AppDeps) => (deps.config.isProd ? '__Host-ccb' : 'ccb');
/** Scorer sessions: one school year (installed phone apps), signed out after 120 days without use. */
export const SCORER_SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const SCORER_SESSION_IDLE_MS = 120 * 24 * 60 * 60 * 1000;
/** Board sessions: one year; a board screen that stays dark for 60 days must open its link again. */
export const DISPLAY_SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const DISPLAY_SESSION_IDLE_MS = 60 * 24 * 60 * 60 * 1000;

/** All endpoints registered on this server (tests enumerate these). */
export const registeredEndpoints: Endpoint[] = [];

/**
 * The handlers `route()` registered, per app instance (S14h1, D-160): the MCP module turns endpoints
 * that opt in with `mcp: {…}` into tools and calls the same handler, so a tool runs exactly the
 * endpoint's access, ownership and audit code.
 */
const handlersByApp = new WeakMap<FastifyInstance, Map<Endpoint, Handler<z.ZodType, z.ZodType>>>();
export function registeredHandler(app: FastifyInstance, ep: Endpoint): Handler<z.ZodType, z.ZodType> | undefined {
  return handlersByApp.get(app)?.get(ep);
}
/** Access classes whose endpoints may be offered to AI tools; `user`, `account`, `public` and link sessions never are. */
export const MCP_EXPOSABLE_ACCESS = ['classroom', 'teacher', 'admin'] as const;

/** Record an endpoint whose Fastify routes a module registers itself (the `/mcp` transport). */
export function recordEndpoint(ep: Endpoint) {
  if (!ep.access) throw new Error(`Endpoint ${ep.method} ${ep.path} has no access class`);
  registeredEndpoints.push(ep);
}

/**
 * Student sessions are validated by the links module (re-checks the link is still active on every
 * request, STU-3). Until that module registers a resolver, student sessions are rejected.
 */
type StudentResolver = (deps: AppDeps, session: SessionRow) => StudentPrincipal | null;
let studentResolver: StudentResolver = () => null;
export function setStudentResolver(fn: StudentResolver) {
  studentResolver = fn;
}

/** Scorer and display sessions are validated by the Super Speakers module (every request, D-128). */
type ScorerResolver = (deps: AppDeps, session: SessionRow) => ScorerPrincipal | null;
type DisplayResolver = (deps: AppDeps, session: SessionRow) => DisplayPrincipal | null;
let scorerResolver: ScorerResolver = () => null;
let displayResolver: DisplayResolver = () => null;
export function setScorerResolver(fn: ScorerResolver) {
  scorerResolver = fn;
}
export function setDisplayResolver(fn: DisplayResolver) {
  displayResolver = fn;
}

/**
 * AI tools (S14h1, D-160): the MCP module resolves the bearer token on every request, in this order:
 * the school switch is on, the token is known, not expired and not revoked, its account is active.
 * It throws an AppError for each refusal. Until the module registers, `/mcp` is refused.
 */
type McpResolver = (deps: AppDeps, token: string | null) => { user: UserRow; principal: McpPrincipal };
let mcpResolver: McpResolver = () => {
  throw new AppError('FEATURE_DISABLED', 'AI tools are not available', { reason: 'MCP_DISABLED' });
};
export function setMcpResolver(fn: McpResolver) {
  mcpResolver = fn;
}

/** The bearer token of the Authorization header, or null (any other scheme counts as none). */
export function bearerOf(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer[ ]+(\S+)\s*$/iu.exec(h);
  return m ? m[1]! : null;
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
const IDLE_MS: Record<SessionRow['kind'], number> = {
  user: SESSION_IDLE_MS,
  student: STUDENT_SESSION_IDLE_MS,
  scorer: SCORER_SESSION_IDLE_MS,
  display: DISPLAY_SESSION_IDLE_MS,
};

function liveSession(deps: AppDeps, raw: string | undefined, kind: SessionRow['kind']): SessionRow | null {
  if (!raw) return null;
  const now = deps.now();
  const session = deps.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash(deps.config.SECRET_PEPPER, raw)), isNull(sessions.revokedAt)))
    .get();
  const idle = IDLE_MS[kind];
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

/** The scorer principal of the scorer cookie (link re-checked on every request). */
function loadScorerSession(deps: AppDeps, req: FastifyRequest): { session: SessionRow | null; scorer: ScorerPrincipal | null } {
  const session = liveSession(deps, req.cookies?.[scorerCookieName(deps)], 'scorer');
  const scorer = session ? scorerResolver(deps, session) : null;
  if (!session || !scorer) return { session: null, scorer: null };
  touch(deps, session);
  return { session, scorer };
}

/** The board principal of the board cookie (link re-checked on every request). */
export function loadDisplaySession(deps: AppDeps, req: FastifyRequest): { session: SessionRow | null; display: DisplayPrincipal | null } {
  const session = liveSession(deps, req.cookies?.[displayCookieName(deps)], 'display');
  const display = session ? displayResolver(deps, session) : null;
  if (!session || !display) return { session: null, display: null };
  touch(deps, session);
  return { session, display };
}

export function isPinUnlocked(session: SessionRow, now: number): boolean {
  return !session.classroomMode || (session.pinUnlockedUntil !== null && session.pinUnlockedUntil > now);
}

export interface AccessOptions {
  /** See Endpoint.allowWithTemporaryPassword. */
  allowWithTemporaryPassword?: boolean | undefined;
  /** Which origins may send a mutating request (S14f, D-157); `route()` sets it from the endpoint path. Default `main`. */
  originClass?: OriginClass | undefined;
  /** See Endpoint.background: checks the PIN unlock but never slides its window (PIN-7). */
  background?: boolean | undefined;
}

/**
 * The link of the live student session this request already carries (the student cookie), or null.
 * The link exchange uses it to tell a device that opens its own link again from a new device
 * (S14e3, D-155); it is never an access decision.
 */
export function currentStudentLinkId(deps: AppDeps, req: FastifyRequest): string | null {
  return liveSession(deps, req.cookies?.[studentCookieName(deps)], 'student')?.studentLinkId ?? null;
}

/**
 * Origin classes (S14f, D-157). The Super Speakers scorer app and board may run on their own origin
 * (`SPEAKERS_ORIGIN`), so their endpoints (`/api/scorer…`, `/api/board…`) accept that origin as well
 * as the main one; every other endpoint accepts only the main origin (PUBLIC_ORIGIN). The class comes
 * from the endpoint's declared path when it is registered, never from the request. With
 * SPEAKERS_ORIGIN unset both origins are the same, so nothing changes.
 */
export type OriginClass = 'main' | 'speakers';
const SPEAKERS_API = /^\/api\/(?:scorer|board)(?:\/|$)/u;
export const originClassOf = (endpointPath: string): OriginClass => (SPEAKERS_API.test(endpointPath) ? 'speakers' : 'main');

/** The origins a mutating request of this class may come from. */
export function allowedOrigins(deps: AppDeps, originClass: OriginClass): string[] {
  const { main, speakers } = deps.config.origins;
  return originClass === 'speakers' && speakers !== main ? [main, speakers] : [main];
}

function enforceAccess(deps: AppDeps, access: Access, ctx: RequestContext, opts: AccessOptions = {}): void {
  if (access === 'public' || access === 'oauth') return;
  if (access === 'student') {
    if (!ctx.student) throw new AppError('UNAUTHENTICATED', 'Student link session required');
    return;
  }
  if (access === 'scorer') {
    if (!ctx.scorer) throw new AppError('UNAUTHENTICATED', 'Scorer link session required');
    return;
  }
  if (access === 'display') {
    if (!ctx.display) throw new AppError('UNAUTHENTICATED', 'Board link session required');
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
  if (session.classroomMode && !opts.background) {
    // Sliding inactivity window (PIN-7). Background polls (the bell) are not activity.
    const until = now + PIN_UNLOCK_MS;
    deps.db.update(sessions).set({ pinUnlockedUntil: until }).where(eq(sessions.id, session.id)).run();
    session.pinUnlockedUntil = until;
  }
}

/**
 * `/mcp` (S14h1, D-160) and the OAuth POST endpoints (S14h2): a browser page on another site must not
 * reach a local or tunnelled server through the user's browser (DNS rebinding), so an Origin header,
 * when present, must be the main origin. Clients that are not browsers send none. No CSRF header: the
 * bearer token is not ambient.
 */
function enforceMcpOrigin(deps: AppDeps, req: FastifyRequest) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== deps.config.origins.main) throw new AppError('CSRF', 'Origin not allowed', { reason: 'ORIGIN_NOT_ALLOWED' });
}

function actorOf(user: UserRow | null, student: StudentPrincipal | null): Actor {
  if (user) return { type: 'user', id: user.id, role: user.role };
  if (student) return { type: 'student', id: student.studentId };
  return { type: 'system', id: null };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF: same-origin fetches only. Custom header can't be sent cross-site without CORS. The Origin
 * header, when present, must be one of the origins of the endpoint's origin class (D-157).
 */
function enforceCsrf(deps: AppDeps, req: FastifyRequest, originClass: OriginClass) {
  if (!MUTATING.has(req.method)) return;
  if (req.headers['x-cc-csrf'] !== '1') throw new AppError('CSRF', 'Missing CSRF header');
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new AppError('CSRF', 'Cross-site request rejected');
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && !allowedOrigins(deps, originClass).includes(origin)) {
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
  if (access === 'mcp') {
    // Bearer only (S14h1, D-160): cookies are never read here, so a signed-in browser cannot call it.
    enforceMcpOrigin(deps, req);
    const { user, principal } = mcpResolver(deps, bearerOf(req));
    const actor: Actor = { type: 'mcp', id: user.id, role: user.role, tokenId: principal.tokenId };
    return { ...deps, ip: clientIp(deps, req), session: null, user, student: null, scorer: null, display: null, mcp: principal, actor };
  }
  // A bearer token never works on the app's own endpoints, whatever cookies come with it.
  if (req.headers.authorization !== undefined && bearerOf(req) !== null) throw new AppError('UNAUTHENTICATED', 'Bearer tokens are accepted only by the AI tools endpoint', { reason: 'BEARER_NOT_ALLOWED' });
  if (access === 'oauth') {
    // OAuth protocol endpoints (S14h2, D-160): no cookie is read and nothing is ambient (public clients
    // prove themselves with PKCE, codes and refresh tokens), so no CSRF header. A browser page on another
    // site still may not post here: an Origin header on a POST must be the main origin.
    if (MUTATING.has(req.method)) enforceMcpOrigin(deps, req);
    return { ...deps, ip: clientIp(deps, req), session: null, user: null, student: null, scorer: null, display: null, actor: { type: 'system', id: null } };
  }
  enforceCsrf(deps, req, opts.originClass ?? 'main');
  // Student endpoints see ONLY the student session (studentId comes from it, STU-4/5); every other
  // endpoint sees only the teacher/admin session, so a browser holding both never mixes them.
  let ctx: RequestContext;
  if (access === 'student') {
    const { session, student } = loadStudentSession(deps, req);
    ctx = { ...deps, ip: clientIp(deps, req), session, user: null, student, actor: actorOf(null, student) };
  } else if (access === 'scorer') {
    // Scorer endpoints see ONLY the scorer cookie (S12, D-128).
    const { session, scorer } = loadScorerSession(deps, req);
    const actor: Actor = scorer ? { type: 'scorer', id: scorer.scorerLinkId } : { type: 'system', id: null };
    ctx = { ...deps, ip: clientIp(deps, req), session, user: null, student: null, scorer, display: null, actor };
  } else if (access === 'display') {
    // Board endpoints see ONLY the board cookie (S12, D-128).
    const { session, display } = loadDisplaySession(deps, req);
    const actor: Actor = display ? { type: 'display', id: display.displayLinkId } : { type: 'system', id: null };
    ctx = { ...deps, ip: clientIp(deps, req), session, user: null, student: null, scorer: null, display, actor };
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
  if (ep.mcp) throw new Error(`Endpoint ${ep.method} ${ep.path}: raw routes (files, CSV, streams) are never MCP tools`);
  registeredEndpoints.push(ep as unknown as Endpoint);
  const originClass = originClassOf(ep.path);
  app.route({
    method: ep.method,
    url: ep.path,
    config: opts.rateLimit ? { rateLimit: opts.rateLimit } : {},
    handler: async (req, reply) => {
      const ctx = contextFor(deps, req, ep.access, { allowWithTemporaryPassword: ep.allowWithTemporaryPassword, originClass, background: ep.background });
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
  if (ep.mcp && !(MCP_EXPOSABLE_ACCESS as readonly string[]).includes(ep.access)) throw new Error(`Endpoint ${ep.method} ${ep.path}: ${ep.access} endpoints are never MCP tools`);
  registeredEndpoints.push(ep as unknown as Endpoint);
  let handlers = handlersByApp.get(app);
  if (!handlers) handlersByApp.set(app, (handlers = new Map()));
  handlers.set(ep as unknown as Endpoint, handler as unknown as Handler<z.ZodType, z.ZodType>);
  const originClass = originClassOf(ep.path);
  app.route({
    method: ep.method,
    url: ep.path,
    config: opts.rateLimit ? { rateLimit: opts.rateLimit } : {},
    handler: async (req, reply) => {
      const ctx = contextFor(deps, req, ep.access, { allowWithTemporaryPassword: ep.allowWithTemporaryPassword, originClass, background: ep.background });
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
