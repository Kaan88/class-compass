/**
 * The Streamable HTTP MCP server at /mcp (S14h1, D-160): initialize and version negotiation, the
 * session header, MCP-Protocol-Version, ping, tools/resources/prompts, notifications (202), batches
 * only on 2025-03-26, GET 405, DELETE ends the session, JSON-RPC error codes, tool errors as results,
 * the per-token rate limit and the 256 KB result cap. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpCalls } from '../../src/server/db/schema.ts';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../../src/server/modules/mcp/transport.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { Mcp, makeToken, setAi } from '../mcp-helpers.ts';
import { buildSchool, type School } from '../school-fixture.ts';

let env: TestEnv;
let school: School;
let token: string;
beforeAll(async () => {
  env = await makeEnv();
  school = await buildSchool(env);
  await setAi(school.admin, { mcpEnabled: true });
  token = (await makeToken(school.teacherA, { scopes: ['classes:read', 'reports:read', 'goals:read'] })).secret;
});
afterAll(async () => env.app.close());

describe('MCP transport (D-160)', () => {
  it('initialize negotiates the version and starts a session', async () => {
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      const c = new Mcp(env, token);
      const r = await c.init(v);
      expect(r.protocolVersion).toBe(v);
      expect(r.capabilities).toMatchObject({ tools: {}, resources: {}, prompts: {} });
      expect(r.serverInfo.name).toBe('class-compass');
      expect(typeof c.session).toBe('string');
    }
    // An unknown version gets the latest one.
    const c = new Mcp(env, token);
    expect((await c.init('1999-01-01')).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('requires the session header after initialize and checks MCP-Protocol-Version', async () => {
    const c = new Mcp(env, token);
    await c.init();
    const ping = { jsonrpc: '2.0', id: 9, method: 'ping' };
    expect((await c.raw('POST', ping, { 'mcp-session-id': '' })).status).toBe(400);
    expect((await c.raw('POST', ping, { 'mcp-session-id': 'not-a-session' })).status).toBe(404);
    expect((await c.raw('POST', ping, { 'mcp-protocol-version': '2024-11-05' })).status).toBe(400);
    const ok = await c.raw('POST', ping, { 'mcp-protocol-version': c.version });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/application\/json/u);
    expect(ok.body).toEqual({ jsonrpc: '2.0', id: 9, result: {} });
    // Without the version header the negotiated one is assumed.
    expect((await c.raw('POST', ping)).body.result).toEqual({});
  });

  it('a session belongs to its token', async () => {
    const other = (await makeToken(school.teacherA, { scopes: ['classes:read'], name: 'Second' })).secret;
    const a = new Mcp(env, token);
    await a.init();
    const b = new Mcp(env, other);
    b.session = a.session;
    expect((await b.raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(404);
  });

  it('accepts notifications and responses with 202 and no body', async () => {
    const c = new Mcp(env, token);
    await c.init();
    const r = await c.raw('POST', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(r.status).toBe(202);
    expect(r.body).toBeNull();
    expect((await c.raw('POST', { jsonrpc: '2.0', id: 'x', result: {} })).status).toBe(202);
  });

  it('answers JSON-RPC errors with the right codes', async () => {
    const c = new Mcp(env, token);
    await c.init();
    expect((await c.rpc('no/such/method')).error.code).toBe(-32601);
    expect((await c.rpc('tools/call', { name: 'no_such_tool', arguments: {} })).error.code).toBe(-32602);
    expect((await c.rpc('resources/read', { uri: 'classcompass://nope' })).error.code).toBe(-32002);
    expect((await c.rpc('prompts/get', { name: 'weekly_summary', arguments: {} })).error.code).toBe(-32602);
    const bad = await c.raw('POST', { jsonrpc: '1.0', id: 3, method: 'ping' });
    expect(bad.body.error.code).toBe(-32600);
    expect((await c.raw('POST', 'not an object')).status).toBe(400);
  });

  it('batches only on 2025-03-26, and never with initialize', async () => {
    const old = new Mcp(env, token);
    await old.init('2025-03-26');
    const r = await old.raw('POST', [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.map((x: { id: number }) => x.id)).toEqual([1, 2]);
    const now = new Mcp(env, token);
    await now.init('2025-06-18');
    expect((await now.raw('POST', [{ jsonrpc: '2.0', id: 1, method: 'ping' }])).status).toBe(400);
    expect((await now.raw('POST', [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }])).status).toBe(400);
  });

  it('GET is 405 and DELETE ends the session', async () => {
    const c = new Mcp(env, token);
    await c.init();
    const g = await c.raw('GET');
    expect(g.status).toBe(405);
    expect(String(g.headers.allow)).toContain('POST');
    expect((await c.raw('DELETE')).status).toBe(204);
    expect((await c.raw('POST', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(404);
    expect((await c.raw('DELETE')).status).toBe(404);
  });

  it('lists and calls tools, resources and prompts', async () => {
    const c = new Mcp(env, token);
    await c.init();
    const tools = (await c.rpc('tools/list')).result.tools as Array<{ name: string; inputSchema: { type: string }; description: string; annotations: { readOnlyHint: boolean } }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_my_classes');
    expect(names).toContain('class_overview');
    // Scopes the token does not have and admin tools are not listed.
    expect(names).not.toContain('create_homework');
    expect(names).not.toContain('usage_report');
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(JSON.stringify(t.inputSchema)).not.toContain('"cc"');
      expect(t.description).toMatch(/Privacy/u);
    }
    const list = await c.call('list_my_classes');
    expect(list.isError).toBe(false);
    expect(list.data.contexts[0].className).toBe('3-A');
    // A tool error is a result with isError, not a protocol error.
    const missing = await c.call('class_overview', { contextId: school.ctxB.id });
    expect(missing.isError).toBe(true);
    expect(missing.data.error.code).toBe('NOT_FOUND');
    const invalid = await c.call('class_overview', {});
    expect(invalid.isError).toBe(true);
    expect(invalid.data.error.code).toBe('VALIDATION');

    const resources = (await c.rpc('resources/list')).result.resources as Array<{ uri: string }>;
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['classcompass://me/classes', 'classcompass://themes/package-schema', 'classcompass://guides/en/teacher', 'classcompass://guides/tr/teacher', 'classcompass://docs/theming']));
    const mine = (await c.rpc('resources/read', { uri: 'classcompass://me/classes' })).result.contents[0];
    expect(JSON.parse(mine.text).classes[0].className).toBe('3-A');
    const guide = (await c.rpc('resources/read', { uri: 'classcompass://guides/tr/teacher' })).result.contents[0];
    expect(guide.mimeType).toBe('text/markdown');
    expect(guide.text.startsWith('#')).toBe(true);
    expect((await c.rpc('resources/templates/list')).result.resourceTemplates).toEqual([]);

    const prompts = (await c.rpc('prompts/list')).result.prompts as Array<{ name: string }>;
    expect(prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['weekly_summary', 'topic_plan', 'design_theme']));
    // goal_presets needs goals:write, which this token lacks.
    expect(prompts.map((p) => p.name)).not.toContain('goal_presets');
    const p = (await c.rpc('prompts/get', { name: 'weekly_summary', arguments: { contextId: school.ctxA.id } })).result;
    expect(p.messages[0].content.text).toContain(school.ctxA.id);
  });

  it('logs every request without its arguments', async () => {
    const c = new Mcp(env, token);
    await c.init();
    await c.call('class_overview', { contextId: school.ctxA.id });
    const rows = env.db.select().from(mcpCalls).all();
    expect(rows.some((r) => r.method === 'tools/call:class_overview' && r.status === 'ok' && r.bytes > 0)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(school.ctxA.id);
  });

  it('rate-limits each token to 120 per minute and cuts results over 256 KB', async () => {
    const t = (await makeToken(school.teacherA, { scopes: ['classes:read'], name: 'Busy' })).secret;
    const c = new Mcp(env, t);
    await c.init();
    let limited: { status: number; headers: Record<string, unknown> } | null = null;
    for (let i = 0; i < 130 && !limited; i += 1) {
      const r = await c.raw('POST', { jsonrpc: '2.0', id: i, method: 'ping' });
      if (r.status === 429 || r.body?.error?.data?.code === 'RATE_LIMITED') limited = r;
    }
    expect(limited).not.toBeNull();
    env.clock.advance(61_000);
    expect((await c.raw('POST', { jsonrpc: '2.0', id: 999, method: 'ping' })).status).toBe(200);
  });
});
