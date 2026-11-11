/**
 * Account invites and email-link sign-in (S13b, D-108).
 *
 * - Invite: an administrator creates the account and gets a single-use link (7 days, HMAC-hashed,
 *   revocable, regenerable; only the newest works), emailed when SMTP is configured. The invite page
 *   lets the person choose a password or (teachers only) email-link sign-in. Using an emailed invite
 *   proves the address.
 * - Email-link sign-in: "Email me a sign-in link" always answers the same (a request id, no account
 *   enumeration); only active teacher accounts that chose email-link get an email. The email has a
 *   link (15 minutes, single use, token in the URL fragment; the landing page POSTs, so a scanner that
 *   pre-fetches the link cannot use it) and a 6-digit code bound to the request id of the device that
 *   asked (5 tries). Rate limits: per address on the route, 3 emails per account per 15 minutes.
 *   Wrong codes are also counted per account across all its codes: after 10 within 24 hours the code
 *   path is closed for that account for 24 hours (only the emailed link works), so nobody can keep
 *   asking for new codes and guessing them.
 * - Changing an account's email, deactivating it or an admin password reset revokes its pending
 *   invites and unused sign-in links (`revokeEmailLinks`), so a mail sent to an old or wrong address
 *   cannot be used later (D-015); an email change also clears the "verified" mark.
 * - Switching method: to email-link needs the current password and a code emailed to the address;
 *   back to password needs a fresh email sign-in. Administrators always keep passwords.
 * Tokens and codes are stored as HMAC hashes with the server pepper; nothing secret is audited.
 */
