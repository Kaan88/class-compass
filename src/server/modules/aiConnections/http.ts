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

/**
 * Small JSON calls (model lists, OAuth): the time until the response headers arrive, and the longest
 * quiet gap after them. A chat request (`chat: true`) uses the first only for connecting (socket and
 * TLS) and then only the total limit: a model that thinks first can be silent for minutes before its
 * headers (a server that ignores `stream`) or between streamed pieces (audit 2026-11-12).
 */
export const AI_CONNECT_TIMEOUT_MS = 30_000;
export const AI_IDLE_TIMEOUT_MS = 60_000;
/** The longest one request may take in total, from sending it to the end of the streamed reply (10 minutes since 2026-11-12: a long reply such as a theme package from a model that thinks first). */
export const AI_TOTAL_TIMEOUT_MS = 10 * 60_000;
/** The most a provider may send in one reply (small JSON calls: model lists, OAuth). */
export const AI_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/**
 * The raw-byte backstop of a chat request (`chat: true`; D-203). A model that thinks first streams its
 * hidden reasoning one token per event of about 300 bytes (DeepSeek), so 65,536 output tokens can be
 * well over 8 MiB on the wire although little of it is kept. Memory stays bounded by the SSE line cap
 * (`SSE_MAX_LINE_CHARS`) and each adapter's cap on what it keeps (`AI_MAX_KEPT_CHARS`).
 */
export const AI_MAX_CHAT_RESPONSE_BYTES = 64 * 1024 * 1024;
/** The longest unfinished SSE line, and the most data one SSE event may carry (characters; D-203). */
export const SSE_MAX_LINE_CHARS = 1024 * 1024;
/**
 * The most a streaming adapter keeps of one reply (characters of text, tool-call arguments and reasoning
 * together; D-203): far above any real answer (65,536 tokens are about 260,000 characters), so going
 * over it means a runaway reply, which ends as `OUT_OF_TOKENS`.
 */
export const AI_MAX_KEPT_CHARS = 2 * 1024 * 1024;

/**
 * Non-personal detail of a failure, for the server log only (D-203): which check failed, never what
 * the provider sent.
 */
export type AiErrorDetail =
  | 'BODY_TOO_LARGE'
  | 'SSE_LINE_TOO_LONG'
  | 'BAD_SSE_JSON'
  | 'BAD_JSON_BODY'
  | 'NOT_AN_EVENT_STREAM'
  | 'STREAM_ENDED_EARLY'
  | 'KEPT_TOO_LARGE'
  | 'PROVIDER_FINISH'
  | 'STREAM_ERROR_EVENT'
  | 'REDIRECT'
  | 'BAD_TOKEN_REPLY';

/**
 * Counters of one streamed reply (D-203), exposed on a failure (`AiCallError.stats`) for the server log:
 * sizes and flags only, never text. `lastFinishReason` is the provider's finish reason when it is a plain
 * word (anything else is kept as `other`).
 */
export interface StreamStats {
  bytes: number;
  events: number;
  sawDone: boolean;
  lastFinishReason: string | null;
  sawUsage: boolean;
  reasoningChars: number;
  contentChars: number;
  toolCalls: number;
}
export const newStreamStats = (): StreamStats => ({ bytes: 0, events: 0, sawDone: false, lastFinishReason: null, sawUsage: false, reasoningChars: 0, contentChars: 0, toolCalls: 0 });
/** A finish reason as the counters keep it (a short plain word; anything else is `other`). */
export const finishWord = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,40}$/u.test(v) ? v : 'other');

/** Counts the bytes of a body as it is read. */
export async function* countBytes(body: AsyncIterable<Buffer>, stats: StreamStats): AsyncGenerator<Buffer> {
  for await (const c of body) {
    stats.bytes += c.length;
    yield c;
  }
}

/** Puts a stream's counters on a failure (another error passes unchanged). */
export function withStats(e: unknown, stats: StreamStats): unknown {
  if (e instanceof AiCallError && !e.stats) e.stats = { ...stats };
  return e;
}

