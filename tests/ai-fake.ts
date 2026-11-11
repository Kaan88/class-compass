/**
 * A local fake model provider for the AI connection tests (S19a, D-179): one HTTP server on
 * 127.0.0.1 that speaks the Anthropic Messages, OpenAI Chat Completions and Gemini streaming formats
 * and OpenRouter's key exchange, records every request, and never reaches a real provider. Keys are
 * fake (`FAKE_KEYS`). With tools in the request it calls the first tool; without, it answers text.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_KEYS = {
  anthropic: 'sk-ant-fake-0123456789-S19A',
  openai: 'sk-fake-openai-0123456789-S19A',
  gemini: 'AIza-fake-gemini-0123456789-S19A',
  openrouter: 'sk-or-fake-0123456789-S19A',
  compatible: 'fake-local-key-0123456789-S19A',
  oauthIssued: 'sk-or-v1-fake-issued-by-oauth-S19A',
} as const;

export interface Recorded {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

const sse = (res: http.ServerResponse, events: Array<{ event?: string; data: unknown }>, crlf = false) => {
  const nl = crlf ? '\r\n' : '\n';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`${e.event ? `event: ${e.event}${nl}` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}${nl}${nl}`);
  res.end();
};

export function anthropicStream(res: http.ServerResponse, body: any) {
  const tool = body.tools?.[0];
  const events: Array<{ event?: string; data: unknown }> = [{ event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 21, output_tokens: 1 } } } }];
  if (tool) {
    events.push(
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Calling.' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_fake1', name: tool.name, input: {} } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"wo' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'rd": "ready"}' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } } },
    );
  } else {
    events.push(
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { event: 'ping', data: { type: 'ping' } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'rea' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'dy' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } } },
    );
  }
  events.push({ event: 'message_stop', data: { type: 'message_stop' } });
  sse(res, events);
}

export function openAiStream(res: http.ServerResponse, body: any, opts: { crlf?: boolean } = {}) {
  const tool = body.tools?.[0]?.function;
  const chunk = (delta: unknown, finish: string | null = null) => ({ data: { choices: [{ index: 0, delta, finish_reason: finish }] } });
  const events = tool
    ? [
        chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_fake1', type: 'function', function: { name: tool.name, arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"word":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"ready"}' } }] }),
        chunk({}, 'tool_calls'),
      ]
    : [chunk({ role: 'assistant', content: 'rea' }), chunk({ content: 'dy' }), chunk({}, 'stop')];
  sse(res, [...events, { data: { choices: [], usage: { prompt_tokens: 17, completion_tokens: 5 } } }, { data: '[DONE]' }], opts.crlf);
}

export function geminiStream(res: http.ServerResponse, body: any) {
  const decl = body.tools?.[0]?.functionDeclarations?.[0];
  const events = decl
    ? [{ data: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: decl.name, args: { word: 'ready' } }, thoughtSignature: 'sig-fake-1' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 6 } } }]
    : [
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking', thought: true }, { text: 'rea' }] } }] } },
        { data: { candidates: [{ content: { role: 'model', parts: [{ text: 'dy' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 2 } } },
      ];
  sse(res, events);
}

export class FakeProvider {
  server: http.Server;
  requests: Recorded[] = [];
  /** OpenRouter's key exchange: the challenge the test expects and the code it accepts. */
  expectChallenge: string | null = null;
  acceptCode = 'fake-openrouter-code';
  /** Models that answer 400 to a request with tools (like a local model without tool support). */
  noToolsModels: string[] = ['local-no-tools'];
  /** Overrides the next answers (status codes, malformed bodies…). */
  override: ((r: Recorded, res: http.ServerResponse) => boolean) | null = null;
  constructor() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = raw;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          /* form or text */
        }
        const r: Recorded = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body };
        this.requests.push(r);
        if (this.override?.(r, res)) return;
        this.answer(r, res);
      });
    });
  }

  private answer(r: Recorded, res: http.ServerResponse) {
    const deny = () => {
      res.writeHead(401, { 'content-type': 'application/json' });
      // A real provider may echo part of the key; the app must never pass this on.
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${String(r.headers.authorization ?? r.headers['x-api-key'] ?? '')}` } }));
    };
    // Gemini answers a wrong key with 400 and the reason API_KEY_INVALID (and echoes nothing useful).
    const geminiDeny = () => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            error: {
              code: 400,
              message: `API key not valid. Please pass a valid API key. (${String(r.headers['x-goog-api-key'] ?? '')})`,
              status: 'INVALID_ARGUMENT',
              details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
            },
          },
        ]),
      );
    };
    const bearer = String(r.headers.authorization ?? '').replace(/^Bearer /u, '');
    if (r.path === '/v1/messages') return r.headers['x-api-key'] === FAKE_KEYS.anthropic ? anthropicStream(res, r.body) : deny();
    if (r.path.endsWith('/chat/completions')) {
      if (!(Object.values(FAKE_KEYS) as string[]).includes(bearer)) return deny();
      // A small local server without tool support refuses any request that has `tools`.
      if (this.noToolsModels.includes(String(r.body?.model)) && r.body?.tools) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'tools are not supported by this model', type: 'invalid_request_error' } }));
      }
      return openAiStream(res, r.body);
    }
    if (/^\/v1beta\/models\/[^/:]+:streamGenerateContent\?alt=sse$/u.test(r.path)) return r.headers['x-goog-api-key'] === FAKE_KEYS.gemini ? geminiStream(res, r.body) : geminiDeny();
    if (r.path.endsWith('/auth/keys')) {
      const ok = r.body?.code === this.acceptCode && r.body?.code_challenge_method === 'S256' && this.expectChallenge === crypto.createHash('sha256').update(String(r.body?.code_verifier ?? '')).digest('base64url');
      res.writeHead(ok ? 200 : 403, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ok ? { key: FAKE_KEYS.oauthIssued, user_id: 'fake-user' } : { error: 'invalid code' }));
    }
    res.writeHead(404);
    res.end();
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
