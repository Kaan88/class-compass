import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Me } from '../../../shared/contracts/auth.ts';
import { foldForSearch } from '../../../shared/text/turkish.ts';
import type { Db } from '../../db/client.ts';
import { authAttempts, oneTimeTokens, sessions, users } from '../../db/schema.ts';
import { tx } from '../../db/client.ts';
import { translate } from '../../../shared/i18n/index.ts';
import { emailResetEnabled } from '../../lib/mailer.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, Actor, SessionRow, UserRow } from '../../lib/context.ts';
import { hashPassword, hashPin, newId, randomToken, tokenHash, verifyPassword, verifyPin } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import { isPinUnlocked, PIN_UNLOCK_MS } from '../../lib/http.ts';

export const SESSION_ABSOLUTE_MS = 14 * 24 * 60 * 60 * 1000;
const LOGIN_FREE_FAILURES = 5;
const IP_MAX_FAILURES = 30;
const PIN_FREE_FAILURES = 5;
const PIN_REVOKE_FAILURES = 10;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;

export const normaliseLogin = (login: string) => foldForSearch(login.trim());

export function toMe(user: UserRow, session: SessionRow, now: number): Me {
  return {
    kind: 'user',
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
    textScale: user.textScale,
    mustChangePassword: user.mustChangePassword,
    hasPin: user.pinHash !== null,
    classroomMode: session.classroomMode,
    pinUnlockedUntil: session.pinUnlockedUntil,
    pinUnlocked: isPinUnlocked(session, now),
  };
}

function attemptState(db: Db, key: string) {
  return db.select().from(authAttempts).where(eq(authAttempts.key, key)).get();
}

function recordFailure(db: Db, key: string, now: number, freeFailures: number) {
  const cur = attemptState(db, key);
  const failures = (cur?.failures ?? 0) + 1;
  // Escalating lockout after the free failures: 1, 2, 4 … 30 minutes.
  const over = failures - freeFailures;
  const lockedUntil = over > 0 ? now + Math.min(30, 2 ** (over - 1)) * 60_000 : null;
  db.insert(authAttempts)
    .values({ key, failures, lockedUntil, updatedAt: now })
    .onConflictDoUpdate({ target: authAttempts.key, set: { failures, lockedUntil, updatedAt: now } })
    .run();
}

function clearFailures(db: Db, key: string) {
  db.delete(authAttempts).where(eq(authAttempts.key, key)).run();
}

function assertNotLocked(db: Db, key: string, now: number) {
  const s = attemptState(db, key);
  if (s?.lockedUntil && s.lockedUntil > now) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Try again later.', { retryAt: s.lockedUntil });
  }
}

const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

export interface LoginResult {
  user: UserRow;
  session: SessionRow;
  token: string;
}

export async function login(deps: AppDeps, ip: string, loginName: string, password: string): Promise<LoginResult> {
  const { db } = deps;
  const ipKey = `login:ip:${ip}`;
  assertNotLocked(db, ipKey, deps.now());
  const user = db.select().from(users).where(eq(users.login, normaliseLogin(loginName))).get();
  const userKey = user ? `login:user:${user.id}` : null;
  if (userKey) assertNotLocked(db, userKey, deps.now());
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
  const now = deps.now();
  if (!user || !ok || user.disabledAt) {
    recordFailure(db, ipKey, now, IP_MAX_FAILURES);
    if (userKey) recordFailure(db, userKey, now, LOGIN_FREE_FAILURES);
    throw new AppError('UNAUTHENTICATED', 'Incorrect sign-in details');
  }
  clearFailures(db, ipKey);
  if (userKey) clearFailures(db, userKey);
  const { session, token } = createSession(deps, { kind: 'user', userId: user.id }, now);
  audit(db, { type: 'user', id: user.id, role: user.role }, { action: 'auth.login', entity: 'user', entityId: user.id }, now);
  return { user, session, token };
}