import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { translate } from '../../../shared/i18n/index.ts';
import { tx, type Db } from '../../db/client.ts';
import { authAttempts, oneTimeTokens, sessions, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { Actor, AppDeps, SessionRow, UserRow } from '../../lib/context.ts';
import { hashPassword, newId, randomToken, timingSafeEqualStr, tokenHash } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { emailResetEnabled } from '../../lib/mailer.ts';
import { actorFor, createSession, invalidateResetTokens, revokeAllUserMcpTokens, revokeAllUserSessions, SESSION_ABSOLUTE_MS, toMe } from './service.ts';

export const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_LINK_MS = 15 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
const EMAILS_PER_ACCOUNT = 3;
/** Wrong codes per account (across all its codes) before the code path closes, and for how long. */
export const CODE_FAILURES_PER_ACCOUNT = 10;
export const CODE_LOCK_MS = 24 * 60 * 60 * 1000;
const SYSTEM: Actor = { type: 'system', id: null };

/** Email-link sign-in (and emailed invites) need SMTP (D-015, D-108). */
export const emailLinkEnabled = emailResetEnabled;

const origin = (deps: AppDeps) => new URL(deps.config.PUBLIC_ORIGIN).origin;
const hashOf = (deps: AppDeps, purpose: string, value: string) => tokenHash(deps.config.SECRET_PEPPER, `${purpose}:${value}`);
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

function sendQuietly(deps: AppDeps, to: string, subject: string, text: string) {
  void deps.mailer!.send({ to, subject, text }).catch(() => {
    /* delivery failures are not reported (no enumeration); the admin can always copy an invite link */
  });
}

function activeTokens(db: Db, kind: 'invite' | 'email_signin', where: ReturnType<typeof eq>, now: number) {
  return db
    .select()
    .from(oneTimeTokens)
    .where(and(eq(oneTimeTokens.kind, kind), where, isNull(oneTimeTokens.usedAt), isNull(oneTimeTokens.revokedAt), gt(oneTimeTokens.expiresAt, now)));
}
function activeToken(db: Db, kind: 'invite' | 'email_signin', where: ReturnType<typeof eq>, now: number) {
  return activeTokens(db, kind, where, now).get();
}

/**
 * Pending invites and unused email sign-in links/codes of an account stop working. Called when an
 * administrator changes the account's email, deactivates it or resets its password (D-015, D-108).
 */
export function revokeEmailLinks(db: Db, userId: string, now: number) {
  revokePendingInvites(db, userId, now);
  db.update(oneTimeTokens)
    .set({ usedAt: now })
    .where(and(eq(oneTimeTokens.userId, userId), eq(oneTimeTokens.kind, 'email_signin'), isNull(oneTimeTokens.usedAt)))
    .run();
}

// ---------------------------------------------------------------- wrong codes per account
const codeKey = (userId: string) => `emailcode:user:${userId}`;
function codeLocked(db: Db, userId: string, now: number): boolean {
  const s = db.select().from(authAttempts).where(eq(authAttempts.key, codeKey(userId))).get();
  return Boolean(s?.lockedUntil && s.lockedUntil > now);
}
function recordCodeFailure(db: Db, userId: string, now: number) {
  const key = codeKey(userId);
  const cur = db.select().from(authAttempts).where(eq(authAttempts.key, key)).get();
  // The window restarts after a quiet day; within it every wrong code counts, whichever code it was for.
  const failures = cur && now - cur.updatedAt < CODE_LOCK_MS ? cur.failures + 1 : 1;
  const lockedUntil = failures >= CODE_FAILURES_PER_ACCOUNT ? now + CODE_LOCK_MS : null;
  db.insert(authAttempts)
    .values({ key, failures, lockedUntil, updatedAt: now })
    .onConflictDoUpdate({ target: authAttempts.key, set: { failures, lockedUntil, updatedAt: now } })
    .run();
}

function getUser(db: Db, id: string): UserRow {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw notFound('Account');
  return u;
}

// ---------------------------------------------------------------- invites
export interface InviteOut {
  link: string;
  expiresAt: number;
  emailed: boolean;
}

/** Pending invite of an account (admin list). */
export function inviteStatus(db: Db, userId: string, now: number): { pending: boolean; expiresAt: number | null } {
  const row = db
    .select({ expiresAt: oneTimeTokens.expiresAt })
    .from(oneTimeTokens)
    .where(and(eq(oneTimeTokens.kind, 'invite'), eq(oneTimeTokens.userId, userId), isNull(oneTimeTokens.usedAt), isNull(oneTimeTokens.revokedAt), gt(oneTimeTokens.expiresAt, now)))
    .orderBy(desc(oneTimeTokens.createdAt))
    .get();
  return { pending: Boolean(row), expiresAt: row?.expiresAt ?? null };
}

function revokePendingInvites(db: Db, userId: string, now: number) {
  db.update(oneTimeTokens)
    .set({ revokedAt: now })
    .where(and(eq(oneTimeTokens.kind, 'invite'), eq(oneTimeTokens.userId, userId), isNull(oneTimeTokens.usedAt), isNull(oneTimeTokens.revokedAt)))
    .run();
}

/**
 * New invite for an account (creation or "send a new invite"): the previous one stops working. The
 * link is returned to the administrator (copy / QR) and emailed when SMTP is configured and the account
 * has an address. Existing sign-in details keep working until the invite is used.
 */
export function issueInvite(deps: AppDeps, user: UserRow, actor: Actor): InviteOut {
  const now = deps.now();
  const token = randomToken();
  const willEmail = emailLinkEnabled(deps) && Boolean(user.email);
  const expiresAt = now + INVITE_MS;
  tx(deps.db, () => {
    revokePendingInvites(deps.db, user.id, now);
    deps.db
      .insert(oneTimeTokens)
      .values({ id: newId(), kind: 'invite', userId: user.id, tokenHash: tokenHash(deps.config.SECRET_PEPPER, token), expiresAt, usedAt: null, sentByEmail: willEmail, createdBy: actor.id, createdAt: now })
      .run();
    audit(deps.db, actor, { action: 'auth.invite_issue', entity: 'user', entityId: user.id, after: { expiresAt, emailed: willEmail } }, now);
  });
  const link = `${origin(deps)}/invite#token=${token}`;
  if (willEmail) {
    sendQuietly(deps, user.email!, translate(user.locale, 'email.invite.subject'), translate(user.locale, 'email.invite.body', { name: user.displayName, link, login: user.login }));
  }
  return { link, expiresAt, emailed: willEmail };
}

export function revokeInvite(deps: AppDeps, userId: string, actor: Actor) {
  const now = deps.now();
  tx(deps.db, () => {
    getUser(deps.db, userId);
    revokePendingInvites(deps.db, userId, now);
    audit(deps.db, actor, { action: 'auth.invite_revoke', entity: 'user', entityId: userId }, now);
  });
}

const inviteInvalid = () => new AppError('VALIDATION', 'This invite link is not valid any more. Ask your administrator for a new one.', { reason: 'INVITE_INVALID' });

function findInvite(deps: AppDeps, token: string) {
  const row = activeToken(deps.db, 'invite', eq(oneTimeTokens.tokenHash, tokenHash(deps.config.SECRET_PEPPER, token)), deps.now());
  if (!row) throw inviteInvalid();
  const user = getUser(deps.db, row.userId);
  if (user.disabledAt) throw inviteInvalid();
  return { row, user };
}

function emailLinkState(deps: AppDeps, user: UserRow) {
  const allowed = user.role === 'teacher';
  const reason = !emailLinkEnabled(deps) ? ('SMTP_NOT_CONFIGURED' as const) : !user.email ? ('NO_EMAIL' as const) : null;
  return { emailLinkAllowed: allowed, emailLinkAvailable: allowed && reason === null, emailLinkUnavailableReason: allowed ? reason : null };
}

export function inspectInvite(deps: AppDeps, token: string) {
  const { row, user } = findInvite(deps, token);
  return { displayName: user.displayName, login: user.login, role: user.role, locale: user.locale, ...emailLinkState(deps, user), expiresAt: row.expiresAt };
}

export async function acceptInvite(deps: AppDeps, ip: string, input: { token: string; method: 'password' | 'email_link'; password?: string | undefined }) {
  const first = findInvite(deps, input.token);
  if (input.method === 'email_link') {
    const st = emailLinkState(deps, first.user);
    if (!st.emailLinkAllowed) throw new AppError('FORBIDDEN', 'Administrator accounts sign in with a password', { reason: 'ADMIN_PASSWORD_REQUIRED' });
    if (!st.emailLinkAvailable) throw invalid('Email sign-in is not available', { reason: st.emailLinkUnavailableReason ?? 'SMTP_NOT_CONFIGURED' });
  } else if (!input.password) throw invalid('Choose a password', { reason: 'PASSWORD_REQUIRED' });
  const passwordHash = input.method === 'password' ? await hashPassword(input.password!) : '';
  const now = deps.now();
  const result = tx(deps.db, () => {
    const { row, user } = findInvite(deps, input.token); // single use, also under races
    deps.db.update(oneTimeTokens).set({ usedAt: now }).where(eq(oneTimeTokens.id, row.id)).run();
    const verified = row.sentByEmail ? now : user.emailVerifiedAt;
    deps.db
      .update(users)
      .set({ passwordHash, signInMethod: input.method, mustChangePassword: false, emailVerifiedAt: verified, updatedAt: now })
      .where(eq(users.id, user.id))
      .run();
    revokeAllUserSessions(deps.db, user.id, now);
    invalidateResetTokens(deps.db, user.id, now);
    audit(deps.db, actorFor(user), { action: 'auth.invite_accept', entity: 'user', entityId: user.id, after: { method: input.method, emailVerified: verified !== null } }, now);
    // An email-link choice on an invite that was not emailed must prove the address first.
    if (input.method === 'email_link' && !row.sentByEmail) return { user: getUser(deps.db, user.id), signIn: false };
    const s = createSession(deps, { kind: 'user', userId: user.id }, now, SESSION_ABSOLUTE_MS, 'invite');
    audit(deps.db, actorFor(user), { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'invite' } }, now);
    return { user: getUser(deps.db, user.id), signIn: true, session: s.session, token: s.token };
  });
  if (!result.signIn) {
    const requestId = sendSignInEmail(deps, result.user);
    return { status: 'check_email' as const, requestId, user: result.user, session: null, token: null };
  }
  void ip;
  return { status: 'signed_in' as const, requestId: null, user: result.user, session: result.session!, token: result.token! };
}

