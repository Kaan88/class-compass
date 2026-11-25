/**
 * Anthropic Messages API adapter (S19a, D-179): `POST {base}/v1/messages` with `stream: true`,
 * `x-api-key` and `anthropic-version`. Tools become Anthropic tools (`name`, `description`,
 * `input_schema`); tool results go back as `tool_result` blocks in a user turn (consecutive turns of
 * the same role are merged, as the API requires alternating roles).
 */
import { AiCallError, aiRequest, assertKept, countBytes, finishWord, newStreamStats, readText, sseEvents, statusError, withStats, type AiHttpResponse } from '../http.ts';
import { toolCall, type Adapter, type ChatMessage, type StopReason, type ToolDefinition } from './types.ts';

export const ANTHROPIC_VERSION = '2023-06-01';

type Block = Record<string, unknown>;
interface Turn {
  role: 'user' | 'assistant';
  content: Block[];
}

/** Half of a surrogate pair on its own (text cut in the middle of an emoji): Anthropic refuses the whole request. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const wellFormed = (s: string) => s.replace(LONE_SURROGATE, '�');
/** The same for every string inside a tool call's arguments (a theme package the model wrote can hold emoji). */
const wellFormedDeep = (v: unknown): unknown =>
  typeof v === 'string' ? wellFormed(v) : Array.isArray(v) ? v.map(wellFormedDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [wellFormed(k), wellFormedDeep(x)])) : v;

/** The kinds of refused request told apart in the server log (`anthropicFailure`). */
const REFUSAL_KINDS: Array<[RegExp, string]> = [
  [/prompt is too long|exceed.*context|too many tokens/iu, 'PROMPT_TOO_LONG'],
  [/non-whitespace|must be non-empty|cannot be empty/iu, 'BLANK_TEXT'],
  [/max_tokens/iu, 'MAX_TOKENS'],
  [/tool_use|tool_result/iu, 'TOOL_PAIRING'],
  [/surrogate|unicode|utf-?8/iu, 'BAD_UNICODE'],
  [/credit balance|billing/iu, 'BILLING'],
  [/input_schema|json schema/iu, 'TOOL_SCHEMA'],
  [/roles must alternate|first message/iu, 'TURN_ORDER'],
];

/**
 * The error of a refused request. A 400, 413 or 422 body (small, capped) is read for the server log
 * only, and only as codes: the error type, a kind from `REFUSAL_KINDS` and the field path the message
 * starts with (`messages.3.content.0.text`). The provider's sentence is never passed on to the person,
 * and is kept for the log only when the kind is not known, with everything it quotes removed.
 */
export async function anthropicFailure(res: AiHttpResponse): Promise<AiCallError> {
  const err = statusError(res.status);
  if (res.status !== 400 && res.status !== 413 && res.status !== 422) {
    res.cancel();
    return err;
  }
  try {
    const d: any = JSON.parse(await readText(res, 16 * 1024));
    const type = typeof d?.error?.type === 'string' && /^[a-z_]{1,40}$/u.test(d.error.type) ? d.error.type : 'unknown';
    const message = typeof d?.error?.message === 'string' ? d.error.message : '';
    const kind = REFUSAL_KINDS.find(([re]) => re.test(message))?.[1] ?? 'OTHER';
    const path = /^(?:messages|tools|system|model|max_tokens|tool_choice)(?:\.[a-z_0-9]{1,40}){0,8}/u.exec(message)?.[0];
    // For a kind the list does not know, the validator's sentence itself is the only clue (production,
    // 2026-11-25: "OTHER messages" explained nothing). It names fields and rules, not what was written;
    // anything it quotes is cut out, the rest is reduced to plain characters and kept short.
    const sentence =
      kind === 'OTHER'
        ? message
            .replace(/"[^"]*"|'[^']*'|`[^`]*`/gu, '<quoted>')
            .replace(/[^A-Za-z0-9 .,:;_()<>=/+-]/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 200)
        : '';
    err.providerHint = [type, kind, path, sentence ? `| ${sentence}` : ''].filter(Boolean).join(' ');
  } catch {
    /* an unreadable body: the status alone is logged */
  }
  return err;
}

export function anthropicMessages(messages: ChatMessage[]): Turn[] {
  const out: Turn[] = [];
  const push = (role: Turn['role'], blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', [{ type: 'text', text: wellFormed(m.content) }]);
    else if (m.role === 'assistant')
      push('assistant', [
        // A text block of white space only (a line break written before a tool call) is refused with HTTP 400.
        ...(m.content.trim() ? [{ type: 'text', text: wellFormed(m.content) }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: wellFormedDeep(c.arguments) })),
      ]);
    else push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: wellFormed(m.content), ...(m.isError ? { is_error: true } : {}) }]);
  }
  return out;
}

export const anthropicTools = (tools: ToolDefinition[]) => tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

