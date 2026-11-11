/**
 * Provider adapters (S19a, D-179): each wire format against a local fake server (never a real
 * provider): streaming text, tool calls assembled from pieces, usage, the translation of the internal
 * tool format (from the MCP tool definitions) to Anthropic tools, OpenAI functions and Gemini function
 * declarations, message history translation, and failures that never carry the provider's text.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anthropicAdapter, anthropicMessages } from '../../src/server/modules/aiConnections/adapters/anthropic.ts';
import { geminiAdapter, geminiContents, geminiSchema } from '../../src/server/modules/aiConnections/adapters/gemini.ts';
import { openAiAdapter, openAiMessages } from '../../src/server/modules/aiConnections/adapters/openai.ts';
import type { Adapter, ChatEvent, ChatMessage, ProviderTarget, ToolDefinition } from '../../src/server/modules/aiConnections/adapters/types.ts';
import { AiCallError, sseEvents } from '../../src/server/modules/aiConnections/http.ts';
import { toolDefinitions } from '../../src/server/modules/aiConnections/tools.ts';
import { allTools } from '../../src/server/modules/mcp/registry.ts';
import { FAKE_KEYS, FakeProvider, openAiStream } from '../ai-fake.ts';
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

describe('Anthropic Messages adapter', () => {
  it('streams text, usage and the stop reason', async () => {
    const es = await run(anthropicAdapter, target(FAKE_KEYS.anthropic));
    expect(textOf(es)).toBe('ready');
    expect(es.find((e) => e.type === 'usage')).toEqual({ type: 'usage', inputTokens: 21, outputTokens: 3 });
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
    expect(es.find((e) => e.type === 'usage')).toEqual({ type: 'usage', inputTokens: 17, outputTokens: 5 });
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
    expect(plain.find((e) => e.type === 'usage')).toEqual({ type: 'usage', inputTokens: 3, outputTokens: 4 });
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
    await expect(run(openAiAdapter, target(FAKE_KEYS.openai))).rejects.toMatchObject({ failure: 'BAD_RESPONSE' });
  });
});

describe('Gemini adapter', () => {
  it('streams text (thought parts left out) and usage', async () => {
    const es = await run(geminiAdapter, target(FAKE_KEYS.gemini));
    expect(textOf(es)).toBe('ready');
    expect(es.find((e) => e.type === 'usage')).toEqual({ type: 'usage', inputTokens: 30, outputTokens: 2 });
    const r = last();
    expect(r.path).toBe('/v1beta/models/fake-model:streamGenerateContent?alt=sse');
    expect(r.headers['x-goog-api-key']).toBe(FAKE_KEYS.gemini);
    expect(r.body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(r.body.generationConfig).toEqual({ maxOutputTokens: 50 });
  });

  it('returns function calls with their thought signature and sends function declarations', async () => {
    const es = await run(geminiAdapter, target(FAKE_KEYS.gemini), [TOOL]);
    expect(callsOf(es)).toEqual([{ id: 'call_0', name: 'connection_check', arguments: { word: 'ready' }, signature: 'sig-fake-1' }]);
    expect(es[es.length - 1]).toEqual({ type: 'done', stop: 'toolUse' });
    expect(last().body.tools).toEqual([{ functionDeclarations: [{ name: 'connection_check', description: 'Test tool', parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } }] }]);
  });

  it('sends the signature back and tool results as functionResponse parts', () => {
    const c = geminiContents([
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'Let me look.', toolCalls: [{ id: 'call_0', name: 'x', arguments: { a: 1 }, signature: 'sig' }] },
      { role: 'tool', toolCallId: 'call_0', name: 'x', content: 'done' },
    ]);
    expect(c).toEqual([
      { role: 'user', parts: [{ text: 'Q' }] },
      { role: 'model', parts: [{ text: 'Let me look.' }, { functionCall: { name: 'x', args: { a: 1 } }, thoughtSignature: 'sig' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'x', response: { content: 'done' } } }] },
    ]);
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
});
