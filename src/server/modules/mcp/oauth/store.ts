/**
 * OAuth storage for AI apps (S14h2, D-160): registered apps (DCR and Client ID Metadata Documents),
 * connections (grants) and their ending. Only `modules/mcp/` reads or writes the `oauth_*` tables and
 * `mcp_tokens`; the auth service ends an account's connections through `revokeOAuthForUser`.
 *
 * A connection is one token family: every access token issued under it carries the connection's id as
 * `mcp_tokens.family_id`, so ending a connection ends its access tokens, refresh tokens and pending
 * codes at once, and pseudonyms stay stable for as long as it lives.
 */
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminAiConnection, AiConnection, OAuthClientView } from '../../../../shared/contracts/mcp.ts';
import { DEFAULT_OAUTH_REDIRECT_HOSTS, MCP_SCOPES, OAUTH_CLIENT_UNUSED_DAYS, type McpScope } from '../../../../shared/mcp.ts';
import type { Db } from '../../../db/client.ts';
import { mcpTokens, oauthClients, oauthCodes, oauthGrants, oauthRequests, schoolSettings, users } from '../../../db/schema.ts';
import type { AppDeps } from '../../../lib/context.ts';
import { newId } from '../../../lib/crypto.ts';
import { fetchClientMetadata } from './cimd.ts';
import { checkRedirectUri, normaliseAllowedHost, redirectHostOf } from './redirects.ts';

export type ClientRow = typeof oauthClients.$inferSelect;
export type GrantRow = typeof oauthGrants.$inferSelect;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** A metadata document is read again after an hour; a stored copy serves for a day when the app's server is down. */
const CIMD_FRESH_MS = HOUR;
const CIMD_STALE_MS = 24 * HOUR;
export const CLIENT_NAME_MAX = 100;

/** The administrator's redirect host allow-list (the default when the stored value is unusable). */
export function redirectHosts(db: Db): string[] {
  const row = db.select({ h: schoolSettings.oauthRedirectHostsJson }).from(schoolSettings).where(eq(schoolSettings.id, 1)).get();
  const list = Array.isArray(row?.h) ? row.h.map((x) => (typeof x === 'string' ? normaliseAllowedHost(x) : null)).filter((x): x is string => x !== null) : null;
  return list ?? [...DEFAULT_OAUTH_REDIRECT_HOSTS];
}

/** An app's own name as plain text: control and bidirectional-override characters removed, trimmed, capped. Never markup. */
export function cleanClientName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
  return (s || 'Unnamed app').slice(0, CLIENT_NAME_MAX);
}

/** The effective end of a connection: its consent's expiry, or earlier when the administrator lowered the cap since. */
export const grantExpiry = (g: Pick<GrantRow, 'createdAt' | 'expiresAt'>, capDays: number) => Math.min(g.expiresAt, g.createdAt + capDays * DAY);
export const grantLive = (g: GrantRow, now: number, capDays: number) => g.revokedAt === null && grantExpiry(g, capDays) > now;

/** Whether a registration still works: not revoked, and used (or made) in the last 30 days or holding a live connection. */
export function clientUsable(db: Db, c: ClientRow, now: number): boolean {
  if (c.revokedAt !== null) return false;
  if ((c.lastUsedAt ?? c.createdAt) + OAUTH_CLIENT_UNUSED_DAYS * DAY > now) return true;
  return !!db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(and(eq(oauthGrants.clientRowId, c.id), isNull(oauthGrants.revokedAt), gt(oauthGrants.expiresAt, now)))
    .get();
}

export const touchClient = (db: Db, c: ClientRow, now: number) => {
  if (c.lastUsedAt === null || now - c.lastUsedAt > 60_000) db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, c.id)).run();
};

