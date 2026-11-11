/**
 * OpenAI Chat Completions adapter (S19a, D-179): `POST {base}/chat/completions` with `stream: true`
 * and `stream_options.include_usage`. Used by OpenAI, OpenRouter, any OpenAI-compatible server and
 * (when it is ever switched on) "Sign in with ChatGPT". Tools become function tools
 * (`{type: 'function', function: {name, description, parameters}}`); tool results are `role: 'tool'`
 * messages. A server that ignores `stream` and answers one JSON completion is read too (some small
 * local servers do).
 */
import { AiCallError, aiRequest, failureOfStatus, readText, sseEvents } from '../http.ts';
import { toolCall, type Adapter, type ChatEvent, type ChatMessage, type StopReason, type ToolDefinition } from './types.ts';

export function openAiMessages(system: string, messages: ChatMessage[]): Array<Record<string, unknown>> {
  return [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.content };
      if (m.role === 'assistant')
        return {
          role: 'assistant',
          content: m.content || null,
          ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}),
        };
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }),
  ];
}

export const openAiTools = (tools: ToolDefinition[]) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

const STOP: Record<string, StopReason> = { stop: 'end', tool_calls: 'toolUse', function_call: 'toolUse', length: 'length' };

function* fromCompletion(d: any): Generator<ChatEvent> {
  const msg = d?.choices?.[0]?.message ?? {};
  if (typeof msg.content === 'string' && msg.content) yield { type: 'text', text: msg.content };
  const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  for (let i = 0; i < calls.length; i++) yield { type: 'toolCall', call: toolCall(String(calls[i]?.id ?? `call_${i}`), String(calls[i]?.function?.name ?? ''), calls[i]?.function?.arguments) };
  yield { type: 'usage', inputTokens: Number(d?.usage?.prompt_tokens) || 0, outputTokens: Number(d?.usage?.completion_tokens) || 0 };
  const reason = d?.choices?.[0]?.finish_reason;
  yield { type: 'done', stop: calls.length ? 'toolUse' : (STOP[String(reason)] ?? 'other') };
}

export const openAiAdapter: Adapter = async function* (req) {
  const body = {
    model: req.model,
    messages: openAiMessages(req.system, req.messages),
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
  });
  if (res.status < 200 || res.status >= 300) {
    res.cancel();
    throw new AiCallError(failureOfStatus(res.status), res.status);
  }
  if (/^application\/json/iu.test(res.contentType)) {
    let d: unknown;
    try {
      d = JSON.parse(await readText(res));
    } catch (e) {
      throw e instanceof AiCallError ? e : new AiCallError('BAD_RESPONSE');
    }
    if ((d as any)?.error) throw new AiCallError('PROVIDER_ERROR');
    yield* fromCompletion(d);
    return;
  }
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let input = 0;
  let output = 0;
  let reason: string | null = null;
  let finished = false;
  for await (const ev of sseEvents(res.body)) {
    if (ev.data === '[DONE]') {
      finished = true;
      break;
    }
    let d: any;
    try {
      d = JSON.parse(ev.data);
    } catch {
      throw new AiCallError('BAD_RESPONSE');
    }
    if (d?.error) {
      res.cancel();
      throw new AiCallError(Number(d.error.code) === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR');
    }
    if (d?.usage) {
      input = Number(d.usage.prompt_tokens) || input;
      output = Number(d.usage.completion_tokens) || output;
    }
    const choice = d?.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) yield { type: 'text', text: delta.content };
    for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = Number(tc.index ?? 0);
      const cur = calls.get(index) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = String(tc.id);
      if (tc.function?.name) cur.name += String(tc.function.name);
      if (tc.function?.arguments) cur.args += String(tc.function.arguments);
      calls.set(index, cur);
    }
    if (choice.finish_reason) reason = String(choice.finish_reason);
  }
  // Some servers end the stream without `[DONE]`; a finish reason is enough.
  if (!finished && reason === null) throw new AiCallError('BAD_RESPONSE');
  const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]);
  for (const [i, c] of ordered) yield { type: 'toolCall', call: toolCall(c.id || `call_${i}`, c.name, c.args) };
  yield { type: 'usage', inputTokens: input, outputTokens: output };
  yield { type: 'done', stop: ordered.length ? 'toolUse' : (STOP[String(reason)] ?? 'other') };
};
