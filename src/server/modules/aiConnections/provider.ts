/**
 * From a stored connection to a request (S19a, D-179): the secret is opened only here, just before a
 * request, and never leaves the process; the address and its network policy come from the type (the
 * providers' fixed https APIs, public addresses only) or from the administrator's base URL (local
 * addresses only when ticked). `streamChat` is the entry point for the assistant's agent loop (S19b).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { WIRE_FORMAT, type AiConnectionType } from '../../../shared/aiConnections.ts';
import { chatgptAvailable } from '../../config.ts';
import { aiConnections } from '../../db/schema.ts';
import type { AppDeps } from '../../lib/context.ts';
import { openSecret, sealSecret } from '../../lib/crypto.ts';
import { anthropicAdapter } from './adapters/anthropic.ts';
import { geminiAdapter } from './adapters/gemini.ts';
import { openAiAdapter } from './adapters/openai.ts';
import type { Adapter, ChatEvent, ChatMessage, ProviderTarget, ToolDefinition } from './adapters/types.ts';
import { AiCallError, aiRequest, readJson } from './http.ts';
import { checkBaseUrl, type NetPolicy } from './urlSafety.ts';

export type ConnectionRow = typeof aiConnections.$inferSelect;

/** The HKDF purpose of connection secrets; the row id is the AAD (a secret copied to another row does not open). */
export const SECRET_PURPOSE = 'ai-connection-secret';
export const sealConnectionSecret = (deps: Pick<AppDeps, 'config'>, id: string, secret: string) => sealSecret(deps.config.SECRET_PEPPER, SECRET_PURPOSE, id, secret);
export const openConnectionSecret = (deps: Pick<AppDeps, 'config'>, row: Pick<ConnectionRow, 'id' | 'secretCipher'>) => openSecret(deps.config.SECRET_PEPPER, SECRET_PURPOSE, row.id, row.secretCipher);

/** The providers' own APIs (used when tests do not inject a local fake). */
export const PROVIDER_BASE: Record<'anthropic' | 'openai' | 'gemini' | 'openrouter', string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api/v1',
};

const ADAPTERS: Record<(typeof WIRE_FORMAT)[AiConnectionType], Adapter> = { anthropic: anthropicAdapter, openai: openAiAdapter, gemini: geminiAdapter };

/** A fixed address, or the test's local fake for it (which may be on loopback). */
export function fixedAddress(deps: Pick<AppDeps, 'aiProviderUrls'>, key: keyof NonNullable<AppDeps['aiProviderUrls']>, fallback: string): { url: string; policy: NetPolicy } {
  const override = deps.aiProviderUrls?.[key];
  return override ? { url: override.replace(/\/+$/u, ''), policy: 'local' } : { url: fallback.replace(/\/+$/u, ''), policy: 'public' };
}

/** "Sign in with ChatGPT" keeps its tokens as one sealed JSON value. */
interface ChatgptTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

const parseTokens = (raw: string | null): ChatgptTokens | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ChatgptTokens;
    return typeof v.accessToken === 'string' ? v : null;
  } catch {
    return null;
  }
};

/** Exchanges an authorization code or a refresh token at the ChatGPT token address (form body, public client with PKCE). */
export async function chatgptTokenRequest(deps: AppDeps, params: Record<string, string>): Promise<ChatgptTokens> {
  const token = fixedAddress(deps, 'chatgptToken', deps.config.AI_CHATGPT_TOKEN_URL ?? '');
  const res = await aiRequest({
    url: token.url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: deps.config.AI_CHATGPT_CLIENT_ID, ...params }).toString(),
    policy: token.policy,
  });
  const d = (await readJson(res)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof d?.access_token !== 'string' || !d.access_token) throw new AiCallError('BAD_RESPONSE');
  return {
    accessToken: d.access_token,
    refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : null,
    expiresAt: typeof d.expires_in === 'number' ? deps.now() + d.expires_in * 1000 : null,
  };
}

export const sealChatgptTokens = (deps: AppDeps, id: string, t: ChatgptTokens) => sealConnectionSecret(deps, id, JSON.stringify(t));

