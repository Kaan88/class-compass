/**
 * MCP conformance (S14h1, D-160): the official SDK client (`@modelcontextprotocol/sdk`, a pinned
 * devDependency used only here) talks to a real listening server over Streamable HTTP with a personal
 * token: initialize and version negotiation, ping, tools, resources, prompts, session end; and the
 * SDK client's own OAuth flow (S14h2) below. Fictional data only.
 */
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { LATEST_PROTOCOL_VERSION as SDK_LATEST, SUPPORTED_PROTOCOL_VERSIONS as SDK_SUPPORTED } from '@modelcontextprotocol/sdk/types.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../../src/server/modules/mcp/transport.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { makeToken, PASSWORD, setAi } from '../mcp-helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
let env: TestEnv;
let s: School;
let base: string;
let secret: string;
beforeAll(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
  await setAi(s.admin, { mcpEnabled: true });
  secret = (await makeToken(s.teacherA, { scopes: ['classes:read', 'reports:read', 'goals:read'] })).secret;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(env.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => env.app.close());

const connect = async (token: string) => {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new McpClient({ name: 'class-compass-conformance', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
};

describe('SDK client against /mcp (D-160)', () => {
  it('speaks every version the pinned SDK client supports (but the pre-Streamable-HTTP 2024-10-07)', () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(SDK_LATEST);
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) expect(SDK_SUPPORTED).toContain(v);
    expect(SDK_SUPPORTED.filter((v) => !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v))).toEqual(['2024-10-07']);
  });

  it('initializes, lists and calls tools, resources and prompts, and ends the session', async () => {
    const { client, transport } = await connect(secret);
    expect(client.getServerVersion()).toMatchObject({ name: 'class-compass' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    expect(transport.sessionId).toBeTruthy();
    expect(transport.protocolVersion).toBe(SDK_LATEST);
    await client.ping();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['list_my_classes', 'class_overview', 'class_report', 'student_summary', 'theme_schema']));
    const classes = await client.callTool({ name: 'list_my_classes', arguments: {} });
    expect(classes.isError).toBe(false);
    const text = (classes.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(text).contexts[0].className).toBe('3-A');
    const refused = await client.callTool({ name: 'class_overview', arguments: { contextId: s.ctxB.id } });
    expect(refused.isError).toBe(true);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('classcompass://me/classes');
    const read = await client.readResource({ uri: 'classcompass://themes/package-schema' });
    expect(JSON.parse((read.contents[0] as { text: string }).text).title).toBe('Class Compass theme package');

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('weekly_summary');
    const prompt = await client.getPrompt({ name: 'weekly_summary', arguments: { contextId: s.ctxA.id } });
    expect(prompt.messages[0]!.role).toBe('user');

    await transport.terminateSession();
    expect(transport.sessionId).toBeUndefined();
    await client.close();
  });

  it('the SDK is a pinned devDependency that the app never imports', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(pkg.devDependencies['@modelcontextprotocol/sdk']).toMatch(/^\d+\.\d+\.\d+$/u);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/u.test(e.name) && fs.readFileSync(p, 'utf8').includes('@modelcontextprotocol')) offenders.push(p);
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });

  it('refuses a revoked token before the session starts', async () => {
    const t = await makeToken(s.teacherA, { scopes: ['classes:read'], name: 'Revoked' });
    await s.teacherA.post(`/api/account/ai-tools/tokens/${t.id}/revoke`);
    await expect(connect(t.secret)).rejects.toThrow();
  });
});

/**
 * OAuth (S14h2, D-160): the SDK client's own OAuth flow end to end against a real listening server whose
 * PUBLIC_ORIGIN is its listening address: 401 → protected resource metadata → authorization server
 * metadata → dynamic client registration → authorize with PKCE S256 and the resource → a programmatic
 * consent by a signed-in teacher (the provider follows the authorize redirect with that teacher's
 * browser) → code exchange → tools over the access token → refresh rotation when the access token
 * expires. Then the same with a Client ID Metadata Document when the provider offers one.
 */