// ---------------------------------------------------------------- Client ID Metadata Documents
const CimdDoc = z.object({
  client_id: z.string(),
  client_name: z.string().optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** Is this client id a metadata document address (https with a path)? */
export function isMetadataUrl(clientId: string): boolean {
  if (!clientId.startsWith('https://') || clientId.length > 512) return false;
  try {
    const u = new URL(clientId);
    return u.pathname !== '/' && !u.hash && !u.username && !u.password && u.port === '';
  } catch {
    return false;
  }
}

export class ClientMetadataError extends Error {}

/**
 * Read (or re-read after an hour) a Client ID Metadata Document on an allowed host. The document must
 * name itself (`client_id` equal to its address), list redirect addresses the school allows and be a
 * public client (`token_endpoint_auth_method` none).
 */
async function metadataClient(deps: AppDeps, clientId: string, allowed: readonly string[]): Promise<ClientRow> {
  const host = new URL(clientId).hostname.toLowerCase();
  if (!allowed.includes(host)) throw new ClientMetadataError('The app’s address is not on the school’s list of allowed hosts');
  const now = deps.now();
  const stored = deps.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
  if (stored?.revokedAt) throw new ClientMetadataError('This app was revoked by the administrator');
  if (stored && stored.metadataFetchedAt !== null && now - stored.metadataFetchedAt < CIMD_FRESH_MS) return stored;
  let doc: z.infer<typeof CimdDoc>;
  try {
    const parsed = CimdDoc.safeParse(await (deps.clientMetadataFetch ?? fetchClientMetadata)(clientId));
    if (!parsed.success) throw new ClientMetadataError('The app’s metadata document is not valid');
    doc = parsed.data;
  } catch (err) {
    if (stored && stored.metadataFetchedAt !== null && now - stored.metadataFetchedAt < CIMD_STALE_MS && !(err instanceof ClientMetadataError)) return stored;
    throw err instanceof ClientMetadataError ? err : new ClientMetadataError('The app’s metadata document could not be read');
  }
  if (doc.client_id !== clientId) throw new ClientMetadataError('The metadata document names another client id');
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') throw new ClientMetadataError('Only public clients are supported');
  if (doc.response_types && !doc.response_types.includes('code')) throw new ClientMetadataError('The app does not use authorization codes');
  // Keep only the redirect addresses this school allows; there must be at least one.
  const uris = doc.redirect_uris.filter((u) => checkRedirectUri(u, allowed).ok);
  if (!uris.length) throw new ClientMetadataError('None of the app’s redirect addresses is allowed at this school');
  const values = { name: cleanClientName(doc.client_name), redirectUrisJson: uris, metadataFetchedAt: now };
  if (stored) {
    deps.db.update(oauthClients).set(values).where(eq(oauthClients.id, stored.id)).run();
    return { ...stored, ...values };
  }
  const row: ClientRow = { id: newId(), clientId, kind: 'cimd', ...values, createdAt: now, lastUsedAt: null, revokedAt: null, revokedBy: null };
  deps.db.insert(oauthClients).values(row).run();
  return row;
}

/**
 * The app behind a `client_id`: a registration (usable) or a metadata document on an allowed host.
 * `refresh: false` (the token endpoint) never fetches a document, it uses the stored copy.
 */
export async function resolveClient(deps: AppDeps, clientId: unknown, opts: { refresh: boolean }): Promise<ClientRow | null> {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 512) return null;
  const now = deps.now();
  if (isMetadataUrl(clientId) && opts.refresh) return metadataClient(deps, clientId, redirectHosts(deps.db));
  const row = deps.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
  if (!row || !clientUsable(deps.db, row, now)) return null;
  return row;
}

// ---------------------------------------------------------------- ending connections
/**
 * End connections (each one's access tokens with it) and void their unused codes. `by` is the account
 * that ended them, or null for the system. Returns how many were live. Call inside a transaction.
 */
export function revokeGrants(db: Db, grantIds: readonly string[], now: number, by: string | null, reason: string): number {
  if (!grantIds.length) return 0;
  const live = and(inArray(oauthGrants.id, [...grantIds]), isNull(oauthGrants.revokedAt));
  const n = db.select({ n: sql<number>`count(*)` }).from(oauthGrants).where(live).get()?.n ?? 0;
  db.update(oauthGrants).set({ revokedAt: now, revokedBy: by, revokeReason: reason }).where(live).run();
  db.update(mcpTokens)
    .set({ revokedAt: now, revokedBy: by })
    .where(and(eq(mcpTokens.kind, 'oauth'), inArray(mcpTokens.familyId, [...grantIds]), isNull(mcpTokens.revokedAt)))
    .run();
  db.update(oauthCodes)
    .set({ usedAt: now })
    .where(and(inArray(oauthCodes.grantId, [...grantIds]), isNull(oauthCodes.usedAt)))
    .run();
  return n;
}

/**
 * Everything OAuth of one account ends (the account was deactivated, its password reset or changed,
 * its sign-in method changed; D-160 S14h1 review fix extended to OAuth): live connections, their
 * tokens and codes, and the requests still waiting on a consent page. Returns the connections ended.
 */
export function revokeOAuthForUser(db: Db, userId: string, now: number, reason: string): number {
  const ids = db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
    .all()
    .map((r) => r.id);
  const n = revokeGrants(db, ids, now, null, reason);
  db.update(oauthRequests)
    .set({ status: 'expired', decidedAt: now })
    .where(and(eq(oauthRequests.userId, userId), eq(oauthRequests.status, 'pending')))
    .run();
  return n;
}

/** The school switch went off: every connection, code and waiting request ends (personal tokens just stop answering). */
export function revokeAllOAuth(db: Db, now: number): number {
  const ids = db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(isNull(oauthGrants.revokedAt))
    .all()
    .map((r) => r.id);
  const n = revokeGrants(db, ids, now, null, 'school_switch_off');
  db.update(oauthRequests).set({ status: 'expired', decidedAt: now }).where(eq(oauthRequests.status, 'pending')).run();
  db.update(oauthCodes).set({ usedAt: now }).where(isNull(oauthCodes.usedAt)).run();
  return n;
}

/** A lower cap shortens existing connections too (like personal tokens). Returns how many. Call inside a transaction. */
export function clampGrants(db: Db, capDays: number, now: number): number {
  const capMs = capDays * DAY;
  const over = and(isNull(oauthGrants.revokedAt), gt(oauthGrants.expiresAt, now), sql`${oauthGrants.expiresAt} > ${oauthGrants.createdAt} + ${capMs}`);
  const n = db.select({ n: sql<number>`count(*)` }).from(oauthGrants).where(over).get()?.n ?? 0;
  if (n) db.update(oauthGrants).set({ expiresAt: sql`${oauthGrants.createdAt} + ${capMs}` }).where(over).run();
  return n;
}

// ---------------------------------------------------------------- lists
const scopesOf = (xs: readonly string[]) => xs.filter((x): x is McpScope => (MCP_SCOPES as readonly string[]).includes(x));

function lastUsedByFamily(db: Db, ids: readonly string[]): Map<string, number> {
  if (!ids.length) return new Map();
  const rows = db
    .select({ f: mcpTokens.familyId, at: sql<number | null>`max(${mcpTokens.lastUsedAt})` })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.kind, 'oauth'), inArray(mcpTokens.familyId, [...ids])))
    .groupBy(mcpTokens.familyId)
    .all();
  return new Map(rows.filter((r) => r.at !== null).map((r) => [r.f, r.at as number]));
}

