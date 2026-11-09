/**
 * The OAuth 2.1 authorization server for AI apps (S14h2, D-160), on the main origin (the issuer):
 *
 * - Discovery: Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource` and
 *   `/.well-known/oauth-protected-resource/mcp`, Authorization Server Metadata (RFC 8414) at
 *   `/.well-known/oauth-authorization-server`. Readable from any origin (CORS `*`, never credentials):
 *   they are public and hold nothing about the school.
 * - `/oauth/register`: Dynamic Client Registration (RFC 7591), public clients only, redirect addresses
 *   https on an allowed host or http loopback; rate-limited per address; unused registrations expire.
 * - `/oauth/authorize`: response_type `code`, PKCE `S256` only, `resource` must be `/mcp` (RFC 8707),
 *   an exact redirect match (loopback: any port, RFC 8252). Until the client and its redirect address
 *   are known, errors are shown on our own page and never redirected; afterwards they go back to the
 *   app with `state`. The request waits in `oauth_requests` for the consent page (`/oauth/consent`).
 * - `/oauth/token`: `authorization_code` (60-second single-use codes bound to the client, account,
 *   redirect address and PKCE challenge; a reused code ends the connection) and `refresh_token`
 *   (rotated on every use; a reused one ends the connection, unless it is a concurrent retry: rotated
 *   less than 30 seconds ago and its successor not yet rotated). Access tokens last an hour and never
 *   outlive the consent. Client authentication `none`; errors as RFC 6749 JSON, `no-store`.
 * - `/oauth/revoke`: RFC 7009. A refresh token ends its connection; an access token ends itself.
 *
 * All of it answers 404 while the school's AI tools switch is off (the authorize step shows our page).
 * No token, code or verifier is ever logged (the app redacts them and logs no request bodies).
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import * as O from '../../../../shared/contracts/oauth.ts';
import type { OAuthPageError } from '../../../../shared/contracts/oauth.ts';
import { MCP_SCOPES, MCP_TOKEN_PREFIX, OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_PATHS, OAUTH_REFRESH_PREFIX, OAUTH_REFRESH_REUSE_GRACE_SECONDS, OAUTH_REQUEST_MINUTES, OAUTH_WELL_KNOWN, type McpScope } from '../../../../shared/mcp.ts';
import { tx } from '../../../db/client.ts';
import { mcpTokens, oauthClients, oauthCodes, oauthGrants, oauthRefreshTokens, oauthRequests, users } from '../../../db/schema.ts';
import { audit } from '../../../lib/audit.ts';
import type { AppDeps } from '../../../lib/context.ts';
import { newId, randomToken, timingSafeEqualStr, tokenHash } from '../../../lib/crypto.ts';
import { AppError } from '../../../lib/errors.ts';
import { contextFor, recordEndpoint } from '../../../lib/http.ts';
import { aiSettings } from '../tokens.ts';
import { checkRedirectUri, isOurResource, matchRedirectUri, mcpResource } from './redirects.ts';
import { cleanClientName, ClientMetadataError, grantExpiry, grantLive, makeRoomForRegistration, pruneOAuth, redirectHosts, resolveClient, revokeGrants, touchClient, type ClientRow, type GrantRow } from './store.ts';

const SYSTEM = { type: 'system' as const, id: null };
const STATE_MAX = 512;
const FORM_MAX_BYTES = 16 * 1024;

/** The browser that opened `/oauth/authorize` carries this cookie to the consent page (SameSite=Lax, 15 minutes). */
export const oauthBrowserCookie = (deps: Pick<AppDeps, 'config'>) => (deps.config.isProd ? '__Host-ccoa' : 'ccoa');
export const browserHash = (deps: Pick<AppDeps, 'config'>, nonce: string) => tokenHash(deps.config.SECRET_PEPPER, `oauth-browser:${nonce}`);

type Params = Record<string, string>;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Request parameters as single strings; a repeated or non-string parameter makes the request invalid (RFC 6749 §3.1). */
function single(raw: unknown): Params | null {
  if (!isRecord(raw)) return {};
  const out: Params = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') return null;
    out[k] = v;
  }
  return out;
}

