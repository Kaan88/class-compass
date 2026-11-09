/**
 * OAuth 2.1 for AI apps (S14h2, D-160): discovery (RFC 9728, RFC 8414), the 401/403 challenges of
 * `/mcp`, Dynamic Client Registration (RFC 7591) with the redirect address rules, Client ID Metadata
 * Documents, the authorize step (PKCE S256, exact redirect match, RFC 8707 resource, state, no open
 * redirect), the consent page (`account`: session, PIN lock, re-authentication, browser and account
 * binding, scope narrowing, privacy, expiry), the token endpoint (single-use 60-second codes, reuse
 * revocation, refresh rotation and family revocation, the cap), revocation (RFC 7009), the school
 * switch, revokeAllUserMcpTokens and the logs. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { auditEvents, mcpTokens, oauthClients, oauthGrants, oauthRequests } from '../../src/server/db/schema.ts';
import { OAUTH_UNUSED_CLIENTS_MAX } from '../../src/shared/mcp.ts';
import { isPublicAddress } from '../../src/server/modules/mcp/oauth/cimd.ts';
import { checkRedirectUri, isOurResource, matchRedirectUri } from '../../src/server/modules/mcp/oauth/redirects.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { Mcp, PASSWORD, setAi } from '../mcp-helpers.ts';
import {
  authorize,
  authorizeUrl,
  authParams,
  CLAUDE_CALLBACK,
  connectApp,
  consent,
  exchange,
  form,
  freshIp,
  LOOPBACK,
  pkce,
  refresh,
  register,
  registerOk,
  requestIdOf,
} from '../oauth-helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

const DAY = 24 * 60 * 60 * 1000;
const logLines: string[] = [];
const CIMD_URL = 'https://claude.ai/oauth/claude-code-client-metadata';
let cimdCalls: string[] = [];
let cimdDoc: (url: string) => unknown = (url) => ({ client_id: url, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });

let env: TestEnv;
let s: School;
beforeAll(async () => {
  env = await makeEnv(
    {},
    {
      logStream: { write: (line: string) => void logLines.push(line) },
      clientMetadataFetch: async (url) => {
        cimdCalls.push(url);
        return cimdDoc(url);
      },
    },
  );
  s = await buildSchool(env);
});
afterAll(async () => env.app.close());

const get = async (url: string, headers: Record<string, string> = {}) => {
  const r = await env.app.inject({ method: 'GET', url, headers });
  let body: any = r.body;
  try {
    body = JSON.parse(r.body);
  } catch {
    /* not JSON */
  }
  return { status: r.statusCode, body, headers: r.headers };
};
const reasonOf = (r: { body: any }) => r.body?.error?.details?.reason;
/** A signed-in teacher on an address of its own (authorize allows 60 calls a minute per address). */
const teacherOnFreshIp = async () => {
  const c = new Client(env);
  c.ip = freshIp();
  await c.login('ayse.teacher');
  return c;
};
const ORIGIN = () => env.config.origins.main;

