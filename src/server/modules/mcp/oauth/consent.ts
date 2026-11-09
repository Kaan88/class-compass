/**
 * The consent page's server side and the management of connections (S14h2, D-160).
 *
 * The consent endpoints are `account` endpoints: a signed-in teacher or administrator, PIN-gated in
 * classroom mode (423 while locked), with the normal CSRF checks. A waiting request is
 * - single use (pending → approved or denied, in one transaction),
 * - bound to the browser that opened `/oauth/authorize` (the `ccoa` cookie nonce), and
 * - bound to the first account that opens it (another account gets 404).
 * Allow needs re-authentication (`assertReauth`, like personal tokens). The scopes can only be the
 * app's request narrowed to the account's role (administrator scopes are never offered to teachers),
 * and narrowed further by the person; the privacy mode is pseudonymous unless the school allows student
 * data; the expiry is within the administrator's cap.
 */
import type { FastifyRequest } from 'fastify';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as O from '../../../../shared/contracts/oauth.ts';
import { MCP_SCOPES, MCP_TOKEN_DEFAULT_DAYS, OAUTH_CODE_SECONDS, OAUTH_CONNECTIONS_PER_USER, OAUTH_IGNORED_SCOPES, READ_SCOPES, scopesForRole, type McpScope } from '../../../../shared/mcp.ts';
import { tx } from '../../../db/client.ts';
import { oauthClients, oauthCodes, oauthGrants, oauthRequests, schoolSettings } from '../../../db/schema.ts';
import { audit } from '../../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../../lib/context.ts';
import { newId, randomToken, timingSafeEqualStr, tokenHash } from '../../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../../lib/errors.ts';
import { assertReauth } from '../../auth/service.ts';
import { aiSettings } from '../tokens.ts';
import { browserHash, oauthBrowserCookie, redirectWith } from './protocol.ts';
import { normaliseAllowedHost, redirectHostOf, LOOPBACK_HOSTS } from './redirects.ts';
import { clientUsable, redirectHosts, revokeGrants, type ClientRow } from './store.ts';

type RequestRow = typeof oauthRequests.$inferSelect;
type In<E extends { input: z.ZodType }> = z.infer<E['input']>;
const DAY = 24 * 60 * 60 * 1000;

const gone = () => new AppError('NOT_FOUND', 'This request has ended; start again from the AI app', { reason: 'OAUTH_REQUEST_GONE' });

/** The waiting request for this account in this browser (claims it for the account on first view). */
function loadRequest(ctx: RequestContext, requestId: string, req: FastifyRequest): { r: RequestRow; client: ClientRow } {
  const user = requireUser(ctx);
  if (!aiSettings(ctx.db).mcpEnabled) throw new AppError('FEATURE_DISABLED', 'AI tools are switched off', { reason: 'MCP_DISABLED' });
  const now = ctx.now();
  const r = ctx.db.select().from(oauthRequests).where(eq(oauthRequests.id, requestId)).get();
  if (!r || r.status !== 'pending' || r.expiresAt <= now) throw gone();
  const nonce = req.cookies?.[oauthBrowserCookie(ctx)];
  if (typeof nonce !== 'string' || !timingSafeEqualStr(browserHash(ctx, nonce), r.browserHash)) {
    throw new AppError('NOT_FOUND', 'Open the connection from the AI app in this browser', { reason: 'OAUTH_OTHER_BROWSER' });
  }
  if (r.userId === null) {
    const claimed = ctx.db
      .update(oauthRequests)
      .set({ userId: user.id })
      .where(and(eq(oauthRequests.id, r.id), isNull(oauthRequests.userId)))
      .run().changes;
    if (claimed === 1) r.userId = user.id;
    else r.userId = ctx.db.select({ u: oauthRequests.userId }).from(oauthRequests).where(eq(oauthRequests.id, r.id)).get()?.u ?? null;
  }
  if (r.userId !== user.id) throw gone();
  const client = ctx.db.select().from(oauthClients).where(eq(oauthClients.id, r.clientRowId)).get();
  if (!client || !clientUsable(ctx.db, client, now)) throw gone();
  return { r, client };
}

/** What the request asks for, sorted for this account's role. */
function scopeChoice(r: RequestRow, role: 'admin' | 'teacher') {
  const mine = scopesForRole(role);
  const asked = r.scopesRequestedJson.filter((x) => !OAUTH_IGNORED_SCOPES.includes(x));
  const known = asked.filter((x): x is McpScope => (MCP_SCOPES as readonly string[]).includes(x));
  const unknown = asked.filter((x) => !(MCP_SCOPES as readonly string[]).includes(x));
  const askedMine = known.filter((x) => mine.includes(x));
  // Without a usable request the account's own scopes are offered, with only the read ones ticked.
  const offered = askedMine.length ? askedMine : mine;
  const preselected = askedMine.length ? askedMine : mine.filter((x) => READ_SCOPES.includes(x));
  return { offered, preselected, notAvailable: known.filter((x) => !mine.includes(x)), unknown };
}

