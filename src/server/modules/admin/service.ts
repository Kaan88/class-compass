/**
 * Account administration (ACC-1/2/3, DAT-3) and audit-log queries (DAT-5, ACC-9).
 * Temporary passwords are generated server-side, returned once, and only their hash is stored.
 */
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/admin.ts';
import { compareNames, normaliseName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { auditEvents, schoolSettings, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext, UserRow } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { hashPassword, randomToken } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { createUser, insertUser, invalidateResetTokens, revokeAllUserMcpTokens, revokeAllUserSessions } from '../auth/service.ts';
import { emailLinkEnabled, inviteStatus, issueInvite, revokeEmailLinks, revokeInvite, sendPolicyCode, usePolicyCode } from '../auth/emailSignIn.ts';
import { emailLinkRequired, passwordBlocked, passwordsOff } from '../auth/signInPolicy.ts';
import { passkeyCount, removeAllPasskeys } from '../auth/passkeys.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

/** 16 URL-safe characters (~96 bits). */
export const temporaryPassword = () => randomToken(12);

export function adminUserDto(u: UserRow, invite: { pending: boolean; expiresAt: number | null } = { pending: false, expiresAt: null }, passkeys = 0) {
  return {
    passkeys,
    signInMethod: u.signInMethod,
    emailVerified: u.emailVerifiedAt !== null,
    invitePending: invite.pending,
    inviteExpiresAt: invite.expiresAt,
    googleLinked: u.googleSub !== null,
    id: u.id,
    login: u.login,
    displayName: u.displayName,
    email: u.email,
    role: u.role,
    active: u.disabledAt === null,
    hasPin: u.pinHash !== null,
    mustChangePassword: u.mustChangePassword,
    locale: u.locale,
    createdAt: u.createdAt,
  };
}

function getUser(db: Db, id: string): UserRow {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw notFound('Account');
  return u;
}

const dtoOf = (deps: Pick<RequestContext, 'db' | 'now'>, u: UserRow) => adminUserDto(u, inviteStatus(deps.db, u.id, deps.now()), passkeyCount(deps.db, u.id));

export function listUsers(deps: Pick<RequestContext, 'db' | 'now'>) {
  return deps.db
    .select()
    .from(users)
    .all()
    .sort((a, b) => compareNames(a.displayName, b.displayName))
    .map((u) => dtoOf(deps, u));
}

export async function createUserByAdmin(ctx: RequestContext, input: In<typeof C.createUserByAdmin>) {
  // The admin chooses the new account's interface language (S13a, D-099), English by default.
  const locale = input.locale;
  const base = { login: input.login, displayName: normaliseName(input.displayName), role: input.role, email: input.email, locale };
  // D-207: while passwords are off, a new account gets an invite, never a password (the address is always required, D-212).
  if (passwordBlocked(ctx.db) && input.setup === 'temporary_password') throw emailLinkRequired();
  if (input.setup === 'temporary_password') {
    const password = temporaryPassword();
    const u = await createUser(ctx.db, { ...base, password, mustChangePassword: true }, ctx.actor, ctx.now());
    return { user: dtoOf(ctx, u), temporaryPassword: password, invite: null };
  }
  // Invite (S13b, D-108): no password yet (''), so nobody can sign in until the invite is used.
  const u = insertUser(ctx.db, { ...base, mustChangePassword: false }, '', ctx.actor, ctx.now());
  const invite = issueInvite(ctx, u, ctx.actor);
  return { user: dtoOf(ctx, u), temporaryPassword: null, invite };
}

export function inviteUserByAdmin(ctx: RequestContext, userId: string) {
  const u = getUser(ctx.db, userId);
  if (u.disabledAt) throw conflict('Reactivate the account first', { reason: 'ACCOUNT_INACTIVE' });
  const invite = issueInvite(ctx, u, ctx.actor);
  return { user: dtoOf(ctx, getUser(ctx.db, userId)), invite };
}

export function revokeInviteByAdmin(ctx: RequestContext, userId: string) {
  revokeInvite(ctx, userId, ctx.actor);
  return dtoOf(ctx, getUser(ctx.db, userId));
}

export function updateUserByAdmin(ctx: RequestContext, input: In<typeof C.updateUserByAdmin>) {
  return tx(ctx.db, () => {
    const u = getUser(ctx.db, input.userId);
    const patch: Partial<UserRow> = {};
    if (input.displayName !== undefined) patch.displayName = normaliseName(input.displayName);
    if (input.email !== undefined) patch.email = input.email?.trim().toLowerCase() || null;
    if (input.locale !== undefined) patch.locale = input.locale;
    // D-207: without an address the account could not sign in at all.
    if (patch.email === null && u.email !== null && passwordBlocked(ctx.db)) throw invalid('The account needs an email address to sign in', { reason: 'EMAIL_REQUIRED' });
    const emailChanged = patch.email !== undefined && patch.email !== u.email;
    // A new address is not verified until a mail to it is used (an invite or a sign-in link).
    // The Google id and the id of the operator's sign-in server belonged to the previous address (D-208, D-213): the new one must be proven again.
    ctx.db.update(users).set({ ...patch, ...(emailChanged ? { emailVerifiedAt: null, googleSub: null, ssoSub: null } : {}), updatedAt: ctx.now() }).where(eq(users.id, u.id)).run();
    // Reset links, invites and sign-in links already mailed to the previous address must stop working (D-015, D-108).
    if (emailChanged) {
      invalidateResetTokens(ctx.db, u.id, ctx.now());
      revokeEmailLinks(ctx.db, u.id, ctx.now());
    }
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, u[k as keyof UserRow]]));
    audit(ctx.db, ctx.actor, { action: 'user.update', entity: 'user', entityId: u.id, before, after: patch }, ctx.now());
    return dtoOf(ctx, getUser(ctx.db, u.id));
  });
}