describe('redirect address and resource rules (unit)', () => {
  const allowed = ['claude.ai'];
  it('accepts https on an allowed host and http loopback on any port', () => {
    for (const u of [CLAUDE_CALLBACK, 'http://127.0.0.1:33418/callback', 'http://localhost/callback', 'http://[::1]:8080/cb', 'http://LOCALHOST:5/cb', 'https://claude.ai/cb?x=1']) expect(checkRedirectUri(u, allowed).ok, u).toBe(true);
  });
  it.each([
    ['http://claude.ai/api/mcp/auth_callback', 'http_not_loopback'],
    ['https://evil.example.org/callback', 'host_not_allowed'],
    ['https://claude.ai.evil.example/cb', 'host_not_allowed'],
    ['https://sub.claude.ai/cb', 'host_not_allowed'],
    ['https://claude.ai/cb#frag', 'fragment'],
    ['https://*.claude.ai/cb', 'wildcard'],
    ['https://user:pw@claude.ai/cb', 'userinfo'],
    ['https://claude.ai@evil.example/cb', 'userinfo'],
    ['https://claude.ai:8443/cb', 'port'],
    ['javascript:alert(1)', 'scheme'],
    ['cursor://anysphere.cursor-retrieval/oauth', 'scheme'],
    ['data:text/html,hi', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['/relative/path', 'invalid'],
    ['https://claude.ai/ cb', 'invalid'],
    [`https://claude.ai/${'a'.repeat(600)}`, 'too_long'],
  ])('refuses %s (%s)', (u, reason) => {
    expect(checkRedirectUri(u, allowed)).toEqual({ ok: false, reason });
  });
  it('matches exactly, and only loopback addresses on another port', () => {
    const reg = [CLAUDE_CALLBACK, 'http://127.0.0.1/callback', 'http://localhost:9000/cb?x=1'];
    expect(matchRedirectUri(reg, CLAUDE_CALLBACK, allowed)).toBe(CLAUDE_CALLBACK);
    expect(matchRedirectUri(reg, `${CLAUDE_CALLBACK}/`, allowed)).toBeNull();
    expect(matchRedirectUri(reg, `${CLAUDE_CALLBACK}?x=1`, allowed)).toBeNull();
    expect(matchRedirectUri(reg, 'https://CLAUDE.ai/api/mcp/auth_callback', allowed)).toBeNull();
    expect(matchRedirectUri(reg, 'http://127.0.0.1:51234/callback', allowed)).toBe('http://127.0.0.1:51234/callback');
    expect(matchRedirectUri(reg, 'http://127.0.0.1:51234/other', allowed)).toBeNull();
    expect(matchRedirectUri(reg, 'http://localhost:51234/callback', allowed)).toBeNull(); // localhost ≠ 127.0.0.1
    expect(matchRedirectUri(reg, 'http://localhost:1/cb?x=1', allowed)).toBe('http://localhost:1/cb?x=1');
    expect(matchRedirectUri(reg, 'http://127.0.0.1:51234/callback#x', allowed)).toBeNull();
    expect(matchRedirectUri(['https://evil.example.org/cb'], 'https://evil.example.org/cb', allowed)).toBeNull(); // the allow-list applies again
  });
  it('knows the MCP resource (RFC 8707)', () => {
    const o = 'https://school.example.org';
    expect(isOurResource('https://school.example.org/mcp', o)).toBe(true);
    expect(isOurResource('https://SCHOOL.example.org/mcp/', o)).toBe(true);
    for (const r of ['https://school.example.org', 'https://school.example.org/', 'https://school.example.org/mcp?x=1', 'https://school.example.org/mcp#f', 'http://school.example.org/mcp', 'https://other.example.org/mcp', 'https://school.example.org/api']) expect(isOurResource(r, o), r).toBe(false);
  });
  it('fetches metadata documents only from public addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.3', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1']) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ['160.79.104.10', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe('while AI tools are off (D-161 switch first)', () => {
  it('discovery, registration, token and revoke answer 404; authorize shows our page', async () => {
    for (const u of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) expect((await get(u)).status, u).toBe(404);
    expect((await register(env, { redirect_uris: [CLAUDE_CALLBACK] })).status).toBe(404);
    expect((await form(env, '/oauth/token', { grant_type: 'authorization_code' })).status).toBe(404);
    expect((await form(env, '/oauth/revoke', { token: 'x' })).status).toBe(404);
    const a = await get(authorizeUrl({ client_id: 'x', redirect_uri: CLAUDE_CALLBACK }));
    expect(a.status).toBe(303);
    expect(a.headers.location).toBe('/oauth/consent?error=MCP_DISABLED');
  });
});

describe('with AI tools on', () => {
  beforeAll(async () => {
    await setAi(s.admin, { mcpEnabled: true });
  });

  describe('discovery (RFC 9728, RFC 8414)', () => {
    it('protected resource metadata names /mcp and this server, at both addresses', async () => {
      for (const u of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
        const r = await get(u);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ resource: `${ORIGIN()}/mcp`, authorization_servers: [ORIGIN()], bearer_methods_supported: ['header'] });
        expect(r.body.scopes_supported).toContain('classes:read');
        expect(r.headers['access-control-allow-origin']).toBe('*');
        expect(r.headers['access-control-allow-credentials']).toBeUndefined();
      }
      const pre = await env.app.inject({ method: 'OPTIONS', url: '/.well-known/oauth-protected-resource/mcp', headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'GET', 'access-control-request-headers': 'mcp-protocol-version' } });
      expect(pre.statusCode).toBe(204);
      expect(String(pre.headers['access-control-allow-headers'])).toContain('mcp-protocol-version');
    });

    it('authorization server metadata: S256 only, public clients, DCR and CIMD', async () => {
      const r = await get('/.well-known/oauth-authorization-server');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        issuer: ORIGIN(),
        authorization_endpoint: `${ORIGIN()}/oauth/authorize`,
        token_endpoint: `${ORIGIN()}/oauth/token`,
        registration_endpoint: `${ORIGIN()}/oauth/register`,
        revocation_endpoint: `${ORIGIN()}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
      });
      expect(r.body.scopes_supported).not.toContain('offline_access');
    });

    it('/mcp answers 401 with the resource metadata address; a bad token adds error="invalid_token"', async () => {
      const none = await new Mcp(env, null).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(none.status).toBe(401);
      const h = String(none.headers['www-authenticate']);
      expect(h).toMatch(/^Bearer /u);
      expect(h).toContain(`resource_metadata="${ORIGIN()}/.well-known/oauth-protected-resource/mcp"`);
      expect(h).not.toContain('error=');
      const bad = await new Mcp(env, 'ccmcp_not-a-real-token-at-all').raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(bad.status).toBe(401);
      expect(String(bad.headers['www-authenticate'])).toContain('error="invalid_token"');
    });
  });

  describe('dynamic client registration (RFC 7591)', () => {
    it('registers a public client: no secret, cleaned name, both grant types', async () => {
      const r = await register(env, { client_name: 'Claude‮\u0007 <b>Desktop</b>', redirect_uris: [CLAUDE_CALLBACK, LOOPBACK] });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ redirect_uris: [CLAUDE_CALLBACK, LOOPBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
      expect(r.body.client_secret).toBeUndefined();
      expect(r.body.client_id).toMatch(/^ccc_/u);
      // Untrusted display text: control and direction characters go, markup stays text.
      expect(r.body.client_name).toBe('Claude <b>Desktop</b>');
      expect(r.headers['cache-control']).toBe('no-store');
    });

    it.each([
      [{ redirect_uris: [] }, 'invalid_redirect_uri'],
      [{ redirect_uris: 'https://claude.ai/cb' }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['https://evil.example.org/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['http://claude.ai/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['https://claude.ai/cb#x'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['https://*.claude.ai/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['cursor://callback'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: [CLAUDE_CALLBACK, 'https://evil.example.org/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }, 'invalid_client_metadata'],
      [{ redirect_uris: [CLAUDE_CALLBACK], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ redirect_uris: [CLAUDE_CALLBACK], response_types: ['token'] }, 'invalid_client_metadata'],
    ])('refuses %j (%s)', async (body, error) => {
      const r = await register(env, body);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe(error);
    });

    it('is rate-limited per address', async () => {
      const ip = '10.99.0.1';
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) statuses.push((await register(env, { redirect_uris: [LOOPBACK] }, ip)).status);
      expect(statuses.slice(0, 20).every((x) => x === 201)).toBe(true);
      expect(statuses.slice(20)).toEqual([429, 429]);
      // Another address is not affected.
      expect((await register(env, { redirect_uris: [LOOPBACK] })).status).toBe(201);
    });

    it('a registration nobody uses expires after 30 days', async () => {
      const clientId = await registerOk(env);
      env.clock.advance(31 * DAY);
      try {
        const browser = s.teacherA;
        const a = await authorize(browser, authParams(env, clientId, pkce().challenge));
        expect(a.location).toBe('/oauth/consent?error=UNKNOWN_CLIENT');
      } finally {
        env.clock.advance(-31 * DAY);
      }
    });

    it('an authorize call without a consent does not keep a registration alive (S14h2 review)', async () => {
      const t = await teacherOnFreshIp();
      const clientId = await registerOk(env);
      env.clock.advance(20 * DAY);
      try {
        expect((await authorize(t, authParams(env, clientId, pkce().challenge))).location).toMatch(/^\/oauth\/consent\?request=/u);
        expect(env.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get()!.lastUsedAt).toBeNull();
        env.clock.advance(11 * DAY);
        expect((await authorize(t, authParams(env, clientId, pkce().challenge))).location).toBe('/oauth/consent?error=UNKNOWN_CLIENT');
      } finally {
        env.clock.advance(-31 * DAY);
      }
    });

    it('a flood of unused registrations never stops new ones: the oldest unused one makes room (S14h2 review)', async () => {
      const t = await teacherOnFreshIp();
      const connected = await connectApp(env, t);
      const unused = and(eq(oauthClients.kind, 'dcr'), isNull(oauthClients.revokedAt), sql`not exists (select 1 from ${oauthGrants} g where g.client_row_id = ${oauthClients.id})`);
      const count = () => env.db.select({ n: sql<number>`count(*)` }).from(oauthClients).where(unused).get()!.n;
      const t0 = env.clock.t;
      const flood = Array.from({ length: Math.max(0, OAUTH_UNUSED_CLIENTS_MAX - count()) }, (_, i) => ({
        id: `flood-${i}`,
        clientId: `ccc_flood_${i}`,
        kind: 'dcr' as const,
        name: `Flood ${i}`,
        redirectUrisJson: [LOOPBACK],
        createdAt: t0 - 60_000 - i * 1000,
        lastUsedAt: null,
        metadataFetchedAt: null,
        revokedAt: null,
        revokedBy: null,
      }));
      if (flood.length) env.db.insert(oauthClients).values(flood).run();
      try {
        expect(count()).toBe(OAUTH_UNUSED_CLIENTS_MAX);
        const oldest = env.db.select().from(oauthClients).where(unused).orderBy(oauthClients.createdAt).get()!;
        const fresh = await registerOk(env);
        expect(count()).toBe(OAUTH_UNUSED_CLIENTS_MAX);
        expect(env.db.select().from(oauthClients).where(eq(oauthClients.id, oldest.id)).get()).toBeUndefined();
        // The new registration works; an app with a connection was never a candidate.
        expect((await authorize(t, authParams(env, fresh, pkce().challenge))).location).toMatch(/^\/oauth\/consent\?request=/u);
        expect((await refresh(env, connected.clientId, connected.refresh)).status).toBe(200);
        // The administrator's list shows apps that were used before registrations nobody used.
        const clients = (await ok(s.admin.get('/api/admin/ai-tools'))).clients as Array<{ clientId: string }>;
        expect(clients.findIndex((c) => c.clientId === connected.clientId)).toBeGreaterThanOrEqual(0);
        expect(clients.findIndex((c) => c.clientId === connected.clientId)).toBeLessThan(clients.findIndex((c) => c.clientId === fresh));
      } finally {
        env.db.delete(oauthRequests).where(sql`${oauthRequests.clientRowId} like 'flood-%'`).run();
        env.db.delete(oauthClients).where(sql`${oauthClients.id} like 'flood-%'`).run();
      }
    });
  });

  describe('authorize: no open redirect, PKCE S256, resource, state', () => {
    let clientId: string;
    beforeAll(async () => {
      clientId = await registerOk(env, [CLAUDE_CALLBACK, 'http://127.0.0.1/callback']);
    });

    it('errors before the redirect address is validated stay on our own page', async () => {
      const { challenge } = pkce();
      const cases: Array<[Record<string, string | undefined>, string]> = [
        [authParams(env, 'ccc_unknown', challenge), 'UNKNOWN_CLIENT'],
        [authParams(env, clientId, challenge, { redirect_uri: 'https://evil.example.org/cb' }), 'REDIRECT_URI'],
        [authParams(env, clientId, challenge, { redirect_uri: 'https://claude.ai/api/mcp/other' }), 'REDIRECT_URI'],
        [authParams(env, clientId, challenge, { redirect_uri: `${CLAUDE_CALLBACK}#x` }), 'REDIRECT_URI'],
        [authParams(env, clientId, challenge, { redirect_uri: undefined }), 'REDIRECT_URI'],
        [authParams(env, clientId, challenge, { redirect_uri: 'http://127.0.0.1:4000/other' }), 'REDIRECT_URI'],
        [authParams(env, clientId, challenge, { state: 'x'.repeat(600) }), 'INVALID_REQUEST'],
      ];
      for (const [p, error] of cases) {
        const a = await authorize(s.teacherA, p);
        expect(a.status, error).toBe(303);
        expect(a.location, error).toBe(`/oauth/consent?error=${error}`);
      }
      // A repeated parameter is invalid, and never redirected either.
      const dup = await s.teacherA.req('GET', `${authorizeUrl(authParams(env, clientId, challenge))}&redirect_uri=${encodeURIComponent('https://evil.example.org/cb')}`);
      expect(dup.headers.location).toBe('/oauth/consent?error=INVALID_REQUEST');
    });

    it('later errors go back to the app with its state and our issuer', async () => {
      const { challenge } = pkce();
      const cases: Array<[Record<string, string | undefined>, string]> = [
        [authParams(env, clientId, challenge, { response_type: 'token' }), 'unsupported_response_type'],
        [authParams(env, clientId, challenge, { code_challenge_method: 'plain' }), 'invalid_request'],
        [authParams(env, clientId, challenge, { code_challenge_method: undefined }), 'invalid_request'],
        [authParams(env, clientId, 'short', {}), 'invalid_request'],
        [authParams(env, clientId, challenge, { resource: 'https://other.example.org/mcp' }), 'invalid_target'],
        [authParams(env, clientId, challenge, { resource: ORIGIN() }), 'invalid_target'],
        [authParams(env, clientId, challenge, { scope: 'classes:read "quoted"' }), 'invalid_scope'],
      ];
      for (const [p, error] of cases) {
        const a = await authorize(s.teacherA, p);
        expect(a.status, error).toBe(303);
        const u = new URL(a.location);
        expect(`${u.origin}${u.pathname}`).toBe(CLAUDE_CALLBACK);
        expect(u.searchParams.get('error')).toBe(error);
        expect(u.searchParams.get('state')).toBe('st-123');
        expect(u.searchParams.get('iss')).toBe(ORIGIN());
        expect(u.searchParams.get('code')).toBeNull();
      }
    });

    it('a valid request waits for the consent page, bound to this browser; loopback may change port', async () => {
      const a = await authorize(s.teacherA, authParams(env, clientId, pkce().challenge, { redirect_uri: 'http://127.0.0.1:51234/callback' }));
      expect(a.location).toMatch(/^\/oauth\/consent\?request=[A-Za-z0-9_-]{32}$/u);
      const row = env.db.select().from(oauthRequests).where(eq(oauthRequests.id, requestIdOf(a.location))).get()!;
      expect(row).toMatchObject({ status: 'pending', userId: null, redirectUri: 'http://127.0.0.1:51234/callback', resource: `${ORIGIN()}/mcp` });
      expect(s.teacherA.cookies.get('ccoa')).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    });
  });

  describe('consent page (account access, PIN lock, re-authentication)', () => {
    let clientId: string;
    beforeAll(async () => {
      clientId = await registerOk(env);
    });

    it('needs a signed-in session, this browser and this account', async () => {
      const browser = new Client(env);
      const a = await authorize(browser, authParams(env, clientId, pkce().challenge));
      const id = requestIdOf(a.location);
      // Not signed in: 401 (the page sends the person to sign in first).
      expect((await browser.get(`/api/account/oauth/requests/${id}`)).status).toBe(401);
      await browser.login('ayse.teacher');
      const view = await ok(browser.get(`/api/account/oauth/requests/${id}`));
      expect(view).toMatchObject({ clientName: 'Claude', redirectHost: 'claude.ai', redirectLoopback: false, offered: ['classes:read', 'reports:read'], preselected: ['classes:read', 'reports:read'] });
      // Another browser (no cookie) cannot use the request id.
      const other = new Client(env);
      await other.login('ayse.teacher');
      expect(reasonOf(await other.get(`/api/account/oauth/requests/${id}`))).toBe('OAUTH_OTHER_BROWSER');
      // Another account in the same browser (the request is bound to the first account).
      const sameBrowser = new Client(env);
      sameBrowser.cookies.set('ccoa', browser.cookies.get('ccoa')!);
      await sameBrowser.login('mehmet.teacher');
      const r = await sameBrowser.get(`/api/account/oauth/requests/${id}`);
      expect(r.status).toBe(404);
      expect(reasonOf(r)).toBe('OAUTH_REQUEST_GONE');
    });

    it('423 while the classroom lock is engaged; works after the PIN', async () => {
      const t = new Client(env);
      await t.login('ayse.teacher');
      await ok(t.post('/api/auth/pin', { currentPassword: PASSWORD, pin: '2468' }));
      await ok(t.post('/api/classroom/enter'));
      const a = await authorize(t, authParams(env, clientId, pkce().challenge));
      const id = requestIdOf(a.location);
      expect((await t.get(`/api/account/oauth/requests/${id}`)).status).toBe(423);
      expect((await t.post(`/api/account/oauth/requests/${id}`, { allow: true, currentPassword: PASSWORD })).status).toBe(423);
      await ok(t.post('/api/auth/pin/unlock', { pin: '2468' }));
      expect((await t.get(`/api/account/oauth/requests/${id}`)).status).toBe(200);
    });

    it('sorts scopes by role: administrator scopes are never offered to teachers; unknown ones are shown and ignored', async () => {
      const { challenge } = pkce();
      const a = await authorize(s.teacherA, authParams(env, clientId, challenge, { scope: 'classes:read school:read settings:admin offline_access email goals:write' }));
      const id = requestIdOf(a.location);
      const view = await ok(s.teacherA.get(`/api/account/oauth/requests/${id}`));
      expect(view.offered).toEqual(['classes:read', 'goals:write']);
      expect(view.notAvailable).toEqual(['school:read', 'settings:admin']);
      expect(view.unknown).toEqual(['email']);
      const refused = await s.teacherA.post(`/api/account/oauth/requests/${id}`, { allow: true, currentPassword: PASSWORD, scopes: ['classes:read', 'school:read'] });
      expect(reasonOf(refused)).toBe('SCOPE_NOT_ALLOWED');
      const notAsked = await s.teacherA.post(`/api/account/oauth/requests/${id}`, { allow: true, currentPassword: PASSWORD, scopes: ['reports:read'] });
      expect(reasonOf(notAsked)).toBe('SCOPE_NOT_ALLOWED');
      // An administrator is offered only administrator scopes.
      const admin = new Client(env);
      await admin.login('root.admin');
      const b = await authorize(admin, authParams(env, clientId, challenge, { scope: 'classes:read school:read' }));
      const av = await ok(admin.get(`/api/account/oauth/requests/${requestIdOf(b.location)}`));
      expect(av.offered).toEqual(['school:read']);
      expect(av.notAvailable).toEqual(['classes:read']);
      // No usable scope asked: the role's scopes, with only the read ones ticked.
      const c = await authorize(s.teacherA, authParams(env, clientId, challenge, { scope: undefined }));
      const cv = await ok(s.teacherA.get(`/api/account/oauth/requests/${requestIdOf(c.location)}`));
      expect(cv.offered).toContain('homework:write');
      expect(cv.preselected).toEqual(['classes:read', 'reports:read', 'goals:read']);
    });

    it('allow needs the password again, the cap and the privacy rule; the code goes back with state', async () => {
      const { challenge, verifier } = pkce();
      const a = await authorize(s.teacherA, authParams(env, clientId, challenge));
      const id = requestIdOf(a.location);
      const url = `/api/account/oauth/requests/${id}`;
      expect((await s.teacherA.post(url, { allow: true })).status).toBe(401);
      expect(reasonOf(await s.teacherA.post(url, { allow: true, currentPassword: 'wrong-password-123' }))).toBe('WRONG_PASSWORD');
      expect(reasonOf(await s.teacherA.post(url, { allow: true, currentPassword: PASSWORD, days: 91 }))).toBe(undefined); // schema refuses > 90
      await setAi(s.admin, { mcpTokenMaxDays: 30 });
      try {
        expect(reasonOf(await s.teacherA.post(url, { allow: true, currentPassword: PASSWORD, days: 31 }))).toBe('TOKEN_TOO_LONG');
      } finally {
        await setAi(s.admin, { mcpTokenMaxDays: 90 });
      }
      expect(reasonOf(await s.teacherA.post(url, { allow: true, currentPassword: PASSWORD, privacy: 'named' }))).toBe('STUDENT_DATA_OFF');
      expect(reasonOf(await s.teacherA.post(url, { allow: true, currentPassword: PASSWORD, scopes: [] }))).toBe('SCOPE_REQUIRED');
      const d = await ok(s.teacherA.post(url, { allow: true, currentPassword: PASSWORD, scopes: ['classes:read'], days: 7 }));
      const back = new URL(d.redirectTo);
      expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
      expect(back.searchParams.get('state')).toBe('st-123');
      expect(back.searchParams.get('iss')).toBe(ORIGIN());
      const code = back.searchParams.get('code')!;
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      // Single use: the request cannot be decided again.
      expect(reasonOf(await s.teacherA.post(url, { allow: true, currentPassword: PASSWORD }))).toBe('OAUTH_REQUEST_GONE');
      const t = await exchange(env, clientId, code, verifier);
      expect(t.status).toBe(200);
      expect(t.body.scope).toBe('classes:read');
      // Audited, without the code.
      const audits = env.db.select().from(auditEvents).where(eq(auditEvents.action, 'oauth.connect')).all();
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toContain(code);
    });

    it('deny sends access_denied with the state', async () => {
      const a = await authorize(s.teacherA, authParams(env, clientId, pkce().challenge));
      const d = await ok(s.teacherA.post(`/api/account/oauth/requests/${requestIdOf(a.location)}`, { allow: false }));
      const back = new URL(d.redirectTo);
      expect(back.searchParams.get('error')).toBe('access_denied');
      expect(back.searchParams.get('state')).toBe('st-123');
      expect(back.searchParams.get('code')).toBeNull();
    });

    it('requests expire after 15 minutes', async () => {
      const a = await authorize(s.teacherA, authParams(env, clientId, pkce().challenge));
      env.clock.advance(16 * 60_000);
      try {
        expect(reasonOf(await s.teacherA.get(`/api/account/oauth/requests/${requestIdOf(a.location)}`))).toBe('OAUTH_REQUEST_GONE');
      } finally {
        env.clock.advance(-16 * 60_000);
      }
    });
  });

  describe('token endpoint', () => {
    it('issues an hour-long access token for /mcp and a refresh token, no-store', async () => {
      const app = await connectApp(env, s.teacherA);
      expect(app.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'classes:read reports:read' });
      expect(app.access).toMatch(/^ccmcp_/u);
      expect(app.refresh).toMatch(/^ccmcpr_/u);
      const mcp = new Mcp(env, app.access);
      await mcp.init();
      const r = await mcp.call('list_my_classes');
      expect(r.isError).toBe(false);
      const row = env.db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, env.db.select().from(mcpTokens).all().find((x) => x.kind === 'oauth')!.tokenHash)).get()!;
      expect(row.kind).toBe('oauth');
      // The refresh token never works as a bearer token.
      expect((await new Mcp(env, app.refresh).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      // Access tokens are not listed as personal tokens; the connection is.
      const view = await ok(s.teacherA.get('/api/account/ai-tools'));
      expect(view.tokens.every((t: { kind: string }) => t.kind === 'pat')).toBe(true);
      expect(view.connections.some((c: { clientName: string; status: string }) => c.clientName === 'Claude' && c.status === 'active')).toBe(true);
      // An access token expires after an hour.
      env.clock.advance(61 * 60_000);
      try {
        const late = await new Mcp(env, app.access).raw('POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
        expect(late.status).toBe(401);
        expect(String(late.headers['www-authenticate'])).toContain('error="invalid_token"');
      } finally {
        env.clock.advance(-61 * 60_000);
      }
    });

    it('PKCE: a wrong verifier, client or redirect address fails and ends the connection', async () => {
      for (const kind of ['verifier', 'client', 'redirect'] as const) {
        const clientId = await registerOk(env);
        const otherClient = await registerOk(env);
        const { verifier, challenge } = pkce();
        const { code } = await consent(s.teacherA, authParams(env, clientId, challenge));
        const extra: Record<string, string> = kind === 'redirect' ? { redirect_uri: `${CLAUDE_CALLBACK}?x` } : {};
        const t = await exchange(env, kind === 'client' ? otherClient : clientId, code, kind === 'verifier' ? pkce().verifier : verifier, extra);
        expect(t.status, kind).toBe(400);
        expect(t.body.error).toBe('invalid_grant');
        // The real client cannot use the code afterwards either.
        expect((await exchange(env, clientId, code, verifier)).body.error).toBe('invalid_grant');
      }
    });

    it('codes are single use: a replay ends everything issued from the code', async () => {
      const clientId = await registerOk(env);
      const { verifier, challenge } = pkce();
      const { code } = await consent(s.teacherA, authParams(env, clientId, challenge));
      const first = await exchange(env, clientId, code, verifier);
      expect(first.status).toBe(200);
      const again = await exchange(env, clientId, code, verifier);
      expect(again.status).toBe(400);
      expect(again.body.error).toBe('invalid_grant');
      expect((await new Mcp(env, first.body.access_token).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      expect((await refresh(env, clientId, first.body.refresh_token)).body.error).toBe('invalid_grant');
      expect(env.db.select().from(auditEvents).where(eq(auditEvents.action, 'oauth.connection_end')).all().some((a) => String(a.afterJson).includes('code_reuse'))).toBe(true);
    });

    it('codes last 60 seconds', async () => {
      const clientId = await registerOk(env);
      const { verifier, challenge } = pkce();
      const { code } = await consent(s.teacherA, authParams(env, clientId, challenge));
      env.clock.advance(61_000);
      try {
        expect((await exchange(env, clientId, code, verifier)).body.error).toBe('invalid_grant');
      } finally {
        env.clock.advance(-61_000);
      }
    });

    it('checks the resource indicator and refuses client secrets and unknown grant types', async () => {
      const clientId = await registerOk(env);
      const { verifier, challenge } = pkce();
      const { code } = await consent(s.teacherA, authParams(env, clientId, challenge));
      expect((await exchange(env, clientId, code, verifier, { resource: 'https://other.example.org/mcp' })).body.error).toBe('invalid_target');
      const secret = await exchange(env, clientId, code, verifier, { client_secret: 'x' });
      expect(secret.status).toBe(401);
      expect(secret.body.error).toBe('invalid_client');
      expect((await form(env, '/oauth/token', { grant_type: 'password', client_id: clientId })).body.error).toBe('unsupported_grant_type');
      expect((await form(env, '/oauth/token', { grant_type: 'client_credentials', client_id: clientId })).body.error).toBe('unsupported_grant_type');
      const unknown = await form(env, '/oauth/token', { grant_type: 'authorization_code', client_id: 'ccc_nobody', code: 'x', code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK });
      expect(unknown.status).toBe(401);
      expect(unknown.body.error).toBe('invalid_client');
      const dup = await env.app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `grant_type=authorization_code&client_id=${clientId}&client_id=other` });
      expect(JSON.parse(dup.body).error).toBe('invalid_request');
      expect(dup.headers['cache-control']).toBe('no-store');
      // The resource without the code is still fine (the code was not used by the refusals above? it was: invalid_target came first).
    });

    it('refresh tokens rotate; a reused one ends the whole connection', async () => {
      const app = await connectApp(env, s.teacherA);
      const r1 = await refresh(env, app.clientId, app.refresh);
      expect(r1.status).toBe(200);
      expect(r1.body.refresh_token).not.toBe(app.refresh);
      expect(r1.body.access_token).not.toBe(app.access);
      const r2 = await refresh(env, app.clientId, r1.body.refresh_token);
      expect(r2.status).toBe(200);
      // The same family: pseudonyms stay stable across refreshes.
      const fam = (tok: string) => env.db.select().from(mcpTokens).all().find((x) => x.kind === 'oauth' && x.prefix === tok.slice(0, 10))!.familyId;
      expect(fam(r2.body.access_token)).toBe(fam(app.access));
      // The old refresh token comes back: everything of the connection ends.
      const reuse = await refresh(env, app.clientId, app.refresh);
      expect(reuse.status).toBe(400);
      expect(reuse.body.error).toBe('invalid_grant');
      expect((await refresh(env, app.clientId, r2.body.refresh_token)).body.error).toBe('invalid_grant');
      expect((await new Mcp(env, r2.body.access_token).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      // Another client presenting the refresh token fails too.
      const b = await connectApp(env, s.teacherA);
      const other = await registerOk(env);
      expect((await refresh(env, other, b.refresh)).body.error).toBe('invalid_grant');
      expect((await refresh(env, b.clientId, b.refresh)).body.error).toBe('invalid_grant');
    });

    it('concurrent refreshes with one token (parallel requests of one client) all work; the connection lives on (S14h2 review)', async () => {
      const t = await teacherOnFreshIp();
      const app = await connectApp(env, t);
      const [a, b] = await Promise.all([refresh(env, app.clientId, app.refresh), refresh(env, app.clientId, app.refresh)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      // A third retry inside the grace window, while the successors are still unused.
      env.clock.advance(20_000);
      try {
        const c = await refresh(env, app.clientId, app.refresh);
        expect(c.status).toBe(200);
        for (const tok of [a.body.access_token, b.body.access_token, c.body.access_token]) {
          const mcp = new Mcp(env, tok);
          await mcp.init();
          expect((await mcp.call('list_my_classes')).isError).toBe(false);
        }
        const fam = (tok: string) => env.db.select().from(mcpTokens).where(eq(mcpTokens.prefix, tok.slice(0, 10))).get()!.familyId;
        expect(new Set([fam(a.body.access_token), fam(b.body.access_token), fam(c.body.access_token)]).size).toBe(1);
        // The client keeps one of them and refreshes normally: its siblings and the original are superseded.
        const d = await refresh(env, app.clientId, c.body.refresh_token);
        expect(d.status).toBe(200);
        // Now the original comes back (its successor was used): a copy, the whole connection ends.
        const reuse = await refresh(env, app.clientId, app.refresh);
        expect(reuse.body.error).toBe('invalid_grant');
        expect((await refresh(env, app.clientId, d.body.refresh_token)).body.error).toBe('invalid_grant');
        expect((await new Mcp(env, d.body.access_token).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      } finally {
        env.clock.advance(-20_000);
      }
    });

    it('a rotated refresh token presented after the 30-second grace window ends the connection', async () => {
      const t = await teacherOnFreshIp();
      const app = await connectApp(env, t);
      const r1 = await refresh(env, app.clientId, app.refresh);
      expect(r1.status).toBe(200);
      env.clock.advance(31_000);
      try {
        const late = await refresh(env, app.clientId, app.refresh);
        expect(late.status).toBe(400);
        expect(late.body.error).toBe('invalid_grant');
        expect((await refresh(env, app.clientId, r1.body.refresh_token)).body.error).toBe('invalid_grant');
        expect((await new Mcp(env, r1.body.access_token).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
        expect(env.db.select().from(auditEvents).where(eq(auditEvents.action, 'oauth.connection_end')).all().some((x) => String(x.afterJson).includes('refresh_reuse'))).toBe(true);
      } finally {
        env.clock.advance(-31_000);
      }
    });

    it('a refresh can narrow the scopes but never widen them', async () => {
      const app = await connectApp(env, s.teacherA);
      expect((await refresh(env, app.clientId, app.refresh, { scope: 'classes:read goals:write' })).body.error).toBe('invalid_scope');
      const narrow = await refresh(env, app.clientId, app.refresh, { scope: 'classes:read' });
      expect(narrow.body.scope).toBe('classes:read');
    });

    it('never outlives the consent or the administrator’s cap', async () => {
      const app = await connectApp(env, s.teacherA, { days: 7 });
      env.clock.advance(7 * DAY - 30 * 60_000);
      try {
        const r = await refresh(env, app.clientId, app.refresh);
        expect(r.status).toBe(200);
        expect(r.body.expires_in).toBeLessThanOrEqual(30 * 60);
        env.clock.advance(31 * 60_000);
        expect((await refresh(env, app.clientId, r.body.refresh_token)).body.error).toBe('invalid_grant');
      } finally {
        env.clock.advance(-(7 * DAY + 60_000));
      }
      // Lowering the cap shortens existing connections.
      const b = await connectApp(env, s.teacherA, { days: 60 });
      await setAi(s.admin, { mcpTokenMaxDays: 14 });
      try {
        const view = await ok(s.teacherA.get('/api/account/ai-tools'));
        const conn = view.connections.find((c: { status: string; expiresAt: number }) => c.status === 'active' && c.expiresAt > env.clock.t + 13 * DAY);
        expect(conn.expiresAt).toBeLessThanOrEqual(env.clock.t + 14 * DAY);
        env.clock.advance(15 * DAY);
        expect((await refresh(env, b.clientId, b.refresh)).body.error).toBe('invalid_grant');
      } finally {
        env.clock.advance(-15 * DAY);
        await setAi(s.admin, { mcpTokenMaxDays: 90 });
      }
    });
  });

  describe('scopes on /mcp', () => {
    it('an OAuth token without a tool’s scope gets 403 insufficient_scope naming what it holds plus the missing scope', async () => {
      const app = await connectApp(env, s.teacherA, { scopes: ['classes:read'] }, 'classes:read reports:read');
      const mcp = new Mcp(env, app.access);
      await mcp.init();
      const r = await mcp.raw('POST', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'class_report', arguments: { contextId: s.ctxA.id } } }, { 'mcp-protocol-version': mcp.version });
      expect(r.status).toBe(403);
      const h = String(r.headers['www-authenticate']);
      expect(h).toContain('error="insufficient_scope"');
      expect(h).toContain('scope="classes:read reports:read"');
      expect(h).toContain('resource_metadata=');
      expect(r.body.id).toBe(7);
      // Tools the token may use still work.
      expect((await mcp.call('list_my_classes')).isError).toBe(false);
    });
  });

  describe('revocation endpoint (RFC 7009)', () => {
    it('a refresh token ends its connection; an access token ends itself; unknown tokens are fine', async () => {
      const a = await connectApp(env, s.teacherA);
      expect((await form(env, '/oauth/revoke', { token: a.access, client_id: a.clientId })).status).toBe(200);
      expect((await new Mcp(env, a.access).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      const r = await refresh(env, a.clientId, a.refresh);
      expect(r.status).toBe(200);
      expect((await form(env, '/oauth/revoke', { token: r.body.refresh_token, token_type_hint: 'refresh_token', client_id: a.clientId })).status).toBe(200);
      expect((await refresh(env, a.clientId, r.body.refresh_token)).body.error).toBe('invalid_grant');
      expect((await new Mcp(env, r.body.access_token).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      expect((await form(env, '/oauth/revoke', { token: 'ccmcpr_unknown' })).status).toBe(200);
      expect((await form(env, '/oauth/revoke', {})).status).toBe(400);
      // Another client cannot revoke someone else's token.
      const b = await connectApp(env, s.teacherA);
      const other = await registerOk(env);
      expect((await form(env, '/oauth/revoke', { token: b.refresh, client_id: other })).status).toBe(200);
      expect((await refresh(env, b.clientId, b.refresh)).status).toBe(200);
    });

    it('a personal token is never revoked through the OAuth endpoint', async () => {
      const made = await ok(s.teacherA.post('/api/account/ai-tools/tokens', { name: 'Kept', scopes: ['classes:read'], days: 7, currentPassword: PASSWORD }));
      expect((await form(env, '/oauth/revoke', { token: made.secret })).status).toBe(200);
      expect(env.db.select().from(mcpTokens).where(eq(mcpTokens.id, made.token.id)).get()!.revokedAt).toBeNull();
      await ok(s.teacherA.post(`/api/account/ai-tools/tokens/${made.token.id}/revoke`));
    });
  });

  describe('Profile and Admin → AI tools', () => {
    it('the owner disconnects an app; someone else cannot', async () => {
      const app = await connectApp(env, s.teacherA);
      const view = await ok(s.teacherA.get('/api/account/ai-tools'));
      const conn = view.connections.find((c: { status: string }) => c.status === 'active');
      expect(conn).toMatchObject({ clientName: 'Claude', redirectHost: 'claude.ai', privacy: 'pseudonymous' });
      expect((await s.teacherB.post(`/api/account/ai-tools/connections/${conn.id}/revoke`)).status).toBe(404);
      const all = (await ok(s.teacherA.get('/api/account/ai-tools'))).connections.filter((c: { status: string }) => c.status === 'active');
      for (const c of all) await ok(s.teacherA.post(`/api/account/ai-tools/connections/${c.id}/revoke`));
      expect((await refresh(env, app.clientId, app.refresh)).body.error).toBe('invalid_grant');
      expect((await new Mcp(env, app.access).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      expect(env.db.select().from(auditEvents).where(eq(auditEvents.action, 'oauth.disconnect')).all().length).toBeGreaterThan(0);
    });

    it('administrators see apps and connections, revoke them and edit the redirect host list (audited)', async () => {
      const app = await connectApp(env, s.teacherA);
      const admin = await ok(s.admin.get('/api/admin/ai-tools'));
      expect(admin.redirectHosts).toEqual(['claude.ai']);
      const conn = admin.connections.find((c: { status: string; userName: string }) => c.status === 'active');
      expect(conn.userName).toBe('Test ayse.teacher');
      const client = admin.clients.find((c: { clientId: string }) => c.clientId === app.clientId);
      expect(client).toMatchObject({ kind: 'dcr', name: 'Claude', redirectHosts: ['claude.ai'], status: 'active', activeConnections: 1 });
      expect(JSON.stringify(admin)).not.toContain(app.access);
      expect(JSON.stringify(admin)).not.toContain(app.refresh);
      await ok(s.admin.post(`/api/admin/ai-tools/clients/${client.id}/revoke`));
      expect((await refresh(env, app.clientId, app.refresh)).status).toBe(401); // the client is gone: invalid_client
      // The host list.
      expect((await s.teacherA.put('/api/admin/ai-tools/redirect-hosts', { hosts: [] })).status).toBe(403);
      expect(reasonOf(await s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['*.example.org'] }))).toBe('INVALID_HOST');
      expect(reasonOf(await s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['localhost'] }))).toBe('INVALID_HOST');
      expect(reasonOf(await s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['https://claude.ai'] }))).toBe('INVALID_HOST');
      await ok(s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['Claude.AI', 'connectors.example.org'] }));
      expect((await ok(s.admin.get('/api/admin/ai-tools'))).redirectHosts).toEqual(['claude.ai', 'connectors.example.org']);
      expect((await register(env, { redirect_uris: ['https://connectors.example.org/cb'] })).status).toBe(201);
      await ok(s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: [] }));
      try {
        expect((await register(env, { redirect_uris: [CLAUDE_CALLBACK] })).status).toBe(400);
        expect((await register(env, { redirect_uris: [LOOPBACK] })).status).toBe(201);
      } finally {
        await ok(s.admin.put('/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai'] }));
      }
      expect(env.db.select().from(auditEvents).where(eq(auditEvents.action, 'school.oauth_redirect_hosts')).all().length).toBe(3);
    });
  });

  describe('Client ID Metadata Documents', () => {
    it('reads a document on an allowed host and matches its loopback addresses on any port', async () => {
      cimdCalls = [];
      const { verifier, challenge } = pkce();
      const params = authParams(env, CIMD_URL, challenge, { redirect_uri: 'http://localhost:47123/callback' });
      const a = await authorize(s.teacherA, params);
      expect(a.location).toMatch(/^\/oauth\/consent\?request=/u);
      expect(cimdCalls).toEqual([CIMD_URL]);
      const view = await ok(s.teacherA.get(`/api/account/oauth/requests/${requestIdOf(a.location)}`));
      expect(view).toMatchObject({ clientName: 'Claude Code', clientKind: 'cimd', clientIdHost: 'claude.ai', redirectHost: 'localhost:47123', redirectLoopback: true });
      const d = await ok(s.teacherA.post(`/api/account/oauth/requests/${requestIdOf(a.location)}`, { allow: true, currentPassword: PASSWORD }));
      const code = new URL(d.redirectTo).searchParams.get('code')!;
      const t = await form(env, '/oauth/token', { grant_type: 'authorization_code', client_id: CIMD_URL, code, code_verifier: verifier, redirect_uri: 'http://localhost:47123/callback', resource: `${ORIGIN()}/mcp` });
      expect(t.status, JSON.stringify(t.body)).toBe(200);
      // Read again only after an hour.
      await authorize(s.teacherA, params);
      expect(cimdCalls.length).toBe(1);
      expect(env.db.select().from(oauthClients).where(eq(oauthClients.clientId, CIMD_URL)).get()!.kind).toBe('cimd');
    });

    it('refuses documents on other hosts (never fetched), that name another client or allow no address', async () => {
      cimdCalls = [];
      const { challenge } = pkce();
      const elsewhere = await authorize(s.teacherA, authParams(env, 'https://evil.example.org/client.json', challenge, { redirect_uri: CLAUDE_CALLBACK }));
      expect(elsewhere.location).toBe('/oauth/consent?error=CLIENT_METADATA');
      expect(cimdCalls).toEqual([]);
      const keep = cimdDoc;
      try {
        cimdDoc = () => ({ client_id: 'https://claude.ai/other', redirect_uris: [CLAUDE_CALLBACK] });
        expect((await authorize(s.teacherA, authParams(env, 'https://claude.ai/a.json', challenge))).location).toBe('/oauth/consent?error=CLIENT_METADATA');
        cimdDoc = (url) => ({ client_id: url, redirect_uris: ['https://evil.example.org/cb'] });
        expect((await authorize(s.teacherA, authParams(env, 'https://claude.ai/b.json', challenge))).location).toBe('/oauth/consent?error=CLIENT_METADATA');
        cimdDoc = (url) => ({ client_id: url, redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'private_key_jwt' });
        expect((await authorize(s.teacherA, authParams(env, 'https://claude.ai/c.json', challenge))).location).toBe('/oauth/consent?error=CLIENT_METADATA');
      } finally {
        cimdDoc = keep;
      }
    });

    it('an administrator’s revoke of a metadata-document app lasts past the 30-day clean-up (S14h2 review)', async () => {
      const t = await teacherOnFreshIp();
      const url = 'https://claude.ai/oauth/revoked-test-client';
      const params = () => authParams(env, url, pkce().challenge, { redirect_uri: 'http://localhost:41000/callback' });
      expect((await authorize(t, params())).location).toMatch(/^\/oauth\/consent\?request=/u);
      const row = env.db.select().from(oauthClients).where(eq(oauthClients.clientId, url)).get()!;
      await ok(s.admin.post(`/api/admin/ai-tools/clients/${row.id}/revoke`));
      expect((await authorize(t, params())).location).toBe('/oauth/consent?error=CLIENT_METADATA');
      env.clock.advance(31 * DAY + 2 * 60 * 60_000);
      try {
        expect((await authorize(t, params())).location).toBe('/oauth/consent?error=CLIENT_METADATA');
        expect(env.db.select().from(oauthClients).where(eq(oauthClients.clientId, url)).get()!.revokedAt).not.toBeNull();
        env.clock.advance(100 * DAY);
        expect((await authorize(t, params())).location).toBe('/oauth/consent?error=CLIENT_METADATA');
        const admin = new Client(env);
        admin.ip = freshIp();
        await admin.login('root.admin');
        const listed = (await ok(admin.get('/api/admin/ai-tools'))).clients.find((c: { clientId: string }) => c.clientId === url);
        expect(listed).toMatchObject({ kind: 'cimd', status: 'revoked' });
      } finally {
        env.clock.advance(-(131 * DAY + 2 * 60 * 60_000));
      }
    });
  });

  describe('everything ends together', () => {
    it('revokeAllUserMcpTokens (a password change) ends OAuth connections and waiting requests too', async () => {
      const t = new Client(env);
      await t.login('mehmet.teacher');
      const app = await connectApp(env, t);
      const clientId = await registerOk(env);
      const a = await authorize(t, authParams(env, clientId, pkce().challenge));
      await ok(t.get(`/api/account/oauth/requests/${requestIdOf(a.location)}`));
      await ok(t.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'another-horse-battery-9' }));
      expect((await refresh(env, app.clientId, app.refresh)).body.error).toBe('invalid_grant');
      expect((await new Mcp(env, app.access).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      expect(env.db.select().from(oauthRequests).where(eq(oauthRequests.id, requestIdOf(a.location))).get()!.status).toBe('expired');
      const audit = env.db.select().from(auditEvents).where(eq(auditEvents.action, 'mcp_token.revoke_all')).all();
      expect(audit.some((x) => String(x.afterJson).includes('"connections":1'))).toBe(true);
      await ok(t.post('/api/auth/password', { currentPassword: 'another-horse-battery-9', newPassword: PASSWORD }));
    });

    it('no token, code or verifier is ever logged', async () => {
      const clientId = await registerOk(env);
      const { verifier, challenge } = pkce();
      const { code } = await consent(s.teacherA, authParams(env, clientId, challenge));
      const t = await exchange(env, clientId, code, verifier);
      await refresh(env, clientId, t.body.refresh_token);
      await exchange(env, clientId, code, verifier); // a replay (logged? never with the code)
      const log = logLines.join('\n');
      for (const secret of [code, verifier, t.body.access_token, t.body.refresh_token]) expect(log).not.toContain(secret);
    });

    it('switching AI tools off ends every connection, code and waiting request; on again they stay ended', async () => {
      const app = await connectApp(env, s.teacherA);
      const clientId = await registerOk(env);
      const { verifier, challenge } = pkce();
      const { code } = await consent(s.teacherA, authParams(env, clientId, challenge));
      const waiting = await authorize(s.teacherA, authParams(env, clientId, pkce().challenge));
      await setAi(s.admin, { mcpEnabled: false });
      try {
        expect((await refresh(env, app.clientId, app.refresh)).status).toBe(404);
        expect((await s.teacherA.get(`/api/account/oauth/requests/${requestIdOf(waiting.location)}`)).status).toBe(403);
      } finally {
        await setAi(s.admin, { mcpEnabled: true });
      }
      expect((await refresh(env, app.clientId, app.refresh)).body.error).toBe('invalid_grant');
      expect((await exchange(env, clientId, code, verifier)).body.error).toBe('invalid_grant');
      expect((await new Mcp(env, app.access).raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
      expect(reasonOf(await s.teacherA.get(`/api/account/oauth/requests/${requestIdOf(waiting.location)}`))).toBe('OAUTH_REQUEST_GONE');
      expect(env.db.select().from(oauthGrants).all().every((g) => g.revokedAt !== null || g.createdAt > env.clock.t)).toBe(true);
    });
  });

  it('switches AI tools off at the end', async () => {
    await setAi(s.admin, { mcpEnabled: false });
    expect(freshIp()).toBeTruthy();
  });
});
