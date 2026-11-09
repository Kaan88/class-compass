/**
 * MCP conformance (S14h1, D-160): the official SDK client (`@modelcontextprotocol/sdk`, a pinned
 * devDependency used only here) talks to a real listening server over Streamable HTTP with a personal
 * token: initialize and version negotiation, ping, tools, resources, prompts, session end. OAuth
 * comes with S14h2. Fictional data only.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION as SDK_LATEST, SUPPORTED_PROTOCOL_VERSIONS as SDK_SUPPORTED } from '@modelcontextprotocol/sdk/types.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../../src/server/modules/mcp/transport.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { makeToken, setAi } from '../mcp-helpers.ts';
import { buildSchool, type School } from '../school-fixture.ts';

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
