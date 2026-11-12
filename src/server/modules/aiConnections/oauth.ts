/**
 * Signing in with a provider instead of pasting a key (S19a, D-179).
 *
 * OpenRouter (https://openrouter.ai/docs/use-cases/oauth-pkce): the browser goes to
 * `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`, the user
 * signs in and approves, OpenRouter sends the browser back to our callback with `code`, and the server
 * exchanges the code and the PKCE verifier at `POST /api/v1/auth/keys` for a key tied to that account.
 *
 * "Sign in with ChatGPT": the same shape (authorization code with PKCE at the addresses OpenAI gives
 * the app), only when `chatgptAvailable` (server configuration, off until OpenAI grants access).
 *
 * The callback is our own page `/ai-connections/return` on the main origin; it carries `state` (a
 * random 256-bit value; the server keeps only its HMAC) and posts it with the code after a button
 * press. The state is single use, expires after 10 minutes and works only for the account that
 * started it and for the one connection it was started for, so another person's code cannot be
 * slipped into our connection. The verifier is sealed at rest and never leaves the server.
 */
import crypto from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { chatgptAvailable } from '../../config.ts';
import { tx } from '../../db/client.ts';
import { aiConnections, aiOauthStates } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { openSecret, randomToken, sealSecret, tokenHash } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { AiCallError, aiRequest, readJson } from './http.ts';
import { chatgptTokenRequest, fixedAddress, PROVIDER_BASE, sealChatgptTokens, sealConnectionSecret } from './provider.ts';
import { assertTeachersAllowed, loadManaged, type Scope } from './service.ts';

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const OAUTH_PENDING_MAX = 5;
export const OPENROUTER_AUTH_PAGE = 'https://openrouter.ai/auth';
export const RETURN_PATH = '/ai-connections/return';
const VERIFIER_PURPOSE = 'ai-oauth-verifier';

const stateId = (pepper: string, state: string) => tokenHash(pepper, `ai-oauth-state:${state}`);
export const challengeOf = (verifier: string) => crypto.createHash('sha256').update(verifier).digest('base64url');

/** Starts a sign-in for an OpenRouter (or available ChatGPT) connection; returns where to send the browser. */
export function startOAuth(ctx: RequestContext, connectionId: string, scope: Scope): { authorizeUrl: string } {
  const user = requireUser(ctx);
  const row = loadManaged(ctx, connectionId, scope);
  // A teacher's own connection signs in only while the administrator allows own connections.
  if (scope === 'personal') assertTeachersAllowed(ctx.db);
  if (row.type !== 'openrouter' && row.type !== 'chatgpt') throw invalid('This connection uses a key', { reason: 'AI_OAUTH_NOT_FOR_TYPE' });
  if (row.type === 'chatgpt' && !chatgptAvailable(ctx.config)) throw new AppError('FEATURE_DISABLED', 'Sign in with ChatGPT is not available', { reason: 'AI_CHATGPT_NOT_AVAILABLE' });
  const now = ctx.now();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const id = stateId(ctx.config.SECRET_PEPPER, state);
  tx(ctx.db, () => {
    ctx.db.delete(aiOauthStates).where(lt(aiOauthStates.expiresAt, now - 24 * 60 * 60_000)).run();
    const pending = ctx.db.select({ n: sql<number>`count(*)` }).from(aiOauthStates).where(and(eq(aiOauthStates.userId, user.id), isNull(aiOauthStates.usedAt), sql`${aiOauthStates.expiresAt} > ${now}`)).get()?.n ?? 0;
    if (pending >= OAUTH_PENDING_MAX) throw new AppError('RATE_LIMITED', 'Too many sign-ins waiting', { reason: 'AI_OAUTH_TOO_MANY' });
    ctx.db
      .insert(aiOauthStates)
      .values({ id, userId: user.id, connectionId: row.id, verifierCipher: sealSecret(ctx.config.SECRET_PEPPER, VERIFIER_PURPOSE, id, verifier), createdAt: now, expiresAt: now + OAUTH_STATE_TTL_MS, usedAt: null })
      .run();
  });
  const returnUrl = `${ctx.config.origins.main}${RETURN_PATH}`;
  const challenge = challengeOf(verifier);
  if (row.type === 'openrouter') {
    const callback = `${returnUrl}?${new URLSearchParams({ state })}`;
    return { authorizeUrl: `${OPENROUTER_AUTH_PAGE}?${new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: 'S256' })}` };
  }
  const q = new URLSearchParams({ response_type: 'code', client_id: ctx.config.AI_CHATGPT_CLIENT_ID, redirect_uri: returnUrl, state, code_challenge: challenge, code_challenge_method: 'S256', ...(ctx.config.AI_CHATGPT_SCOPE ? { scope: ctx.config.AI_CHATGPT_SCOPE } : {}) });
  return { authorizeUrl: `${ctx.config.AI_CHATGPT_AUTHORIZE_URL}?${q}` };
}

