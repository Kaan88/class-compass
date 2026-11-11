/**
 * "Test connection" (S19a, D-179): two tiny requests to one model, with no school data in them. The
 * first asks for one word (does text come back?), the second offers one tool and asks the model to
 * call it (will the assistant's tools work?). The answer is a yes/no per part and, on failure, the
 * failure code and HTTP status only: never the provider's message, which can echo part of a key.
 */
import type { z } from 'zod';
import { AI_TEST_TOOL, AI_TEST_WORD } from '../../../shared/aiConnections.ts';
import type { AiTestResult } from '../../../shared/contracts/aiConnections.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { invalid } from '../../lib/errors.ts';
import type { ChatEvent, ToolDefinition } from './adapters/types.ts';
import { AiCallError } from './http.ts';
import { streamChat, type ConnectionRow } from './provider.ts';
import { recordTest, recordTokens, statusOf } from './service.ts';

export const TEST_TOOL: ToolDefinition = {
  name: AI_TEST_TOOL,
  description: `Confirms that tool calls work. Call it once with the word "${AI_TEST_WORD}".`,
  inputSchema: { type: 'object', properties: { word: { type: 'string', description: 'The word to send back.' } }, required: ['word'] },
};
const SYSTEM = 'This is an automatic connection test from a school app. Follow the instruction exactly and keep the answer very short.';

async function collect(gen: AsyncGenerator<ChatEvent>) {
  let text = '';
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const ev of gen) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'toolCall') calls.push(ev.call);
    else if (ev.type === 'usage') usage = ev;
  }
  return { text, calls, usage };
}

export async function testConnection(ctx: RequestContext, row: ConnectionRow, model: string): Promise<z.infer<typeof AiTestResult>> {
  const user = requireUser(ctx);
  if (!row.modelsJson.some((m) => m.name === model)) throw invalid('Not one of the connection’s models', { reason: 'AI_MODEL_NOT_ALLOWED' });
  const started = performance.now();
  const status = statusOf(ctx, row);
  const done = (r: Omit<z.infer<typeof AiTestResult>, 'ms'>) => ({ ...r, ms: Math.round(performance.now() - started) });
  if (status === 'notAvailable') return done({ ok: false, text: false, tools: false, failure: 'NOT_AVAILABLE', httpStatus: null });
  if (status === 'needsKey') return done({ ok: false, text: false, tools: false, failure: 'NEEDS_KEY', httpStatus: null });
  let text = false;
  let tools = false;
  try {
    const a = await collect(streamChat(ctx, { connection: row, model, system: SYSTEM, messages: [{ role: 'user', content: `Reply with the single word: ${AI_TEST_WORD}` }], tools: [], maxTokens: 64 }));
    recordTokens(ctx, row.id, user.id, a.usage);
    text = a.text.trim().length > 0;
    const b = await collect(
      streamChat(ctx, { connection: row, model, system: SYSTEM, messages: [{ role: 'user', content: `Call the ${AI_TEST_TOOL} tool with the word "${AI_TEST_WORD}". Do not write anything else.` }], tools: [TEST_TOOL], maxTokens: 128 }),
    );
    recordTokens(ctx, row.id, user.id, b.usage);
    tools = b.calls.some((c) => c.name === AI_TEST_TOOL && typeof c.arguments.word === 'string');
    recordTest(ctx.db, row, model, { text, tools }, ctx.now());
    return done({ ok: text && tools, text, tools, failure: null, httpStatus: null });
  } catch (e) {
    if (!(e instanceof AiCallError)) throw e;
    recordTest(ctx.db, row, model, { text, tools: false }, ctx.now());
    return done({ ok: false, text, tools: false, failure: e.failure, httpStatus: e.httpStatus });
  }
}