// ---------------------------------------------------------------- email-link sign-in
/**
 * Issue a sign-in link + code for one account and email it; returns the request id the code is
 * bound to. Older unused links of the account stop working. Null when the per-account limit is hit.
 */
function issueSignIn(deps: AppDeps, user: UserRow, requestId: string, binding: string, withLink: boolean): string | null {
  const now = deps.now();
  const token = randomToken();
  const code = newCode();
  const ok = tx(deps.db, () => {
    const recent =
      deps.db
        .select({ n: sql<number>`count(*)` })
        .from(oneTimeTokens)
        .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, 'email_signin'), gt(oneTimeTokens.createdAt, now - EMAIL_LINK_MS)))
        .get()?.n ?? 0;
    if (recent >= EMAILS_PER_ACCOUNT) return false;
    deps.db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(and(eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, 'email_signin'), isNull(oneTimeTokens.usedAt)))
      .run();
    deps.db
      .insert(oneTimeTokens)
      .values({
        id: newId(),
        kind: 'email_signin',
        userId: user.id,
        tokenHash: tokenHash(deps.config.SECRET_PEPPER, token),
        expiresAt: now + EMAIL_LINK_MS,
        usedAt: null,
        codeHash: hashOf(deps, 'code', code),
        bindingHash: hashOf(deps, 'bind', binding),
        codeAttempts: 0,
        createdAt: now,
      })
      .run();
    audit(deps.db, SYSTEM, { action: withLink ? 'auth.email_link_requested' : 'auth.email_code_requested', entity: 'user', entityId: user.id }, now);
    return true;
  });
  if (!ok) return null;
  const link = `${origin(deps)}/signin-link#token=${token}`;
  const body = withLink
    ? translate(user.locale, 'email.signin.body', { name: user.displayName, link, code })
    : translate(user.locale, 'email.methodcode.body', { name: user.displayName, code });
  sendQuietly(deps, user.email!, translate(user.locale, withLink ? 'email.signin.subject' : 'email.methodcode.subject'), body);
  return requestId;
}