/** Exchanges the code for the connection's secret. Every refusal of the state is the same 404. */
export async function finishOAuth(ctx: RequestContext, input: { state: string; code: string }) {
  const user = requireUser(ctx);
  const now = ctx.now();
  const id = stateId(ctx.config.SECRET_PEPPER, input.state);
  // Claimed in one statement before anything else, so a second use (a replay) finds nothing.
  const claimed = ctx.db
    .update(aiOauthStates)
    .set({ usedAt: now })
    .where(and(eq(aiOauthStates.id, id), eq(aiOauthStates.userId, user.id), isNull(aiOauthStates.usedAt), sql`${aiOauthStates.expiresAt} > ${now}`))
    .returning()
    .get();
  if (!claimed) throw notFound('Sign-in request');
  const verifier = openSecret(ctx.config.SECRET_PEPPER, VERIFIER_PURPOSE, id, claimed.verifierCipher);
  const row = ctx.db.select().from(aiConnections).where(eq(aiConnections.id, claimed.connectionId)).get();
  if (!verifier || !row || row.deletedAt !== null) throw notFound('Sign-in request');
  const scope: Scope = row.ownerUserId ? 'personal' : 'school';
  // The account must still manage the connection (an administrator for a school one, the owner for a personal one).
  if (scope === 'school' ? user.role !== 'admin' : row.ownerUserId !== user.id) throw notFound('Sign-in request');
  if (scope === 'personal') assertTeachersAllowed(ctx.db);
  let sealed: string;
  try {
    if (row.type === 'openrouter') {
      const base = fixedAddress(ctx, 'openrouter', PROVIDER_BASE.openrouter);
      const res = await aiRequest({
        url: `${base.url}/auth/keys`,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ code: input.code, code_verifier: verifier, code_challenge_method: 'S256' }),
        policy: base.policy,
      });
      const d = (await readJson(res)) as { key?: unknown };
      if (typeof d?.key !== 'string' || d.key.length < 8) throw new AiCallError('BAD_RESPONSE');
      sealed = sealConnectionSecret(ctx, row.id, d.key);
    } else if (row.type === 'chatgpt' && chatgptAvailable(ctx.config)) {
      const tokens = await chatgptTokenRequest(ctx, { grant_type: 'authorization_code', code: input.code, code_verifier: verifier, redirect_uri: `${ctx.config.origins.main}${RETURN_PATH}` });
      sealed = sealChatgptTokens(ctx, row.id, tokens);
    } else throw new AiCallError('NOT_AVAILABLE');
  } catch (e) {
    if (e instanceof AiCallError) throw invalid('The provider did not accept the sign-in', { reason: 'AI_OAUTH_FAILED', failure: e.failure });
    throw e;
  }
  // The connection may have been deleted while the code was exchanged: the key is then discarded,
  // never written to the deleted row, and nothing is audited as connected (audit 2026-11-12).
  const written = tx(ctx.db, () => {
    const done = ctx.db
      .update(aiConnections)
      .set({ secretCipher: sealed, secretSetAt: now, secretSource: 'oauth', updatedAt: now })
      .where(and(eq(aiConnections.id, row.id), isNull(aiConnections.deletedAt)))
      .returning({ id: aiConnections.id })
      .get();
    if (!done) return false;
    audit(ctx.db, ctx.actor, { action: 'ai_connection.connect', entity: 'ai_connection', entityId: row.id, after: { scope, type: row.type, via: 'oauth' } }, now);
    return true;
  });
  if (!written) throw notFound('Sign-in request');
  return { connectionId: row.id, scope, name: row.name };
}
