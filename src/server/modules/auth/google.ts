/**
 * Sign in with Google (S31, D-208), beside email links.
 *
 * There is no self-registration: an administrator creates the account with an email address, and
 * Google only proves that the person owns that address. The flow is the authorization code flow with
 * PKCE and a client secret:
 *
 * 1. `startGoogleSignIn`: a random `state`, `nonce` and PKCE verifier are sealed into an HttpOnly
 *    cookie that lives 10 minutes (nothing is stored in the database), and the browser is sent to
 *    Google with `prompt=select_account`, so Google always asks which account to use and never picks
 *    one that happens to be signed in on that computer.
 * 2. Google sends the browser back to our own page `/signin-google` with `code` and `state`; the page
 *    removes them from the address bar and POSTs them (a GET never uses a code, D-108).
 * 3. `completeGoogleSignIn`: the cookie must be present, unexpired and carry the same `state` (so the
 *    answer belongs to the browser that asked); the code is exchanged at Google's token endpoint over
 *    TLS, and the ID token that comes back in that answer is checked: issuer, audience (our client
 *    id), expiry, nonce, and `email_verified`. Its signature is not checked again: it was received
 *    directly from Google over TLS in exchange for the code, which OpenID Connect Core 3.1.3.7 allows.
 *
 * Matching the account: first by Google's permanent id (`users.google_sub`), stored at the first
 * sign-in; otherwise by the verified address, which must belong to exactly one active account without
 * a Google id yet. Only accounts that may sign in without a password are matched (`passwordlessAllowed`):
 * every teacher, and administrators once the school has switched passwords off (D-207); an
 * administrator who still has a password never signs in with Google. An administrator who changes an
 * account's address clears its Google id.
 *
 * An invited teacher who has not opened the invite yet may sign in with Google straight away: the
 * invited address is proven, so the invite counts as used and the account signs in without a password
 * from then on (email links or Google).
 *
 * Only `openid email` is asked for; no Google token is kept.
 */
import crypto from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { tx, type Db } from '../../db/client.ts';
import { oneTimeTokens, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, UserRow } from '../../lib/context.ts';
import { openSecret, randomToken, sealSecret, timingSafeEqualStr } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import { actorFor, createSession, invalidateResetTokens, SESSION_ABSOLUTE_MS } from './service.ts';
import { passwordlessAllowed } from './signInPolicy.ts';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_RETURN_PATH = '/signin-google';
export const GOOGLE_COOKIE = 'cc_google_signin';
export const GOOGLE_COOKIE_PATH = '/api/auth/google';
export const GOOGLE_STATE_TTL_MS = 10 * 60_000;
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_MS = 5 * 60_000;
const SEAL_PURPOSE = 'google-signin';
const SEAL_AAD = 'state';
const TOKEN_TIMEOUT_MS = 10_000;
const challengeOf = (verifier: string) => crypto.createHash('sha256').update(verifier).digest('base64url');

export const googleSignInEnabled = (deps: Pick<AppDeps, 'config'>): boolean => Boolean(deps.config.GOOGLE_SIGNIN_CLIENT_ID && deps.config.GOOGLE_SIGNIN_CLIENT_SECRET);

const notAvailable = () => new AppError('FEATURE_DISABLED', 'Sign in with Google is not set up', { reason: 'GOOGLE_NOT_AVAILABLE' });
/** The request does not belong to this browser, is too old, or Google did not accept it: start again. */
const failed = () => new AppError('UNAUTHENTICATED', 'Google sign-in did not work. Try again.', { reason: 'GOOGLE_SIGNIN_FAILED' });
const noAccount = () => new AppError('UNAUTHENTICATED', 'No account uses this Google address', { reason: 'GOOGLE_NO_ACCOUNT' });
const ambiguous = () => new AppError('UNAUTHENTICATED', 'Several accounts use this address', { reason: 'GOOGLE_AMBIGUOUS' });

const redirectUri = (deps: Pick<AppDeps, 'config'>) => `${deps.config.origins.main}${GOOGLE_RETURN_PATH}`;

interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  exp: number;
}

/** Where to send the browser, and the sealed cookie value that binds the answer to this browser. */
export function startGoogleSignIn(deps: AppDeps): { authorizeUrl: string; cookie: string } {
  if (!googleSignInEnabled(deps)) throw notAvailable();
  const pending: Pending = { state: randomToken(32), nonce: randomToken(32), verifier: randomToken(48), exp: deps.now() + GOOGLE_STATE_TTL_MS };
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: deps.config.GOOGLE_SIGNIN_CLIENT_ID,
    redirect_uri: redirectUri(deps),
    scope: 'openid email',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challengeOf(pending.verifier),
    code_challenge_method: 'S256',
    // Always ask which Google account: never silently the one left signed in on this computer.
    prompt: 'select_account',
  });
  return { authorizeUrl: `${GOOGLE_AUTHORIZE_URL}?${q}`, cookie: sealSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, SEAL_AAD, JSON.stringify(pending)) };
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