function sendSignInEmail(deps: AppDeps, user: UserRow): string {
  const requestId = randomToken();
  issueSignIn(deps, user, requestId, requestId, true);
  return requestId;
}

/** Always returns a fresh request id; an email is sent only to an active email-link teacher account with this address. */
export function requestEmailLink(deps: AppDeps, emailInput: string): { requestId: string } {
  const requestId = randomToken();
  if (!emailLinkEnabled(deps)) return { requestId };
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) return { requestId };
  const matches = deps.db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.disabledAt), eq(users.signInMethod, 'email_link'), eq(users.role, 'teacher')))
    .all();
  for (const u of matches) issueSignIn(deps, u, requestId, requestId, true);
  return { requestId };
}

const signInInvalid = () => new AppError('UNAUTHENTICATED', 'This sign-in link or code is not valid any more', { reason: 'SIGNIN_LINK_INVALID' });

function finishEmailSignIn(deps: AppDeps, row: typeof oneTimeTokens.$inferSelect) {
  const now = deps.now();
  const user = getUser(deps.db, row.userId);
  if (user.disabledAt || user.signInMethod !== 'email_link') throw signInInvalid();
  deps.db.update(oneTimeTokens).set({ usedAt: now }).where(eq(oneTimeTokens.id, row.id)).run();
  // The owner proved the mailbox: the wrong-code count starts again.
  deps.db.delete(authAttempts).where(eq(authAttempts.key, codeKey(user.id))).run();
  if (user.emailVerifiedAt === null) deps.db.update(users).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(users.id, user.id)).run();
  const s = createSession(deps, { kind: 'user', userId: user.id }, now, SESSION_ABSOLUTE_MS, 'email_link');
  audit(deps.db, actorFor(user), { action: 'auth.login', entity: 'user', entityId: user.id, after: { method: 'email_link' } }, now);
  return { user: getUser(deps.db, user.id), session: s.session, token: s.token };
}

export function completeEmailLink(deps: AppDeps, token: string) {
  return tx(deps.db, () => {
    const row = activeToken(deps.db, 'email_signin', eq(oneTimeTokens.tokenHash, tokenHash(deps.config.SECRET_PEPPER, token)), deps.now());
    if (!row) throw signInInvalid();
    return finishEmailSignIn(deps, row);
  });
}

/**
 * Checks a code bound to `binding`. Several accounts can share an address, so one request can have a
 * code per account: the code is compared with every active row of the binding. A wrong code counts
 * against each of those rows (a code dies after 5) and against each account (the code path closes
 * after CODE_FAILURES_PER_ACCOUNT, see above). Returns the matching token row.
 */
function checkCode(deps: AppDeps, binding: string, code: string) {
  const now = deps.now();
  const rows = activeTokens(deps.db, 'email_signin', eq(oneTimeTokens.bindingHash, hashOf(deps, 'bind', binding)), now)
    .all()
    .filter((r) => r.codeHash && r.codeAttempts < CODE_MAX_ATTEMPTS && !codeLocked(deps.db, r.userId, now));
  if (!rows.length) return { row: null, wrong: false };
  const given = hashOf(deps, 'code', code);
  const match = rows.find((r) => timingSafeEqualStr(r.codeHash!, given));
  if (match) return { row: match, wrong: false };
  let left = 0;
  for (const r of rows) {
    const attempts = r.codeAttempts + 1;
    deps.db
      .update(oneTimeTokens)
      .set({ codeAttempts: attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { usedAt: now } : {}) })
      .where(eq(oneTimeTokens.id, r.id))
      .run();
    recordCodeFailure(deps.db, r.userId, now);
    if (!codeLocked(deps.db, r.userId, now)) left = Math.max(left, CODE_MAX_ATTEMPTS - attempts);
  }
  return { row: null, wrong: true, attemptsLeft: left };
}