/** application/x-www-form-urlencoded → an object; a repeated key becomes an array (refused by `single`). */
function parseForm(body: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/** S256: BASE64URL(SHA256(code_verifier)) compared in constant time; the verifier must be 43–128 unreserved characters (RFC 7636). */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/u.test(verifier)) return false;
  return timingSafeEqualStr(crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url'), challenge);
}

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');

/** An RFC 6749 error answer. */
function oauthError(reply: FastifyReply, status: number, error: string, description: string) {
  return noStore(reply).status(status).type('application/json').send({ error, error_description: description });
}

const notAvailable = (reply: FastifyReply) => oauthError(reply, 404, 'not_found', 'AI tools are switched off at this school');

/** The app's redirect address with our parameters added (its own query kept). */
export function redirectWith(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** Scope words of a request: known ones, `offline_access` dropped, at most 20 words of at most 64 characters. */
export function requestedScopes(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === '') return [];
  const words = raw.trim().split(/ +/u);
  if (words.length > 20 || words.some((w) => w.length > 64 || !/^[\x21\x23-\x5b\x5d-\x7e]+$/u.test(w))) return null;
  return [...new Set(words)];
}

/** Issue an access token (an `oauth` row of `mcp_tokens` in the connection's family) and a new refresh token. Call inside a transaction. */
function issueTokens(deps: AppDeps, grant: GrantRow, client: ClientRow, scopes: readonly string[], now: number, capDays: number) {
  const access = `${MCP_TOKEN_PREFIX}${randomToken(32)}`;
  const refresh = `${OAUTH_REFRESH_PREFIX}${randomToken(32)}`;
  const expiresAt = Math.min(now + OAUTH_ACCESS_TOKEN_SECONDS * 1000, grantExpiry(grant, capDays));
  deps.db
    .insert(mcpTokens)
    .values({
      id: newId(),
      kind: 'oauth',
      familyId: grant.id,
      clientId: client.id,
      userId: grant.userId,
      name: grant.clientName,
      tokenHash: tokenHash(deps.config.SECRET_PEPPER, access),
      prefix: access.slice(0, MCP_TOKEN_PREFIX.length + 4),
      scopesJson: [...scopes],
      privacyMode: grant.privacyMode,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    })
    .run();
  deps.db.insert(oauthRefreshTokens).values({ id: newId(), grantId: grant.id, tokenHash: tokenHash(deps.config.SECRET_PEPPER, refresh), createdAt: now, rotatedAt: null }).run();
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((expiresAt - now) / 1000)),
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

type RefreshRow = typeof oauthRefreshTokens.$inferSelect;

/**
 * Is this rotated refresh token a concurrent retry rather than a copy? Yes when it was rotated less
 * than OAUTH_REFRESH_REUSE_GRACE_SECONDS ago and no refresh token issued after it has been rotated since
 * (its successor is still unused). Such a retry gets tokens of the same connection (D-160 S14h2 review:
 * the SDK client refreshes once per concurrent request after the hourly access token expired).
 */
function concurrentRetry(deps: AppDeps, rt: RefreshRow, now: number): boolean {
  if (rt.rotatedAt === null || now < rt.rotatedAt || now - rt.rotatedAt > OAUTH_REFRESH_REUSE_GRACE_SECONDS * 1000) return false;
  const laterUsed = deps.db
    .select({ id: oauthRefreshTokens.id })
    .from(oauthRefreshTokens)
    .where(and(eq(oauthRefreshTokens.grantId, rt.grantId), isNotNull(oauthRefreshTokens.rotatedAt), sql`rowid > (select rowid from ${oauthRefreshTokens} where id = ${rt.id})`))
    .get();
  return !laterUsed;
}

/** End a connection because a code or refresh token was misused (audited as the system). */
function endForMisuse(deps: AppDeps, grantId: string, reason: 'code_reuse' | 'code_misuse' | 'refresh_reuse' | 'refresh_misuse', now: number) {
  tx(deps.db, () => {
    const n = revokeGrants(deps.db, [grantId], now, null, reason);
    if (n) audit(deps.db, SYSTEM, { action: 'oauth.connection_end', entity: 'oauth_grant', entityId: grantId, after: { reason } }, now);
  });
}

