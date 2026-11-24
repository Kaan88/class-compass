/**
 * Passkeys (S33, D-210): sign-in without a password or an email, with a key the person's own device
 * keeps (WebAuthn, through `@simplewebauthn/server`).
 *
 * - Adding one (`startRegistration` / `finishRegistration`): a signed-in teacher or administrator,
 *   after re-authentication like any change of sign-in details (D-108). The key is discoverable
 *   (`residentKey: required`), so signing in needs no username, and user verification is required: the
 *   device asks for its fingerprint, face or screen lock every time, so a passkey is two factors (the
 *   device, and what unlocks it). No attestation is asked for: the school does not need to know the
 *   make of the device.
 * - Signing in (`startSignIn` / `finishSignIn`): public. The browser offers the passkeys it has for this
 *   site; the server finds the account by the credential id and checks the signature, the origin, the
 *   site (`rpID`) and the counter.
 * - The challenge of either step is sealed into an HttpOnly cookie for 5 minutes (nothing is stored),
 *   works once, and a registration challenge is bound to the account that asked.
 * - Only the public key is stored (`passkeys`); the private key never leaves the person's device or
 *   password manager. The table is never exported.
 * - Every account may have passkeys, administrators too: a passkey is stronger than a password, so
 *   the rule that administrators keep a password (D-108) does not stand in its way.
 *
 * The site's name for passkeys (`rpID`) is the host of PUBLIC_ORIGIN. WebAuthn does not work for an
 * IP address, so an install reached by one offers no passkeys (`passkeysEnabled`).
 */
import net from 'node:net';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { tx, type Db } from '../../db/client.ts';
import { passkeys, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { Actor, AppDeps, SessionRow, UserRow } from '../../lib/context.ts';
import { newId, openSecret, sealSecret } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { getUserSetting, setUserSetting } from '../../lib/userSettings.ts';
import { actorFor, createSession, isFreshEmailSession, SESSION_ABSOLUTE_MS } from './service.ts';

export const PASSKEY_COOKIE = 'cc_passkey';
export const PASSKEY_COOKIE_PATH = '/api/auth/passkeys';
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
export const PASSKEYS_PER_ACCOUNT = 10;
const RP_NAME = 'Class Compass';
const SEAL_PURPOSE = 'passkey';
const SEAL_AAD = 'challenge';

type PasskeyRow = typeof passkeys.$inferSelect;

const rpId = (deps: Pick<AppDeps, 'config'>) => new URL(deps.config.origins.main).hostname;

/** Passkeys can work on this install: the site has a name, not just an IP address. */
export const passkeysEnabled = (deps: Pick<AppDeps, 'config'>): boolean => net.isIP(rpId(deps).replace(/^\[|\]$/gu, '')) === 0;

const notAvailable = () => new AppError('FEATURE_DISABLED', 'Passkeys are not available on this address', { reason: 'PASSKEY_NOT_AVAILABLE' });
/** One answer for every refusal at sign-in: nothing about any account is revealed. */
const signInFailed = () => new AppError('UNAUTHENTICATED', 'The passkey sign-in did not work', { reason: 'PASSKEY_SIGNIN_FAILED' });
const addFailed = () => invalid('The passkey could not be added', { reason: 'PASSKEY_ADD_FAILED' });

interface Pending {
  kind: 'register' | 'signin';
  challenge: string;
  userId: string | null;
  exp: number;
}

const seal = (deps: AppDeps, p: Pending) => sealSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, SEAL_AAD, JSON.stringify(p));

function openPending(deps: AppDeps, cookie: string | undefined, kind: Pending['kind']): Pending | null {
  const raw = openSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, SEAL_AAD, cookie);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Pending>;
    if (p.kind !== kind || typeof p.challenge !== 'string' || typeof p.exp !== 'number' || p.exp < deps.now()) return null;
    return { kind, challenge: p.challenge, userId: typeof p.userId === 'string' ? p.userId : null, exp: p.exp };
  } catch {
    return null;
  }
}

export const passkeyDto = (r: PasskeyRow) => ({ id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, backedUp: r.backedUp });

const ofUser = (db: Db, userId: string) => db.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(desc(passkeys.createdAt)).all();

export const listPasskeys = (db: Db, userId: string) => ofUser(db, userId).map(passkeyDto);

export const passkeyCount = (db: Db, userId: string): number => db.select({ n: sql<number>`count(*)` }).from(passkeys).where(eq(passkeys.userId, userId)).get()?.n ?? 0;

// ---------------------------------------------------------------- adding a passkey
export async function startRegistration(deps: AppDeps, user: UserRow) {
  if (!passkeysEnabled(deps)) throw notAvailable();
  const existing = ofUser(deps.db, user.id);
  if (existing.length >= PASSKEYS_PER_ACCOUNT) throw invalid('Remove a passkey first', { reason: 'PASSKEY_LIMIT' });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(deps),
    userName: user.login,
    userDisplayName: user.displayName,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    // The same authenticator is not added twice.
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transportsJson })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { options, cookie: seal(deps, { kind: 'register', challenge: options.challenge, userId: user.id, exp: deps.now() + PASSKEY_CHALLENGE_TTL_MS }) };
}

const cleanName = (name: string | undefined, now: number) => name?.trim().slice(0, 60) || `Passkey ${new Date(now).toISOString().slice(0, 10)}`;

