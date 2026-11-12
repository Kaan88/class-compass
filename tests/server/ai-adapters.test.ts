/**
 * Provider adapters (S19a, D-179): each wire format against a local fake server (never a real
 * provider): streaming text, tool calls assembled from pieces, usage, the translation of the internal
 * tool format (from the MCP tool definitions) to Anthropic tools, OpenAI functions and Gemini function
 * declarations, message history translation, and failures that never carry the provider's text.
 */
import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { anthropicAdapter, anthropicMessages } from '../../src/server/modules/aiConnections/adapters/anthropic.ts';
import { geminiAdapter, geminiContents, geminiSchema } from '../../src/server/modules/aiConnections/adapters/gemini.ts';
import { openAiAdapter, openAiCallId, openAiMessages } from '../../src/server/modules/aiConnections/adapters/openai.ts';
import { newCallId, type Adapter, type ChatEvent, type ChatMessage, type ProviderTarget, type ToolDefinition } from '../../src/server/modules/aiConnections/adapters/types.ts';
import { AI_MAX_CHAT_RESPONSE_BYTES, AI_MAX_KEPT_CHARS, AI_MAX_RESPONSE_BYTES, AiCallError, aiRequest, SSE_MAX_LINE_CHARS, sseEvents } from '../../src/server/modules/aiConnections/http.ts';
import { reasoningFieldOf, sendsReasoningBack } from '../../src/server/modules/aiConnections/provider.ts';
import { toolDefinitions } from '../../src/server/modules/aiConnections/tools.ts';
import { mayHaveProcessed, usageOrEstimate } from '../../src/server/modules/assistantChat/agent.ts';
import { allTools } from '../../src/server/modules/mcp/registry.ts';
import { FAKE_KEYS, FakeProvider, openAiStream, startStallingServer } from '../ai-fake.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';

let fake: FakeProvider;
let base: string;
let env: TestEnv;
beforeAll(async () => {
  fake = new FakeProvider();
  base = await fake.start();
  env = await makeEnv(); // registers every route, so the MCP tools exist
});
afterAll(async () => {
  await fake.close();
  await env.app.close();
});

const TOOL: ToolDefinition = { name: 'connection_check', description: 'Test tool', inputSchema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } };
const target = (secret: string | null, path = ''): ProviderTarget => ({ baseUrl: `${base}${path}`, policy: 'local', secret });

async function run(adapter: Adapter, t: ProviderTarget, tools: ToolDefinition[] = [], messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }]) {
  const events: ChatEvent[] = [];
  for await (const e of adapter({ target: t, model: 'fake-model', system: 'Be brief.', messages, tools, maxTokens: 50 })) events.push(e);
  return events;
}
const textOf = (es: ChatEvent[]) => es.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
const callsOf = (es: ChatEvent[]) => es.flatMap((e) => (e.type === 'toolCall' ? [e.call] : []));
const last = () => fake.requests[fake.requests.length - 1]!;
/** The usage a consumer records: the last `usage` event (each one is the total so far). */
const usageOf = (es: ChatEvent[]) => es.filter((e) => e.type === 'usage').pop();

describe('Anthropic Messages adapter', () => {
  it('streams text, usage and the stop reason', async () => {
    const es = await run(anthropicAdapter, target(FAKE_KEYS.anthropic));
    expect(textOf(es)).toBe('ready');
    expect(usageOf(es)).toEqual({ type: 'usage', inputTokens: 21, outputTokens: 3 });
    expect(es[es.length - 1]).toEqual({ type: 'done', stop: 'end' });
    const r = last();
    expect(r.path).toBe('/v1/messages');
    expect(r.headers['x-api-key']).toBe(FAKE_KEYS.anthropic);
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.body).toMatchObject({ model: 'fake-model', max_tokens: 50, system: 'Be brief.', stream: true });
    expect(r.body.tools).toBeUndefined();
  });

  it('assembles a tool call from partial JSON and sends Anthropic tools', async () => {
    const es = await run(anthropicAdapter, target(FAKE_KEYS.anthropic), [TOOL]);
    expect(callsOf(es)).toEqual([{ id: 'toolu_fake1', name: 'connection_check', arguments: { word: 'ready' } }]);
    expect(es[es.length - 1]).toEqual({ type: 'done', stop: 'toolUse' });
    expect(last().body.tools).toEqual([{ name: 'connection_check', description: 'Test tool', input_schema: TOOL.inputSchema }]);
  });

  it('translates history: tool results merge into one user turn after the assistant’s tool use', () => {
    const turns = anthropicMessages([
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'x', arguments: { n: 1 } }, { id: 'b', name: 'y', arguments: {} }] },
      { role: 'tool', toolCallId: 'a', name: 'x', content: '1' },
      { role: 'tool', toolCallId: 'b', name: 'y', content: 'no', isError: true },
      { role: 'user', content: 'Thanks' },
    ]);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect(turns[1]!.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'x', input: { n: 1 } },
      { type: 'tool_use', id: 'b', name: 'y', input: {} },
    ]);
    expect(turns[2]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '1' },
      { type: 'tool_result', tool_use_id: 'b', content: 'no', is_error: true },
      { type: 'text', text: 'Thanks' },
    ]);
  });

  it('a rejected key is KEY_REJECTED with the status only, never the provider’s text', async () => {
    const err = await run(anthropicAdapter, target('sk-ant-wrong-key-123456')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiCallError);
    expect(err).toMatchObject({ failure: 'KEY_REJECTED', httpStatus: 401 });
    expect(String((err as Error).message)).not.toContain('wrong-key');
  });
});