export function createSession(
  deps: AppDeps,
  who: { kind: 'user'; userId: string } | { kind: 'student'; studentLinkId: string },
  now: number,
  absoluteMs = SESSION_ABSOLUTE_MS,
) {
  const { db } = deps;
  const pepper = deps.config.SECRET_PEPPER;
  const token = randomToken();
  const row = {
    id: newId(),
    tokenHash: tokenHash(pepper, token),
    kind: who.kind,
    userId: who.kind === 'user' ? who.userId : null,
    studentLinkId: who.kind === 'student' ? who.studentLinkId : null,
    classroomMode: false,
    pinUnlockedUntil: null,
    pinFailures: 0,
    pinLockedUntil: null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + absoluteMs,
    revokedAt: null,
  } satisfies SessionRow;
  db.insert(sessions).values(row).run();
  return { session: row as SessionRow, token };
}

export function revokeSession(db: Db, sessionId: string, now: number) {
  db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sessionId)).run();
}

export function revokeAllUserSessions(db: Db, userId: string, now: number, exceptSessionId?: string) {
  const cond = exceptSessionId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, exceptSessionId))
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  db.update(sessions).set({ revokedAt: now }).where(cond).run();
}

/**
 * Void every unused password-reset link of a user (D-015). Called whenever the account's email,
 * password or active state changes, so a link sent to an old mailbox, or issued before an admin
 * reset after a suspected compromise, can no longer be used.
 */
export function invalidateResetTokens(db: Db, userId: string, now: number) {
  db.update(oneTimeTokens)
    .set({ usedAt: now })
    .where(and(eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.kind, 'password_reset'), isNull(oneTimeTokens.usedAt)))
    .run();
}

export async function changePassword(deps: AppDeps, user: UserRow, session: SessionRow, current: string, next: string) {
  if (!(await verifyPassword(user.passwordHash, current))) throw new AppError('UNAUTHENTICATED', 'Current password is incorrect', { reason: 'WRONG_PASSWORD' });
  const passwordHash = await hashPassword(next);
  const now = deps.now();
  tx(deps.db, () => {
    deps.db.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: now }).where(eq(users.id, user.id)).run();
    revokeAllUserSessions(deps.db, user.id, now, session.id);
    invalidateResetTokens(deps.db, user.id, now);
    audit(deps.db, actorFor(user), { action: 'auth.password_change', entity: 'user', entityId: user.id }, now);
  });
}

export async function setPin(deps: AppDeps, user: UserRow, currentPassword: string, pin: string) {
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new AppError('UNAUTHENTICATED', 'Current password is incorrect', { reason: 'WRONG_PASSWORD' });
  const pinHash = await hashPin(deps.config.SECRET_PEPPER, pin);
  const now = deps.now();
  deps.db.update(users).set({ pinHash, updatedAt: now }).where(eq(users.id, user.id)).run();
  audit(deps.db, actorFor(user), { action: 'auth.pin_set', entity: 'user', entityId: user.id }, now);
}