/** The ChatGPT access token, refreshed (and stored again) when it is about to expire. */
async function chatgptAccessToken(deps: AppDeps, row: ConnectionRow): Promise<string> {
  const tokens = parseTokens(openConnectionSecret(deps, row));
  if (!tokens) throw new AiCallError('NEEDS_KEY');
  if (tokens.expiresAt === null || tokens.expiresAt - deps.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new AiCallError('KEY_REJECTED');
  const fresh = await chatgptTokenRequest(deps, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
  const next = { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken };
  // The connection may have been deleted while the token was refreshed: the new token is then
  // discarded, never written to the deleted row and never used (like `finishOAuth`).
  const written = deps.db
    .update(aiConnections)
    .set({ secretCipher: sealChatgptTokens(deps, row.id, next), updatedAt: deps.now() })
    .where(and(eq(aiConnections.id, row.id), isNull(aiConnections.deletedAt)))
    .returning({ id: aiConnections.id })
    .get();
  if (!written) throw new AiCallError('NEEDS_KEY');
  return next.accessToken;
}

/** Where a connection's requests go, with what secret. Throws `AiCallError` (NEEDS_KEY, NOT_AVAILABLE, URL_NOT_ALLOWED). */
export async function targetOf(deps: AppDeps, row: ConnectionRow): Promise<ProviderTarget> {
  switch (row.type) {
    case 'anthropic':
    case 'openai':
    case 'gemini':
    case 'openrouter': {
      const secret = openConnectionSecret(deps, row);
      if (!secret) throw new AiCallError('NEEDS_KEY');
      const a = fixedAddress(deps, row.type, PROVIDER_BASE[row.type]);
      return { baseUrl: a.url, policy: a.policy, secret, maxTokensField: row.type === 'openai' ? 'max_completion_tokens' : 'max_tokens' };
    }
    case 'openaiCompatible': {
      // Checked again on every use, in case the rules changed since it was saved.
      const checked = checkBaseUrl(row.baseUrl ?? '', row.localNetwork);
      if (!checked.ok) throw new AiCallError('URL_NOT_ALLOWED');
      return { baseUrl: checked.url, policy: row.localNetwork ? 'local' : 'public', secret: openConnectionSecret(deps, row), maxTokensField: 'max_tokens' };
    }
    case 'chatgpt': {
      if (!chatgptAvailable(deps.config)) throw new AiCallError('NOT_AVAILABLE');
      const a = fixedAddress(deps, 'chatgpt', deps.config.AI_CHATGPT_API_BASE ?? '');
      return { baseUrl: a.url, policy: a.policy, secret: await chatgptAccessToken(deps, row), maxTokensField: 'max_completion_tokens' };
    }
  }
}

/**
 * The output cap when the caller gives none. Reasoning models count their hidden thinking against it
 * (OpenAI's o-series and gpt-5, Gemini 2.5 and later), so it is well above a short answer; it stays at
 * 4096 because some older models refuse a larger cap.
 */
export const DEFAULT_MAX_TOKENS = 4096;

export interface ChatRequest {
  connection: ConnectionRow;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** The total limit of the request (default `AI_TOTAL_TIMEOUT_MS`): the Test button keeps it short. */
  timeoutMs?: number;
}

/**
 * Streams one model reply through the connection's adapter (S19b's agent loop calls this after
 * `beginAssistantMessage` and records the `usage` event with `recordTokens`). Errors are `AiCallError`s.
 */
export async function* streamChat(deps: AppDeps, req: ChatRequest): AsyncGenerator<ChatEvent> {
  let target: ProviderTarget;
  try {
    target = await targetOf(deps, req.connection);
  } catch (e) {
    // No chat request was made (no key, an address refused, a token refresh that failed).
    throw e instanceof AiCallError ? new AiCallError(e.failure, e.httpStatus, false) : e;
  }
  yield* ADAPTERS[WIRE_FORMAT[req.connection.type]]({ target, model: req.model, system: req.system, messages: req.messages, tools: req.tools, maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, signal: req.signal, timeoutMs: req.timeoutMs });
}