export function requestView(ctx: RequestContext, requestId: string, req: FastifyRequest): O.OAuthRequestView {
  const user = requireUser(ctx);
  const { r, client } = loadRequest(ctx, requestId, req);
  const s = aiSettings(ctx.db);
  const choice = scopeChoice(r, user.role);
  const redirect = new URL(r.redirectUri);
  return {
    requestId: r.id,
    clientName: client.name,
    clientKind: client.kind,
    clientIdHost: client.kind === 'cimd' ? redirectHostOf(client.clientId) : null,
    redirectHost: redirectHostOf(r.redirectUri),
    redirectLoopback: redirect.protocol === 'http:' && LOOPBACK_HOSTS.includes(redirect.hostname.toLowerCase()),
    ...choice,
    studentDataAllowed: s.aiStudentDataAllowed,
    maxDays: s.mcpTokenMaxDays,
    defaultDays: Math.min(MCP_TOKEN_DEFAULT_DAYS, s.mcpTokenMaxDays),
    expiresAt: r.expiresAt,
  };
}

/** Allow (re-authentication first) or deny. Returns where to send the browser. */
export async function decide(ctx: RequestContext, input: In<typeof O.decideOAuthRequest>, req: FastifyRequest): Promise<{ redirectTo: string }> {
  const user = requireUser(ctx);
  const origin = ctx.config.origins.main;
  const first = loadRequest(ctx, input.requestId, req);
  const finish = (status: 'approved' | 'denied', now: number) => {
    const n = ctx.db
      .update(oauthRequests)
      .set({ status, decidedAt: now })
      .where(and(eq(oauthRequests.id, first.r.id), eq(oauthRequests.status, 'pending'), eq(oauthRequests.userId, user.id)))
      .run().changes;
    if (n !== 1) throw gone();
  };
  if (!input.allow) {
    const now = ctx.now();
    tx(ctx.db, () => {
      finish('denied', now);
      audit(ctx.db, ctx.actor, { action: 'oauth.deny', entity: 'oauth_client', entityId: first.client.id, after: { client: first.client.name, redirectHost: redirectHostOf(first.r.redirectUri) } }, now);
    });
    return { redirectTo: redirectWith(first.r.redirectUri, { error: 'access_denied', error_description: 'The user did not allow access', state: first.r.state, iss: origin }) };
  }
  await assertReauth(ctx, user, ctx.session!, input.currentPassword);
  // Read again after the password check: the request may have been decided in another tab meanwhile.
  const { r, client } = loadRequest(ctx, input.requestId, req);
  const s = aiSettings(ctx.db);
  const choice = scopeChoice(r, user.role);
  const scopes = [...new Set(input.scopes ?? choice.preselected)];
  if (!scopes.length) throw invalid('Choose at least one permission', { reason: 'SCOPE_REQUIRED' });
  if (scopes.some((x) => !choice.offered.includes(x))) throw invalid('A permission was not asked for or is not available for this account', { reason: 'SCOPE_NOT_ALLOWED' });
  const days = input.days ?? Math.min(MCP_TOKEN_DEFAULT_DAYS, s.mcpTokenMaxDays);
  if (days > s.mcpTokenMaxDays) throw invalid('Longer than the school allows', { reason: 'TOKEN_TOO_LONG', maxDays: s.mcpTokenMaxDays });
  const privacy = input.privacy ?? 'pseudonymous';
  if (privacy === 'named' && !s.aiStudentDataAllowed) throw invalid('The school does not allow student data for AI tools', { reason: 'STUDENT_DATA_OFF' });
  const now = ctx.now();
  const code = randomToken(32);
  tx(ctx.db, () => {
    const live = ctx.db.select({ n: sql<number>`count(*)` }).from(oauthGrants).where(and(eq(oauthGrants.userId, user.id), isNull(oauthGrants.revokedAt), gt(oauthGrants.expiresAt, now))).get()?.n ?? 0;
    if (live >= OAUTH_CONNECTIONS_PER_USER) throw conflict('Too many connected apps', { reason: 'TOO_MANY_CONNECTIONS', max: OAUTH_CONNECTIONS_PER_USER });
    finish('approved', now);
    const grantId = newId();
    const redirectHost = redirectHostOf(r.redirectUri);
    ctx.db
      .insert(oauthGrants)
      .values({ id: grantId, clientRowId: client.id, userId: user.id, clientName: client.name, redirectHost, scopesJson: scopes, privacyMode: privacy, createdAt: now, expiresAt: now + days * DAY, lastRefreshAt: null, revokedAt: null, revokedBy: null, revokeReason: null })
      .run();
    ctx.db
      .insert(oauthCodes)
      .values({ id: newId(), codeHash: tokenHash(ctx.config.SECRET_PEPPER, code), grantId, clientRowId: client.id, userId: user.id, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, resource: r.resource, createdAt: now, expiresAt: now + OAUTH_CODE_SECONDS * 1000, usedAt: null })
      .run();
    audit(ctx.db, ctx.actor, { action: 'oauth.connect', entity: 'oauth_grant', entityId: grantId, after: { client: client.name, redirectHost, scopes, privacy, expiresAt: now + days * DAY } }, now);
  });
  return { redirectTo: redirectWith(r.redirectUri, { code, state: r.state, iss: origin }) };
}