export async function finishRegistration(deps: AppDeps, user: UserRow, cookie: string | undefined, response: unknown, name: string | undefined) {
  if (!passkeysEnabled(deps)) throw notAvailable();
  const pending = openPending(deps, cookie, 'register');
  if (!pending || pending.userId !== user.id) throw addFailed();
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: pending.challenge,
      expectedOrigin: deps.config.origins.main,
      expectedRPID: rpId(deps),
      requireUserVerification: true,
    });
    if (!v.verified) throw addFailed();
    info = v.registrationInfo;
  } catch {
    throw addFailed();
  }
  const now = deps.now();
  return tx(deps.db, () => {
    if (deps.db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.credentialId, info.credential.id)).get()) throw invalid('This passkey is already added', { reason: 'PASSKEY_EXISTS' });
    if (passkeyCount(deps.db, user.id) >= PASSKEYS_PER_ACCOUNT) throw invalid('Remove a passkey first', { reason: 'PASSKEY_LIMIT' });
    const row: PasskeyRow = {
      id: newId(),
      userId: user.id,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: info.credential.counter,
      transportsJson: info.credential.transports ?? [],
      name: cleanName(name, now),
      backedUp: info.credentialBackedUp,
      createdAt: now,
      lastUsedAt: null,
    };
    deps.db.insert(passkeys).values(row).run();
    audit(deps.db, actorFor(user), { action: 'auth.passkey_add', entity: 'user', entityId: user.id, after: { passkeyId: row.id, backedUp: row.backedUp } }, now);
    return passkeyDto(row);
  });
}

export function removePasskey(deps: AppDeps, user: UserRow, passkeyId: string) {
  tx(deps.db, () => {
    const row = deps.db.select().from(passkeys).where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, user.id))).get();
    if (!row) throw notFound('Passkey');
    deps.db.delete(passkeys).where(eq(passkeys.id, row.id)).run();
    audit(deps.db, actorFor(user), { action: 'auth.passkey_remove', entity: 'user', entityId: user.id, before: { passkeyId: row.id } }, deps.now());
  });
}

/** An administrator removes every passkey of an account (a lost or stolen device). Returns how many. */
export function removeAllPasskeys(db: Db, actor: Actor, userId: string, now: number): number {
  const n = passkeyCount(db, userId);
  if (!n) return 0;
  db.delete(passkeys).where(eq(passkeys.userId, userId)).run();
  audit(db, actor, { action: 'auth.passkey_remove_admin', entity: 'user', entityId: userId, before: { count: n } }, now);
  return n;
}

// ---------------------------------------------------------------- the offer after a sign-in
/**
 * Offer a passkey now? Only right after a sign-in that proved the person without a password (the same
 * sessions that count as re-authentication, so adding needs no further step), while the account has
 * none and has not switched the offer off.
 */
export const shouldOfferPasskey = (deps: AppDeps, user: UserRow, session: SessionRow): boolean =>
  passkeysEnabled(deps) && isFreshEmailSession(session, deps.now()) && passkeyCount(deps.db, user.id) === 0 && getUserSetting(deps.db, user.id, 'passkeys.offer');

export function dismissPasskeyOffer(deps: AppDeps, user: UserRow) {
  setUserSetting(deps.db, user.id, 'passkeys.offer', false, deps.now());
}

// ---------------------------------------------------------------- signing in
export async function startSignIn(deps: AppDeps) {
  if (!passkeysEnabled(deps)) throw notAvailable();
  // No list of credentials: the browser offers the passkeys it holds for this site (no username needed).
  const options = await generateAuthenticationOptions({ rpID: rpId(deps), userVerification: 'required' });
  return { options, cookie: seal(deps, { kind: 'signin', challenge: options.challenge, userId: null, exp: deps.now() + PASSKEY_CHALLENGE_TTL_MS }) };
}

export async function finishSignIn(deps: AppDeps, cookie: string | undefined, response: unknown) {
  if (!passkeysEnabled(deps)) throw notAvailable();
  const pending = openPending(deps, cookie, 'signin');
  const credentialId = (response as { id?: unknown } | null)?.id;
  if (!pending || typeof credentialId !== 'string') throw signInFailed();
  const row = deps.db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).get();
  if (!row) throw signInFailed();
  let newCounter: number;
  try {
    const v = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: pending.challenge,
      expectedOrigin: deps.config.origins.main,
      expectedRPID: rpId(deps),
      credential: { id: row.credentialId, publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64url')), counter: row.counter, transports: row.transportsJson as never },
      requireUserVerification: true,
    });
    if (!v.verified) throw signInFailed();
    newCounter = v.authenticationInfo.newCounter;
  } catch {
    throw signInFailed();
  }
  return tx(deps.db, () => {
    const now = deps.now();
    const user = deps.db.select().from(users).where(eq(users.id, row.userId)).get();
    if (!user || user.disabledAt) throw signInFailed();
    deps.db.update(passkeys).set({ counter: newCounter, lastUsedAt: now }).where(eq(passkeys.id, row.id)).run();
    const s = createSession(deps, { kind: 'user', userId: user.id }, now, SESSION_ABSOLUTE_MS, 'passkey');
    audit(deps.db, actorFor(user), { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'passkey' } }, now);
    return { user, session: s.session, token: s.token };
  });
}
