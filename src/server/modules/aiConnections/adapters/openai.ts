/**
 * OpenAI Chat Completions adapter (S19a, D-179): `POST {base}/chat/completions` with `stream: true`
 * and `stream_options.include_usage`. Used by OpenAI, OpenRouter, any OpenAI-compatible server and
 * (when it is ever switched on) "Sign in with ChatGPT". Tools become function tools
 * (`{type: 'function', function: {name, description, parameters}}`); tool results are `role: 'tool'`
 * messages. A server that ignores `stream` and answers one JSON completion is read too (some small
 * local servers do).
 *
 * Reasoning (D-203): a model that thinks first streams its hidden reasoning in `delta.reasoning_content`
 * (DeepSeek) or `delta.reasoning` (OpenRouter). It is yielded as `reasoning` events (never shown) and,
 * when the target asks for it (`sendReasoning`), an assistant message with tool calls carries its
 * reasoning back as `reasoning_content`. A stream that ends with neither `[DONE]` nor a finish reason is
 * `STREAM_ENDED`; the finish reasons `insufficient_system_resource` and `aborted` are failures.
 */
import crypto from 'node:crypto';
import { AiCallError, aiRequest, assertKept, countBytes, finishWord, newStreamStats, readText, sseEvents, statusError, withStats } from '../http.ts';
import { MAX_CALL_ID_LENGTH, toolCall, type Adapter, type ChatEvent, type ChatMessage, type StopReason, type ToolDefinition } from './types.ts';

/**
 * A call id as OpenAI accepts it (at most 40 characters). A longer one (another provider's, or one
 * made up before ids were shortened) becomes a hash of itself, the same for the call and its result.
 */
export const openAiCallId = (id: string) => (id.length <= MAX_CALL_ID_LENGTH ? id : `cc_${crypto.createHash('sha256').update(id).digest('hex').slice(0, MAX_CALL_ID_LENGTH - 3)}`);

/** `reasoning`: send an assistant message's reasoning back with its tool calls (`ProviderTarget.sendReasoning`). */
export function openAiMessages(system: string, messages: ChatMessage[], opts: { reasoning?: boolean } = {}): Array<Record<string, unknown>> {
  return [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.content };
      if (m.role === 'assistant')
        return {
          role: 'assistant',
          content: m.content || null,
          ...(opts.reasoning && m.toolCalls?.length && m.reasoning ? { reasoning_content: m.reasoning } : {}),
          ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: openAiCallId(c.id), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}),
        };
      return { role: 'tool', tool_call_id: openAiCallId(m.toolCallId), content: m.content };
    }),
  ];
}

export const openAiTools = (tools: ToolDefinition[]) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

const STOP: Record<string, StopReason> = { stop: 'end', tool_calls: 'toolUse', function_call: 'toolUse', length: 'length' };
/** Finish reasons that mean the provider gave up (DeepSeek: out of capacity, or stopped): a failure even after partial text. */
const FAILED_FINISH = new Set(['insufficient_system_resource', 'aborted']);

/**
 * A reply the provider's filter blocked is a `BLOCKED` failure; one the provider gave up on
 * (`FAILED_FINISH`) a `PROVIDER_ERROR` whatever was written; one that ended for another unknown reason
 * with neither text nor calls a `PROVIDER_ERROR` (not an empty, finished answer).
 */
function assertAnswered(reason: string | null, wrote: boolean, calls: number) {
  if (reason === 'content_filter') throw new AiCallError('BLOCKED');
  if (reason !== null && FAILED_FINISH.has(reason)) throw new AiCallError('PROVIDER_ERROR', null, true, 'PROVIDER_FINISH');
  if (!wrote && !calls && STOP[String(reason)] === undefined) throw new AiCallError('PROVIDER_ERROR');
}

/** The reasoning text of a delta or message (`reasoning_content`, or OpenRouter's `reasoning`), or ''. */
const reasoningOf = (m: any): string => (typeof m?.reasoning_content === 'string' ? m.reasoning_content : typeof m?.reasoning === 'string' ? m.reasoning : '');

function* fromCompletion(d: any): Generator<ChatEvent> {
  const msg = d?.choices?.[0]?.message ?? {};
  yield { type: 'usage', inputTokens: Number(d?.usage?.prompt_tokens) || 0, outputTokens: Number(d?.usage?.completion_tokens) || 0 };
  const reasoning = reasoningOf(msg);
  if (reasoning) yield { type: 'reasoning', text: reasoning };
  const wrote = typeof msg.content === 'string' && msg.content !== '';
  if (wrote) yield { type: 'text', text: msg.content };
  const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  for (let i = 0; i < calls.length; i++) yield { type: 'toolCall', call: toolCall(calls[i]?.id ? String(calls[i].id) : null, String(calls[i]?.function?.name ?? ''), calls[i]?.function?.arguments) };
  const reason = d?.choices?.[0]?.finish_reason;
  assertAnswered(reason == null ? null : String(reason), wrote, calls.length);
  // Cut off by the output limit wins over tool calls: the last call may be unfinished.
  yield { type: 'done', stop: STOP[String(reason)] === 'length' ? 'length' : calls.length ? 'toolUse' : (STOP[String(reason)] ?? 'other') };
}

