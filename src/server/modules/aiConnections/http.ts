/**
 * Outgoing requests to model providers (S19a, D-179). One small client on `node:http(s)` so every
 * request gets the same safety rules: the socket's address is checked at connect time against the
 * connection's policy (`policyLookup`, so DNS rebinding cannot reach the school's network or a cloud
 * metadata service), literal addresses are checked before connecting, redirects are never followed,
 * no cookies are sent, the response is size-capped and every phase has a time limit.
 *
 * Errors carry an `AiFailure` code and at most the HTTP status: never the provider's message or body,
 * which can echo part of a key.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AiFailure } from '../../../shared/aiConnections.ts';
import { AddressRefused, addressAllowed, policyLookup, type NetPolicy } from './urlSafety.ts';

/** Time until the response headers arrive, and the longest quiet gap while a reply streams. */
export const AI_CONNECT_TIMEOUT_MS = 30_000;
export const AI_IDLE_TIMEOUT_MS = 60_000;
/** The longest one streamed reply may take in total. */
export const AI_TOTAL_TIMEOUT_MS = 5 * 60_000;
/** The most a provider may send in one reply. */
export const AI_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class AiCallError extends Error {
  readonly failure: AiFailure;
  readonly httpStatus: number | null;
  constructor(failure: AiFailure, httpStatus: number | null = null) {
    super(`AI provider call failed: ${failure}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    this.name = 'AiCallError';
    this.failure = failure;
    this.httpStatus = httpStatus;
  }
}

/** The failure an HTTP status means (never the provider's text). */
export function failureOfStatus(status: number): AiFailure {
  if (status === 401 || status === 403) return 'KEY_REJECTED';
  if (status === 404) return 'MODEL_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 300 && status < 400) return 'BAD_RESPONSE';
  return 'PROVIDER_ERROR';
}

export interface AiHttpRequest {
  url: string;
  method?: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
  policy: NetPolicy;
  signal?: AbortSignal | undefined;
}

export interface AiHttpResponse {
  status: number;
  contentType: string;
  /** The body in pieces, size-capped. Read it to the end or call `cancel`. */
  body: AsyncIterable<Buffer>;
  cancel: () => void;
}

/** Sends one request. Resolves when the headers arrive (any status); rejects with `AiCallError`. */
export function aiRequest(req: AiHttpRequest): Promise<AiHttpResponse> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(req.url);
    } catch {
      return reject(new AiCallError('URL_NOT_ALLOWED'));
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return reject(new AiCallError('URL_NOT_ALLOWED'));
    if (u.protocol === 'http:' && req.policy !== 'local') return reject(new AiCallError('URL_NOT_ALLOWED'));
    const host = u.hostname.replace(/^\[|\]$/gu, '');
    // A literal address never goes through `lookup`, so it is checked here.
    if (net.isIP(host) && !addressAllowed(host, req.policy)) return reject(new AiCallError('URL_NOT_ALLOWED'));
    if (req.signal?.aborted) return reject(new AiCallError('TIMEOUT'));
    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e instanceof AiCallError ? e : (e as Error)?.name === 'AddressRefused' || e instanceof AddressRefused ? new AiCallError('URL_NOT_ALLOWED') : new AiCallError('UNREACHABLE'));
    };
    const r = lib.request(
      u,
      {
        method: req.method ?? 'POST',
        headers: { 'user-agent': 'class-compass-assistant', ...req.headers, ...(req.body !== undefined ? { 'content-length': String(Buffer.byteLength(req.body)) } : {}) },
        lookup: policyLookup(req.policy),
        agent: false,
        timeout: AI_CONNECT_TIMEOUT_MS,
      },
      (res) => {
        if (settled) {
          res.resume();
          return;
        }
        settled = true;
        r.setTimeout(AI_IDLE_TIMEOUT_MS);
        const total = setTimeout(() => r.destroy(new AiCallError('TIMEOUT')), AI_TOTAL_TIMEOUT_MS);
        res.on('close', () => clearTimeout(total));
        let size = 0;
        const body = (async function* () {
          try {
            for await (const chunk of res as AsyncIterable<Buffer>) {
              size += chunk.length;
              if (size > AI_MAX_RESPONSE_BYTES) throw new AiCallError('BAD_RESPONSE');
              yield chunk;
            }
          } catch (e) {
            throw e instanceof AiCallError ? e : (e as Error)?.name === 'AiCallError' ? e : new AiCallError('UNREACHABLE');
          } finally {
            clearTimeout(total);
            if (!res.complete) r.destroy();
          }
        })();
        resolve({ status: res.statusCode ?? 0, contentType: String(res.headers['content-type'] ?? ''), body, cancel: () => r.destroy() });
      },
    );
    r.on('timeout', () => r.destroy(new AiCallError('TIMEOUT')));
    r.on('error', fail);
    req.signal?.addEventListener('abort', () => r.destroy(new AiCallError('TIMEOUT')), { once: true });
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}

/** Reads a whole (small) body as text, at most `max` bytes. */
export async function readText(res: AiHttpResponse, max = 1024 * 1024): Promise<string> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > max) {
      res.cancel();
      throw new AiCallError('BAD_RESPONSE');
    }
    parts.push(c);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** Reads a JSON reply; throws `AiCallError` for a non-2xx status (body discarded) or a body that is not JSON. */
export async function readJson(res: AiHttpResponse): Promise<unknown> {
  if (res.status < 200 || res.status >= 300) {
    res.cancel();
    throw new AiCallError(failureOfStatus(res.status), res.status);
  }
  try {
    return JSON.parse(await readText(res));
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    throw new AiCallError('BAD_RESPONSE');
  }
}

/** One Server-Sent Event: its `event:` name (if any) and its `data:` lines joined. */
export interface SseEvent {
  event: string | null;
  data: string;
}

/** Splits a byte stream into Server-Sent Events (LF or CRLF line ends, multi-line data, comments skipped). */
export async function* sseEvents(body: AsyncIterable<Buffer>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | null = null;
  let data: string[] = [];
  const flushLine = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = null;
      data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /u, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.search(/\r\n|\n|\r/u)) !== -1) {
      // A CR at the very end may be the first half of a CRLF split across chunks: wait for the next one.
      if (buf[nl] === '\r' && nl === buf.length - 1) break;
      const line = buf.slice(0, nl);
      buf = buf.slice(buf[nl] === '\r' && buf[nl + 1] === '\n' ? nl + 2 : nl + 1);
      yield* flushLine(line);
    }
  }
  buf += decoder.decode();
  if (buf) yield* flushLine(buf);
  yield* flushLine('');
}
