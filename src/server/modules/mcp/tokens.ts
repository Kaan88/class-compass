/**
 * Personal tokens for the AI tools (S14h1, D-160) and the school's AI switches (D-161).
 *
 * A token is `ccmcp_` + 256 random bits, shown once; only HMAC(pepper, token) is stored (like
 * sessions and links), with the first characters as a recognisable prefix. Tokens are made through
 * `account` endpoints (so the classroom PIN lock answers 423) after re-authentication, for the scopes
 * of the account's role, for at most the administrator's cap (≤ 90 days). The resolver checks, on
 * every request and in this order: the school switch, the token (known, not expired, not revoked), the
 * account (active, no temporary password). Role and scope are checked per tool, then the endpoint's
 * own ownership checks run.
 *
 * OAuth (S14h2): `kind` 'oauth' rows are the hour-long access tokens of a connection (`oauth/`); they
 * resolve the same way, `familyId` is the connection (pseudonyms are per family), `clientId` the
 * client's row, and they work only while the connection lives. Lists here show personal tokens only;
 * connections are listed by `oauth/store.ts`.
 */
import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/mcp.ts';
import { AI_STUDENT_DATA_CONFIRM } from '../../../shared/contracts/mcp.ts';
import { MCP_PATH, MCP_TOKEN_DEFAULT_DAYS, MCP_TOKEN_MAX_DAYS, MCP_TOKEN_PREFIX, MCP_TOKENS_PER_USER, scopesForRole, type McpScope } from '../../../shared/mcp.ts';
import { tx, type Db } from '../../db/client.ts';
import { mcpCalls, mcpTokens, oauthGrants, schoolSettings, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type AppDeps, type McpPrincipal, type RequestContext, type UserRow } from '../../lib/context.ts';
import { newId, randomToken, tokenHash } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { assertReauth } from '../auth/service.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { accountConnections, adminConnections, clampGrants, clientViews, grantLive, redirectHosts, revokeAllOAuth } from './oauth/store.ts';

type TokenRow = typeof mcpTokens.$inferSelect;
type In<E extends { input: z.ZodType }> = z.infer<E['input']>;
const DAY = 24 * 60 * 60 * 1000;
const TOUCH_MS = 60_000;

export const mcpUrl = (deps: Pick<AppDeps, 'config'>) => `${deps.config.origins.main}${MCP_PATH}`;

export function aiSettings(db: Db) {
  const s = getSchoolSettings(db);
  return { mcpEnabled: s.mcpEnabled, aiStudentDataAllowed: s.aiStudentDataAllowed, mcpTokenMaxDays: Math.min(MCP_TOKEN_MAX_DAYS, s.mcpTokenMaxDays) };
}

/**
 * When a token stops working: its own expiry, or earlier when the administrator has lowered the cap
 * since it was made (the cap applies to existing tokens at once, review fix).
 */
export const effectiveExpiry = (t: Pick<TokenRow, 'createdAt' | 'expiresAt'>, capDays: number) => Math.min(t.expiresAt, t.createdAt + capDays * DAY);
const statusOf = (t: TokenRow, now: number, capDays: number) => (t.revokedAt !== null ? 'revoked' : effectiveExpiry(t, capDays) <= now ? 'expired' : 'active');
function dto(t: TokenRow, now: number, capDays: number): z.infer<typeof C.AiToken> {
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    prefix: t.prefix,
    scopes: t.scopesJson as McpScope[],
    privacy: t.privacyMode,
    status: statusOf(t, now, capDays),
    createdAt: t.createdAt,
    expiresAt: effectiveExpiry(t, capDays),
    lastUsedAt: t.lastUsedAt,
    revokedAt: t.revokedAt,
  };
}