// ---------------------------------------------------------------- ending connections, apps and the host list
function endConnection(ctx: RequestContext, grantId: string, ownerOnly: boolean) {
  const user = requireUser(ctx);
  const g = ctx.db.select().from(oauthGrants).where(eq(oauthGrants.id, grantId)).get();
  if (!g || (ownerOnly && g.userId !== user.id)) throw notFound('Connection');
  const now = ctx.now();
  tx(ctx.db, () => {
    if (revokeGrants(ctx.db, [g.id], now, user.id, ownerOnly ? 'owner' : 'admin')) {
      audit(ctx.db, ctx.actor, { action: 'oauth.disconnect', entity: 'oauth_grant', entityId: g.id, after: { client: g.clientName, by: ownerOnly ? 'owner' : 'admin', userId: g.userId } }, now);
    }
  });
  return { ok: true as const };
}
/** Profile → AI tools → Disconnect (someone else's connection answers 404). */
export const disconnectOwn = (ctx: RequestContext, grantId: string) => endConnection(ctx, grantId, true);
export const adminDisconnect = (ctx: RequestContext, grantId: string) => endConnection(ctx, grantId, false);

/** Admin → AI tools: revoke a registered app; its connections end with it. */
export function adminRevokeClient(ctx: RequestContext, clientRowId: string) {
  const user = requireUser(ctx);
  const c = ctx.db.select().from(oauthClients).where(eq(oauthClients.id, clientRowId)).get();
  if (!c) throw notFound('App');
  const now = ctx.now();
  tx(ctx.db, () => {
    if (c.revokedAt === null) ctx.db.update(oauthClients).set({ revokedAt: now, revokedBy: user.id }).where(eq(oauthClients.id, c.id)).run();
    const ids = ctx.db
      .select({ id: oauthGrants.id })
      .from(oauthGrants)
      .where(and(eq(oauthGrants.clientRowId, c.id), isNull(oauthGrants.revokedAt)))
      .all()
      .map((x) => x.id);
    const ended = revokeGrants(ctx.db, ids, now, user.id, 'client_revoked');
    ctx.db.update(oauthRequests).set({ status: 'expired', decidedAt: now }).where(and(eq(oauthRequests.clientRowId, c.id), eq(oauthRequests.status, 'pending'))).run();
    audit(ctx.db, ctx.actor, { action: 'oauth_client.revoke', entity: 'oauth_client', entityId: c.id, after: { name: c.name, kind: c.kind, connectionsEnded: ended } }, now);
  });
  return { ok: true as const };
}

/**
 * The redirect host allow-list (audited). Hosts are normalised to lower case; loopback names and
 * wildcards are refused (loopback addresses are always allowed anyway). Existing registrations whose
 * addresses are no longer allowed stop working at the next authorize step (addresses are checked again there).
 */
export function setRedirectHosts(ctx: RequestContext, input: In<typeof O.setOAuthRedirectHosts>) {
  const hosts: string[] = [];
  for (const raw of input.hosts) {
    const h = normaliseAllowedHost(raw);
    if (!h) throw invalid(`Not a host name: ${raw.slice(0, 80)}`, { reason: 'INVALID_HOST' });
    if (!hosts.includes(h)) hosts.push(h);
  }
  const before = redirectHosts(ctx.db);
  const now = ctx.now();
  tx(ctx.db, () => {
    ctx.db.update(schoolSettings).set({ oauthRedirectHostsJson: hosts, updatedAt: now }).where(eq(schoolSettings.id, 1)).run();
    audit(ctx.db, ctx.actor, { action: 'school.oauth_redirect_hosts', entity: 'school_settings', entityId: '1', before: { hosts: before }, after: { hosts } }, now);
  });
  return { hosts };
}