describe('OpenAI Chat Completions adapter (OpenAI, OpenRouter, compatible servers)', () => {
  it('streams text and usage with a bearer key', async () => {
    const es = await run(openAiAdapter, { ...target(FAKE_KEYS.openai), maxTokensField: 'max_completion_tokens' });
    expect(textOf(es)).toBe('ready');
    expect(usageOf(es)).toEqual({ type: 'usage', inputTokens: 17, outputTokens: 5 });
    expect(es[es.length - 1]).toEqual({ type: 'done', stop: 'end' });
    const r = last();
    expect(r.path).toBe('/chat/completions');
    expect(r.headers.authorization).toBe(`Bearer ${FAKE_KEYS.openai}`);
    expect(r.body.max_completion_tokens).toBe(50);
    expect(r.body.stream_options).toEqual({ include_usage: true });
    expect(r.body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('joins tool call pieces and sends function tools', async () => {
    const es = await run(openAiAdapter, target(FAKE_KEYS.openrouter, '/api/v1'), [TOOL]);
    expect(callsOf(es)).toEqual([{ id: 'call_fake1', name: 'connection_check', arguments: { word: 'ready' } }]);
    expect(es[es.length - 1]).toEqual({ type: 'done', stop: 'toolUse' });
    expect(last().path).toBe('/api/v1/chat/completions');
    expect(last().body.tools).toEqual([{ type: 'function', function: { name: 'connection_check', description: 'Test tool', parameters: TOOL.inputSchema } }]);
    expect(last().body.max_tokens).toBe(50);
  });

  it('a compatible server without a key sends no Authorization header; CRLF streams and plain JSON answers work', async () => {
    fake.override = (r, res) => {
      if (!r.path.endsWith('/chat/completions')) return false;
      fake.override = null;
      openAiStream(res, r.body, { crlf: true });
      return true;
    };
    const es = await run(openAiAdapter, target(null, '/v1'));
    expect(textOf(es)).toBe('ready');
    expect(last().headers.authorization).toBeUndefined();
    fake.override = (r, res) => {
      fake.override = null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'connection_check', arguments: 'not json' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
      return true;
    };
    const plain = await run(openAiAdapter, target(null, '/v1'), [TOOL]);
    expect(callsOf(plain)).toEqual([{ id: 'c1', name: 'connection_check', arguments: {}, invalidArguments: true }]);
    expect(usageOf(plain)).toEqual({ type: 'usage', inputTokens: 3, outputTokens: 4 });
  });

  it('translates history to assistant tool_calls and tool messages', () => {
    expect(
      openAiMessages('', [
        { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'x', arguments: { n: 1 } }] },
        { role: 'tool', toolCallId: 'a', name: 'x', content: '1' },
      ]),
    ).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{"n":1}' } }] },
      { role: 'tool', tool_call_id: 'a', content: '1' },
    ]);
  });

  it('maps statuses (429 rate limited, 404 model not found) and a stream cut short', async () => {
    for (const [status, failure] of [
      [429, 'RATE_LIMITED'],
      [404, 'MODEL_NOT_FOUND'],
      [500, 'PROVIDER_ERROR'],
      [302, 'BAD_RESPONSE'],
    ] as const) {
      fake.override = (_r, res) => {
        fake.override = null;
        res.writeHead(status, { location: 'http://169.254.169.254/' });
        res.end('nope');
        return true;
      };
      await expect(run(openAiAdapter, target(FAKE_KEYS.openai))).rejects.toMatchObject({ failure, httpStatus: status });
    }
    fake.override = (_r, res) => {
      fake.override = null;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"half"}}]}\n\n');
      return true;
    };
    await expect(run(openAiAdapter, target(FAKE_KEYS.openai))).rejects.toMatchObject({ failure: 'STREAM_ENDED', detail: 'STREAM_ENDED_EARLY' });
  });
});

