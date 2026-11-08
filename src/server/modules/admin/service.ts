/**
 * Account administration (ACC-1/2/3, DAT-3) and audit-log queries (DAT-5, ACC-9).
 * Temporary passwords are generated server-side, returned once, and only their hash is stored.
 */
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/admin.ts';
import { compareNames, normaliseName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { auditEvents, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext, UserRow } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { hashPassword, randomToken } from '../../lib/crypto.ts';
import { conflict, invalid, notFound } from '../../lib/errors.ts';
import { createUser, insertUser, invalidateResetTokens, revokeAllUserSessions } from '../auth/service.ts';
import { inviteStatus, issueInvite, revokeInvite } from '../auth/emailSignIn.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

/** 16 URL-safe characters (~96 bits). */
export const temporaryPassword = () => randomToken(12);

export function adminUserDto(u: UserRow, invite: { pending: boolean; expiresAt: number | null } = { pending: false, expiresAt: null }) {
  return {
    signInMethod: u.signInMethod,
    emailVerified: u.emailVerifiedAt !== null,
    invitePending: invite.pending,
    inviteExpiresAt: invite.expiresAt,
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

const dtoOf = (deps: Pick<RequestContext, 'db' | 'now'>, u: UserRow) => adminUserDto(u, inviteStatus(deps.db, u.id, deps.now()));

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
  const base = { login: input.login, displayName: normaliseName(input.displayName), role: input.role, email: input.email ?? null, locale };
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
    ctx.db.update(users).set({ ...patch, updatedAt: ctx.now() }).where(eq(users.id, u.id)).run();
    // A reset link already mailed to the previous address must stop working (D-015).
    if (patch.email !== undefined && patch.email !== u.email) invalidateResetTokens(ctx.db, u.id, ctx.now());
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
      ctx.db.update(users).set({ disabledAt: active ? null : now, updatedAt: now }).where(eq(users.id, u.id)).run();
      if (!active) {
        revokeAllUserSessions(ctx.db, u.id, now);
        invalidateResetTokens(ctx.db, u.id, now);
      }
      audit(ctx.db, ctx.actor, { action: active ? 'user.reactivate' : 'user.deactivate', entity: 'user', entityId: u.id }, now);
    }
    return dtoOf(ctx, getUser(ctx.db, u.id));
  });
}

export async function resetPasswordByAdmin(ctx: RequestContext, userId: string) {
  const u = getUser(ctx.db, userId);
  if (u.id === requireUser(ctx).id) throw invalid('Use “change password” for your own account', { reason: 'OWN_PASSWORD' });
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  tx(ctx.db, () => {
    const now = ctx.now();
    // Also the way back from email-link sign-in (e.g. SMTP was turned off, D-108).
    ctx.db.update(users).set({ passwordHash, mustChangePassword: true, signInMethod: 'password', updatedAt: now }).where(eq(users.id, u.id)).run();
    revokeAllUserSessions(ctx.db, u.id, now);
    invalidateResetTokens(ctx.db, u.id, now);
    audit(ctx.db, ctx.actor, { action: 'auth.password_reset_admin', entity: 'user', entityId: u.id }, now);
  });
  return { temporaryPassword: password };
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