function activeAdminCount(db: Db, exceptId: string) {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), isNull(users.disabledAt), ne(users.id, exceptId)))
      .get()?.n ?? 0
  );
}

/** Deactivation blocks sign-in and ends sessions; the account row, assignments and history stay (DAT-3). */
export function setUserActive(ctx: RequestContext, userId: string, active: boolean) {
  return tx(ctx.db, () => {
    const u = getUser(ctx.db, userId);
    if (!active) {
      if (u.id === requireUser(ctx).id) throw invalid('You cannot deactivate your own account', { reason: 'SELF_DEACTIVATE' });
      if (u.role === 'admin' && activeAdminCount(ctx.db, u.id) === 0) throw conflict('At least one active administrator is required', { reason: 'LAST_ADMIN' });
    }
    if ((u.disabledAt === null) !== active) {
      const now = ctx.now();
      // A deactivated account lets go of its Google id and its sign-in server id (D-208, D-213): otherwise the
      // old link would keep answering for that person and shut out a new account with the same address.
      ctx.db.update(users).set({ disabledAt: active ? null : now, ...(active ? {} : { googleSub: null, ssoSub: null }), updatedAt: now }).where(eq(users.id, u.id)).run();
      if (!active) {
        revokeAllUserSessions(ctx.db, u.id, now);
        invalidateResetTokens(ctx.db, u.id, now);
        // AI tools tokens end too, so a reactivation does not bring them back.
        revokeAllUserMcpTokens(ctx.db, ctx.actor, u.id, now, 'deactivated');
        // A pending invite must not work again after a reactivation (a new one can be sent then).
        revokeEmailLinks(ctx.db, u.id, now);
      }
      audit(ctx.db, ctx.actor, { action: active ? 'user.reactivate' : 'user.deactivate', entity: 'user', entityId: u.id }, now);
    }
    return dtoOf(ctx, getUser(ctx.db, u.id));
  });
}