function connectionView(g: GrantRow, now: number, capDays: number, lastUsed: Map<string, number>): AiConnection {
  const expiresAt = grantExpiry(g, capDays);
  return {
    id: g.id,
    clientName: g.clientName,
    redirectHost: g.redirectHost,
    scopes: scopesOf(g.scopesJson),
    privacy: g.privacyMode,
    status: g.revokedAt !== null ? 'revoked' : expiresAt <= now ? 'expired' : 'active',
    createdAt: g.createdAt,
    expiresAt,
    lastUsedAt: lastUsed.get(g.id) ?? null,
    revokedAt: g.revokedAt,
  };
}

/** One account's connections (live ones and those that ended in the last 90 days), newest first. */
export function accountConnections(db: Db, userId: string, now: number, capDays: number): AiConnection[] {
  const rows = db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.userId, userId), or(isNull(oauthGrants.revokedAt), gt(oauthGrants.revokedAt, now - 90 * DAY)), gt(oauthGrants.expiresAt, now - 90 * DAY)))
    .orderBy(desc(oauthGrants.createdAt))
    .all();
  const used = lastUsedByFamily(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((g) => connectionView(g, now, capDays, used));
}

/** Every connection of the last 90 days, with its account (Admin → AI tools). */
export function adminConnections(db: Db, now: number, capDays: number): AdminAiConnection[] {
  const rows = db
    .select({ g: oauthGrants, userName: users.displayName, userRole: users.role })
    .from(oauthGrants)
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .where(and(or(isNull(oauthGrants.revokedAt), gt(oauthGrants.revokedAt, now - 90 * DAY)), gt(oauthGrants.expiresAt, now - 90 * DAY)))
    .orderBy(desc(oauthGrants.createdAt))
    .all();
  const used = lastUsedByFamily(
    db,
    rows.map((r) => r.g.id),
  );
  return rows.map((r) => ({ ...connectionView(r.g, now, capDays, used), userId: r.g.userId, userName: r.userName, userRole: r.userRole }));
}