describe('Gemini adapter', () => {
  it('streams text (thought parts left out) and usage', async () => {
    const es = await run(geminiAdapter, target(FAKE_KEYS.gemini));
    expect(textOf(es)).toBe('ready');
    expect(usageOf(es)).toEqual({ type: 'usage', inputTokens: 30, outputTokens: 2 });
    const r = last();
    expect(r.path).toBe('/v1beta/models/fake-model:streamGenerateContent?alt=sse');
    expect(r.headers['x-goog-api-key']).toBe(FAKE_KEYS.gemini);
    expect(r.body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(r.body.generationConfig).toEqual({ maxOutputTokens: 50 });
  });

  it('returns function calls with their thought signature and sends function declarations', async () => {
    const es = await run(geminiAdapter, target(FAKE_KEYS.gemini), [TOOL]);
    // The fake sends no id: one is made up, unique across replies, and marked as made up.
    expect(callsOf(es)).toEqual([{ id: expect.stringMatching(/^cc_call_[0-9a-f]{32}$/u), generatedId: true, name: 'connection_check', arguments: { word: 'ready' }, signature: 'sig-fake-1' }]);
    const again = callsOf(await run(geminiAdapter, target(FAKE_KEYS.gemini), [TOOL]));
    expect(again[0]!.id).not.toBe(callsOf(es)[0]!.id);
    expect(es[es.length - 1]).toEqual({ type: 'done', stop: 'toolUse' });
    expect(last().body.tools).toEqual([{ functionDeclarations: [{ name: 'connection_check', description: 'Test tool', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } }] }]);
  });

  it('sends the signature back and tool results as functionResponse parts; only Gemini’s own ids travel back', () => {
    const c = geminiContents([
      { role: 'user', content: 'Q' },
      {
        role: 'assistant',
        content: 'Let me look.',
        toolCalls: [
          { id: 'gem-id-1', name: 'x', arguments: { a: 1 }, signature: 'sig' },
          { id: 'cc_call_made-up', generatedId: true, name: 'y', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'gem-id-1', name: 'x', content: 'done' },
      { role: 'tool', toolCallId: 'cc_call_made-up', name: 'y', content: 'also' },
    ]);
    expect(c).toEqual([
      { role: 'user', parts: [{ text: 'Q' }] },
      { role: 'model', parts: [{ text: 'Let me look.' }, { functionCall: { id: 'gem-id-1', name: 'x', args: { a: 1 } }, thoughtSignature: 'sig' }, { functionCall: { name: 'y', args: {} } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { id: 'gem-id-1', name: 'x', response: { content: 'done' } } }, { functionResponse: { name: 'y', response: { content: 'also' } } }],
      },
    ]);
  });

  it('a call id Gemini sends is kept as is', async () => {
    fake.override = (r, res) => {
      if (!r.path.includes(':streamGenerateContent')) return false;
      fake.override = null;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'gem-42', name: 'connection_check', args: { word: 'ready' } } }] }, finishReason: 'STOP' }] })}\n\n`);
      return true;
    };
    expect(callsOf(await run(geminiAdapter, target(FAKE_KEYS.gemini), [TOOL]))).toEqual([{ id: 'gem-42', name: 'connection_check', arguments: { word: 'ready' } }]);
  });

  it('a wrong key (400 API_KEY_INVALID) is KEY_REJECTED without the provider’s text; another 400 is a provider error', async () => {
    const err = await run(geminiAdapter, target('AIza-wrong-key-123456')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiCallError);
    expect(err).toMatchObject({ failure: 'KEY_REJECTED', httpStatus: 400 });
    expect(String((err as Error).message)).not.toContain('wrong-key');
    fake.override = (_r, res) => {
      fake.override = null;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad schema' } }));
      return true;
    };
    await expect(run(geminiAdapter, target(FAKE_KEYS.gemini))).rejects.toMatchObject({ failure: 'PROVIDER_ERROR', httpStatus: 400 });
  });

  it('reduces JSON Schema to Gemini’s subset (nullable unions, const, no additionalProperties)', () => {
    expect(
      geminiSchema({
        $schema: 'x',
        type: 'object',
        additionalProperties: false,
        properties: { a: { type: ['string', 'null'], default: 'x' }, b: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] }, c: { const: 'only' }, d: { type: 'array', items: { type: 'object' } } },
        required: ['a'],
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'string', nullable: true }, b: { type: 'integer', minimum: 1, nullable: true }, c: { enum: ['only'] }, d: { type: 'array', items: { type: 'object', properties: {} } } },
      required: ['a'],
    });
  });
});

describe('one internal tool format from the MCP tool definitions', () => {
  it('every MCP tool becomes a definition that each adapter can send', () => {
    const defs = toolDefinitions(allTools());
    expect(defs.length).toBeGreaterThan(40);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
      expect(d.description.length).toBeGreaterThan(10);
      const g = geminiSchema(d.inputSchema) as Record<string, unknown>;
      expect(JSON.stringify(g)).not.toMatch(/"\$schema"|"additionalProperties"|"default"/u);
    }
  });
});

describe('the Server-Sent Events reader', () => {
  it('handles CRLF split across chunks, comments, multi-line data and a missing final blank line', async () => {
    async function* chunks() {
      for (const c of [': hi\r', '\nevent: a\r\ndata: 1\r', '\ndata: 2\r\n\r\n', 'data: last']) yield Buffer.from(c);
    }
    const out = [];
    for await (const e of sseEvents(chunks())) out.push(e);
    expect(out).toEqual([
      { event: 'a', data: '1\n2' },
      { event: null, data: 'last' },
    ]);
  });
});

describe('outgoing request rules', () => {
  it('a request to a loopback or metadata address under the public policy never connects', async () => {
    let hits = 0;
    const s = http.createServer((_q, r) => {
      hits += 1;
      r.end();
    });
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
    const port = (s.address() as { port: number }).port;
    await expect(run(openAiAdapter, { baseUrl: `http://127.0.0.1:${port}`, policy: 'public', secret: 'x' })).rejects.toMatchObject({ failure: 'URL_NOT_ALLOWED' });
    await expect(run(openAiAdapter, { baseUrl: `https://localhost:${port}`, policy: 'public', secret: 'x' })).rejects.toMatchObject({ failure: 'URL_NOT_ALLOWED' });
    await expect(run(openAiAdapter, { baseUrl: 'http://169.254.169.254/latest', policy: 'local', secret: 'x' })).rejects.toMatchObject({ failure: 'URL_NOT_ALLOWED' });
    expect(hits).toBe(0);
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });

  it('the total time limit holds before the headers arrive: a server that never finishes them is cut off (security review)', async () => {
    const stall = await startStallingServer(50);
    try {
      const started = Date.now();
      // The socket is never quiet (a 100 Continue every 50 ms), so only the total limit can end it.
      await expect(aiRequest({ url: `${stall.base}/v1/chat/completions`, headers: {}, body: '{}', policy: 'local', totalTimeoutMs: 400 })).rejects.toMatchObject({ failure: 'TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(3000);
      // The client destroyed its socket; the server sees the close a moment later (later under load,
      // which made a fixed 100 ms wait flaky).
      await vi.waitFor(() => expect(stall.open()).toBe(0), { timeout: 2000, interval: 20 });
    } finally {
      await stall.close();
    }
  });
});

