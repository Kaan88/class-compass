/**
 * Sign in with the operator's own sign-in server (S34, D-213): one OpenID Connect provider that the
 * person who runs the server sets up in the server's settings, for example their own mail server.
 * Beside email links, Google (D-208) and passkeys (D-210); it never makes an account.
 *
 * It is the same flow as Google's, with three differences:
 * - The provider's addresses come from its discovery document (`<issuer>/.well-known/openid-configuration`),
 *   read over HTTPS and kept for an hour. The issuer it names must be the configured one, and its
 *   authorization and token endpoints must be HTTPS addresses on the issuer's own host.
 * - A client secret is optional: without one the client is public and PKCE (S256, always sent) carries
 *   the proof.
 * - Every account may use it, administrators too, whether passwords are on or off: the operator chose
 *   and runs this provider, so it is trusted the way the server itself is. (Google is anybody's
 *   provider, so an administrator with a password cannot use it, D-208.)
 *
 * The ID token arrives directly from the token endpoint over TLS in exchange for the code, so its
 * signature is not checked again (OpenID Connect Core 3.1.3.7, as for Google); its issuer, audience,
 * expiry, nonce and address are. `email_verified` must be true unless `SSO_TRUST_EMAIL` says that this
 * provider only ever names addresses it owns (a mail server naming its own mailboxes sends no such
 * claim), and `SSO_EMAIL_DOMAINS` can limit the addresses it may vouch for. Matching is by the provider's permanent id (`users.sso_sub`) once known, before that by the
 * address, which must belong to exactly one active account. No provider token is kept.
 *
 * The icon the sign-in page shows is a file in the data folder (`SSO_ICON_FILE`), never part of the
 * repository; it is served as an image only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { tx, type Db } from '../../db/client.ts';
import { oneTimeTokens, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, UserRow } from '../../lib/context.ts';
import { openSecret, randomToken, sealSecret, timingSafeEqualStr } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import { actorFor, createSession, invalidateResetTokens, passwordNotSet, SESSION_ABSOLUTE_MS } from './service.ts';
import { passwordlessAllowed } from './signInPolicy.ts';

export const SSO_RETURN_PATH = '/signin-sso';
export const SSO_COOKIE = 'cc_sso_signin';
export const SSO_COOKIE_PATH = '/api/auth/sso';
export const SSO_STATE_TTL_MS = 10 * 60_000;
export const SSO_ICON_MAX_BYTES = 100 * 1024;
const DISCOVERY_TTL_MS = 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 10_000;
const SEAL_PURPOSE = 'sso-signin';
const SEAL_AAD = 'state';
const ICON_TYPES: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const challengeOf = (verifier: string) => crypto.createHash('sha256').update(verifier).digest('base64url');

type Config = AppDeps['config'];

/** The issuer as configured, without a trailing slash; null when the option is not set up. */
const issuerOf = (config: Config): string | null => (config.SSO_ISSUER && config.SSO_CLIENT_ID ? config.SSO_ISSUER.replace(/\/+$/u, '') : null);

export const ssoEnabled = (deps: Pick<AppDeps, 'config'>): boolean => issuerOf(deps.config) !== null;

/** `SSO_EMAIL_DOMAINS` as a list of lower-case domains; empty = no limit. */
export const ssoDomains = (config: Config): string[] =>
  config.SSO_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/u, ''))
    .filter(Boolean);

function iconPath(config: Config): { file: string; type: string } | null {
  const name = config.SSO_ICON_FILE;
  // A bare file name in the data folder: no folders, so the setting cannot point anywhere else.
  if (!name || name !== path.basename(name)) return null;
  const type = ICON_TYPES[path.extname(name).toLowerCase()];
  return type ? { file: path.join(config.DATA_DIR, name), type } : null;
}

/** The icon's file, if it is a regular file (not a link) of an allowed kind and size. */
function usableIcon(deps: Pick<AppDeps, 'config'>): { file: string; type: string } | null {
  const icon = ssoEnabled(deps) ? iconPath(deps.config) : null;
  if (!icon) return null;
  try {
    const st = fs.lstatSync(icon.file);
    return st.isFile() && st.size > 0 && st.size <= SSO_ICON_MAX_BYTES ? icon : null;
  } catch {
    return null;
  }
}

/** The icon file for the sign-in page, or null (not set, wrong kind, missing, a link or too large). */
export function ssoIcon(deps: Pick<AppDeps, 'config'>): { body: Buffer; type: string } | null {
  const icon = usableIcon(deps);
  if (!icon) return null;
  try {
    return { body: fs.readFileSync(icon.file), type: icon.type };
  } catch {
    return null;
  }
}

/** What the sign-in page may know: the name for the button, and whether there is an icon. Null = not offered. */
export function ssoPublicInfo(deps: Pick<AppDeps, 'config'>): { name: string; hasIcon: boolean } | null {
  if (!ssoEnabled(deps)) return null;
  return { name: deps.config.SSO_NAME || new URL(issuerOf(deps.config)!).hostname, hasIcon: usableIcon(deps) !== null };
}