export function registerOAuthProtocol(app: FastifyInstance, deps: AppDeps) {
  for (const ep of [O.oauthResourceMetadata, O.oauthResourceMetadataMcp, O.oauthServerMetadata, O.oauthRegister, O.oauthAuthorize, O.oauthToken, O.oauthRevoke]) recordEndpoint(ep);
  const origin = deps.config.origins.main;
  const enabled = () => aiSettings(deps.db).mcpEnabled;

  const resourceMetadata = () => ({
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Class Compass',
    resource_documentation: `${origin}/help?guide=ai-tools`,
  });
  const serverMetadata = () => ({
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_PATHS.token}`,
    registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${origin}${OAUTH_PATHS.revoke}`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/help?guide=ai-tools`,
  });

  void app.register(async (s) => {
    s.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: FORM_MAX_BYTES }, (_req, body, done) => done(null, parseForm(String(body))));
    // Errors before a handler runs (a body that is not JSON, too large, too many requests) in OAuth form;
    // the app's own refusals (a bearer token, a foreign Origin) keep the app's error format.
    s.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
      const status = err.statusCode ?? 500;
      if (status === 429) return oauthError(reply, 429, 'temporarily_unavailable', 'Too many requests; try again later');
      if (status >= 400 && status < 500) return oauthError(reply, status === 415 ? 400 : status, 'invalid_request', 'The request could not be read');
      req.log.error({ err }, 'oauth request failed');
      return oauthError(reply, 500, 'server_error', 'Something went wrong');
    });

    // ------------------------------------------------------------ discovery (RFC 9728, RFC 8414)
    const discovery = (path: string, doc: () => unknown) => {
      s.get(path, (req, reply) => {
        contextFor(deps, req, 'oauth');
        reply.header('Access-Control-Allow-Origin', '*');
        if (!enabled()) return notAvailable(reply);
        return reply.header('Cache-Control', 'no-store').type('application/json').send(doc());
      });
      // Browser-based clients send MCP-Protocol-Version, which needs a CORS preflight.
      s.options(path, (_req, reply) =>
        reply.status(204).header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Methods', 'GET').header('Access-Control-Allow-Headers', 'mcp-protocol-version, accept').header('Access-Control-Max-Age', '600').send(),
      );
    };
    discovery(OAUTH_WELL_KNOWN.resource, resourceMetadata);
    discovery(OAUTH_WELL_KNOWN.resourceMcp, resourceMetadata);
    discovery(OAUTH_WELL_KNOWN.server, serverMetadata);

    // ------------------------------------------------------------ registration (RFC 7591)
    s.post(OAUTH_PATHS.register, { bodyLimit: FORM_MAX_BYTES, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, (req, reply) => {
      contextFor(deps, req, 'oauth');
      if (!enabled()) return notAvailable(reply);
      const now = deps.now();
      pruneOAuth(deps.db, now);
      const b = req.body;
      const bad = (description: string) => oauthError(reply, 400, 'invalid_client_metadata', description);
      if (!isRecord(b)) return bad('Expected a JSON object');
      if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== 'none') return bad('Only public clients are supported: token_endpoint_auth_method must be "none"');
      const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
      if (b.grant_types !== undefined && (!strings(b.grant_types) || !(b.grant_types as string[]).includes('authorization_code') || (b.grant_types as string[]).some((g) => g !== 'authorization_code' && g !== 'refresh_token'))) {
        return bad('grant_types must be authorization_code (and refresh_token)');
      }
      if (b.response_types !== undefined && (!strings(b.response_types) || (b.response_types as string[]).some((r) => r !== 'code'))) return bad('response_types must be code');
      if (!strings(b.redirect_uris) || !(b.redirect_uris as string[]).length || (b.redirect_uris as string[]).length > 10) return oauthError(reply, 400, 'invalid_redirect_uri', 'redirect_uris must list 1 to 10 addresses');
      const allowed = redirectHosts(deps.db);
      for (const u of b.redirect_uris as string[]) {
        const c = checkRedirectUri(u, allowed);
        if (!c.ok) return oauthError(reply, 400, 'invalid_redirect_uri', `Redirect address not allowed (${c.reason}): use https on a host the school allows, or http on 127.0.0.1, [::1] or localhost`);
      }
      const row: ClientRow = {
        id: newId(),
        clientId: `ccc_${randomToken(18)}`,
        kind: 'dcr',
        name: cleanClientName(b.client_name),
        redirectUrisJson: [...new Set(b.redirect_uris as string[])],
        createdAt: now,
        lastUsedAt: null,
        metadataFetchedAt: null,
        revokedAt: null,
        revokedBy: null,
      };
      tx(deps.db, () => {
        makeRoomForRegistration(deps.db, now);
        deps.db.insert(oauthClients).values(row).run();
      });
      return noStore(reply)
        .status(201)
        .type('application/json')
        .send({
          client_id: row.clientId,
          client_id_issued_at: Math.floor(now / 1000),
          client_name: row.name,
          redirect_uris: row.redirectUrisJson,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        });
    });

    // ------------------------------------------------------------ authorize
    s.get(OAUTH_PATHS.authorize, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      contextFor(deps, req, 'oauth');
      // Before the client and its redirect address are known, errors stay on our own page (no open redirect).
      const page = (error: OAuthPageError) => noStore(reply).redirect(`${OAUTH_PATHS.consent}?error=${error}`, 303);
      if (!enabled()) return page('MCP_DISABLED');
      const now = deps.now();
      pruneOAuth(deps.db, now);
      const q = single(req.query);
      if (!q) return page('INVALID_REQUEST');
      let client: ClientRow | null;
      try {
        client = await resolveClient(deps, q.client_id, { refresh: true });
      } catch (err) {
        if (err instanceof ClientMetadataError) return page('CLIENT_METADATA');
        throw err;
      }
      if (!client) return page('UNKNOWN_CLIENT');
      const redirectUri = matchRedirectUri(client.redirectUrisJson, q.redirect_uri, redirectHosts(deps.db));
      if (!redirectUri) return page('REDIRECT_URI');
      if (q.state !== undefined && q.state.length > STATE_MAX) return page('INVALID_REQUEST');
      // From here errors go back to the app, with its state (RFC 6749 §4.1.2.1) and our issuer (RFC 9207).
      const back = (error: string, description: string) => noStore(reply).redirect(redirectWith(redirectUri, { error, error_description: description, state: q.state, iss: origin }), 303);
      if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported');
      if (q.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
      if (!q.code_challenge || !/^[A-Za-z0-9_-]{43}$/u.test(q.code_challenge)) return back('invalid_request', 'code_challenge must be a base64url SHA-256 value');
      if (q.resource !== undefined && !isOurResource(q.resource, origin)) return back('invalid_target', `resource must be ${mcpResource(origin)}`);
      const scopes = requestedScopes(q.scope);
      if (scopes === null) return back('invalid_scope', 'The scope parameter is not valid');
      // The browser that opened this address must be the one on the consent page (a cookie nonce, SameSite=Lax).
      const cookieName = oauthBrowserCookie(deps);
      const existing = req.cookies?.[cookieName];
      const nonce = typeof existing === 'string' && /^[A-Za-z0-9_-]{32}$/u.test(existing) ? existing : randomToken(24);
      const id = randomToken(24);
      deps.db
        .insert(oauthRequests)
        .values({
          id,
          clientRowId: client.id,
          redirectUri,
          state: q.state ?? null,
          codeChallenge: q.code_challenge,
          resource: mcpResource(origin),
          scopesRequestedJson: scopes,
          browserHash: browserHash(deps, nonce),
          userId: null,
          status: 'pending',
          createdAt: now,
          expiresAt: now + OAUTH_REQUEST_MINUTES * 60_000,
          decidedAt: null,
        })
        .run();
      // No touchClient here: an unauthenticated authorize call is not a use of the registration.
      reply.setCookie(cookieName, nonce, { path: '/', httpOnly: true, sameSite: 'lax', secure: deps.config.isProd, maxAge: OAUTH_REQUEST_MINUTES * 60 });
      return noStore(reply).redirect(`${OAUTH_PATHS.consent}?request=${encodeURIComponent(id)}`, 303);
    });

    // ------------------------------------------------------------ token
    s.post(OAUTH_PATHS.token, { bodyLimit: FORM_MAX_BYTES, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      contextFor(deps, req, 'oauth');
      if (!enabled()) return notAvailable(reply);
      const b = single(req.body);
      if (!b) return oauthError(reply, 400, 'invalid_request', 'Each parameter must be given once');
      // Public clients only: a secret, an assertion or HTTP authentication is refused.
      if (req.headers.authorization !== undefined || b.client_secret !== undefined || b.client_assertion !== undefined) return oauthError(reply, 401, 'invalid_client', 'Only public clients (no client secret) are supported');
      if (!b.client_id) return oauthError(reply, 400, 'invalid_request', 'client_id is required');
      const client = await resolveClient(deps, b.client_id, { refresh: false });
      if (!client) return oauthError(reply, 401, 'invalid_client', 'Unknown or expired client; register again');
      if (b.resource !== undefined && !isOurResource(b.resource, origin)) return oauthError(reply, 400, 'invalid_target', `resource must be ${mcpResource(origin)}`);
      const now = deps.now();
      const s0 = aiSettings(deps.db);
      const userUsable = (userId: string) => {
        const u = deps.db.select().from(users).where(eq(users.id, userId)).get();
        return !!u && u.disabledAt === null && !u.mustChangePassword;
      };

      if (b.grant_type === 'authorization_code') {
        if (!b.code || !b.code_verifier || !b.redirect_uri || b.code.length > 200) return oauthError(reply, 400, 'invalid_request', 'code, code_verifier and redirect_uri are required');
        const code = deps.db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, tokenHash(deps.config.SECRET_PEPPER, b.code))).get();
        if (!code) return oauthError(reply, 400, 'invalid_grant', 'Unknown authorization code');
        // Single use: whoever comes second (a replay) ends the connection made from it.
        const claimed = deps.db
          .update(oauthCodes)
          .set({ usedAt: now })
          .where(and(eq(oauthCodes.id, code.id), isNull(oauthCodes.usedAt)))
          .run().changes;
        if (claimed !== 1) {
          endForMisuse(deps, code.grantId, 'code_reuse', now);
          return oauthError(reply, 400, 'invalid_grant', 'The authorization code was already used');
        }
        if (code.expiresAt <= now) {
          tx(deps.db, () => revokeGrants(deps.db, [code.grantId], now, null, 'code_expired'));
          return oauthError(reply, 400, 'invalid_grant', 'The authorization code has expired');
        }
        if (code.clientRowId !== client.id || code.redirectUri !== b.redirect_uri || !pkceMatches(b.code_verifier, code.codeChallenge)) {
          endForMisuse(deps, code.grantId, 'code_misuse', now);
          return oauthError(reply, 400, 'invalid_grant', 'The code does not match this client, redirect address or code verifier');
        }
        const grant = deps.db.select().from(oauthGrants).where(eq(oauthGrants.id, code.grantId)).get();
        if (!grant || !grantLive(grant, now, s0.mcpTokenMaxDays) || !userUsable(grant.userId)) return oauthError(reply, 400, 'invalid_grant', 'The connection has ended');
        const out = tx(deps.db, () => issueTokens(deps, grant, client, grant.scopesJson, now, s0.mcpTokenMaxDays));
        touchClient(deps.db, client, now);
        return noStore(reply).type('application/json').send(out);
      }

      if (b.grant_type === 'refresh_token') {
        const raw = b.refresh_token;
        if (!raw) return oauthError(reply, 400, 'invalid_request', 'refresh_token is required');
        if (!raw.startsWith(OAUTH_REFRESH_PREFIX) || raw.length > 200) return oauthError(reply, 400, 'invalid_grant', 'Unknown refresh token');
        const rt = deps.db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash(deps.config.SECRET_PEPPER, raw))).get();
        if (!rt) return oauthError(reply, 400, 'invalid_grant', 'Unknown refresh token');
        if (rt.rotatedAt !== null && !concurrentRetry(deps, rt, now)) {
          // A rotated refresh token came back after the grace window (or after its successor was used): it
          // was copied. End the whole connection (OAuth 2.1 §4.3.1).
          endForMisuse(deps, rt.grantId, 'refresh_reuse', now);
          return oauthError(reply, 400, 'invalid_grant', 'The refresh token was already used');
        }
        const grant = deps.db.select().from(oauthGrants).where(eq(oauthGrants.id, rt.grantId)).get();
        if (!grant) return oauthError(reply, 400, 'invalid_grant', 'Unknown refresh token');
        if (grant.clientRowId !== client.id) {
          endForMisuse(deps, grant.id, 'refresh_misuse', now);
          return oauthError(reply, 400, 'invalid_grant', 'The refresh token belongs to another client');
        }
        if (!grantLive(grant, now, s0.mcpTokenMaxDays) || !userUsable(grant.userId)) return oauthError(reply, 400, 'invalid_grant', 'The connection has ended; connect again');
        let scopes: readonly string[] = grant.scopesJson;
        if (b.scope !== undefined) {
          const asked = requestedScopes(b.scope);
          if (!asked || !asked.length || asked.some((x) => !grant.scopesJson.includes(x))) return oauthError(reply, 400, 'invalid_scope', 'A refresh can only keep or narrow the scopes of the connection');
          scopes = asked as McpScope[];
        }
        const out = tx(deps.db, () => {
          const cur = deps.db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, rt.id)).get();
          if (!cur) return null;
          if (cur.rotatedAt === null) {
            // A normal rotation supersedes this token and any sibling a concurrent retry was given.
            deps.db
              .update(oauthRefreshTokens)
              .set({ rotatedAt: now })
              .where(and(eq(oauthRefreshTokens.grantId, grant.id), isNull(oauthRefreshTokens.rotatedAt)))
              .run();
            deps.db.update(oauthGrants).set({ lastRefreshAt: now }).where(eq(oauthGrants.id, grant.id)).run();
          } else if (!concurrentRetry(deps, cur, now)) {
            return null;
          }
          return issueTokens(deps, grant, client, scopes, now, s0.mcpTokenMaxDays);
        });
        if (!out) {
          endForMisuse(deps, grant.id, 'refresh_reuse', now);
          return oauthError(reply, 400, 'invalid_grant', 'The refresh token was already used');
        }
        touchClient(deps.db, client, now);
        return noStore(reply).type('application/json').send(out);
      }

      return oauthError(reply, 400, b.grant_type ? 'unsupported_grant_type' : 'invalid_request', 'grant_type must be authorization_code or refresh_token');
    });

    // ------------------------------------------------------------ revoke (RFC 7009)
    s.post(OAUTH_PATHS.revoke, { bodyLimit: FORM_MAX_BYTES, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      contextFor(deps, req, 'oauth');
      if (!enabled()) return notAvailable(reply);
      const b = single(req.body);
      if (!b || !b.token) return oauthError(reply, 400, 'invalid_request', 'token is required');
      if (req.headers.authorization !== undefined || b.client_secret !== undefined) return oauthError(reply, 401, 'invalid_client', 'Only public clients (no client secret) are supported');
      const now = deps.now();
      const client = b.client_id !== undefined ? await resolveClient(deps, b.client_id, { refresh: false }) : null;
      // RFC 7009 §2.2: an unknown or already revoked token is still a 200; the token must belong to the client that names itself.
      const mine = (clientRowId: string | null) => b.client_id === undefined || (client !== null && client.id === clientRowId);
      if (b.token.startsWith(OAUTH_REFRESH_PREFIX) && b.token.length <= 200) {
        const rt = deps.db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash(deps.config.SECRET_PEPPER, b.token))).get();
        const grant = rt ? deps.db.select().from(oauthGrants).where(eq(oauthGrants.id, rt.grantId)).get() : undefined;
        if (grant && grant.revokedAt === null && mine(grant.clientRowId)) {
          tx(deps.db, () => {
            if (revokeGrants(deps.db, [grant.id], now, null, 'client_revoked')) audit(deps.db, SYSTEM, { action: 'oauth.connection_end', entity: 'oauth_grant', entityId: grant.id, after: { reason: 'client_revoked' } }, now);
          });
        }
      } else if (b.token.startsWith(MCP_TOKEN_PREFIX) && b.token.length <= 200) {
        const t = deps.db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash(deps.config.SECRET_PEPPER, b.token))).get();
        // Only OAuth access tokens: personal tokens are revoked on the Profile.
        if (t && t.kind === 'oauth' && t.revokedAt === null && mine(t.clientId)) deps.db.update(mcpTokens).set({ revokedAt: now, revokedBy: null }).where(eq(mcpTokens.id, t.id)).run();
      }
      return noStore(reply).status(200).send();
    });
  });
}