/**
 * Throws `OUT_OF_TOKENS` (`KEPT_TOO_LARGE`) when an adapter has kept more of one reply than
 * `AI_MAX_KEPT_CHARS` (text, tool-call arguments and reasoning together).
 */
export function assertKept(stats: StreamStats, toolArgChars: number) {
  if (stats.contentChars + stats.reasoningChars + toolArgChars > AI_MAX_KEPT_CHARS) throw new AiCallError('OUT_OF_TOKENS', null, true, 'KEPT_TOO_LARGE');
}

export class AiCallError extends Error {
  readonly failure: AiFailure;
  readonly httpStatus: number | null;
  /** Which check failed (non-personal, for the server log). */
  readonly detail: AiErrorDetail | null;
  /** The stream's counters when it failed while streaming (set by the adapter). */
  stats: StreamStats | null = null;
  /**
   * Whether the request may have reached the provider: false when it failed before a connection was
   * made (refused address, unreachable host, stopped before sending) or before any provider request
   * (no key, a token that could not be refreshed). Token counting uses it: nothing sent counts nothing.
   */
  readonly sent: boolean;
  constructor(failure: AiFailure, httpStatus: number | null = null, sent = true, detail: AiErrorDetail | null = null) {
    super(`AI provider call failed: ${failure}${httpStatus ? ` (HTTP ${httpStatus})` : ''}${detail ? ` [${detail}]` : ''}`);
    this.name = 'AiCallError';
    this.failure = failure;
    this.httpStatus = httpStatus;
    this.sent = sent;
    this.detail = detail;
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

/** The error of a non-2xx answer (a redirect, which is never followed, says so in its detail). */
export const statusError = (status: number) => new AiCallError(failureOfStatus(status), status, true, status >= 300 && status < 400 ? 'REDIRECT' : null);

export interface AiHttpRequest {
  url: string;
  method?: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
  policy: NetPolicy;
  signal?: AbortSignal | undefined;
  /** The total limit for this request (default `AI_TOTAL_TIMEOUT_MS`); tests set a short one. */
  totalTimeoutMs?: number;
  /** A chat request: connecting is limited, waiting for the headers and quiet gaps only by the total limit. */
  chat?: boolean;
  /** Tests only: shorter connect and idle limits (defaults `AI_CONNECT_TIMEOUT_MS`, `AI_IDLE_TIMEOUT_MS`). */
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
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
      return reject(new AiCallError('URL_NOT_ALLOWED', null, false));
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return reject(new AiCallError('URL_NOT_ALLOWED', null, false));
    if (u.protocol === 'http:' && req.policy !== 'local') return reject(new AiCallError('URL_NOT_ALLOWED', null, false));
    const host = u.hostname.replace(/^\[|\]$/gu, '');
    // A literal address never goes through `lookup`, so it is checked here.
    if (net.isIP(host) && !addressAllowed(host, req.policy)) return reject(new AiCallError('URL_NOT_ALLOWED', null, false));
    if (req.signal?.aborted) return reject(new AiCallError('TIMEOUT', null, false));
    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    // Set once the socket is connected (and TLS is set up): a failure before it never reached the provider.
    let connected = false;
    const connectMs = req.connectTimeoutMs ?? AI_CONNECT_TIMEOUT_MS;
    let connecting: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown) => {
      clearTimeout(total);
      clearTimeout(connecting);
      if (settled) return;
      settled = true;
      const failure: AiFailure = e instanceof AiCallError ? e.failure : (e as Error)?.name === 'AddressRefused' || e instanceof AddressRefused ? 'URL_NOT_ALLOWED' : 'UNREACHABLE';
      reject(e instanceof AiCallError && connected ? e : new AiCallError(failure, e instanceof AiCallError ? e.httpStatus : null, connected, e instanceof AiCallError ? e.detail : null));
    };
    const r = lib.request(
      u,
      {
        method: req.method ?? 'POST',
        headers: { 'user-agent': 'class-compass-assistant', ...req.headers, ...(req.body !== undefined ? { 'content-length': String(Buffer.byteLength(req.body)) } : {}) },
        lookup: policyLookup(req.policy),
        agent: false,
        // A chat request is not limited by socket silence (see `AI_CONNECT_TIMEOUT_MS`).
        ...(req.chat ? {} : { timeout: connectMs }),
      },
      (res) => {
        if (settled) {
          res.resume();
          return;
        }
        settled = true;
        clearTimeout(connecting);
        if (!req.chat) r.setTimeout(req.idleTimeoutMs ?? AI_IDLE_TIMEOUT_MS);
        res.on('close', () => clearTimeout(total));
        let size = 0;
        const max = req.chat ? AI_MAX_CHAT_RESPONSE_BYTES : AI_MAX_RESPONSE_BYTES;
        const body = (async function* () {
          try {
            for await (const chunk of res as AsyncIterable<Buffer>) {
              size += chunk.length;
              if (size > max) throw new AiCallError('BAD_RESPONSE', null, true, 'BODY_TOO_LARGE');
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
    // The total limit runs from the start, not from the headers: a server that never finishes its
    // headers (a slow trickle, or a `100 Continue` every few seconds) keeps the socket busy, so the
    // idle timeout alone would never end it (security review of D-179). Only callbacks that run
    // after this line read `total`.
    const total = setTimeout(() => r.destroy(new AiCallError('TIMEOUT')), req.totalTimeoutMs ?? AI_TOTAL_TIMEOUT_MS);
    if (req.chat) {
      // Only connecting (TCP, and TLS for https) has the short limit.
      connecting = setTimeout(() => r.destroy(new AiCallError('TIMEOUT')), connectMs);
    }
    r.once('socket', (socket) =>
      socket.once(u.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
        connected = true;
        clearTimeout(connecting);
      }),
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
      throw new AiCallError('BAD_RESPONSE', null, true, 'BODY_TOO_LARGE');
    }
    parts.push(c);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** Reads a JSON reply; throws `AiCallError` for a non-2xx status (body discarded) or a body that is not JSON. */
export async function readJson(res: AiHttpResponse): Promise<unknown> {
  if (res.status < 200 || res.status >= 300) {
    res.cancel();
    throw statusError(res.status);
  }
  try {
    return JSON.parse(await readText(res));
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    throw new AiCallError('BAD_RESPONSE', null, true, 'BAD_JSON_BODY');
  }
}

/** One Server-Sent Event: its `event:` name (if any) and its `data:` lines joined. */
export interface SseEvent {
  event: string | null;
  data: string;
}

const tooLong = () => new AiCallError('BAD_RESPONSE', null, true, 'SSE_LINE_TOO_LONG');

/**
 * Splits a byte stream into Server-Sent Events (LF or CRLF line ends, multi-line data, comments skipped).
 * An unfinished line, or one event's data, longer than `SSE_MAX_LINE_CHARS` is a `BAD_RESPONSE`
 * (`SSE_LINE_TOO_LONG`, D-203), so a stream without line ends cannot grow the buffer up to the byte cap.
 */
export async function* sseEvents(body: AsyncIterable<Buffer>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | null = null;
  let data: string[] = [];
  let dataChars = 0;
  const flushLine = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = null;
      data = [];
      dataChars = 0;
      return;
    }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /u, '');
    if (field === 'event') event = value;
    else if (field === 'data') {
      dataChars += value.length + 1;
      if (dataChars > SSE_MAX_LINE_CHARS) throw tooLong();
      data.push(value);
    }
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
    if (buf.length > SSE_MAX_LINE_CHARS) throw tooLong();
  }
  buf += decoder.decode();
  if (buf) yield* flushLine(buf);
  yield* flushLine('');
}