/** Registered apps (not revoked, or revoked in the last 90 days), newest first. */
export function clientViews(db: Db, now: number): OAuthClientView[] {
  const rows = db
    .select()
    .from(oauthClients)
    .where(or(isNull(oauthClients.revokedAt), gt(oauthClients.revokedAt, now - 90 * DAY)))
    .orderBy(desc(oauthClients.createdAt))
    .limit(500)
    .all();
  const live = new Map(
    db
      .select({ c: oauthGrants.clientRowId, n: sql<number>`count(*)` })
      .from(oauthGrants)
      .where(and(isNull(oauthGrants.revokedAt), gt(oauthGrants.expiresAt, now)))
      .groupBy(oauthGrants.clientRowId)
      .all()
      .map((r) => [r.c, r.n]),
  );
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    clientId: c.clientId,
    redirectHosts: [...new Set(c.redirectUrisJson.map(redirectHostOf))],
    status: c.revokedAt !== null ? 'revoked' : clientUsable(db, c, now) ? 'active' : 'expired',
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
    activeConnections: live.get(c.id) ?? 0,
  }));
}

// ---------------------------------------------------------------- housekeeping
let lastPrune = 0;
/**
 * At most hourly: delete registrations that expired without ever getting a connection, and requests
 * and codes older than a day (they are single use and short-lived; connections and their tokens are
 * kept for the lists, the call log and the audit trail).
 */
export function pruneOAuth(db: Db, now: number) {
  if (now - lastPrune < HOUR && now >= lastPrune) return;
  lastPrune = now;
  db.delete(oauthRequests).where(lt(oauthRequests.createdAt, now - DAY)).run();
  db.delete(oauthCodes).where(lt(oauthCodes.createdAt, now - DAY)).run();
  db.delete(oauthClients)
    .where(
      and(
        lt(sql`coalesce(${oauthClients.lastUsedAt}, ${oauthClients.createdAt})`, now - OAUTH_CLIENT_UNUSED_DAYS * DAY),
        sql`not exists (select 1 from ${oauthGrants} g where g.client_row_id = ${oauthClients.id})`,
        sql`not exists (select 1 from ${oauthRequests} r where r.client_row_id = ${oauthClients.id})`,
      ),
    )
    .run();
}
