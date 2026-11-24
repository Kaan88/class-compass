/**
 * The part of a sign-in with Google (D-208) and with the operator's sign-in server (D-213) that comes
 * after the provider has proven a person: which accounts this person may be, and signing one of them in
 * (S36, D-216).
 *
 * Candidates (rule 1 of D-216): every active account that may use this provider (`eligible`: Google
 * only for accounts that may be without a password, the sign-in server for any account) and that either
 * already carries the provider's id of this person, or has the proven address (any case) and no id from
 * this provider yet. An account with the address but another id belongs to somebody else's provider
 * account and is not a candidate. Several accounts may share an address (D-108) and may then carry the
 * same id.
 *
 * One candidate signs in at once. Several: nothing is signed in, the page shows the accounts' names and
 * roles only, and a sealed HttpOnly cookie that lives 5 minutes carries the proof (provider, id,
 * address, the candidates' ids) to the choice, because the provider's code is already spent. Nothing is
 * stored. The choice checks the cookie and checks the chosen account again (it may have been
 * deactivated or given another address in between).
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { tx, type Db } from '../../db/client.ts';
import { oneTimeTokens, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, UserRow } from '../../lib/context.ts';
import { openSecret, sealSecret } from '../../lib/crypto.ts';
import type { AppError } from '../../lib/errors.ts';
import { actorFor, createSession, invalidateResetTokens, passwordNotSet, SESSION_ABSOLUTE_MS } from './service.ts';
import { passwordlessAllowed } from './signInPolicy.ts';

/** How long the list of accounts may be answered. */
export const CHOICE_TTL_MS = 5 * 60_000;
const CHOICE_AAD = 'choice';

export interface ProviderClaims {
  sub: string;
  /** Lower case. */
  email: string;
}

export interface Provider {
  key: 'google' | 'sso';
  /** The column that holds this provider's id of the person. */
  subField: 'googleSub' | 'ssoSub';
  linkedAction: 'auth.google_linked' | 'auth.sso_linked';
  /** Whether the account may use this provider at all. */
  eligible: (db: Db, user: UserRow) => boolean;
  /** The seal purpose of the choice cookie (one per provider). */
  choicePurpose: string;
  noAccount: () => AppError;
  failed: () => AppError;
}

export interface SignedIn {
  user: UserRow;
  session: ReturnType<typeof createSession>['session'];
  token: string;
}

export interface Choice {
  id: string;
  displayName: string;
  role: UserRow['role'];
}

export type ProviderResult = { kind: 'signed_in'; signedIn: SignedIn } | { kind: 'choose'; choose: Choice[]; cookie: string };

interface PendingChoice {
  p: Provider['key'];
  sub: string;
  email: string;
  ids: string[];
  exp: number;
}

/** Rule 1 for one account (the choice checks it again). */
function isCandidate(db: Db, provider: Provider, user: UserRow, claims: ProviderClaims): boolean {
  if (user.disabledAt !== null || !provider.eligible(db, user)) return false;
  const sub = user[provider.subField];
  if (sub !== null) return sub === claims.sub;
  return user.email?.toLowerCase() === claims.email;
}

function candidatesOf(db: Db, provider: Provider, claims: ProviderClaims): UserRow[] {
  const col = users[provider.subField];
  return db
    .select()
    .from(users)
    .where(and(isNull(users.disabledAt), or(eq(col, claims.sub), and(isNull(col), sql`lower(${users.email}) = ${claims.email}`))))
    .orderBy(users.displayName, users.id)
    .all()
    .filter((u) => isCandidate(db, provider, u, claims));
}

/**
 * Signs this account in: links the provider's id at its first use, takes the proven address as
 * verified, uses up an open invite (an invited account may sign in this way straight away and is
 * without a password from then on; only an account that may be without one, D-108), starts the session
 * and writes the audits. Call inside the transaction.
 */