/** Runs an adapter against a one-off answer of the fake; returns the events and the error (if any). */
async function runWith(adapter: Adapter, t: ProviderTarget, answer: (res: http.ServerResponse) => void) {
  fake.override = (_r, res) => {
    fake.override = null;
    answer(res);
    return true;
  };
  const events: ChatEvent[] = [];
  let error: unknown = null;
  try {
    for await (const e of adapter({ target: t, model: 'fake-model', system: 'Be brief.', messages: [{ role: 'user', content: 'Hello' }], tools: [], maxTokens: 50 })) events.push(e);
  } catch (e) {
    error = e;
  }
  return { events, error };
}
const sseOf = (res: http.ServerResponse, events: unknown[], end = true) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const d of events) res.write(`data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`);
  if (end) res.end();
};
/** Sends the events, then breaks the connection (a reply cut off midway). */
const cutAfter = (res: http.ServerResponse, events: unknown[]) => {
  sseOf(res, events, false);
  setTimeout(() => res.socket?.destroy(), 30);
};

describe('audit finding 5: made-up call ids fit OpenAI’s 40-character limit', () => {
  it('a generated id is at most 40 characters, and a longer stored id is shortened the same way for the call and its result', () => {
    for (let i = 0; i < 20; i++) expect(newCallId().length).toBeLessThanOrEqual(40);
    const long = 'cc_call_8a1f2c3d-4b5e-6789-abcd-ef0123456789';
    expect(long.length).toBe(44);
    const wire = openAiMessages('', [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: long, generatedId: true, name: 'x', arguments: {} },
          { id: 'call_short', name: 'y', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: long, name: 'x', content: '1' },
      { role: 'tool', toolCallId: 'call_short', name: 'y', content: '2' },
    ]) as any[];
    const sent = wire[0].tool_calls.map((c: { id: string }) => c.id);
    expect(sent[0].length).toBeLessThanOrEqual(40);
    expect(sent[0]).not.toBe(long);
    expect(wire[1].tool_call_id).toBe(sent[0]);
    expect(sent[1]).toBe('call_short');
    expect(wire[2].tool_call_id).toBe('call_short');
    expect(openAiCallId(long)).toBe(sent[0]);
  });
});

describe('audit finding 6: a blocked or empty abnormal reply is a failure, not a finished answer', () => {
  it('Gemini: a safety finish reason or a blocked prompt is BLOCKED; another abnormal end with nothing is PROVIDER_ERROR', async () => {
    const t = target(FAKE_KEYS.gemini);
    const safety = await runWith(geminiAdapter, t, (res) => sseOf(res, [{ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }], usageMetadata: { promptTokenCount: 9 } }]));
    expect(safety.error).toMatchObject({ failure: 'BLOCKED' });
    expect(safety.events.some((e) => e.type === 'done')).toBe(false);
    const prompt = await runWith(geminiAdapter, t, (res) => sseOf(res, [{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 9 } }]));
    expect(prompt.error).toMatchObject({ failure: 'BLOCKED' });
    const other = await runWith(geminiAdapter, t, (res) => sseOf(res, [{ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] }]));
    expect(other.error).toMatchObject({ failure: 'PROVIDER_ERROR' });
    // A normal reply still finishes.
    const fine = await runWith(geminiAdapter, t, (res) => sseOf(res, [{ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]));
    expect(fine.error).toBeNull();
    expect(fine.events.pop()).toEqual({ type: 'done', stop: 'end' });
  });

  it('OpenAI: content_filter is BLOCKED (streamed and plain JSON); an end with nothing and no known reason is PROVIDER_ERROR', async () => {
    const t = target(FAKE_KEYS.openai);
    const filtered = await runWith(openAiAdapter, t, (res) => sseOf(res, [{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }, '[DONE]']));
    expect(filtered.error).toMatchObject({ failure: 'BLOCKED' });
    const plain = await runWith(openAiAdapter, t, (res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'content_filter' }] }));
    });
    expect(plain.error).toMatchObject({ failure: 'BLOCKED' });
    const empty = await runWith(openAiAdapter, t, (res) => sseOf(res, [{ choices: [{ delta: {}, finish_reason: 'error' }] }, '[DONE]']));
    expect(empty.error).toMatchObject({ failure: 'PROVIDER_ERROR' });
  });

  it('Anthropic: a refusal is BLOCKED', async () => {
    const r = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) =>
      sseOf(res, [{ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } }, { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 2 } }, { type: 'message_stop' }]),
    );
    expect(r.error).toMatchObject({ failure: 'BLOCKED' });
  });
});

