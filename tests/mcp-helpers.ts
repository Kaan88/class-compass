/**
 * Helpers for the AI tools tests (S14h1, D-160, D-161): switch the school's AI settings, make a
 * personal token through the Profile endpoints, and speak JSON-RPC to `/mcp` with a bearer token.
 * Fictional data only.
 */
import { expect } from 'vitest';
import type { McpScope } from '../src/shared/mcp.ts';
import { AI_STUDENT_DATA_CONFIRM } from '../src/shared/contracts/mcp.ts';
import type { Client, TestEnv } from './helpers.ts';

export const PASSWORD = 'correct-horse-battery';

export async function setAi(admin: Client, patch: { mcpEnabled?: boolean; aiStudentDataAllowed?: boolean; mcpTokenMaxDays?: number }) {
  const r = await admin.put('/api/admin/ai-tools', { ...patch, ...(patch.aiStudentDataAllowed ? { confirm: AI_STUDENT_DATA_CONFIRM } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

export async function makeToken(c: Client, opts: { scopes: McpScope[]; days?: number; privacy?: 'pseudonymous' | 'named'; name?: string }): Promise<{ secret: string; id: string }> {
  const r = await c.post('/api/account/ai-tools/tokens', { name: opts.name ?? 'Test client', scopes: opts.scopes, days: opts.days ?? 30, privacy: opts.privacy ?? 'pseudonymous', currentPassword: PASSWORD });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { secret: r.body.secret as string, id: r.body.token.id as string };
}

export interface RpcReply {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

/** A JSON-RPC client over `app.inject` with a bearer token (no cookies, no CSRF header). */
export class Mcp {
  private env: TestEnv;
  token: string | null;
  session: string | null = null;
  version = '2025-11-25';
  private nextId = 1;
  constructor(env: TestEnv, token: string | null) {
    this.env = env;
    this.token = token;
  }

  async raw(method: 'GET' | 'POST' | 'DELETE', body?: unknown, headers: Record<string, string> = {}): Promise<RpcReply> {
    const h: Record<string, string> = { accept: 'application/json, text/event-stream', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    if (this.session && !('mcp-session-id' in headers)) h['mcp-session-id'] = this.session;
    const res = await this.env.app.inject({ method, url: '/mcp', headers: h, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
    let parsed: any = null;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  async init(version = '2025-11-25') {
    const r = await this.raw('POST', { jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    this.session = r.headers['mcp-session-id'] as string;
    this.version = r.body.result.protocolVersion;
    await this.raw('POST', { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': this.version });
    return r.body.result;
  }

  async rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const r = await this.raw('POST', { jsonrpc: '2.0', id: this.nextId++, method, params }, { 'mcp-protocol-version': this.version });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  }

  /** tools/call → `{ isError, data, text }` (the result's JSON text parsed). */
  async call(name: string, args: Record<string, unknown> = {}) {
    const r = await this.rpc('tools/call', { name, arguments: args });
    if (r.error) return { isError: true, data: r.error, text: JSON.stringify(r.error), rpcError: true };
    const text = r.result.content[0].text as string;
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { isError: r.result.isError as boolean, data, text, rpcError: false };
  }
}