export const openAiAdapter: Adapter = async function* (req) {
  const body = {
    model: req.model,
    messages: openAiMessages(req.system, req.messages, { reasoning: req.target.sendReasoning === true }),
    ...(req.tools.length ? { tools: openAiTools(req.tools) } : {}),
    [req.target.maxTokensField ?? 'max_tokens']: req.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  const res = await aiRequest({
    url: `${req.target.baseUrl}/chat/completions`,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(req.target.secret ? { authorization: `Bearer ${req.target.secret}` } : {}) },
    body: JSON.stringify(body),
    policy: req.target.policy,
    signal: req.signal,
    chat: true,
    totalTimeoutMs: req.timeoutMs,
  });
  if (res.status < 200 || res.status >= 300) {
    res.cancel();
    throw statusError(res.status);
  }
  if (/^application\/json/iu.test(res.contentType)) {
    let d: unknown;
    try {
      d = JSON.parse(await readText(res));
    } catch (e) {
      throw e instanceof AiCallError ? e : new AiCallError('BAD_RESPONSE', null, true, 'BAD_JSON_BODY');
    }
    if ((d as any)?.error) throw new AiCallError('PROVIDER_ERROR', null, true, 'STREAM_ERROR_EVENT');
    yield* fromCompletion(d);
    return;
  }
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const stats = newStreamStats();
  let argChars = 0;
  let input = 0;
  let output = 0;
  let reason: string | null = null;
  let wrote = false;
  try {
    for await (const ev of sseEvents(countBytes(res.body, stats))) {
      stats.events += 1;
      if (ev.data === '[DONE]') {
        stats.sawDone = true;
        break;
      }
      let d: any;
      try {
        d = JSON.parse(ev.data);
      } catch {
        throw new AiCallError('BAD_RESPONSE', null, true, 'BAD_SSE_JSON');
      }
      if (d?.error) {
        res.cancel();
        throw new AiCallError(Number(d.error.code) === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR', null, true, 'STREAM_ERROR_EVENT');
      }
      if (d?.usage) {
        stats.sawUsage = true;
        input = Number(d.usage.prompt_tokens) || input;
        output = Number(d.usage.completion_tokens) || output;
        yield { type: 'usage', inputTokens: input, outputTokens: output };
      }
      const choice = d?.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      const reasoning = reasoningOf(delta);
      if (reasoning) {
        stats.reasoningChars += reasoning.length;
        assertKept(stats, argChars);
        yield { type: 'reasoning', text: reasoning };
      }
      if (typeof delta.content === 'string' && delta.content) {
        wrote = true;
        stats.contentChars += delta.content.length;
        assertKept(stats, argChars);
        yield { type: 'text', text: delta.content };
      }
      for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const index = Number(tc.index ?? 0);
        const cur = calls.get(index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = String(tc.id);
        if (tc.function?.name) cur.name += String(tc.function.name);
        if (tc.function?.arguments) {
          const piece = String(tc.function.arguments);
          cur.args += piece;
          argChars += piece.length;
        }
        calls.set(index, cur);
        stats.toolCalls = calls.size;
        assertKept(stats, argChars + cur.name.length);
      }
      if (choice.finish_reason) {
        reason = String(choice.finish_reason);
        stats.lastFinishReason = finishWord(reason);
      }
    }
    // Some servers end the stream without `[DONE]`; a finish reason is enough. With neither, the provider
    // stopped before the answer was finished (D-203), unless it never sent an event stream at all.
    if (!stats.sawDone && reason === null) {
      if (stats.events === 0 && !/^text\/event-stream/iu.test(res.contentType)) throw new AiCallError('BAD_RESPONSE', null, true, 'NOT_AN_EVENT_STREAM');
      throw new AiCallError('STREAM_ENDED', null, true, 'STREAM_ENDED_EARLY');
    }
    const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]);
    assertAnswered(reason, wrote, ordered.length);
    for (const [, c] of ordered) yield { type: 'toolCall', call: toolCall(c.id || null, c.name, c.args) };
    yield { type: 'done', stop: STOP[String(reason)] === 'length' ? 'length' : ordered.length ? 'toolUse' : (STOP[String(reason)] ?? 'other') };
  } catch (e) {
    res.cancel();
    throw withStats(e, stats);
  }
};