describe('audit finding 7: usage is reported as soon as it is known, so a reply cut short still counts', () => {
  it('Anthropic: input tokens at message_start, output tokens at message_delta, before the stream breaks', async () => {
    const r = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) =>
      cutAfter(res, [
        { type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half an ans' } },
        { type: 'message_delta', delta: {}, usage: { output_tokens: 7 } },
      ]),
    );
    expect(r.error).toBeInstanceOf(AiCallError);
    expect(usageOf(r.events)).toEqual({ type: 'usage', inputTokens: 40, outputTokens: 7 });
  });

  it('Gemini: usageMetadata of each chunk, before the stream breaks', async () => {
    const r = await runWith(geminiAdapter, target(FAKE_KEYS.gemini), (res) => cutAfter(res, [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Half' }] } }], usageMetadata: { promptTokenCount: 33, candidatesTokenCount: 4 } }]));
    expect(r.error).toBeInstanceOf(AiCallError);
    expect(usageOf(r.events)).toEqual({ type: 'usage', inputTokens: 33, outputTokens: 4 });
  });

  it('OpenAI: the usage chunk, before the stream breaks; a whole reply reports one total', async () => {
    const r = await runWith(openAiAdapter, target(FAKE_KEYS.openai), (res) => cutAfter(res, [{ choices: [{ delta: { content: 'Half' } }], usage: { prompt_tokens: 12, completion_tokens: 2 } }]));
    expect(r.error).toBeInstanceOf(AiCallError);
    expect(usageOf(r.events)).toEqual({ type: 'usage', inputTokens: 12, outputTokens: 2 });
    const whole = await run(openAiAdapter, target(FAKE_KEYS.openai));
    expect(whole.filter((e) => e.type === 'usage')).toEqual([{ type: 'usage', inputTokens: 17, outputTokens: 5 }]);
  });
});

describe('audit findings 2 and 3: a chat request waits for a model that thinks silently', () => {
  const start = async (handler: http.RequestListener) => {
    const srv = http.createServer(handler);
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1/chat/completions`, close: () => new Promise<void>((resolve) => srv.close(() => resolve())) };
  };
  const readAll = async (r: Awaited<ReturnType<typeof aiRequest>>) => {
    let out = '';
    for await (const c of r.body) out += c.toString('utf8');
    return out;
  };

  it('finding 2: a quiet gap after the headers ends a small call at the idle limit but not a chat request', async () => {
    const srv = await start((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: 1\n\n');
      setTimeout(() => res.end('data: 2\n\n'), 400);
    });
    try {
      const small = await aiRequest({ url: srv.url, headers: {}, body: '{}', policy: 'local', idleTimeoutMs: 100 });
      await expect(readAll(small)).rejects.toBeInstanceOf(AiCallError);
      const chat = await aiRequest({ url: srv.url, headers: {}, body: '{}', policy: 'local', idleTimeoutMs: 100, chat: true });
      expect(await readAll(chat)).toBe('data: 1\n\ndata: 2\n\n');
    } finally {
      await srv.close();
    }
  });

  it('finding 3: slow response headers end a small call at the connect limit but not a chat request', async () => {
    const srv = await start((_q, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      }, 400);
    });
    try {
      await expect(aiRequest({ url: srv.url, headers: {}, body: '{}', policy: 'local', connectTimeoutMs: 100 })).rejects.toMatchObject({ failure: 'TIMEOUT' });
      const chat = await aiRequest({ url: srv.url, headers: {}, body: '{}', policy: 'local', connectTimeoutMs: 100, chat: true });
      expect(await readAll(chat)).toBe('{"ok":true}');
    } finally {
      await srv.close();
    }
  });

  it('finding 3: connecting still has the short limit for a chat request (a TLS handshake that never finishes)', async () => {
    const sockets = new Set<net.Socket>();
    const silent = net.createServer((sock) => {
      sockets.add(sock);
      sock.on('error', () => {});
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    try {
      const started = Date.now();
      const url = `https://127.0.0.1:${(silent.address() as { port: number }).port}/v1/chat/completions`;
      await expect(aiRequest({ url, headers: {}, body: '{}', policy: 'local', connectTimeoutMs: 150, chat: true })).rejects.toMatchObject({ failure: 'TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      for (const sock of sockets) sock.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});

describe('review of the audit fixes: an abnormal empty Anthropic end is a failure', () => {
  const start = { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } };
  const ending = (reason: string | null) => [start, { type: 'message_delta', delta: reason === null ? {} : { stop_reason: reason }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];

  it('pause_turn, model_context_window_exceeded, an unknown or no stop reason with nothing written is PROVIDER_ERROR', async () => {
    for (const reason of ['pause_turn', 'model_context_window_exceeded', 'something_new', null]) {
      const r = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) => sseOf(res, ending(reason)));
      expect(r.error, String(reason)).toMatchObject({ failure: 'PROVIDER_ERROR' });
      expect(r.events.some((e) => e.type === 'done')).toBe(false);
    }
  });

  it('max_tokens stays the length stop; a normal end (also empty) and an unusual end with text still finish', async () => {
    const length = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) => sseOf(res, ending('max_tokens')));
    expect(length.error).toBeNull();
    expect(length.events.pop()).toEqual({ type: 'done', stop: 'length' });
    const empty = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) => sseOf(res, ending('end_turn')));
    expect(empty.events.pop()).toEqual({ type: 'done', stop: 'end' });
    const written = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) =>
      sseOf(res, [
        start,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Part' } },
        { type: 'message_delta', delta: { stop_reason: 'pause_turn' } },
        { type: 'message_stop' },
      ]),
    );
    expect(written.error).toBeNull();
    expect(written.events.pop()).toEqual({ type: 'done', stop: 'other' });
  });
});