export function completeEmailCode(deps: AppDeps, requestId: string, code: string) {
  // The wrong-try count must be stored even though the request fails, so the check runs in its own
  // transaction before the error is thrown.
  const checked = tx(deps.db, () => {
    const c = checkCode(deps, requestId, code);
    return c.row ? { ok: true as const, result: finishEmailSignIn(deps, c.row) } : { ok: false as const, attemptsLeft: c.attemptsLeft ?? 0 };
  });
  if (!checked.ok) throw new AppError('UNAUTHENTICATED', 'Wrong or expired code', { reason: 'SIGNIN_CODE_INVALID', attemptsLeft: checked.attemptsLeft });
  return checked.result;
}

// ---------------------------------------------------------------- switching method (profile)
const sessionBinding = (session: SessionRow) => `switch:${session.id}`;

export function startEmailLinkMethod(deps: AppDeps, user: UserRow, session: SessionRow) {
  if (user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Administrator accounts sign in with a password', { reason: 'ADMIN_PASSWORD_REQUIRED' });
  if (user.signInMethod === 'email_link') throw invalid('This account already signs in with email links', { reason: 'ALREADY_EMAIL_LINK' });
  if (!emailLinkEnabled(deps)) throw invalid('Email sign-in is not available', { reason: 'SMTP_NOT_CONFIGURED' });
  if (!user.email) throw invalid('Your account has no email address', { reason: 'NO_EMAIL' });
  if (issueSignIn(deps, user, '', sessionBinding(session), false) === null) throw new AppError('RATE_LIMITED', 'Too many emails. Try again later.');
}

export function confirmEmailLinkMethod(deps: AppDeps, user: UserRow, session: SessionRow, code: string) {
  const now = deps.now();
  const checked = tx(deps.db, () => {
    const c = checkCode(deps, sessionBinding(session), code);
    if (!c.row) return { ok: false as const, attemptsLeft: c.attemptsLeft ?? 0 };
    deps.db.update(oneTimeTokens).set({ usedAt: now }).where(eq(oneTimeTokens.id, c.row.id)).run();
    deps.db.update(users).set({ signInMethod: 'email_link', passwordHash: '', emailVerifiedAt: now, mustChangePassword: false, updatedAt: now }).where(eq(users.id, user.id)).run();
    revokeAllUserSessions(deps.db, user.id, now, session.id);
    invalidateResetTokens(deps.db, user.id, now);
    revokeAllUserMcpTokens(deps.db, actorFor(user), user.id, now, 'method_change');
    audit(deps.db, actorFor(user), { action: 'auth.method_change', entity: 'user', entityId: user.id, before: { method: 'password' }, after: { method: 'email_link' } }, now);
    return { ok: true as const };
  });
  if (!checked.ok) throw new AppError('UNAUTHENTICATED', 'Wrong or expired code', { reason: 'SIGNIN_CODE_INVALID', attemptsLeft: checked.attemptsLeft });
  return meOf(deps, user.id, session.id);
}

export async function switchToPassword(deps: AppDeps, user: UserRow, session: SessionRow, newPassword: string, fresh: boolean) {
  if (user.signInMethod !== 'email_link') throw invalid('This account already uses a password', { reason: 'ALREADY_PASSWORD' });
  if (!fresh) throw new AppError('UNAUTHENTICATED', 'Sign in again with a fresh email link first', { reason: 'REAUTH_REQUIRED' });
  const passwordHash = await hashPassword(newPassword);
  const now = deps.now();
  tx(deps.db, () => {
    deps.db.update(users).set({ signInMethod: 'password', passwordHash, mustChangePassword: false, updatedAt: now }).where(eq(users.id, user.id)).run();
    revokeAllUserSessions(deps.db, user.id, now, session.id);
    revokeAllUserMcpTokens(deps.db, actorFor(user), user.id, now, 'method_change');
    audit(deps.db, actorFor(user), { action: 'auth.method_change', entity: 'user', entityId: user.id, before: { method: 'email_link' }, after: { method: 'password' } }, now);
  });
  return meOf(deps, user.id, session.id);
}

export function meOf(deps: AppDeps, userId: string, sessionId: string) {
  const user = getUser(deps.db, userId);
  const session = deps.db.select().from(sessions).where(eq(sessions.id, sessionId)).get()!;
  return toMe(deps.db, user, session, deps.now());
}

/** Active email-link accounts (Maintenance warns when SMTP is off: they cannot sign in). */
export function emailLinkAccountCount(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(users).where(and(eq(users.signInMethod, 'email_link'), isNull(users.disabledAt))).get()?.n ?? 0;
}