export async function resetPasswordByAdmin(ctx: RequestContext, userId: string) {
  const u = getUser(ctx.db, userId);
  if (u.id === requireUser(ctx).id) throw invalid('Use “change password” for your own account', { reason: 'OWN_PASSWORD' });
  if (passwordBlocked(ctx.db)) throw emailLinkRequired(); // D-207: send a new invite instead
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  tx(ctx.db, () => {
    const now = ctx.now();
    // Also the way back from email-link sign-in (e.g. SMTP was turned off, D-108).
    ctx.db.update(users).set({ passwordHash, mustChangePassword: true, signInMethod: 'password', updatedAt: now }).where(eq(users.id, u.id)).run();
    revokeAllUserSessions(ctx.db, u.id, now);
    invalidateResetTokens(ctx.db, u.id, now);
    revokeEmailLinks(ctx.db, u.id, now);
    revokeAllUserMcpTokens(ctx.db, ctx.actor, u.id, now, 'password_reset');
    audit(ctx.db, ctx.actor, { action: 'auth.password_reset_admin', entity: 'user', entityId: u.id }, now);
  });
  return { temporaryPassword: password };
}

/** A lost or stolen device (D-210): every passkey of the account stops working; its sessions end too. */
export function removePasskeysByAdmin(ctx: RequestContext, userId: string) {
  return tx(ctx.db, () => {
    const u = getUser(ctx.db, userId);
    const now = ctx.now();
    if (removeAllPasskeys(ctx.db, ctx.actor, u.id, now)) revokeAllUserSessions(ctx.db, u.id, now);
    return dtoOf(ctx, u);
  });
}

/**
 * Clear a forgotten PIN. The teacher's sessions are revoked too, so a locked classroom device can't
 * be left in a state where nobody can unlock it (and nobody else can take it over).
 */
export function clearPinByAdmin(ctx: RequestContext, userId: string) {
  tx(ctx.db, () => {
    const u = getUser(ctx.db, userId);
    const now = ctx.now();
    ctx.db.update(users).set({ pinHash: null, updatedAt: now }).where(eq(users.id, u.id)).run();
    revokeAllUserSessions(ctx.db, u.id, now);
    audit(ctx.db, ctx.actor, { action: 'auth.pin_cleared_admin', entity: 'user', entityId: u.id }, now);
  });
}

// ---------------------------------------------------------------- sign-in policy (S30, D-207)
const hasPassword = (u: UserRow) => u.signInMethod === 'password' && u.passwordHash !== '';
const withoutEmail = (all: UserRow[]) => all.filter((u) => u.disabledAt === null && !u.email);

export function signInPolicy(ctx: RequestContext) {
  const all = ctx.db.select().from(users).all();
  return {
    passwordsOff: passwordsOff(ctx.db),
    emailReady: emailLinkEnabled(ctx),
    accountsWithPassword: all.filter(hasPassword).length,
    accountsWithoutEmail: withoutEmail(all)
      .sort((a, b) => compareNames(a.displayName, b.displayName))
      .map((u) => ({ id: u.id, displayName: u.displayName })),
    ownEmail: requireUser(ctx).email,
  };
}

/** What must hold before passwords can be switched off: otherwise somebody is locked out. */
function assertCanSwitchOff(ctx: RequestContext, all: UserRow[]) {
  if (!emailLinkEnabled(ctx)) throw invalid('Email is not set up', { reason: 'SMTP_NOT_CONFIGURED' });
  if (withoutEmail(all).length) throw conflict('Every active account needs an email address first', { reason: 'ACCOUNTS_WITHOUT_EMAIL' });
}

/** Step 1 of switching passwords off: a code to the administrator's own address (it proves mail arrives). */
export function requestSignInPolicyCode(ctx: RequestContext) {
  assertCanSwitchOff(ctx, ctx.db.select().from(users).all());
  sendPolicyCode(ctx, requireUser(ctx), ctx.session!);
}

/**
 * "Nobody signs in with a password" (D-207). Switching it on needs working email, an address on every
 * active account and the code emailed to the administrator who asks, and in the same transaction
 * removes every password, the administrator's own included: each account becomes an email-link
 * account, its reset links and AI tool tokens stop (as for any change of sign-in method), and each
 * change is audited. Open sessions stay open, so a lesson that is running is not interrupted and the
 * administrator stays signed in. Switching it off changes no account.
 */