/** Production exchange: one POST to Google's token endpoint; no redirects, a time limit, JSON only. */
export async function exchangeWithGoogle(params: URLSearchParams): Promise<unknown> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: params.toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  return res.json();
}

interface IdClaims {
  sub: string;
  email: string;
}

/** The claims of an ID token received directly from the token endpoint, or null when any check fails. */
export function readIdToken(idToken: unknown, expect: { clientId: string; nonce: string; now: number }): IdClaims | null {
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
  if (typeof c.iss !== 'string' || !GOOGLE_ISSUERS.has(c.iss)) return null;
  const audOk = c.aud === expect.clientId || (Array.isArray(c.aud) && c.aud.length === 1 && c.aud[0] === expect.clientId);
  if (!audOk) return null;
  if (typeof c.exp !== 'number' || c.exp * 1000 < expect.now - CLOCK_SKEW_MS) return null;
  if (typeof c.nonce !== 'string' || !timingSafeEqualStr(c.nonce, expect.nonce)) return null;
  if (typeof c.sub !== 'string' || c.sub.length === 0 || c.sub.length > 255) return null;
  // Google sends a boolean; the address counts only when Google says the person proved it.
  if (c.email_verified !== true || typeof c.email !== 'string' || !/^[^\s@]+@[^\s@]+$/u.test(c.email)) return null;
  return { sub: c.sub, email: c.email.trim().toLowerCase() };
}

function findAccount(db: Db, claims: IdClaims): UserRow {
  const linked = db.select().from(users).where(eq(users.googleSub, claims.sub)).get();
  if (linked) {
    if (linked.disabledAt || !passwordlessAllowed(db, linked)) throw noAccount();
    return linked;
  }
  const matches = db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${claims.email}`, isNull(users.disabledAt), isNull(users.googleSub)))
    .all()
    .filter((u) => passwordlessAllowed(db, u));
  if (matches.length === 0) throw noAccount();
  // Several accounts may share an address (D-108); Google cannot say which one is meant.
  if (matches.length > 1) throw ambiguous();
  return matches[0]!;
}

/** The invite is still open: no password was ever chosen and the account is not an email-link account yet. */
const invitePending = (u: UserRow) => u.signInMethod === 'password' && u.passwordHash === '';

export async function completeGoogleSignIn(deps: AppDeps, cookie: string | undefined, input: { state: string; code: string }) {
  if (!googleSignInEnabled(deps)) throw notAvailable();
  const pending = openPending(deps, cookie);
  if (!pending || pending.exp < deps.now() || !timingSafeEqualStr(pending.state, input.state)) throw failed();
  let reply: unknown;
  try {
    reply = await (deps.googleTokenExchange ?? exchangeWithGoogle)(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: pending.verifier,
        client_id: deps.config.GOOGLE_SIGNIN_CLIENT_ID,
        client_secret: deps.config.GOOGLE_SIGNIN_CLIENT_SECRET,
        redirect_uri: redirectUri(deps),
      }),
    );
  } catch {
    throw failed();
  }
  const claims = readIdToken((reply as { id_token?: unknown } | null)?.id_token, { clientId: deps.config.GOOGLE_SIGNIN_CLIENT_ID, nonce: pending.nonce, now: deps.now() });
  if (!claims) throw failed();
  return tx(deps.db, () => {
    const now = deps.now();
    const user = findAccount(deps.db, claims);
    const actor = actorFor(user);
    const patch: Partial<UserRow> = {};
    if (user.googleSub === null) {
      patch.googleSub = claims.sub;
      audit(deps.db, actor, { action: 'auth.google_linked', entity: 'user', entityId: user.id }, now);
    }
    // Google proved the address on the account (for a linked account the address may have been left as it was).
    if (user.emailVerifiedAt === null && user.email?.toLowerCase() === claims.email) patch.emailVerifiedAt = now;
    if (invitePending(user)) {
      patch.signInMethod = 'email_link';
      patch.mustChangePassword = false;
      deps.db
        .update(oneTimeTokens)
        .set({ usedAt: now })
        .where(and(eq(oneTimeTokens.kind, 'invite'), eq(oneTimeTokens.userId, user.id), isNull(oneTimeTokens.usedAt), isNull(oneTimeTokens.revokedAt)))
        .run();
      invalidateResetTokens(deps.db, user.id, now);
      audit(deps.db, actor, { action: 'auth.invite_accept', entity: 'user', entityId: user.id, after: { method: 'google', emailVerified: true } }, now);
    }
    if (Object.keys(patch).length) deps.db.update(users).set({ ...patch, updatedAt: now }).where(eq(users.id, user.id)).run();
    const s = createSession(deps, { kind: 'user', userId: user.id }, now, SESSION_ABSOLUTE_MS, 'google');
    audit(deps.db, actor, { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'google' } }, now);
    return { user: deps.db.select().from(users).where(eq(users.id, user.id)).get()!, session: s.session, token: s.token };
  });
}
