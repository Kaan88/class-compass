/**
 * "Connect an AI app" (S19c, D-181): Profile → AI tools → setup endpoint and the admin checklist's
 * "first call" status. Per app (ChatGPT, Claude, Claude Code, other) the return host the sign-in needs
 * and whether the administrator allowed it, and the last successful tool call from the existing call
 * log (no arguments, no results, no secrets). PIN-gated like every `account` endpoint. The school
 * switches are turned off again in `finally`. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpCalls, mcpTokens, oauthClients, oauthGrants } from '../../src/server/db/schema.ts';
import { newId } from '../../src/server/lib/crypto.ts';
import { appOfConnection, bareHost } from '../../src/server/modules/mcp/setup.ts';
import { AI_APPS, returnHostFor } from '../../src/shared/mcp.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { Mcp, makeToken, PASSWORD, setAi } from '../mcp-helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
beforeAll(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterAll(async () => env.app.close());

const HOUR = 60 * 60 * 1000;

/** An OAuth connection with one access token, as the consent page would leave it (fake values only). */
function connection(userId: string, o: { clientName: string; redirectHost: string; clientId?: string; revoked?: boolean }) {
  const now = env.clock.now();
  const clientRowId = newId();
  env.db
    .insert(oauthClients)
    .values({ id: clientRowId, clientId: o.clientId ?? `dcr-${clientRowId}`, kind: o.clientId ? 'cimd' : 'dcr', name: o.clientName, redirectUrisJson: [`https://${o.redirectHost}/cb`], createdAt: now, lastUsedAt: now, metadataFetchedAt: null, revokedAt: null, revokedBy: null })
    .run();
  const grantId = newId();
  env.db
    .insert(oauthGrants)
    .values({ id: grantId, clientRowId, userId, clientName: o.clientName, redirectHost: o.redirectHost, scopesJson: ['classes:read'], privacyMode: 'pseudonymous', createdAt: now, expiresAt: now + 30 * 24 * HOUR, lastRefreshAt: null, revokedAt: o.revoked ? now : null, revokedBy: null, revokeReason: null })
    .run();
  const tokenId = newId();
  env.db
    .insert(mcpTokens)
    .values({ id: tokenId, kind: 'oauth', familyId: grantId, clientId: clientRowId, userId, name: o.clientName, tokenHash: `fake-hash-${tokenId}`, prefix: 'ccmcp_fake', scopesJson: ['classes:read'], privacyMode: 'pseudonymous', createdAt: now, expiresAt: now + HOUR, lastUsedAt: null, revokedAt: null, revokedBy: null })
    .run();
  return { tokenId, grantId };
}
const logCall = (tokenId: string, userId: string, method: string, at: number, status: 'ok' | 'error' = 'ok') =>
  env.db.insert(mcpCalls).values({ id: newId(), at, tokenId, userId, method, status, errorCode: null, durationMs: 5, bytes: 100 }).run();

describe('which app a connection belongs to (D-181)', () => {
  it('reads the return host, and on this computer the name or metadata document of Claude Code', () => {
    expect(bareHost('127.0.0.1:47123')).toBe('127.0.0.1');
    expect(bareHost('[::1]:5000')).toBe('[::1]');
    expect(bareHost('Claude.AI')).toBe('claude.ai');
    expect(appOfConnection({ redirectHost: 'chatgpt.com', clientName: 'ChatGPT', clientId: null })).toBe('chatgpt');
    expect(appOfConnection({ redirectHost: 'claude.ai', clientName: 'Claude', clientId: null })).toBe('claude');
    expect(appOfConnection({ redirectHost: 'localhost:33418', clientName: 'Claude Code (class-compass)', clientId: null })).toBe('claude-code');
    expect(appOfConnection({ redirectHost: '127.0.0.1:5000', clientName: 'x', clientId: 'https://claude.ai/oauth/claude-code-client-metadata' })).toBe('claude-code');
    expect(appOfConnection({ redirectHost: '127.0.0.1:6274', clientName: 'MCP Inspector', clientId: null })).toBe('other');
    // A look-alike host is not ChatGPT or Claude.
    expect(appOfConnection({ redirectHost: 'chatgpt.com.example.org', clientName: 'ChatGPT', clientId: null })).toBe('other');
    expect(appOfConnection({ redirectHost: 'notclaude.ai', clientName: 'Claude Code', clientId: null })).toBe('other');
  });

  it('names the documented return hosts (ChatGPT chatgpt.com; Claude and Claude Code claude.ai)', () => {
    expect(AI_APPS.map((a) => returnHostFor(a))).toEqual(['chatgpt.com', 'claude.ai', 'claude.ai', null]);
  });
});

