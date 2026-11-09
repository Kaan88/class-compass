/**
 * The tools of the AI tools endpoint (S14h1, D-160): generated from every contract that opts in with
 * `mcp: {scope, tool, description, readOnly}` (the endpoint's own handler runs, so access, ownership,
 * module switches, outbox commands and audit are exactly the app's), plus the hand-written tools of
 * `tools.ts`. Input schemas come from the contract (`z.toJSONSchema`); every result is parsed by the
 * contract's allow-list output schema and then passes the privacy gate.
 */
import { z } from 'zod';
import type { Endpoint } from '../../../shared/contracts/define.ts';
import type { McpScope } from '../../../shared/mcp.ts';
import { registeredEndpoints } from '../../lib/http.ts';
import { HAND_WRITTEN_TOOLS } from './tools.ts';
import { callEndpoint, type McpTool, type ToolRole } from './toolkit.ts';

export type { McpTool, ToolEnv, ToolRole } from './toolkit.ts';

const roleOf = (ep: Endpoint): ToolRole => (ep.access === 'admin' ? 'admin' : 'teacher');

function generatedTools(): McpTool[] {
  const seen = new Set<Endpoint>();
  const out: McpTool[] = [];
  for (const ep of registeredEndpoints) {
    if (!ep.mcp || seen.has(ep)) continue;
    seen.add(ep);
    out.push({
      name: ep.mcp.tool,
      description: ep.mcp.description,
      scope: ep.mcp.scope,
      role: roleOf(ep),
      readOnly: ep.mcp.readOnly,
      cost: ep.mcp.cost ?? 1,
      input: ep.input,
      output: ep.output,
      endpoint: ep,
      run: (env, input) => callEndpoint(env, ep, input as never),
    });
  }
  return out;
}

const ADMIN_SCOPES: readonly McpScope[] = ['settings:admin', 'themes:write', 'school:read'];

/** Every tool, checked once: unique names, admin scopes only on admin tools and the other way round. */
export function allTools(): McpTool[] {
  const tools = [
    ...generatedTools(),
    ...HAND_WRITTEN_TOOLS.map((t): McpTool => ({ ...t, cost: t.cost ?? 1, run: (env, input) => Promise.resolve(t.run(env, input as never)) })),
  ];
  const names = new Set<string>();
  for (const t of tools) {
    if (!/^[a-z][a-z0-9_]{2,63}$/u.test(t.name)) throw new Error(`MCP tool name ${t.name} must be snake_case`);
    if (names.has(t.name)) throw new Error(`Duplicate MCP tool ${t.name}`);
    names.add(t.name);
    if (t.scope && ADMIN_SCOPES.includes(t.scope) !== (t.role === 'admin')) throw new Error(`MCP tool ${t.name}: scope ${t.scope} does not fit role ${t.role}`);
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/** May this account and token use the tool? (role first, then scope; ownership is the endpoint's job). */
export function toolAccess(t: McpTool, role: 'admin' | 'teacher', scopes: readonly string[]): 'ok' | 'ROLE_MISMATCH' | 'SCOPE_NOT_GRANTED' {
  if (t.role !== 'any' && t.role !== role) return 'ROLE_MISMATCH';
  if (t.scope && !scopes.includes(t.scope)) return 'SCOPE_NOT_GRANTED';
  return 'ok';
}

/** JSON Schema of a tool's input for `tools/list` (personal-data marks and ids explained, not exposed). */
export function inputJsonSchema(t: McpTool): Record<string, unknown> {
  const schema = z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'cc' && k !== '$schema').map(([k, x]) => [k, clean(x)]));
    return v;
  };
  const out = clean(schema) as Record<string, unknown>;
  return out.type === 'object' ? out : { type: 'object', properties: {}, ...out };
}