export function enterClassroom(deps: AppDeps, user: UserRow, session: SessionRow) {
  if (user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Classroom mode is for teacher accounts');
  if (!user.pinHash) throw new AppError('VALIDATION', 'Set a PIN before using classroom mode', { reason: 'PIN_NOT_SET' });
  deps.db.update(sessions).set({ classroomMode: true, pinUnlockedUntil: null }).where(eq(sessions.id, session.id)).run();
}

export function leaveClassroom(deps: AppDeps, session: SessionRow) {
  deps.db.update(sessions).set({ classroomMode: false, pinUnlockedUntil: null }).where(eq(sessions.id, session.id)).run();
}

export function lockNow(deps: AppDeps, session: SessionRow) {
  deps.db.update(sessions).set({ pinUnlockedUntil: null }).where(eq(sessions.id, session.id)).run();
}

/** PIN unlock with per-session lockout (PIN-7). 10 failures revoke the session entirely. */
export async function unlockPin(deps: AppDeps, user: UserRow, session: SessionRow, pin: string): Promise<number> {
  let now = deps.now();
  if (session.pinLockedUntil && session.pinLockedUntil > now) {
    throw new AppError('PIN_LOCKED_OUT', 'Too many wrong PINs. Wait and try again.', { retryAt: session.pinLockedUntil });
  }
  if (!user.pinHash) throw new AppError('VALIDATION', 'No PIN set', { reason: 'PIN_NOT_SET' });
  const ok = await verifyPin(deps.config.SECRET_PEPPER, user.pinHash, pin);
  now = deps.now();
  if (!ok) {
    const failures = session.pinFailures + 1;
    if (failures >= PIN_REVOKE_FAILURES) {
      revokeSession(deps.db, session.id, now);
      audit(deps.db, actorFor(user), { action: 'auth.pin_session_revoked', entity: 'session', entityId: session.id }, now);
      throw new AppError('UNAUTHENTICATED', 'Too many wrong PINs. Sign in again.');
    }
    const pinLockedUntil = failures >= PIN_FREE_FAILURES ? now + PIN_LOCKOUT_MS : null;
    deps.db.update(sessions).set({ pinFailures: failures, pinLockedUntil }).where(eq(sessions.id, session.id)).run();
    audit(deps.db, actorFor(user), { action: 'auth.pin_failed', entity: 'session', entityId: session.id, after: { failures } }, now);
    if (pinLockedUntil) throw new AppError('PIN_LOCKED_OUT', 'Too many wrong PINs. Wait and try again.', { retryAt: pinLockedUntil });
    throw new AppError('UNAUTHENTICATED', 'Wrong PIN', { reason: 'WRONG_PIN', failures });
  }
  const until = now + PIN_UNLOCK_MS;
  deps.db.update(sessions).set({ pinUnlockedUntil: until, pinFailures: 0, pinLockedUntil: null }).where(eq(sessions.id, session.id)).run();
  return until;
}

export const actorFor = (user: UserRow): Actor => ({ type: 'user', id: user.id, role: user.role });

export interface NewUserInput {
  login: string;
  displayName: string;
  role: 'admin' | 'teacher';
  email?: string | null;
  mustChangePassword?: boolean;
  locale?: 'en' | 'tr';
}

function assertNewUserValid(db: Db, input: NewUserInput, password: string | null): string {
  const login = normaliseLogin(input.login);
  if (!/^[\p{L}\p{N}._@-]{3,64}$/u.test(login)) throw new AppError('VALIDATION', 'Login must be 3–64 letters, digits or . _ @ -');
  if (password !== null && password.length < 10) throw new AppError('VALIDATION', 'Password must be at least 10 characters');
  if (db.select({ id: users.id }).from(users).where(eq(users.login, login)).get()) throw new AppError('CONFLICT', 'Login already in use', { reason: 'LOGIN_TAKEN' });
  return login;
}

/** Used by the CLI (initial admin, ACC-3) and the admin module. */
export async function createUser(db: Db, input: NewUserInput & { password: string }, actor: Actor, now: number): Promise<UserRow> {
  assertNewUserValid(db, input, input.password);
  const passwordHash = await hashPassword(input.password);
  return insertUser(db, input, passwordHash, actor, now);
}

/**
 * Synchronous insert with a pre-computed password hash, so callers can create accounts inside a
 * transaction together with other rows (e.g. the demo seed). Re-validates the login.
 */
export function insertUser(db: Db, input: NewUserInput, passwordHash: string, actor: Actor, now: number): UserRow {
  const login = assertNewUserValid(db, input, null);
  const row: UserRow = {
    id: newId(),
    login,
    email: input.email?.trim().toLowerCase() || null,
    displayName: input.displayName.trim(),
    role: input.role,
    passwordHash,
    pinHash: null,
    locale: input.locale ?? 'en',
    textScale: 100,
    mustChangePassword: input.mustChangePassword ?? false,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(users).values(row).run();
  audit(db, actor, { action: 'user.create', entity: 'user', entityId: row.id, after: { login, role: row.role, displayName: row.displayName } }, now);
  return row;
}

// ---------------------------------------------------------------- email password reset (D-015)
export const RESET_TOKEN_MS = 60 * 60 * 1000;
const RESET_MAX_PER_HOUR = 3;
const SYSTEM: Actor = { type: 'system', id: null };

/**
 * Sends a single-use, 1-hour reset link when SMTP is configured and an active account has this
 * email. The caller always answers `{ ok: true }` (no account enumeration). Tokens are stored as
 * HMAC hashes; the link carries the token in the URL fragment so it never reaches server logs.
 */
export function requestPasswordReset(deps: AppDeps, emailInput: string): void {
  if (!emailResetEnabled(deps)) return;
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) return;
  const { db } = deps;
  const now = deps.now();
  const matches = db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.disabledAt)))
    .all();
  for (const user of matches) {
    const token = randomToken();
    const sent = tx(db, () => {
      const recent = db
        .select({ n: sql<number>`count(*)` })
        .from(oneTimeTokens)
        .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, 'password_reset'), gt(oneTimeTokens.createdAt, now - RESET_TOKEN_MS)))
        .get()?.n ?? 0;
      if (recent >= RESET_MAX_PER_HOUR) return false;
      // Only the newest link works.
      db.update(oneTimeTokens)
        .set({ usedAt: now })
        .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, 'password_reset'), isNull(oneTimeTokens.usedAt)))
        .run();
      db.insert(oneTimeTokens)
        .values({ id: newId(), kind: 'password_reset', userId: user.id, tokenHash: tokenHash(deps.config.SECRET_PEPPER, token), expiresAt: now + RESET_TOKEN_MS, usedAt: null, createdAt: now })
        .run();
      audit(db, SYSTEM, { action: 'auth.password_reset_requested', entity: 'user', entityId: user.id }, now);
      return true;
    });
    if (!sent) continue;
    const link = `${new URL(deps.config.PUBLIC_ORIGIN).origin}/reset-password#token=${token}`;
    const locale = user.locale;
    void deps
      .mailer!.send({
        to: user.email!,
        subject: translate(locale, 'email.reset.subject'),
        text: translate(locale, 'email.reset.body', { name: user.displayName, link }),
      })
      .catch(() => {
        /* delivery failures are not reported to the requester (no enumeration) */
      });
  }
}