const notAvailable = () => new AppError('FEATURE_DISABLED', 'This sign-in is not set up', { reason: 'SSO_NOT_AVAILABLE' });
/** The request does not belong to this browser, is too old, or the provider did not accept it: start again. */
const failed = () => new AppError('UNAUTHENTICATED', 'The sign-in did not work. Try again.', { reason: 'SSO_SIGNIN_FAILED' });
const noAccount = () => new AppError('UNAUTHENTICATED', 'No account uses this address', { reason: 'SSO_NO_ACCOUNT' });
const ambiguous = () => new AppError('UNAUTHENTICATED', 'Several accounts use this address', { reason: 'SSO_AMBIGUOUS' });

const redirectUri = (deps: Pick<AppDeps, 'config'>) => `${deps.config.origins.main}${SSO_RETURN_PATH}`;

// ---------------------------------------------------------------- talking to the provider
/** One HTTPS request to the provider: no redirects, a time limit, a JSON answer. */
export async function ssoHttp(url: string, form?: URLSearchParams): Promise<unknown> {
  const res = await fetch(url, {
    method: form ? 'POST' : 'GET',
    headers: { accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(form ? { body: form.toString() } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the sign-in server answered ${res.status}`);
  return res.json();
}

interface Endpoints {
  authorize: string;
  token: string;
}
const discovered = new Map<string, { at: number; endpoints: Endpoints }>();

/** Tests start from a clean slate. */
export const forgetSsoDiscovery = () => discovered.clear();

/** An HTTPS address on the issuer's own host, or null. */
function sameHostHttps(value: unknown, issuer: URL): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.host === issuer.host ? u.toString() : null;
  } catch {
    return null;
  }
}

async function endpointsOf(deps: AppDeps): Promise<Endpoints> {
  const issuer = issuerOf(deps.config);
  if (!issuer) throw notAvailable();
  const now = deps.now();
  const known = discovered.get(issuer);
  if (known && now - known.at < DISCOVERY_TTL_MS && now >= known.at) return known.endpoints;
  const base = new URL(issuer);
  // Checked before anything is sent: a plain-http issuer, or one carrying a user name, a query or a fragment, is never asked.
  if (base.protocol !== 'https:' || base.username || base.password || /[?#]/u.test(issuer)) throw failed();
  let doc: Record<string, unknown>;
  try {
    doc = (await (deps.ssoHttp ?? ssoHttp)(`${issuer}/.well-known/openid-configuration`)) as Record<string, unknown>;
  } catch {
    throw failed();
  }
  const authorize = sameHostHttps(doc?.authorization_endpoint, base);
  const token = sameHostHttps(doc?.token_endpoint, base);
  const named = typeof doc?.issuer === 'string' ? doc.issuer.replace(/\/+$/u, '') : null;
  // A document that names another issuer, or sends people or the code to another host, is not this provider's.
  if (named !== issuer || !authorize || !token) throw failed();
  const endpoints = { authorize, token };
  discovered.set(issuer, { at: now, endpoints });
  return endpoints;
}

// ---------------------------------------------------------------- the flow
interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  exp: number;
}

/** Where to send the browser, and the sealed cookie value that binds the answer to this browser. */
export async function startSsoSignIn(deps: AppDeps): Promise<{ authorizeUrl: string; cookie: string }> {
  if (!ssoEnabled(deps)) throw notAvailable();
  const { authorize } = await endpointsOf(deps);
  const pending: Pending = { state: randomToken(32), nonce: randomToken(32), verifier: randomToken(48), exp: deps.now() + SSO_STATE_TTL_MS };
  const url = new URL(authorize);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: deps.config.SSO_CLIENT_ID,
    redirect_uri: redirectUri(deps),
    scope: 'openid email',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challengeOf(pending.verifier),
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(k, v);
  return { authorizeUrl: url.toString(), cookie: sealSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, SEAL_AAD, JSON.stringify(pending)) };
}

function openPending(deps: AppDeps, cookie: string | undefined): Pending | null {
  const raw = openSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, SEAL_AAD, cookie);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Pending>;
    if (typeof p.state !== 'string' || typeof p.nonce !== 'string' || typeof p.verifier !== 'string' || typeof p.exp !== 'number') return null;
    return p as Pending;
  } catch {
    return null;
  }
}

interface IdClaims {
  sub: string;
  email: string;
}

/** The claims of an ID token received directly from the token endpoint, or null when any check fails. */
export function readSsoIdToken(idToken: unknown, expect: { issuer: string; clientId: string; nonce: string; now: number; trustEmail: boolean; domains: string[] }): IdClaims | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof c !== 'object' || c === null) return null;
  if (typeof c.iss !== 'string' || c.iss.replace(/\/+$/u, '') !== expect.issuer) return null;
  const audOk = c.aud === expect.clientId || (Array.isArray(c.aud) && c.aud.length === 1 && c.aud[0] === expect.clientId);
  if (!audOk) return null;
  if (typeof c.exp !== 'number' || c.exp * 1000 < expect.now - CLOCK_SKEW_MS) return null;
  if (typeof c.nonce !== 'string' || !timingSafeEqualStr(c.nonce, expect.nonce)) return null;
  // A number is accepted as an id too (not every provider sends a string), but only one that JSON kept
  // exact: a larger one is rounded, and two people's ids could become the same text.
  const sub = typeof c.sub === 'number' ? (Number.isSafeInteger(c.sub) && c.sub >= 0 ? String(c.sub) : null) : c.sub;
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) return null;
  if (typeof c.email !== 'string' || !/^[^\s@]+@[^\s@]+$/u.test(c.email)) return null;
  if (!expect.trustEmail && c.email_verified !== true) return null;
  const email = c.email.trim().toLowerCase();
  // The operator may limit the addresses this provider can vouch for to its own domains.
  if (expect.domains.length && !expect.domains.includes(email.slice(email.lastIndexOf('@') + 1))) return null;
  return { sub, email };
}

function findAccount(db: Db, claims: IdClaims): UserRow {
  const linked = db.select().from(users).where(eq(users.ssoSub, claims.sub)).get();
  if (linked) {
    if (linked.disabledAt) throw noAccount();
    return linked;
  }
  const matches = db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${claims.email}`, isNull(users.disabledAt), isNull(users.ssoSub)))
    .all();
  if (matches.length === 0) throw noAccount();
  // Several accounts may share an address (D-108); the provider cannot say which one is meant.
  if (matches.length > 1) throw ambiguous();
  return matches[0]!;
}


export async function completeSsoSignIn(deps: AppDeps, cookie: string | undefined, input: { state: string; code: string }) {
  const issuer = issuerOf(deps.config);
  if (!issuer) throw notAvailable();
  const pending = openPending(deps, cookie);
  if (!pending || pending.exp < deps.now() || !timingSafeEqualStr(pending.state, input.state)) throw failed();
  const { token } = await endpointsOf(deps);
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, code_verifier: pending.verifier, client_id: deps.config.SSO_CLIENT_ID, redirect_uri: redirectUri(deps) });
  if (deps.config.SSO_CLIENT_SECRET) form.set('client_secret', deps.config.SSO_CLIENT_SECRET);
  let reply: unknown;
  try {
    reply = await (deps.ssoHttp ?? ssoHttp)(token, form);
  } catch {
    throw failed();
  }
  const claims = readSsoIdToken((reply as { id_token?: unknown } | null)?.id_token, { issuer, clientId: deps.config.SSO_CLIENT_ID, nonce: pending.nonce, now: deps.now(), trustEmail: deps.config.SSO_TRUST_EMAIL, domains: ssoDomains(deps.config) });
  if (!claims) throw failed();
  return tx(deps.db, () => {
    const now = deps.now();
    const user = findAccount(deps.db, claims);
    const actor = actorFor(user);
    const patch: Partial<UserRow> = {};
    if (user.ssoSub === null) {
      patch.ssoSub = claims.sub;
      audit(deps.db, actor, { action: 'auth.sso_linked', entity: 'user', entityId: user.id }, now);
    }
    if (user.emailVerifiedAt === null && user.email?.toLowerCase() === claims.email) patch.emailVerifiedAt = now;
    // An open invite counts as used, as with Google, but only for an account that may be without a password
    // (a teacher, or anyone while passwords are off). An invited administrator while passwords are on is
    // signed in and keeps the invite: opening it is still how that account chooses its password (D-108).
    if (passwordNotSet(user) && passwordlessAllowed(deps.db, user)) {
      patch.signInMethod = 'email_link';
      patch.mustChangePassword = false;
      deps.db
        .update(oneTimeTokens)
        .set({ usedAt: now })
        .where(and(eq(oneTimeTokens.kind, 'invite'), eq(oneTimeTokens.userId, user.id), isNull(oneTimeTokens.usedAt), isNull(oneTimeTokens.revokedAt)))
        .run();
      invalidateResetTokens(deps.db, user.id, now);
      audit(deps.db, actor, { action: 'auth.invite_accept', entity: 'user', entityId: user.id, after: { method: 'sso', emailVerified: true } }, now);
    }
    if (Object.keys(patch).length) deps.db.update(users).set({ ...patch, updatedAt: now }).where(eq(users.id, user.id)).run();
    const s = createSession(deps, { kind: 'user', userId: user.id }, now, SESSION_ABSOLUTE_MS, 'sso');
    audit(deps.db, actor, { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'sso' } }, now);
    return { user: deps.db.select().from(users).where(eq(users.id, user.id)).get()!, session: s.session, token: s.token };
  });
}
