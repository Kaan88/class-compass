/**
 * "Test connection" (S19a, D-179): two tiny requests to one model, with no school data in them. The
 * first asks for one word (does text come back?), the second offers one tool and asks the model to
 * call it (will the assistant's tools work?). The answer is a yes/no per part and, on failure, the
 * failure code and HTTP status only: never the provider's message, which can echo part of a key.
 *
 * The output cap is generous (`TEST_MAX_TOKENS`): reasoning models (OpenAI's o-series and gpt-5,
 * Gemini 2.5 and later) spend hidden thinking tokens from the same cap before they write anything, and
 * a small cap made a working model look broken. The prompts keep the visible answer to a word, so the
 * cap costs nothing unless the model thinks. A reply cut off by the cap before anything visible came is
 * reported as `OUT_OF_TOKENS`, not as "text / tools do not work".
 *
 * Each test request has a short total limit (`TEST_TIMEOUT_MS`), not the chat's ten minutes: a server
 * that accepts the connection but never answers ends the test with `TIMEOUT` instead of keeping the
 * page waiting (review of the 2026-11-12 audit fixes).
 */
import type { z } from 'zod';
import { AI_TEST_TOOL, AI_TEST_WORD, type AiFailure } from '../../../shared/aiConnections.ts';
import type { AiTestResult } from '../../../shared/contracts/aiConnections.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { invalid } from '../../lib/errors.ts';
import type { ChatEvent, StopReason, ToolDefinition } from './adapters/types.ts';
import { AiCallError } from './http.ts';
import { streamChat, type ConnectionRow } from './provider.ts';
import { assertTeachersAllowed, recordTest, recordTokens, statusOf } from './service.ts';

/** The output cap of each test request: room for a reasoning model's hidden thinking (see above). */
export const TEST_MAX_TOKENS = 4096;
/** The total limit of each of the two test requests (both together stay under a proxy's 100 s). */
export const TEST_TIMEOUT_MS = 45_000;

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
  let stop: StopReason = 'other';
  for await (const ev of gen) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'toolCall') calls.push(ev.call);
    else if (ev.type === 'usage') usage = ev;
    else if (ev.type === 'done') stop = ev.stop;
  }
  return { text, calls, usage, stop };
}

export async function testConnection(ctx: RequestContext, row: ConnectionRow, model: string): Promise<z.infer<typeof AiTestResult>> {
  const user = requireUser(ctx);
  // A teacher's own connection is tested only while the administrator allows own connections.
  if (row.ownerUserId !== null) assertTeachersAllowed(ctx.db);
  if (!row.modelsJson.some((m) => m.name === model)) throw invalid('Not one of the connection’s models', { reason: 'AI_MODEL_NOT_ALLOWED' });
  const started = performance.now();
  const status = statusOf(ctx, row);
  const done = (r: Omit<z.infer<typeof AiTestResult>, 'ms'>) => ({ ...r, ms: Math.round(performance.now() - started) });
  if (status === 'notAvailable') return done({ ok: false, text: false, tools: false, failure: 'NOT_AVAILABLE', httpStatus: null });
  if (status === 'needsKey') return done({ ok: false, text: false, tools: false, failure: 'NEEDS_KEY', httpStatus: null });
  // A paused connection (perhaps a key suspected to have leaked) and a used-up budget send nothing,
  // like a chat message (`connectionForUse`); security review of D-179.
  if (status === 'paused') return done({ ok: false, text: false, tools: false, failure: 'PAUSED', httpStatus: null });
  if (status === 'overBudget') return done({ ok: false, text: false, tools: false, failure: 'OVER_BUDGET', httpStatus: null });
  let text = false;
  let tools = false;
  let failure: AiFailure | null = null;
  const timeoutMs = ctx.aiTestTimeoutMs ?? TEST_TIMEOUT_MS;
  try {
    const a = await collect(streamChat(ctx, { connection: row, model, system: SYSTEM, messages: [{ role: 'user', content: `Reply with the single word: ${AI_TEST_WORD}` }], tools: [], maxTokens: TEST_MAX_TOKENS, timeoutMs }));
    recordTokens(ctx, row.id, user.id, a.usage);
    text = a.text.trim().length > 0;
    if (!text && a.stop === 'length') failure = 'OUT_OF_TOKENS';
    const b = await collect(
      streamChat(ctx, { connection: row, model, system: SYSTEM, messages: [{ role: 'user', content: `Call the ${AI_TEST_TOOL} tool with the word "${AI_TEST_WORD}". Do not write anything else.` }], tools: [TEST_TOOL], maxTokens: TEST_MAX_TOKENS, timeoutMs }),
    );
    recordTokens(ctx, row.id, user.id, b.usage);
    tools = b.calls.some((c) => c.name === AI_TEST_TOOL && typeof c.arguments.word === 'string');
    if (!tools && !b.calls.length && b.stop === 'length') failure ??= 'OUT_OF_TOKENS';
    recordTest(ctx.db, row, model, { text, tools }, ctx.now());
    return done({ ok: text && tools, text, tools, failure, httpStatus: null });
  } catch (e) {
    if (!(e instanceof AiCallError)) throw e;
    // When the text request worked, the failure is the tool request's (a server without tool support
    // often answers 400 to a request with `tools`): `text` stays true so the page can say so.
    recordTest(ctx.db, row, model, { text, tools: false }, ctx.now());
    return done({ ok: false, text, tools: false, failure: e.failure, httpStatus: e.httpStatus });
  }
}