describe('GET /api/account/ai-tools/setup (D-181)', () => {
  it('while AI tools are off: says so, with the address from the configuration and no calls', async () => {
    const r = await ok(s.teacherA.get('/api/account/ai-tools/setup'));
    expect(r.enabled).toBe(false);
    expect(r.url).toBe(`${env.config.origins.main}/mcp`);
    expect(r.apps.map((a: { app: string }) => a.app)).toEqual([...AI_APPS]);
    expect(r.apps.every((a: { lastToolCall: unknown }) => a.lastToolCall === null)).toBe(true);
    // The default allow-list has claude.ai only: ChatGPT is not allowed yet.
    const by = Object.fromEntries(r.apps.map((a: { app: string }) => [a.app, a]));
    expect(by.chatgpt).toMatchObject({ returnHost: 'chatgpt.com', returnHostAllowed: false });
    expect(by.claude).toMatchObject({ returnHost: 'claude.ai', returnHostAllowed: true });
    expect(by.other).toMatchObject({ returnHost: null, returnHostAllowed: true });
  });

  it('shows the last successful tool call per app, own calls only, never arguments or secrets', async () => {
    try {
      await setAi(s.admin, { mcpEnabled: true });
      const t0 = env.clock.now();
      const gpt = connection(s.ayse.id, { clientName: 'ChatGPT', redirectHost: 'chatgpt.com' });
      const claude = connection(s.ayse.id, { clientName: 'Claude', redirectHost: 'claude.ai' });
      const other = connection(s.mehmet.id, { clientName: 'ChatGPT', redirectHost: 'chatgpt.com' });
      logCall(gpt.tokenId, s.ayse.id, 'initialize', t0 - 3 * HOUR);
      logCall(gpt.tokenId, s.ayse.id, 'tools/call:class_overview', t0 - 2 * HOUR);
      logCall(gpt.tokenId, s.ayse.id, 'tools/call:class_report', t0 - HOUR, 'error'); // failures do not count
      logCall(claude.tokenId, s.ayse.id, 'tools/list', t0 - HOUR); // connected, no tool used yet
      logCall(other.tokenId, s.mehmet.id, 'tools/call:list_my_classes', t0); // another teacher's

      // A personal token used for real on /mcp counts for Claude Code and other clients.
      const pat = await makeToken(s.teacherA, { scopes: ['classes:read'], name: 'Laptop (test)' });
      env.clock.advance(60_000);
      const mcp = new Mcp(env, pat.secret);
      await mcp.init();
      const listed = await mcp.call('list_my_classes');
      expect(listed.isError).toBe(false);

      const res = await s.teacherA.get('/api/account/ai-tools/setup');
      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(pat.secret);
      expect(raw).not.toContain('fake-hash');
      expect(raw).not.toContain(PASSWORD);
      const by = Object.fromEntries(res.body.apps.map((a: { app: string }) => [a.app, a]));
      expect(by.chatgpt.lastToolCall).toEqual({ at: t0 - 2 * HOUR, tool: 'class_overview', via: 'connection', name: 'ChatGPT', live: true });
      expect(by.chatgpt.lastSeenAt).toBe(t0 - 2 * HOUR);
      expect(by.claude.lastToolCall).toBeNull();
      expect(by.claude.lastSeenAt).toBe(t0 - HOUR);
      expect(by['claude-code'].lastToolCall).toMatchObject({ tool: 'list_my_classes', via: 'token', name: 'Laptop (test)', live: true });
      expect(by.other.lastToolCall).toMatchObject({ tool: 'list_my_classes', via: 'token' });

      // Mehmet sees only his own ChatGPT call.
      const m = await ok(s.teacherB.get('/api/account/ai-tools/setup'));
      const mBy = Object.fromEntries(m.apps.map((a: { app: string }) => [a.app, a]));
      expect(mBy.chatgpt.lastToolCall).toMatchObject({ tool: 'list_my_classes', at: t0 });
      expect(mBy['claude-code'].lastToolCall).toBeNull();

      // A revoked token still shows its last call, marked as no longer working.
      await ok(s.teacherA.post(`/api/account/ai-tools/tokens/${pat.id}/revoke`));
      const after = await ok(s.teacherA.get('/api/account/ai-tools/setup'));
      expect(after.apps.find((a: { app: string }) => a.app === 'claude-code').lastToolCall.live).toBe(false);

      // The admin checklist's "a first call worked".
      const admin = await ok(s.admin.get('/api/admin/ai-tools'));
      expect(admin.lastToolCallAt).toBeGreaterThanOrEqual(t0);
    } finally {
      await setAi(s.admin, { mcpEnabled: false });
    }
  });

  it('follows the allow-list: adding chatgpt.com allows ChatGPT', async () => {
    try {
      await ok(s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai', 'chatgpt.com'] }));
      const r = await ok(s.teacherA.get('/api/account/ai-tools/setup'));
      expect(r.apps.find((a: { app: string }) => a.app === 'chatgpt').returnHostAllowed).toBe(true);
      await ok(s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['chatgpt.com'] }));
      const r2 = await ok(s.teacherA.get('/api/account/ai-tools/setup'));
      expect(r2.apps.filter((a: { returnHostAllowed: boolean }) => !a.returnHostAllowed).map((a: { app: string }) => a.app)).toEqual(['claude', 'claude-code']);
    } finally {
      await ok(s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai'] }));
    }
  });

  it('is an account endpoint: no anonymous access, and a locked classroom device answers 423', async () => {
    const anon = new Client(env);
    expect((await anon.get('/api/account/ai-tools/setup')).status).toBe(401);
    const t = new Client(env);
    await t.login('mehmet.teacher');
    await ok(t.post('/api/auth/pin', { currentPassword: PASSWORD, pin: '1357' }));
    await ok(t.post('/api/classroom/enter'));
    expect((await t.get('/api/account/ai-tools/setup')).status).toBe(423);
    await ok(t.post('/api/auth/pin/unlock', { pin: '1357' }));
    expect((await t.get('/api/account/ai-tools/setup')).status).toBe(200);
  });
});