/** The account's tokens (newest first; revoked and expired ones of the last 90 days too). */
export function accountView(ctx: RequestContext): z.infer<typeof C.AiToolsAccount> {
  const user = requireUser(ctx);
  const s = aiSettings(ctx.db);
  const now = ctx.now();
  const rows = ctx.db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, user.id), eq(mcpTokens.kind, 'pat'), gt(mcpTokens.expiresAt, now - 90 * DAY)))
    .orderBy(desc(mcpTokens.createdAt))
    .all();
  return {
    enabled: s.mcpEnabled,
    studentDataAllowed: s.aiStudentDataAllowed,
    maxDays: s.mcpTokenMaxDays,
    defaultDays: Math.min(MCP_TOKEN_DEFAULT_DAYS, s.mcpTokenMaxDays),
    scopes: scopesForRole(user.role),
    url: mcpUrl(ctx),
    tokens: rows.map((r) => dto(r, now, s.mcpTokenMaxDays)),
    connections: accountConnections(ctx.db, user.id, now, s.mcpTokenMaxDays),
  };
}

/** Makes a personal token (re-authentication first). The secret is returned here and never again. */
export async function createToken(ctx: RequestContext, input: In<typeof C.createAiToken>) {
  const user = requireUser(ctx);
  await assertReauth(ctx, user, ctx.session!, input.currentPassword);
  const s = aiSettings(ctx.db);
  if (!s.mcpEnabled) throw new AppError('FEATURE_DISABLED', 'AI tools are switched off', { reason: 'MCP_DISABLED' });
  const allowed = scopesForRole(user.role);
  const scopes = [...new Set(input.scopes)];
  if (scopes.some((x) => !allowed.includes(x))) throw invalid('A scope is not available for this account', { reason: 'SCOPE_NOT_ALLOWED' });
  if (input.days > s.mcpTokenMaxDays) throw invalid('Longer than the school allows', { reason: 'TOKEN_TOO_LONG', maxDays: s.mcpTokenMaxDays });
  if (input.privacy === 'named' && !s.aiStudentDataAllowed) throw invalid('The school does not allow student data for AI tools', { reason: 'STUDENT_DATA_OFF' });
  const now = ctx.now();
  const secret = `${MCP_TOKEN_PREFIX}${randomToken(32)}`;
  return tx(ctx.db, () => {
    const live = ctx.db.select({ n: sql<number>`count(*)` }).from(mcpTokens).where(and(eq(mcpTokens.userId, user.id), eq(mcpTokens.kind, 'pat'), isNull(mcpTokens.revokedAt), gt(mcpTokens.expiresAt, now), gt(mcpTokens.createdAt, now - s.mcpTokenMaxDays * DAY))).get()?.n ?? 0;
    if (live >= MCP_TOKENS_PER_USER) throw conflict('Too many tokens', { reason: 'TOO_MANY_TOKENS', max: MCP_TOKENS_PER_USER });
    const id = newId();
    const row: TokenRow = {
      id,
      kind: 'pat',
      familyId: id,
      clientId: null,
      userId: user.id,
      name: input.name,
      tokenHash: tokenHash(ctx.config.SECRET_PEPPER, secret),
      prefix: secret.slice(0, MCP_TOKEN_PREFIX.length + 4),
      scopesJson: scopes,
      privacyMode: input.privacy,
      createdAt: now,
      expiresAt: now + input.days * DAY,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    };
    ctx.db.insert(mcpTokens).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'mcp_token.create', entity: 'mcp_token', entityId: id, after: { name: row.name, scopes, privacy: row.privacyMode, expiresAt: row.expiresAt } }, now);
    return { secret, token: dto(row, now, s.mcpTokenMaxDays) };
  });
}

function revoke(ctx: RequestContext, row: TokenRow, by: 'owner' | 'admin') {
  if (row.revokedAt !== null) return;
  const now = ctx.now();
  tx(ctx.db, () => {
    ctx.db.update(mcpTokens).set({ revokedAt: now, revokedBy: requireUser(ctx).id }).where(eq(mcpTokens.id, row.id)).run();
    audit(ctx.db, ctx.actor, { action: 'mcp_token.revoke', entity: 'mcp_token', entityId: row.id, after: { by, userId: row.userId } }, now);
  });
}

