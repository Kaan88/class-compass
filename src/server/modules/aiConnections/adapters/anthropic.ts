/**
 * Anthropic Messages API adapter (S19a, D-179): `POST {base}/v1/messages` with `stream: true`,
 * `x-api-key` and `anthropic-version`. Tools become Anthropic tools (`name`, `description`,
 * `input_schema`); tool results go back as `tool_result` blocks in a user turn (consecutive turns of
 * the same role are merged, as the API requires alternating roles).
 */
import { AiCallError, aiRequest, failureOfStatus, sseEvents } from '../http.ts';
import { toolCall, type Adapter, type ChatMessage, type StopReason, type ToolDefinition } from './types.ts';

export const ANTHROPIC_VERSION = '2023-06-01';

type Block = Record<string, unknown>;
interface Turn {
  role: 'user' | 'assistant';
  content: Block[];
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
    if (m.role === 'user') push('user', [{ type: 'text', text: m.content }]);
    else if (m.role === 'assistant')
      push('assistant', [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })),
      ]);
    else push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) }]);
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
  });
  if (res.status < 200 || res.status >= 300) {
    res.cancel();
    throw new AiCallError(failureOfStatus(res.status), res.status);
  }
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  let input = 0;
  let output = 0;
  let stop: StopReason = 'other';
  let blocked = false;
  let finished = false;
  for await (const ev of sseEvents(res.body)) {
    let d: any;
    try {
      d = JSON.parse(ev.data);
    } catch {
      throw new AiCallError('BAD_RESPONSE');
    }
    const type = d?.type ?? ev.event;
    if (type === 'message_start') {
      const u = d.message?.usage ?? {};
      input += (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
      output += Number(u.output_tokens) || 0;
      yield { type: 'usage', inputTokens: input, outputTokens: output };
    } else if (type === 'content_block_start') {
      const b = d.content_block ?? {};
      if (b.type === 'tool_use') blocks.set(Number(d.index), { id: String(b.id ?? `call_${d.index}`), name: String(b.name ?? ''), json: '' });
      else if (b.type === 'text' && typeof b.text === 'string' && b.text) yield { type: 'text', text: b.text };
    } else if (type === 'content_block_delta') {
      const delta = d.delta ?? {};
      if (delta.type === 'text_delta' && typeof delta.text === 'string') yield { type: 'text', text: delta.text };
      else if (delta.type === 'input_json_delta') {
        const b = blocks.get(Number(d.index));
        if (b) b.json += String(delta.partial_json ?? '');
      }
    } else if (type === 'content_block_stop') {
      const b = blocks.get(Number(d.index));
      if (b) {
        blocks.delete(Number(d.index));
        yield { type: 'toolCall', call: toolCall(b.id, b.name, b.json) };
      }
    } else if (type === 'message_delta') {
      if (d.usage?.output_tokens !== undefined) {
        output = Number(d.usage.output_tokens) || output;
        yield { type: 'usage', inputTokens: input, outputTokens: output };
      }
      if (d.delta?.stop_reason) {
        stop = STOP[String(d.delta.stop_reason)] ?? 'other';
        blocked = BLOCKED.has(String(d.delta.stop_reason));
      }
    } else if (type === 'message_stop') {
      finished = true;
    } else if (type === 'error') {
      res.cancel();
      throw new AiCallError(d.error?.type === 'overloaded_error' || d.error?.type === 'rate_limit_error' ? 'RATE_LIMITED' : 'PROVIDER_ERROR');
    }
  }
  if (!finished) throw new AiCallError('BAD_RESPONSE');
  if (blocked) throw new AiCallError('BLOCKED');
  yield { type: 'done', stop };
};
