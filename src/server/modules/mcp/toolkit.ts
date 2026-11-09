/**
 * Building blocks shared by the generated and the hand-written MCP tools (S14h1, D-160).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Endpoint } from '../../../shared/contracts/define.ts';
import type { McpScope } from '../../../shared/mcp.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { registeredHandler } from '../../lib/http.ts';

export type ToolRole = 'teacher' | 'admin' | 'any';

export interface McpTool {
  name: string;
  description: string;
  /** null: needs no scope (theme schema and validation hold no school data). */
  scope: McpScope | null;
  role: ToolRole;
  readOnly: boolean;
  cost: number;
  input: z.ZodType;
  /** The allow-list schema of the result, with `pii()` marks for the privacy gate (test-enforced). */
  output: z.ZodType;
  run: (env: ToolEnv, input: unknown) => Promise<unknown>;
  /** The endpoint behind a generated tool. */
  endpoint?: Endpoint;
}

export interface ToolEnv {
  app: FastifyInstance;
  ctx: RequestContext;
}

/** What a hand-written tool declares (`tools.ts`). */
export interface HandTool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  scope: McpScope | null;
  role: ToolRole;
  readOnly: boolean;
  cost?: number;
  input: I;
  output: O;
  run: (env: ToolEnv, input: z.infer<I>) => Promise<z.input<O>> | z.input<O>;
}
export const handTool = <I extends z.ZodType, O extends z.ZodType>(t: HandTool<I, O>): HandTool => t as unknown as HandTool;

/**
 * Handlers get a request/reply stand-in: tool calls have no HTTP request of their own. An exposed
 * handler must not depend on headers or send the reply itself (the registry test calls every tool).
 */
function stubHttp(): { req: FastifyRequest; reply: FastifyReply } {
  const reply = {
    sent: false,
    header: () => reply,
    code: () => reply,
    status: () => reply,
    send: () => {
      reply.sent = true;
      return reply;
    },
  };
  return { req: { headers: {}, query: {}, params: {} } as unknown as FastifyRequest, reply: reply as unknown as FastifyReply };
}

/** Run another endpoint's handler for this tool call (its checks included) and return its allow-listed output. */
export async function callEndpoint<I extends z.ZodType, O extends z.ZodType>(env: ToolEnv, ep: Endpoint<I, O>, input: z.input<I>): Promise<z.infer<O>> {
  const handler = registeredHandler(env.app, ep as unknown as Endpoint);
  if (!handler) throw new AppError('INTERNAL', `No handler for ${ep.method} ${ep.path}`);
  const parsed = ep.input.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid input', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const http = stubHttp();
  const result = await handler(env.ctx, parsed.data, http);
  if ((http.reply as unknown as { sent: boolean }).sent) throw new AppError('INTERNAL', 'This endpoint cannot be used as a tool');
  return ep.output.parse(result) as z.infer<O>;
}