describe('review of the audit fixes: tokens are estimated only for a request the provider may have processed', () => {
  const sent = { system: 'Be brief.', messages: [{ role: 'user' as const, content: 'x'.repeat(400) }] };

  it('a request that never connected is marked as not sent (unreachable, refused address, stopped before sending)', async () => {
    const s = http.createServer();
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
    const port = (s.address() as { port: number }).port;
    await new Promise<void>((resolve) => s.close(() => resolve()));
    await expect(aiRequest({ url: `http://127.0.0.1:${port}/v1/messages`, headers: {}, body: '{}', policy: 'local' })).rejects.toMatchObject({ failure: 'UNREACHABLE', sent: false });
    await expect(aiRequest({ url: 'http://169.254.169.254/x', headers: {}, body: '{}', policy: 'local' })).rejects.toMatchObject({ failure: 'URL_NOT_ALLOWED', sent: false });
    const stopped = new AbortController();
    stopped.abort();
    await expect(aiRequest({ url: `${base}/v1/messages`, headers: {}, body: '{}', policy: 'local', signal: stopped.signal })).rejects.toMatchObject({ failure: 'TIMEOUT', sent: false });
  });

  it('a request cut off after it reached the provider is marked as sent', async () => {
    const r = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) => cutAfter(res, []));
    expect(r.error).toMatchObject({ sent: true });
  });

  it('an in-stream rate-limit error after partial tool-call arguments (OpenAI, HTTP 200) is estimated, not counted 0', async () => {
    const r = await runWith(openAiAdapter, target(FAKE_KEYS.openai), (res) =>
      sseOf(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_classes', arguments: '{"ye' } }] } }] }, { error: { code: 429, message: 'Rate limit' } }]),
    );
    expect(r.error).toMatchObject({ failure: 'RATE_LIMITED', httpStatus: null, sent: true });
    expect(r.events.filter((e) => e.type === 'usage' || e.type === 'toolCall' || e.type === 'text')).toEqual([]);
    expect(mayHaveProcessed(r.error)).toBe(true);
    expect(usageOrEstimate(null, sent, { text: '' }, r.error).inputTokens).toBeGreaterThan(100);
  });

  it('refusals (401/403/404/429) and failures before sending count 0; other failures are estimated', () => {
    const none = { inputTokens: 0, outputTokens: 0 };
    const refused = [
      new AiCallError('KEY_REJECTED', 401),
      new AiCallError('KEY_REJECTED', 403),
      new AiCallError('RATE_LIMITED', 429),
      new AiCallError('MODEL_NOT_FOUND', 404),
      new AiCallError('NEEDS_KEY', null, false),
      new AiCallError('URL_NOT_ALLOWED', null, false),
      new AiCallError('UNREACHABLE', null, false),
      new AiCallError('TIMEOUT', null, false),
    ];
    for (const e of refused) {
      expect(usageOrEstimate(null, sent, { text: '' }, e), e.message).toEqual(none);
      expect(mayHaveProcessed(e)).toBe(false);
    }
    for (const e of [new AiCallError('PROVIDER_ERROR', 500), new AiCallError('UNREACHABLE'), new AiCallError('TIMEOUT'), new AiCallError('BAD_RESPONSE'), new Error('boom')]) {
      expect(usageOrEstimate(null, sent, { text: '' }, e).inputTokens).toBeGreaterThan(100);
    }
    // The same codes from inside an accepted (HTTP 200) stream: the provider already worked, so estimated.
    for (const e of [new AiCallError('RATE_LIMITED'), new AiCallError('KEY_REJECTED'), new AiCallError('MODEL_NOT_FOUND')]) {
      expect(mayHaveProcessed(e), e.message).toBe(true);
      expect(usageOrEstimate(null, sent, { text: '' }, e).inputTokens).toBeGreaterThan(100);
    }
    // Text already written, or the provider's own usage, always counts.
    expect(usageOrEstimate(null, sent, { text: 'abcdefgh' }, new AiCallError('RATE_LIMITED')).outputTokens).toBe(2);
    expect(usageOrEstimate({ inputTokens: 3, outputTokens: 4 }, sent, { text: '' }, new AiCallError('KEY_REJECTED', 401))).toEqual({ inputTokens: 3, outputTokens: 4 });
    // No failure (a finished reply without a usage event): estimated as before.
    expect(usageOrEstimate(null, sent, { text: '' }).inputTokens).toBeGreaterThan(100);
  });
});