/** The owner revokes one of their tokens (someone else's answers 404). */
export function revokeOwn(ctx: RequestContext, tokenId: string) {
  const row = ctx.db.select().from(mcpTokens).where(and(eq(mcpTokens.id, tokenId), eq(mcpTokens.userId, requireUser(ctx).id))).get();
  if (!row) throw notFound('Token');
  revoke(ctx, row, 'owner');
  return { ok: true as const };
}

export function adminRevoke(ctx: RequestContext, tokenId: string) {
  const row = ctx.db.select().from(mcpTokens).where(eq(mcpTokens.id, tokenId)).get();
  if (!row) throw notFound('Token');
  revoke(ctx, row, 'admin');
  return { ok: true as const };
}

/** Admin → AI tools: the switches, every token of the last 90 days (no secrets) and call counts. */
export function adminView(ctx: RequestContext): z.infer<typeof C.AiToolsAdmin> {
  const now = ctx.now();
  const cap = aiSettings(ctx.db).mcpTokenMaxDays;
  const rows = ctx.db
    .select({ t: mcpTokens, userName: users.displayName, userRole: users.role })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .where(and(eq(mcpTokens.kind, 'pat'), gt(mcpTokens.expiresAt, now - 90 * DAY)))
    .orderBy(desc(mcpTokens.createdAt))
    .all();
  const since = now - 7 * DAY;
  const counts = ctx.db
    .select({ status: mcpCalls.status, n: sql<number>`count(*)` })
    .from(mcpCalls)
    .where(gte(mcpCalls.at, since))
    .groupBy(mcpCalls.status)
    .all();
  const n = (st: string) => counts.find((c) => c.status === st)?.n ?? 0;
  return {
    settings: aiSettings(ctx.db),
    url: mcpUrl(ctx),
    tokens: rows.map((r) => ({ ...dto(r.t, now, cap), userId: r.t.userId, userName: r.userName, userRole: r.userRole })),
    calls: { total: counts.reduce((a, c) => a + c.n, 0), errors: n('error'), denied: n('denied') + n('rate_limited') },
    connections: adminConnections(ctx.db, now, cap),
    clients: clientViews(ctx.db, now),
    redirectHosts: redirectHosts(ctx.db),
  };
}

/** Changes the switches (audited). Student data on needs the typed confirmation; off takes effect at once for every token. */
export function setSettings(ctx: RequestContext, input: In<typeof C.setAiToolsSettings>) {
  const before = aiSettings(ctx.db);
  if (input.aiStudentDataAllowed === true && !before.aiStudentDataAllowed && input.confirm?.trim() !== AI_STUDENT_DATA_CONFIRM) {
    throw invalid(`Type ${AI_STUDENT_DATA_CONFIRM} to confirm`, { reason: 'CONFIRMATION_MISMATCH' });
  }
  const patch: Partial<typeof schoolSettings.$inferInsert> = {};
  if (input.mcpEnabled !== undefined) patch.mcpEnabled = input.mcpEnabled;
  if (input.aiStudentDataAllowed !== undefined) patch.aiStudentDataAllowed = input.aiStudentDataAllowed;
  if (input.mcpTokenMaxDays !== undefined) patch.mcpTokenMaxDays = input.mcpTokenMaxDays;
  if (!Object.keys(patch).length) return before;
  const now = ctx.now();
  tx(ctx.db, () => {
    ctx.db.update(schoolSettings).set({ ...patch, updatedAt: now }).where(eq(schoolSettings.id, 1)).run();
    // A lower cap shortens the tokens that already exist (raising it again does not lengthen them).
    let shortened = 0;
    if (patch.mcpTokenMaxDays !== undefined && patch.mcpTokenMaxDays < before.mcpTokenMaxDays) {
      const capMs = patch.mcpTokenMaxDays * DAY;
      const over = and(isNull(mcpTokens.revokedAt), gt(mcpTokens.expiresAt, now), sql`${mcpTokens.expiresAt} > ${mcpTokens.createdAt} + ${capMs}`);
      shortened = ctx.db.select({ n: sql<number>`count(*)` }).from(mcpTokens).where(over).get()?.n ?? 0;
      if (shortened) ctx.db.update(mcpTokens).set({ expiresAt: sql`${mcpTokens.createdAt} + ${capMs}` }).where(over).run();
    }
    if (patch.mcpTokenMaxDays !== undefined && patch.mcpTokenMaxDays < before.mcpTokenMaxDays) shortened += clampGrants(ctx.db, patch.mcpTokenMaxDays, now);
    // Switching AI tools off ends every OAuth connection, code and waiting request (S14h2); personal tokens only stop answering.
    const connectionsEnded = patch.mcpEnabled === false && before.mcpEnabled ? revokeAllOAuth(ctx.db, now) : 0;
    const after = { ...patch, ...(shortened ? { tokensShortened: shortened } : {}), ...(connectionsEnded ? { connectionsEnded } : {}) };
    audit(ctx.db, ctx.actor, { action: 'school.ai_tools', entity: 'school_settings', entityId: '1', before, after }, now);
  });
  return aiSettings(ctx.db);
}