export function setPasswordsOff(ctx: RequestContext, on: boolean, code: string | undefined) {
  const done = tx(ctx.db, () => {
    const before = passwordsOff(ctx.db);
    if (on === before) return { ok: true as const };
    const now = ctx.now();
    let converted = 0;
    if (on) {
      const all = ctx.db.select().from(users).all();
      assertCanSwitchOff(ctx, all);
      if (!code) throw invalid('Type the code from the email', { reason: 'SIGNIN_CODE_INVALID' });
      const checked = usePolicyCode(ctx, ctx.session!, code);
      // A wrong try must be counted, so the transaction ends normally and the error follows it.
      if (!checked.ok) return checked;
      for (const u of all) {
        invalidateResetTokens(ctx.db, u.id, now);
        if (!hasPassword(u)) continue; // an email-link account already, or an invite that is still open
        ctx.db.update(users).set({ signInMethod: 'email_link', passwordHash: '', mustChangePassword: false, updatedAt: now }).where(eq(users.id, u.id)).run();
        revokeAllUserMcpTokens(ctx.db, ctx.actor, u.id, now, 'method_change');
        audit(ctx.db, ctx.actor, { action: 'auth.method_change', entity: 'user', entityId: u.id, before: { method: 'password' }, after: { method: 'email_link', reason: 'school_policy' } }, now);
        converted += 1;
      }
    }
    ctx.db.update(schoolSettings).set({ passwordsOff: on, updatedAt: now }).where(eq(schoolSettings.id, 1)).run();
    audit(ctx.db, ctx.actor, { action: 'school.sign_in_policy', entity: 'school', before: { passwordsOff: before }, after: { passwordsOff: on, ...(on ? { passwordsRemoved: converted } : {}) } }, now);
    return { ok: true as const };
  });
  if (!done.ok) throw new AppError('UNAUTHENTICATED', 'Wrong or expired code', { reason: 'SIGNIN_CODE_INVALID', attemptsLeft: done.attemptsLeft });
  return signInPolicy(ctx);
}

// ---------------------------------------------------------------- audit log
const SECRET_KEY = /(password|secret|token|hash|^pin$)/i;

/** Defence in depth: audit writers never store secrets, and the reader strips anything that looks like one. */
export function scrubSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubSecrets);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET_KEY.test(k)).map(([k, x]) => [k, scrubSecrets(x)]));
  }
  return v;
}

const parse = (s: string | null) => (s === null ? null : scrubSecrets(JSON.parse(s)));

/** Distinct action and record-type codes in the audit log (codes only, never values or ids). */
export function auditCodes(db: Db) {
  const actions = db.selectDistinct({ v: auditEvents.action }).from(auditEvents).all().map((r) => r.v);
  const entities = db.selectDistinct({ v: auditEvents.entity }).from(auditEvents).all().map((r) => r.v);
  return { actions: actions.sort(), entities: entities.sort() };
}

export function queryAudit(db: Db, input: In<typeof C.queryAudit>) {
  const conds = [];
  if (input.entity) conds.push(eq(auditEvents.entity, input.entity));
  if (input.entityId) conds.push(eq(auditEvents.entityId, input.entityId));
  if (input.actorId) conds.push(eq(auditEvents.actorId, input.actorId));
  if (input.action) conds.push(eq(auditEvents.action, input.action));
  if (input.from !== undefined) conds.push(gte(auditEvents.at, input.from));
  if (input.to !== undefined) conds.push(lte(auditEvents.at, input.to));
  const where = conds.length ? and(...conds) : undefined;
  const total = db.select({ n: sql<number>`count(*)` }).from(auditEvents).where(where).get()?.n ?? 0;
  const rows = db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize)
    .all();
  const actorIds = [...new Set(rows.filter((r) => r.actorType === 'user' && r.actorId).map((r) => r.actorId!))];
  const names = new Map(
    actorIds.length ? db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, actorIds)).all().map((u) => [u.id, u.displayName]) : [],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorType === 'system' ? null : (names.get(r.actorId ?? '') ?? null),
      viaAiTool: r.viaTokenId !== null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: parse(r.beforeJson),
      after: parse(r.afterJson),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}