const STOP: Record<string, StopReason> = { end_turn: 'end', stop_sequence: 'end', tool_use: 'toolUse', max_tokens: 'length' };
/** Stop reasons that mean the provider refused to answer. */
const BLOCKED = new Set(['refusal']);

export const anthropicAdapter: Adapter = async function* (req) {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: anthropicMessages(req.messages),
    ...(req.tools.length ? { tools: anthropicTools(req.tools) } : {}),
    stream: true,
  };
  const res = await aiRequest({
    url: `${req.target.baseUrl}/v1/messages`,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'anthropic-version': ANTHROPIC_VERSION, ...(req.target.secret ? { 'x-api-key': req.target.secret } : {}) },
    body: JSON.stringify(body),
    policy: req.target.policy,
    signal: req.signal,
    chat: true,
    totalTimeoutMs: req.timeoutMs,
  });
  if (res.status < 200 || res.status >= 300) throw await anthropicFailure(res);
  const stats = newStreamStats();
  let argChars = 0;
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  let input = 0;
  let output = 0;
  let stop: StopReason = 'other';
  let blocked = false;
  let finished = false;
  // The stop reason as sent, and whether anything was written (an abnormal empty end is a failure).
  let reason: string | null = null;
  let wrote = false;
  let called = false;
  try {
    for await (const ev of sseEvents(countBytes(res.body, stats))) {
      stats.events += 1;
      let d: any;
      try {
        d = JSON.parse(ev.data);
      } catch {
        throw new AiCallError('BAD_RESPONSE', null, true, 'BAD_SSE_JSON');
      }
      const type = d?.type ?? ev.event;
      if (type === 'message_start') {
        const u = d.message?.usage ?? {};
        input += (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
        output += Number(u.output_tokens) || 0;
        stats.sawUsage = true;
        yield { type: 'usage', inputTokens: input, outputTokens: output };
      } else if (type === 'content_block_start') {
        const b = d.content_block ?? {};
        if (b.type === 'tool_use') {
          blocks.set(Number(d.index), { id: String(b.id ?? `call_${d.index}`), name: String(b.name ?? ''), json: '' });
          stats.toolCalls += 1;
        } else if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          wrote = true;
          stats.contentChars += b.text.length;
          assertKept(stats, argChars);
          yield { type: 'text', text: b.text };
        }
      } else if (type === 'content_block_delta') {
        const delta = d.delta ?? {};
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          if (delta.text) wrote = true;
          stats.contentChars += delta.text.length;
          assertKept(stats, argChars);
          yield { type: 'text', text: delta.text };
        }
        else if (delta.type === 'input_json_delta') {
          const b = blocks.get(Number(d.index));
          if (b) {
            const piece = String(delta.partial_json ?? '');
            b.json += piece;
            argChars += piece.length;
            assertKept(stats, argChars);
          }
        }
      } else if (type === 'content_block_stop') {
        const b = blocks.get(Number(d.index));
        if (b) {
          blocks.delete(Number(d.index));
          called = true;
          yield { type: 'toolCall', call: toolCall(b.id, b.name, b.json) };
        }
      } else if (type === 'message_delta') {
        if (d.usage?.output_tokens !== undefined) {
          output = Number(d.usage.output_tokens) || output;
          stats.sawUsage = true;
          yield { type: 'usage', inputTokens: input, outputTokens: output };
        }
        if (d.delta?.stop_reason) {
          reason = String(d.delta.stop_reason);
          stats.lastFinishReason = finishWord(reason);
          stop = STOP[reason] ?? 'other';
          blocked = BLOCKED.has(String(d.delta.stop_reason));
        }
      } else if (type === 'message_stop') {
        finished = true;
        stats.sawDone = true;
      } else if (type === 'error') {
        res.cancel();
        throw new AiCallError(d.error?.type === 'overloaded_error' || d.error?.type === 'rate_limit_error' ? 'RATE_LIMITED' : 'PROVIDER_ERROR', null, true, 'STREAM_ERROR_EVENT');
      }
    }
    // Ended without `message_stop`: the provider stopped before the answer was finished (D-203), unless it never sent an event stream.
    if (!finished) {
      if (stats.events === 0 && !/^text\/event-stream/iu.test(res.contentType)) throw new AiCallError('BAD_RESPONSE', null, true, 'NOT_AN_EVENT_STREAM');
      throw new AiCallError('STREAM_ENDED', null, true, 'STREAM_ENDED_EARLY');
    }
    if (blocked) throw new AiCallError('BLOCKED');
    // Another stop reason (pause_turn, model_context_window_exceeded, an unknown one, none) with neither
    // text nor tool calls is a failure, not an empty finished answer (as in the OpenAI and Gemini adapters).
    if (!wrote && !called && (reason === null || STOP[reason] === undefined)) throw new AiCallError('PROVIDER_ERROR');
    yield { type: 'done', stop };
  } catch (e) {
    res.cancel();
    throw withStats(e, stats);
  }
};