export async function completePasswordReset(deps: AppDeps, token: string, newPassword: string): Promise<void> {
  const { db } = deps;
  const hash = tokenHash(deps.config.SECRET_PEPPER, token);
  const invalidLink = () => new AppError('VALIDATION', 'This reset link is invalid or has expired', { reason: 'RESET_TOKEN_INVALID' });
  const find = () =>
    db
      .select()
      .from(oneTimeTokens)
      .where(and(eq(oneTimeTokens.tokenHash, hash), eq(oneTimeTokens.kind, 'password_reset'), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.expiresAt, deps.now())))
      .get();
  const row = find();
  if (!row) throw invalidLink();
  const passwordHash = await hashPassword(newPassword);
  tx(db, () => {
    const fresh = find(); // re-check inside the transaction: single use even under races
    if (!fresh) throw invalidLink();
    const user = db.select().from(users).where(eq(users.id, fresh.userId)).get();
    if (!user || user.disabledAt) throw invalidLink();
    const now = deps.now();
    db.update(oneTimeTokens).set({ usedAt: now }).where(eq(oneTimeTokens.id, fresh.id)).run();
    db.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: now }).where(eq(users.id, user.id)).run();
    revokeAllUserSessions(db, user.id, now);
    clearFailures(db, `login:user:${user.id}`);
    audit(db, actorFor(user), { action: 'auth.password_reset_email', entity: 'user', entityId: user.id }, now);
  });
}