function signInAccount(deps: AppDeps, provider: Provider, user: UserRow, claims: ProviderClaims): SignedIn {
  const now = deps.now();
  const actor = actorFor(user);
  const patch: Partial<UserRow> = {};
  if (user[provider.subField] === null) {
    patch[provider.subField] = claims.sub;
    audit(deps.db, actor, { action: provider.linkedAction, entity: 'user', entityId: user.id }, now);
  }
  // The provider proved the address on the account (for a linked account the address may have been left as it was).
  if (user.emailVerifiedAt === null && user.email?.toLowerCase() === claims.email) patch.emailVerifiedAt = now;
  // An invited administrator while passwords are on is signed in and keeps the invite: opening it is
  // still how that account chooses its password (D-108). (Google never gets here with such an account.)
  if (passwordNotSet(user) && passwordlessAllowed(deps.db, user)) {
    patch.signInMethod = 'email_link';
    patch.mustChangePassword = false;
    deps.db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(and(eq(oneTimeTokens.kind, 'invite'), eq(oneTimeTokens.userId, user.id), isNull(oneTimeTokens.usedAt), isNull(oneTimeTokens.revokedAt)))
      .run();
    invalidateResetTokens(deps.db, user.id, now);
    audit(deps.db, actor, { action: 'auth.invite_accept', entity: 'user', entityId: user.id, after: { method: provider.key, emailVerified: true } }, now);
  }
  if (Object.keys(patch).length) deps.db.update(users).set({ ...patch, updatedAt: now }).where(eq(users.id, user.id)).run();
  const s = createSession(deps, { kind: 'user', userId: user.id }, now, SESSION_ABSOLUTE_MS, provider.key);
  audit(deps.db, actor, { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: provider.key } }, now);
  return { user: deps.db.select().from(users).where(eq(users.id, user.id)).get()!, session: s.session, token: s.token };
}

/** After the provider proved `claims`: sign the one candidate in, or answer the list to choose from. */
export function finishProviderSignIn(deps: AppDeps, provider: Provider, claims: ProviderClaims): ProviderResult {
  return tx(deps.db, () => {
    const found = candidatesOf(deps.db, provider, claims);
    if (found.length === 0) throw provider.noAccount();
    if (found.length === 1) return { kind: 'signed_in', signedIn: signInAccount(deps, provider, found[0]!, claims) };
    const pending: PendingChoice = { p: provider.key, sub: claims.sub, email: claims.email, ids: found.map((u) => u.id), exp: deps.now() + CHOICE_TTL_MS };
    return {
      kind: 'choose',
      choose: found.map((u) => ({ id: u.id, displayName: u.displayName, role: u.role })),
      cookie: sealSecret(deps.config.SECRET_PEPPER, provider.choicePurpose, CHOICE_AAD, JSON.stringify(pending)),
    };
  });
}

function openChoice(deps: AppDeps, provider: Provider, cookie: string | undefined): PendingChoice | null {
  const raw = openSecret(deps.config.SECRET_PEPPER, provider.choicePurpose, CHOICE_AAD, cookie);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingChoice>;
    if (p.p !== provider.key || typeof p.sub !== 'string' || typeof p.email !== 'string' || typeof p.exp !== 'number') return null;
    if (!Array.isArray(p.ids) || !p.ids.every((id) => typeof id === 'string')) return null;
    return p as PendingChoice;
  } catch {
    return null;
  }
}

/**
 * The person chose one of the listed accounts. A cookie that is missing, tampered with or too old is
 * spent (`spent()` lets the route clear it; the person starts again); a user id that was not on the
 * list, or an account that is no longer a candidate, leaves it. The route clears it after success too,
 * so a choice works once.
 */
export function chooseProviderAccount(deps: AppDeps, provider: Provider, cookie: string | undefined, userId: string, spent: () => void): SignedIn {
  const pending = openChoice(deps, provider, cookie);
  if (!pending || pending.exp < deps.now()) {
    spent();
    throw provider.failed();
  }
  if (!pending.ids.includes(userId)) throw provider.failed();
  const claims = { sub: pending.sub, email: pending.email };
  return tx(deps.db, () => {
    const user = deps.db.select().from(users).where(eq(users.id, userId)).get();
    // Deactivated, no longer allowed to use the provider, or given another address or id since the list.
    if (!user || !isCandidate(deps.db, provider, user, claims)) throw provider.noAccount();
    return signInAccount(deps, provider, user, claims);
  });
}
