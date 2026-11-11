/**
 * "Connect an AI app" (S19c, D-181): what Profile → AI tools needs to guide a teacher through adding
 * Class Compass to ChatGPT, Claude, Claude Code or another MCP client, and the "Check connection"
 * answer. Nothing new is tracked: the last successful call per app comes from the existing call log
 * (`mcp_calls`: method, time, outcome; never arguments or results), joined with the token or the OAuth
 * connection that made it. Which app a connection belongs to is read from its return host (and, for
 * addresses on the person's own computer, the app's name or its metadata document).
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/mcp.ts';
import { AI_APPS, returnHostFor, type AiApp } from '../../../shared/mcp.ts';
import type { Db } from '../../db/client.ts';
import { mcpCalls, mcpTokens, oauthClients, oauthGrants } from '../../db/schema.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { TOOL_CALL_PREFIX } from './calls.ts';
import { grantLive, redirectHosts } from './oauth/store.ts';
import { LOOPBACK_HOSTS } from './oauth/redirects.ts';
import { aiSettings, effectiveExpiry, mcpUrl } from './tokens.ts';

const TOOL_PREFIX = TOOL_CALL_PREFIX;

/** The host of a stored return host (`127.0.0.1:47123`, `[::1]:5000`, `claude.ai`) without its port, lower case. */
export function bareHost(redirectHost: string): string {
  const h = redirectHost.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.replace(/:\d+$/u, '');
}

const isHostOrSub = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/**
 * Which app an OAuth connection belongs to. ChatGPT returns to chatgpt.com; claude.ai and Claude Desktop
 * to claude.ai; Claude Code (and other local tools) to an address on the person's own computer, where
 * Claude Code is recognised by its published metadata document or the name it registers with.
 */
export function appOfConnection(c: { redirectHost: string; clientName: string; clientId: string | null }): AiApp {
  const host = bareHost(c.redirectHost);
  if (isHostOrSub(host, 'chatgpt.com') || isHostOrSub(host, 'openai.com')) return 'chatgpt';
  if (isHostOrSub(host, 'claude.ai')) return 'claude';
  if (LOOPBACK_HOSTS.includes(host) || host.endsWith('.localhost')) {
    const id = (c.clientId ?? '').toLowerCase();
    if (/claude[\s_-]*code/iu.test(c.clientName) || (id.startsWith('https://claude.ai/') && id.includes('claude-code'))) return 'claude-code';
  }
  return 'other';
}

interface FamilyInfo {
  apps: AiApp[];
  via: 'connection' | 'token';
  name: string;
  live: boolean;
}

/** Per token family of this account: the app(s) it counts for, its display name and whether it still works. */
function families(db: Db, userId: string, familyIds: readonly string[], now: number, capDays: number): Map<string, FamilyInfo> {
  const out = new Map<string, FamilyInfo>();
  if (!familyIds.length) return out;
  const grants = db
    .select({ g: oauthGrants, clientId: oauthClients.clientId })
    .from(oauthGrants)
    .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientRowId))
    .where(and(eq(oauthGrants.userId, userId), inArray(oauthGrants.id, [...familyIds])))
    .all();
  for (const { g, clientId } of grants) {
    out.set(g.id, { apps: [appOfConnection({ redirectHost: g.redirectHost, clientName: g.clientName, clientId })], via: 'connection', name: g.clientName, live: grantLive(g, now, capDays) });
  }
  const pats = db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), eq(mcpTokens.kind, 'pat'), inArray(mcpTokens.familyId, [...familyIds])))
    .all();
  // A personal token does not say which app holds it: it counts for Claude Code and for other MCP clients (the two paths that use one).
  for (const t of pats) out.set(t.familyId, { apps: ['claude-code', 'other'], via: 'token', name: t.name, live: t.revokedAt === null && effectiveExpiry(t, capDays) > now });
  return out;
}

/** The newest successful call per token family of this account (tool calls only, or any request). */
function lastCallsByFamily(db: Db, userId: string, toolsOnly: boolean) {
  return db
    .select({ familyId: mcpTokens.familyId, at: sql<number>`max(${mcpCalls.at})`, method: mcpCalls.method })
    .from(mcpCalls)
    .innerJoin(mcpTokens, eq(mcpTokens.id, mcpCalls.tokenId))
    .where(and(eq(mcpCalls.userId, userId), eq(mcpCalls.status, 'ok'), ...(toolsOnly ? [like(mcpCalls.method, `${TOOL_PREFIX}%`)] : [])))
    .groupBy(mcpTokens.familyId)
    .all();
}

/** Profile → AI tools → "Connect an AI app": the switches, the address and per app its host and last call. */
export function setupView(ctx: RequestContext): z.infer<typeof C.AiToolsSetup> {
  const user = requireUser(ctx);
  const s = aiSettings(ctx.db);
  const now = ctx.now();
  const hosts = redirectHosts(ctx.db);
  // SQLite returns the row of the max() for the bare `method` column, so `method` is that call's tool.
  const tools = lastCallsByFamily(ctx.db, user.id, true);
  const seen = lastCallsByFamily(ctx.db, user.id, false);
  const info = families(ctx.db, user.id, [...new Set([...tools, ...seen].map((r) => r.familyId))], now, s.mcpTokenMaxDays);
  const apps = AI_APPS.map((app): z.infer<typeof C.AiAppStatus> => {
    const host = returnHostFor(app);
    let last: z.infer<typeof C.AiAppCall> | null = null;
    for (const r of tools) {
      const f = info.get(r.familyId);
      if (!f?.apps.includes(app) || (last && last.at >= r.at)) continue;
      last = { at: r.at, tool: r.method.slice(TOOL_PREFIX.length), via: f.via, name: f.name, live: f.live };
    }
    let lastSeenAt: number | null = null;
    for (const r of seen) if (info.get(r.familyId)?.apps.includes(app) && (lastSeenAt === null || r.at > lastSeenAt)) lastSeenAt = r.at;
    return { app, returnHost: host, returnHostAllowed: host === null || hosts.includes(host), lastToolCall: last, lastSeenAt };
  });
  return { enabled: s.mcpEnabled, studentDataAllowed: s.aiStudentDataAllowed, url: mcpUrl(ctx), apps };
}
