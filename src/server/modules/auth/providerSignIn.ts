/**
 * The part of a sign-in with Google (D-208) and with the operator's sign-in server (D-213) that comes
 * after the provider has proven a person: which accounts this person may be, and signing one of them in
 * (S36, D-216).
 *
 * Candidates (rule 1 of D-216): active accounts that may use this provider (`eligible`: Google only
 * for accounts that may be without a password, the sign-in server for any account), and of those:
 * - linked: every account that carries the provider's id of this person (the token's `sub`);
 * - unlinked (no id from this provider yet): every account whose stored address is the address the
 *   provider proved in this sign-in (any case). While an active account carries the id, only if that
 *   proven address is also the stored address of such an account: a linked person whose provider
 *   address changed (renamed, or somebody else's address) reaches only the linked accounts; and an old
 *   stored address the provider no longer vouches for this person (a mailbox given to somebody else under
 *   a new id) never counts, because the match needs the proof of this sign-in.
 * So an account reached by address always had its address proven now (which the invite handling and
 * `emailVerifiedAt` rely on). An account with the address but another id belongs to somebody else's
 * provider account and is not a candidate. Several accounts may share an address (D-108) and may then
 * carry the same id.
 *
 * One candidate signs in at once. Several (at most `MAX_CHOICES`): nothing is signed in, the page shows
 * the accounts' names and roles only, and a sealed HttpOnly cookie that lives 5 minutes carries the
 * proof (provider, id, address, the candidates' ids) to the choice, because the provider's code is
 * already spent. Nothing is stored, so nothing marks the cookie as used: it is cleared after a
 * successful choice, when it is found invalid or expired, on a new start of that provider and on
 * sign-out, and otherwise stops working when its 5 minutes are over. The choice checks the cookie and
 * checks the chosen account again with the same rule (it may have been deactivated, given another
 * address or id, or lost the right to use the provider in between).
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
/** More accounts than this on one address are refused rather than listed (and the cookie stays small). */
export const MAX_CHOICES = 10;
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
  tooMany: () => AppError;
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

/**
 * The addresses (lower case) by which an account without this provider's id may be this person: the
 * stored addresses of the active accounts that carry the id, or the proven address while none does.
 */
/**
 * May an unlinked account be matched by the proven address? Yes while no active account carries the
 * id; otherwise only when the proven address is the stored address of one of those accounts.
 */
function addressMatchAllowed(db: Db, provider: Provider, claims: ProviderClaims): boolean {
  const linked = db
    .select({ email: users.email })
    .from(users)
    .where(and(isNull(users.disabledAt), eq(users[provider.subField], claims.sub)))
    .all();
  return linked.length === 0 || linked.some((u) => u.email?.toLowerCase() === claims.email);
}

/** Rule 1 for one account (the choice checks it again). */
function isCandidate(db: Db, provider: Provider, user: UserRow, claims: ProviderClaims, byAddress: boolean): boolean {
  if (user.disabledAt !== null || !provider.eligible(db, user)) return false;
  const sub = user[provider.subField];
  if (sub !== null) return sub === claims.sub;
  return byAddress && user.email?.toLowerCase() === claims.email;
}

function candidatesOf(db: Db, provider: Provider, claims: ProviderClaims): UserRow[] {
  const col = users[provider.subField];
  const byAddress = addressMatchAllowed(db, provider, claims);
  const match = byAddress ? or(eq(col, claims.sub), and(isNull(col), sql`lower(${users.email}) = ${claims.email}`)) : eq(col, claims.sub);
  return db
    .select()
    .from(users)
    .where(and(isNull(users.disabledAt), match))
    .orderBy(users.displayName, users.id)
    .all()
    .filter((u) => isCandidate(db, provider, u, claims, byAddress));
}

/**
 * Signs this account in: links the provider's id at its first use, takes the stored address as
 * verified when it is the proven one, uses up an open invite (an invited account may sign in this way straight away and is
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
  if (Object.keys(patch).length)
    deps.db
      .update(users)
      .set({ ...patch, updatedAt: now })
      .where(eq(users.id, user.id))
      .run();
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
    if (found.length > MAX_CHOICES) throw provider.tooMany();
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
 * list, or an account that is no longer a candidate, leaves it, so another button still works. The
 * route clears it after a successful choice too. Nothing is stored, so a copy of the cookie value kept
 * elsewhere would still work until its 5 minutes are over.
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
    if (!user || !isCandidate(deps.db, provider, user, claims, addressMatchAllowed(deps.db, provider, claims))) throw provider.noAccount();
    return signInAccount(deps, provider, user, claims);
  });
}
