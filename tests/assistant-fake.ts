/**
 * A scripted model for the assistant chat tests (S19b, D-180): it answers OpenAI Chat Completions
 * requests (streamed) from a script the test sets, on the local fake provider of `ai-fake.ts`. A turn is
 * a function of the request body (so it can read what the model was sent: the system prompt, history and
 * tool results) and returns text and/or tool calls. Never reaches a real provider; fictional data only.
 */
import type http from 'node:http';
import type { FakeProvider, Recorded } from './ai-fake.ts';

export interface Reply {
  /** Text, sent in a few pieces. */
  text?: string;
  calls?: Array<{ id?: string; name: string; args: unknown }>;
  /** Answer with this HTTP status instead (a provider error). */
  status?: number;
  /** Wait between pieces (ms), so a test can stop the answer half-way. */
  delayMs?: number;
  /** The finish reason sent (default `tool_calls` with calls, else `stop`); `length` = cut off by the output limit. */
  finish?: string;
  /** Hidden reasoning sent first, DeepSeek style (`delta.reasoning_content`, a few characters per chunk; D-203). */
  reasoning?: string;
  /** End the stream cleanly after the pieces, with neither a finish reason, usage nor `[DONE]` (D-203). */
  endEarly?: boolean;
}
export type Turn = (body: any) => Reply;

export function openAiReply(res: http.ServerResponse, reply: Reply) {
  if (reply.status) {
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    // A real provider may echo the key; the app must never pass this on.
    res.end(JSON.stringify({ error: { message: 'provider error text that must never be shown sk-fake-openai-0123456789-S19A' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunks: unknown[] = [];
  const chunk = (delta: unknown, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
  const text = reply.text ?? '';
  // Pieces that cut through a pseudonym ("Stud" + "ent 1") test the name mapping of the stream.
  const pieces = text ? text.match(/.{1,4}/gsu) ?? [] : [];
  for (const r of reply.reasoning ? reply.reasoning.match(/.{1,8}/gsu) ?? [] : []) chunks.push(chunk({ content: null, reasoning_content: r }));
  for (const p of pieces) chunks.push(chunk({ content: p }));
  (reply.calls ?? []).forEach((c, i) => {
    const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args);
    chunks.push(chunk({ tool_calls: [{ index: i, id: c.id ?? `call_${i}_${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name: c.name, arguments: '' } }] }));
    chunks.push(chunk({ tool_calls: [{ index: i, function: { arguments: args } }] }));
  });
  if (!reply.endEarly) {
    chunks.push(chunk({}, reply.finish ?? (reply.calls?.length ? 'tool_calls' : 'stop')));
    chunks.push({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }
  const lines = [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), ...(reply.endEarly ? [': keep-alive\n\n'] : ['data: [DONE]\n\n'])];
  if (!reply.delayMs) {
    res.end(lines.join(''));
    return;
  }
  let i = 0;
  const next = () => {
    if (res.destroyed) return;
    if (i >= lines.length) return void res.end();
    res.write(lines[i++]);
    setTimeout(next, reply.delayMs);
  };
  next();
}

/** Scripts the fake: chat requests take the next turn (the last one repeats); returns the requests it answered. */
export function script(fake: FakeProvider, turns: Turn[]): Recorded[] {
  const seen: Recorded[] = [];
  let i = 0;
  fake.override = (r, res) => {
    if (!r.path.endsWith('/chat/completions')) return false;
    seen.push(r);
    const turn = turns[Math.min(i, turns.length - 1)]!;
    i += 1;
    openAiReply(res, turn(r.body));
    return true;
  };
  return seen;
}

/** The last tool result the model was sent, parsed (the text after the app's data notice). */
export function lastToolResult(body: any): any {
  const msgs = (body.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool');
  const last = msgs[msgs.length - 1];
  if (!last) return null;
  const text = last.content.slice(last.content.indexOf('\n') + 1);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Everything the provider was sent in one request, as text (for "never contains" checks). */
export const sentText = (r: Recorded) => JSON.stringify(r.body);