/** Refusals of the bearer check; 401s carry `WWW-Authenticate` (the transport adds it). */
const refuse = (code: 'UNAUTHENTICATED' | 'FORBIDDEN', reason: string, message: string) => new AppError(code, message, { reason });

/**
 * The bearer check of every `/mcp` request (D-160), in order: the school switch → the token (known,
 * not expired, not revoked) → the account (active, no temporary password). Updates `last_used_at` at
 * most once a minute.
 */
export function resolveBearer(deps: AppDeps, raw: string | null): { user: UserRow; principal: McpPrincipal } {
  const s = aiSettings(deps.db);
  if (!s.mcpEnabled) throw new AppError('FEATURE_DISABLED', 'AI tools are switched off at this school', { reason: 'MCP_DISABLED' });
  if (!raw) throw refuse('UNAUTHENTICATED', 'TOKEN_MISSING', 'A bearer token is required');
  if (!raw.startsWith(MCP_TOKEN_PREFIX) || raw.length > 200) throw refuse('UNAUTHENTICATED', 'TOKEN_INVALID', 'Unknown token');
  const row = deps.db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash(deps.config.SECRET_PEPPER, raw))).get();
  if (!row) throw refuse('UNAUTHENTICATED', 'TOKEN_INVALID', 'Unknown token');
  const now = deps.now();
  if (row.revokedAt !== null) throw refuse('UNAUTHENTICATED', 'TOKEN_REVOKED', 'This token was revoked');
  if (effectiveExpiry(row, s.mcpTokenMaxDays) <= now) throw refuse('UNAUTHENTICATED', 'TOKEN_EXPIRED', 'This token has expired');
  const user = deps.db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || user.disabledAt !== null) throw refuse('FORBIDDEN', 'ACCOUNT_INACTIVE', 'The account is not active');
  if (user.mustChangePassword) throw refuse('FORBIDDEN', 'MUST_CHANGE_PASSWORD', 'The account must change its password first');
  if (row.kind === 'oauth') {
    // An OAuth access token works only while its connection lives (S14h2): ending the connection, the consent's expiry or a lower cap stops it.
    const grant = deps.db.select().from(oauthGrants).where(eq(oauthGrants.id, row.familyId)).get();
    if (!grant || !grantLive(grant, now, s.mcpTokenMaxDays)) throw refuse('UNAUTHENTICATED', 'TOKEN_REVOKED', 'This connection has ended');
  }
  if (row.lastUsedAt === null || now - row.lastUsedAt > TOUCH_MS) deps.db.update(mcpTokens).set({ lastUsedAt: now }).where(eq(mcpTokens.id, row.id)).run();
  return {
    user,
    principal: {
      tokenId: row.id,
      familyId: row.familyId,
      kind: row.kind,
      scopes: row.scopesJson,
      privacy: row.privacyMode === 'named' && s.aiStudentDataAllowed ? 'named' : 'pseudonymous',
    },
  };
}