describe('D-203: long thinking streams, early ends and failure details (DeepSeek incident 2026-11-12)', () => {
  // DeepSeek's chunk shape: one reasoning token per chunk, about 300 bytes each; usage only on the last chunk.
  const ID = 'c0ffee00-1111-2222-3333-444455556666';
  const base0 = { id: ID, object: 'chat.completion.chunk', created: 1762900000, model: 'deepseek-v4-pro', system_fingerprint: 'fp_fake0000_prod0000_fp8_kvcache' };
  const dsChunk = (delta: unknown, finish: string | null = null) => ({ ...base0, choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }] });
  const line = (d: unknown) => `data: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`;
  const thinkLine = line(dsChunk({ content: null, reasoning_content: 'x' }));
  /** Writes the parts with back-pressure (a long stream must not sit in memory on the fake's side either). */
  async function writeAll(res: http.ServerResponse, parts: Iterable<string>, end = true) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    let buf = '';
    for (const p of parts) {
      buf += p;
      if (buf.length > 64 * 1024) {
        if (res.destroyed) return;
        if (!res.write(buf)) await new Promise((r) => res.once('drain', r));
        buf = '';
      }
    }
    if (buf && !res.destroyed) res.write(buf);
    if (end) res.end();
  }
  const compatible = (): ProviderTarget => ({ ...target(FAKE_KEYS.compatible), sendReasoning: 'reasoning_content' });

  it('more than 8 MiB of reasoning chunks, then content and finish stop, succeeds (chat byte cap 64 MiB)', async () => {
    const n = Math.ceil((AI_MAX_RESPONSE_BYTES + 512 * 1024) / Buffer.byteLength(thinkLine));
    expect(AI_MAX_CHAT_RESPONSE_BYTES).toBe(64 * 1024 * 1024);
    const r = await runWith(openAiAdapter, compatible(), (res) =>
      void writeAll(
        res,
        (function* () {
          yield line(dsChunk({ role: 'assistant', content: null, reasoning_content: '' }));
          for (let i = 0; i < n; i++) yield thinkLine;
          yield line(dsChunk({ content: 'Done.', reasoning_content: null }));
          yield line(dsChunk({ content: '', reasoning_content: null }, 'stop'));
          yield line({ ...base0, choices: [], usage: { prompt_tokens: 23700, completion_tokens: 999 } });
          yield line('[DONE]');
        })(),
      ),
    );
    expect(r.error).toBeNull();
    expect(n * Buffer.byteLength(thinkLine)).toBeGreaterThan(AI_MAX_RESPONSE_BYTES);
    expect(textOf(r.events)).toBe('Done.');
    expect(r.events.filter((e) => e.type === 'reasoning').length).toBe(n);
    expect(usageOf(r.events)).toEqual({ type: 'usage', inputTokens: 23700, outputTokens: 999 });
    expect(r.events[r.events.length - 1]).toEqual({ type: 'done', stop: 'end' });
  }, 60_000);

  it('what an adapter keeps is capped: more text than AI_MAX_KEPT_CHARS is OUT_OF_TOKENS (KEPT_TOO_LARGE)', async () => {
    const piece = 'y'.repeat(64 * 1024);
    const r = await runWith(openAiAdapter, compatible(), (res) =>
      void writeAll(
        res,
        (function* () {
          for (let i = 0; i < AI_MAX_KEPT_CHARS / piece.length + 2; i++) yield line(dsChunk({ content: piece }));
          yield line(dsChunk({}, 'stop'));
          yield line('[DONE]');
        })(),
      ),
    );
    expect(r.error).toMatchObject({ failure: 'OUT_OF_TOKENS', detail: 'KEPT_TOO_LARGE' });
    expect((r.error as AiCallError).stats!.contentChars).toBeGreaterThan(AI_MAX_KEPT_CHARS);
    // Tool-call arguments count too.
    const args = await runWith(openAiAdapter, compatible(), (res) =>
      void writeAll(
        res,
        (function* () {
          yield line(dsChunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_classes', arguments: '' } }] }));
          for (let i = 0; i < AI_MAX_KEPT_CHARS / piece.length + 2; i++) yield line(dsChunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }));
          yield line(dsChunk({}, 'tool_calls'));
          yield line('[DONE]');
        })(),
      ),
    );
    expect(args.error).toMatchObject({ failure: 'OUT_OF_TOKENS', detail: 'KEPT_TOO_LARGE', stats: { toolCalls: 1 } });
    expect(callsOf(args.events)).toEqual([]);
  });

  it('one huge line without a newline, or one event with too much data, fails at the SSE line cap', async () => {
    const r = await runWith(openAiAdapter, compatible(), (res) => void writeAll(res, [`data: ${'z'.repeat(SSE_MAX_LINE_CHARS + 1024)}`]));
    expect(r.error).toMatchObject({ failure: 'BAD_RESPONSE', detail: 'SSE_LINE_TOO_LONG' });
    expect((r.error as AiCallError).stats!.bytes).toBeGreaterThan(SSE_MAX_LINE_CHARS);
    const many = await runWith(openAiAdapter, compatible(), (res) => void writeAll(res, Array.from({ length: 40 }, () => `data: ${'z'.repeat(32 * 1024)}\n`)));
    expect(many.error).toMatchObject({ failure: 'BAD_RESPONSE', detail: 'SSE_LINE_TOO_LONG' });
  });

  it('keep-alive comments then a clean close is STREAM_ENDED with its detail and counters (also after reasoning and usage)', async () => {
    const r = await runWith(openAiAdapter, compatible(), (res) => void writeAll(res, Array.from({ length: 100 }, () => ': keep-alive\n\n')));
    expect(r.error).toBeInstanceOf(AiCallError);
    expect(r.error).toMatchObject({ failure: 'STREAM_ENDED', detail: 'STREAM_ENDED_EARLY', httpStatus: null, sent: true });
    expect((r.error as AiCallError).stats).toMatchObject({ events: 0, sawDone: false, lastFinishReason: null, sawUsage: false });
    expect((r.error as AiCallError).stats!.bytes).toBeGreaterThan(0);
    const thinking = await runWith(openAiAdapter, compatible(), (res) =>
      void writeAll(res, [...Array.from({ length: 50 }, () => thinkLine), line({ ...base0, choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } })]),
    );
    expect(thinking.error).toMatchObject({ failure: 'STREAM_ENDED', stats: { events: 51, reasoningChars: 50, contentChars: 0, sawUsage: true, sawDone: false } });
    // The same for Anthropic (no message_stop) and Gemini (no finish reason, or nothing at all).
    const anth = await runWith(anthropicAdapter, target(FAKE_KEYS.anthropic), (res) => sseOf(res, [{ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } }]));
    expect(anth.error).toMatchObject({ failure: 'STREAM_ENDED', detail: 'STREAM_ENDED_EARLY' });
    const gem = await runWith(geminiAdapter, target(FAKE_KEYS.gemini), (res) => void writeAll(res, [': keep-alive\n\n']));
    expect(gem.error).toMatchObject({ failure: 'STREAM_ENDED', detail: 'STREAM_ENDED_EARLY' });
    // Gemini text without any finish reason was cut short too: not stored as a finished answer.
    const gemCut = await runWith(geminiAdapter, target(FAKE_KEYS.gemini), (res) => sseOf(res, [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Half an ans' }] } }] }]));
    expect(gemCut.error).toMatchObject({ failure: 'STREAM_ENDED', detail: 'STREAM_ENDED_EARLY', stats: { contentChars: 11, lastFinishReason: null } });
    expect(gemCut.events.some((e) => e.type === 'done')).toBe(false);
    // A body that is not an event stream at all, or a data line that is not JSON, stays a format error.
    const html = await runWith(openAiAdapter, compatible(), (res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>502 Bad Gateway</html>');
    });
    expect(html.error).toMatchObject({ failure: 'BAD_RESPONSE', detail: 'NOT_AN_EVENT_STREAM' });
    const badJson = await runWith(openAiAdapter, compatible(), (res) => sseOf(res, ['{"choi']));
    expect(badJson.error).toMatchObject({ failure: 'BAD_RESPONSE', detail: 'BAD_SSE_JSON' });
  });

  it('finish insufficient_system_resource or aborted after content is a PROVIDER_ERROR; the text written stays with the events', async () => {
    for (const finish of ['insufficient_system_resource', 'aborted']) {
      const r = await runWith(openAiAdapter, compatible(), (res) =>
        sseOf(res, [dsChunk({ content: 'Partial', reasoning_content: null }), dsChunk({ content: '' }, finish), { ...base0, choices: [], usage: { prompt_tokens: 5, completion_tokens: 100 } }, '[DONE]']),
      );
      expect(r.error, finish).toMatchObject({ failure: 'PROVIDER_ERROR', detail: 'PROVIDER_FINISH', stats: { lastFinishReason: finish, sawDone: true } });
      expect(textOf(r.events)).toBe('Partial');
      expect(r.events.some((e) => e.type === 'done')).toBe(false);
    }
    // finish length is still the length stop.
    const length = await runWith(openAiAdapter, compatible(), (res) => sseOf(res, [dsChunk({ content: null, reasoning_content: 'hm' }), dsChunk({ content: '' }, 'length'), '[DONE]']));
    expect(length.events.pop()).toEqual({ type: 'done', stop: 'length' });
  });

  it('reads delta.reasoning (OpenRouter) as reasoning, never as text', async () => {
    const r = await runWith(openAiAdapter, compatible(), (res) => sseOf(res, [{ choices: [{ index: 0, delta: { reasoning: 'Thinking…' } }] }, { choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] }, '[DONE]']));
    expect(textOf(r.events)).toBe('Hi');
    expect(r.events.filter((e) => e.type === 'reasoning')).toEqual([{ type: 'reasoning', text: 'Thinking…' }]);
  });

  it('reasoning goes back on an assistant message with tool calls only when the target asks for it (openaiCompatible as reasoning_content, openrouter as reasoning, never openai or chatgpt)', async () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'x', arguments: {} }], reasoning: 'I should look it up.' },
      { role: 'tool', toolCallId: 'call_1', name: 'x', content: '1' },
      { role: 'assistant', content: 'Plain answer', reasoning: 'never sent: no tool calls' },
      { role: 'user', content: 'Again' },
    ];
    expect(openAiMessages('', history, { reasoning: 'reasoning_content' })[1]).toEqual({ role: 'assistant', content: null, reasoning_content: 'I should look it up.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] });
    expect(openAiMessages('', history, { reasoning: 'reasoning_content' })[3]).toEqual({ role: 'assistant', content: 'Plain answer' });
    expect(openAiMessages('', history)[1]).not.toHaveProperty('reasoning_content');
    await run(openAiAdapter, compatible(), [], history);
    expect(last().body.messages[2].reasoning_content).toBe('I should look it up.');
    await run(openAiAdapter, target(FAKE_KEYS.openai), [], history);
    expect(JSON.stringify(last().body)).not.toContain('look it up');
    // OpenRouter takes it back as `reasoning` (its assistant-message field), not `reasoning_content`.
    expect(openAiMessages('', history, { reasoning: 'reasoning' })[1]).toEqual({ role: 'assistant', content: null, reasoning: 'I should look it up.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] });
    await run(openAiAdapter, { ...target(FAKE_KEYS.openrouter, '/api/v1'), sendReasoning: 'reasoning' }, [], history);
    expect(last().body.messages[2]).toMatchObject({ reasoning: 'I should look it up.' });
    expect(last().body.messages[2]).not.toHaveProperty('reasoning_content');
    expect(reasoningFieldOf('openaiCompatible')).toBe('reasoning_content');
    expect(reasoningFieldOf('openrouter')).toBe('reasoning');
    expect(sendsReasoningBack('openaiCompatible')).toBe(true);
    expect(sendsReasoningBack('openrouter')).toBe(true);
    for (const t of ['openai', 'chatgpt', 'anthropic', 'gemini'] as const) {
      expect(sendsReasoningBack(t), t).toBe(false);
      expect(reasoningFieldOf(t), t).toBeNull();
    }
    // Anthropic and Gemini never send it.
    expect(JSON.stringify(anthropicMessages(history))).not.toContain('look it up');
    expect(JSON.stringify(geminiContents(history))).not.toContain('look it up');
  });

  it('a reasoning-only reply cut short is not counted as 0 output tokens', () => {
    const sent = { system: 'Be brief.', messages: [{ role: 'user' as const, content: 'x'.repeat(40) }] };
    const e = new AiCallError('STREAM_ENDED', null, true, 'STREAM_ENDED_EARLY');
    expect(usageOrEstimate(null, sent, { text: '', reasoningChars: 4000 }, e).outputTokens).toBe(1000);
    expect(usageOrEstimate(null, sent, { text: '' }, e).outputTokens).toBe(0);
    // Even a failure that would count nothing counts the reasoning it received.
    expect(usageOrEstimate(null, sent, { text: '', reasoningChars: 8 }, new AiCallError('TIMEOUT', null, false)).outputTokens).toBe(2);
  });

  it('a redirect says so in its detail', async () => {
    fake.override = (_r, res) => {
      fake.override = null;
      res.writeHead(307, { location: 'http://169.254.169.254/' });
      res.end();
      return true;
    };
    await expect(run(openAiAdapter, compatible())).rejects.toMatchObject({ failure: 'BAD_RESPONSE', detail: 'REDIRECT', httpStatus: 307 });
  });
});
