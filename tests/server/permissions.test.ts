/**
 * Permission matrix over EVERY registered endpoint (ACC-1, ACC-4, PIN-1, PIN-8, ENG-3):
 * - unauthenticated → 401 on every non-public endpoint
 * - teacher → 403 on every admin endpoint
 * - admin → 403 on every teacher/classroom endpoint
 * - teacher in locked classroom mode → 423 on every teacher/admin/account endpoint
 * - Super Speakers scorer and board sessions (S12, D-128) → 401 on every endpoint outside their own
 *   access class; signed-in staff → 401 on the scorer and board endpoints (other cookies)
 * - AI tools (S14h1, D-160): `/mcp` answers 403 while the school switch is off, then 401 without a
 *   bearer token; cookies of every kind never work there, and a bearer token never works anywhere else
 * - OAuth protocol endpoints (S14h2, D-160, access class `oauth`): nothing while the switch is off (404, the
 *   authorize step our own error page); with it on they answer without any session and ignore cookies;
 *   the consent endpoints are `account` endpoints and so in the 401 and 423 rows above
 * Access is checked before input validation, so dummy ids and empty bodies are enough.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Endpoint } from '../../src/shared/contracts/define.ts';
import { ACCESS_CLASSES } from '../../src/shared/contracts/define.ts';
import { registeredEndpoints } from '../../src/server/lib/http.ts';
import { Client, makeEnv, seedUser, type TestEnv } from '../helpers.ts';

let env: TestEnv;
let endpoints: Endpoint[];
beforeAll(async () => {
  env = await makeEnv();
  await seedUser(env, 'teacher', 'ayse.teacher');
  await seedUser(env, 'admin', 'root.admin');
  const seen = new Set<string>();
  endpoints = registeredEndpoints.filter((e) => {
    const k = `${e.method} ${e.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
});
afterAll(async () => env.app.close());

const DUMMY = '0190f0f0-0000-7000-8000-000000000000';
const urlOf = (e: Endpoint) => e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => (k === 'module' ? 'routines' : DUMMY));
const hit = (c: Client, e: Endpoint) => c.req(e.method, urlOf(e), e.method === 'GET' ? undefined : {});

async function expectAll(c: Client, filter: (e: Endpoint) => boolean, status: number) {
  const targets = endpoints.filter(filter);
  expect(targets.length).toBeGreaterThan(0);
  const wrong: string[] = [];
  for (const e of targets) {
    const r = await hit(c, e);
    if (r.status !== status) wrong.push(`${e.method} ${e.path} → ${r.status}`);
  }
  expect(wrong).toEqual([]);
}

describe('permission matrix over all endpoints', () => {
  it('registers a meaningful set of endpoints, each with an access class', () => {
    expect(endpoints.length).toBeGreaterThan(50);
    for (const e of endpoints) expect(['public', 'classroom', 'teacher', 'admin', 'student', 'user', 'account', 'scorer', 'display', 'mcp', 'oauth']).toContain(e.access);
    expect([...ACCESS_CLASSES].sort()).toEqual(['account', 'admin', 'classroom', 'display', 'mcp', 'oauth', 'public', 'scorer', 'student', 'teacher', 'user']);
    // Every access class is in use, so each is covered by the matrix below.
    for (const a of ACCESS_CLASSES) expect(endpoints.some((e) => e.access === a), a).toBe(true);
  });

  it('answers 401 to unauthenticated callers on every non-public endpoint', async () => {
    await expectAll(new Client(env), (e) => e.access !== 'public' && e.access !== 'mcp' && e.access !== 'oauth', 401);
  });

  it('answers 403 to teachers on every admin endpoint (ACC-1)', async () => {
    const t = new Client(env);
    await t.login('ayse.teacher');
    await expectAll(t, (e) => e.access === 'admin', 403);
  });

  it('answers 403 to administrators on every teacher and classroom endpoint', async () => {
    const a = new Client(env);
    await a.login('root.admin');
    await expectAll(a, (e) => e.access === 'teacher' || e.access === 'classroom', 403);
  });

  it('Super Speakers scorer and board sessions reach only their own endpoints (S12, D-128)', async () => {
    const a = new Client(env);
    await a.login('root.admin');
    const scorerLink = (await a.post('/api/admin/speakers/scorers', { label: 'Matrix scorer' })).body;
    const boardLink = (await a.post('/api/admin/speakers/displays', { label: 'Matrix board' })).body;
    const scorer = new Client(env);
    expect((await scorer.post('/api/scorer/session', { token: scorerLink.url.split('#')[1] })).status).toBe(200);
    const board = new Client(env);
    expect((await board.post('/api/board/session', { token: boardLink.url.split('#')[1] })).status).toBe(200);
    // The scorer session works on its own endpoints…
    expect((await scorer.get('/api/scorer/me')).status).toBe(200);
    expect((await board.get('/api/board')).status).toBe(200);
    // …and nowhere else (the session ending endpoint is left out so the matrix keeps its session).
    await expectAll(scorer, (e) => e.access !== 'public' && e.access !== 'scorer' && e.access !== 'mcp' && e.access !== 'oauth', 401);
    await expectAll(board, (e) => e.access !== 'public' && e.access !== 'display' && e.access !== 'mcp' && e.access !== 'oauth', 401);
    // Staff sessions do not carry the scorer or board cookie.
    const t = new Client(env);
    await t.login('ayse.teacher');
    await expectAll(t, (e) => e.access === 'scorer' || e.access === 'display', 401);
    await expectAll(a, (e) => e.access === 'scorer' || e.access === 'display', 401);
  });

  it('answers 423 on every teacher/admin/account endpoint while the classroom lock is engaged (PIN-8)', async () => {
    const t = new Client(env);
    await t.login('ayse.teacher');
    expect((await t.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await t.post('/api/classroom/enter')).status).toBe(200);
    await expectAll(t, (e) => e.access === 'teacher' || e.access === 'admin' || e.access === 'account', 423);
  });

  it('AI tools: /mcp takes only a bearer token, and a bearer token works only on /mcp (S14h1, D-160)', async () => {
    const a = new Client(env);
    await a.login('root.admin');
    const isMcp = (e: Endpoint) => e.access === 'mcp';
    // The school switch comes first: off, every caller gets 403.
    await expectAll(new Client(env), isMcp, 403);
    expect((await a.put('/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    try {
      await expectAll(new Client(env), isMcp, 401);
      // A signed-in teacher or administrator cookie never works on /mcp.
      const t = new Client(env);
      await t.login('ayse.teacher');
      await expectAll(t, isMcp, 401);
      await expectAll(a, isMcp, 401);
      // A bearer token never works on the app's own endpoints, not even next to a valid cookie.
      const made = await t.post('/api/account/ai-tools/tokens', { name: 'Matrix', scopes: ['classes:read'], days: 7, currentPassword: 'correct-horse-battery' });
      expect(made.status).toBe(200);
      const bearer = { authorization: `Bearer ${made.body.secret as string}` };
      const wrong: string[] = [];
      for (const e of endpoints.filter((x) => !isMcp(x))) {
        const r = await t.req(e.method, urlOf(e), e.method === 'GET' ? undefined : {}, bearer);
        if (r.status !== 401) wrong.push(`${e.method} ${e.path} → ${r.status}`);
      }
      expect(wrong).toEqual([]);
      // …while the same token works on /mcp.
      const init = await env.app.inject({ method: 'POST', url: '/mcp', headers: { ...bearer, 'content-type': 'application/json' }, payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'matrix', version: '1' } } }) });
      expect(init.statusCode).toBe(200);
    } finally {
      expect((await a.put('/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
    }
  });

  it('OAuth protocol endpoints: nothing while the switch is off, no session needed while it is on, cookies ignored (S14h2, D-160)', async () => {
    const a = new Client(env);
    await a.login('root.admin');
    const isOAuth = (e: Endpoint) => e.access === 'oauth';
    const targets = endpoints.filter(isOAuth);
    expect(targets.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'GET /.well-known/oauth-authorization-server',
      'GET /.well-known/oauth-protected-resource',
      'GET /.well-known/oauth-protected-resource/mcp',
      'GET /oauth/authorize',
      'POST /oauth/register',
      'POST /oauth/revoke',
      'POST /oauth/token',
    ]);
    const expectOff = async (c: Client) => {
      const wrong: string[] = [];
      for (const e of targets) {
        const r = await hit(c, e);
        const ok = e.path === '/oauth/authorize' ? r.status === 303 && r.headers.location === '/oauth/consent?error=MCP_DISABLED' : r.status === 404;
        if (!ok) wrong.push(`${e.method} ${e.path} → ${r.status}`);
      }
      expect(wrong).toEqual([]);
    };
    await expectOff(new Client(env));
    await expectOff(a);
    expect((await a.put('/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    try {
      // Anonymous callers and signed-in browsers get the same answers: discovery 200, the rest refuse the empty request.
      for (const c of [new Client(env), a]) {
        const wrong: string[] = [];
        for (const e of targets) {
          const r = await hit(c, e);
          const want = e.method === 'GET' ? (e.path === '/oauth/authorize' ? 303 : 200) : 400;
          if (r.status !== want) wrong.push(`${e.method} ${e.path} → ${r.status}`);
        }
        expect(wrong).toEqual([]);
      }
    } finally {
      expect((await a.put('/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
    }
  });
});