describe('SDK client OAuth flow (S14h2, D-160)', () => {
  let oenv: TestEnv;
  let os: School;
  let origin: string;
  const docs: string[] = [];
  beforeAll(async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    origin = `http://127.0.0.1:${port}`;
    oenv = await makeEnv(
      { PUBLIC_ORIGIN: origin },
      {
        clientMetadataFetch: async (url) => {
          docs.push(url);
          return { client_id: url, client_name: 'SDK conformance (CIMD)', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' };
        },
      },
    );
    os = await buildSchool(oenv);
    await setAi(os.admin, { mcpEnabled: true });
    await oenv.app.listen({ port, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await setAi(os.admin, { mcpEnabled: false });
    await oenv.app.close();
  });

  /** An in-test OAuthClientProvider: memory storage; "the browser" is a signed-in teacher who allows. */
  class TestProvider implements OAuthClientProvider {
    info: OAuthClientInformationMixed | undefined;
    saved: OAuthTokens | undefined;
    verifier = '';
    code: string | null = null;
    consentedScopes: string[] = [];
    clientMetadataUrl: string | undefined;
    private browser: Client;
    constructor(browser: Client, cimd?: string) {
      this.browser = browser;
      this.clientMetadataUrl = cimd;
    }
    get redirectUrl() {
      return 'http://127.0.0.1:47999/callback';
    }
    get clientMetadata(): OAuthClientMetadata {
      return { client_name: 'SDK conformance', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    }
    state() {
      return 'conformance-state';
    }
    clientInformation() {
      return this.info;
    }
    saveClientInformation(i: OAuthClientInformationMixed) {
      this.info = i;
    }
    tokens() {
      return this.saved;
    }
    saveTokens(t: OAuthTokens) {
      this.saved = t;
    }
    saveCodeVerifier(v: string) {
      this.verifier = v;
    }
    codeVerifier() {
      return this.verifier;
    }
    async redirectToAuthorization(url: URL) {
      expect(url.origin).toBe(origin);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('resource')).toBe(`${origin}/mcp`);
      const r = await this.browser.req('GET', `${url.pathname}${url.search}`);
      expect(r.status).toBe(303);
      const requestId = new URL(String(r.headers.location), origin).searchParams.get('request')!;
      const view = await ok(this.browser.get(`/api/account/oauth/requests/${requestId}`));
      // The teacher narrows the request to two read scopes.
      this.consentedScopes = view.offered.filter((x: string) => x === 'classes:read' || x === 'reports:read');
      const d = await ok(this.browser.post(`/api/account/oauth/requests/${requestId}`, { allow: true, currentPassword: PASSWORD, scopes: this.consentedScopes }));
      const back = new URL(d.redirectTo);
      expect(back.searchParams.get('state')).toBe('conformance-state');
      this.code = back.searchParams.get('code');
    }
  }

  const connectWith = async (provider: TestProvider) => {
    const first = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { authProvider: provider });
    const c1 = new McpClient({ name: 'class-compass-oauth', version: '1.0.0' });
    await expect(c1.connect(first)).rejects.toThrow(UnauthorizedError);
    expect(provider.code).toBeTruthy();
    await first.finishAuth(provider.code!);
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { authProvider: provider });
    const client = new McpClient({ name: 'class-compass-oauth', version: '1.0.0' });
    await client.connect(transport);
    return { client, transport };
  };

  it('registers, authorizes with PKCE through the consent page, exchanges the code and calls tools', async () => {
    const provider = new TestProvider(os.teacherA);
    const { client } = await connectWith(provider);
    expect(provider.info?.client_id).toMatch(/^ccc_/u);
    expect(provider.consentedScopes).toEqual(['classes:read', 'reports:read']);
    expect(provider.saved?.refresh_token).toMatch(/^ccmcpr_/u);
    const classes = await client.callTool({ name: 'list_my_classes', arguments: {} });
    expect(classes.isError).toBe(false);
    expect(JSON.parse((classes.content as Array<{ text: string }>)[0]!.text).contexts[0].className).toBe('3-A');
    // Only the consented scopes' tools are listed.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('create_goal_preset');
    await client.close();

    // An hour later the access token has expired: the SDK refreshes (rotation) and reconnects.
    const before = provider.saved!.refresh_token;
    oenv.clock.advance(61 * 60_000);
    const again = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { authProvider: provider });
    const c2 = new McpClient({ name: 'class-compass-oauth', version: '1.0.0' });
    await c2.connect(again);
    expect(provider.saved!.refresh_token).not.toBe(before);
    expect((await c2.callTool({ name: 'list_my_classes', arguments: {} })).isError).toBe(false);
    await c2.close();
  });

  it('parallel tool calls after the access token expired refresh concurrently and keep the connection (S14h2 review)', async () => {
    // The SDK refreshes once per request that got a 401, with no lock: both requests present the same
    // refresh token. The second is a concurrent retry inside the grace window, not a copied token.
    const provider = new TestProvider(os.teacherA);
    const { client } = await connectWith(provider);
    expect((await client.callTool({ name: 'list_my_classes', arguments: {} })).isError).toBe(false);
    // The access token stops working mid-session (as at its hourly expiry; the clock stays put so the MCP
    // session itself does not time out): every request in flight gets 401 invalid_token.
    const endAccess = async () => {
      const r = await fetch(`${origin}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: provider.saved!.access_token, client_id: provider.info!.client_id }) });
      expect(r.status).toBe(200);
    };
    const before = provider.saved!.refresh_token;
    await endAccess();
    const call = () => client.callTool({ name: 'list_my_classes', arguments: {} });
    const [a, b, c] = await Promise.all([call(), call(), call()]);
    expect([a.isError, b.isError, c.isError]).toEqual([false, false, false]);
    expect(provider.saved!.refresh_token).not.toBe(before);
    // The connection lives on: later calls and the next refresh still work.
    expect((await call()).isError).toBe(false);
    await endAccess();
    expect((await call()).isError).toBe(false);
    await client.close();
  });

  it('uses a Client ID Metadata Document when the provider offers one (on an allowed host)', async () => {
    const url = 'https://claude.ai/oauth/sdk-conformance-client';
    const provider = new TestProvider(os.teacherA, url);
    const { client } = await connectWith(provider);
    expect(provider.info?.client_id).toBe(url);
    expect(docs).toContain(url);
    expect((await client.callTool({ name: 'list_my_classes', arguments: {} })).isError).toBe(false);
    await client.close();
  });
});
