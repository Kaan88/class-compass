/** Administrator contracts (ACC-1/2/9, DAT-3, DAT-5): accounts and the audit log. */
import { z } from 'zod';
import { Empty, Ok, endpoint } from './define.ts';
import { Id, Locale } from './school.ts';

export const AdminUser = z.object({
  id: z.string(),
  login: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: z.enum(['admin', 'teacher']),
  active: z.boolean(),
  hasPin: z.boolean(),
  mustChangePassword: z.boolean(),
  /** Interface language of the account (S13a, D-099): first sign-in, password change and PIN setup use it. */
  locale: Locale,
  /** S13b (D-108): how the account signs in, whether the address was proven, and a pending invite. */
  signInMethod: z.enum(['password', 'email_link']),
  emailVerified: z.boolean(),
  invitePending: z.boolean(),
  inviteExpiresAt: z.number().nullable(),
  /** S31 (D-208): the account has signed in with Google (its Google id is stored). */
  googleLinked: z.boolean(),
  /** S33 (D-210): how many passkeys the account has. */
  passkeys: z.number().int(),
  createdAt: z.number(),
});

/** A new invite link, shown to the administrator once (copy / QR); emailed when SMTP is configured. */
export const InviteOut = z.object({ link: z.string(), expiresAt: z.number(), emailed: z.boolean() });

const Email = z.string().trim().toLowerCase().email().max(200);

export const listUsers = endpoint({ method: 'GET', path: '/api/admin/users', access: 'admin', input: Empty, output: z.object({ users: z.array(AdminUser) }) });

/**
 * Creates an account. `setup: 'invite'` (default, S13b) returns a single-use invite link (7 days)
 * where the person chooses how to sign in; `'temporary_password'` is the fallback: a temporary
 * password returned exactly once and never stored in clear.
 */
export const createUserByAdmin = endpoint({
  method: 'POST',
  path: '/api/admin/users',
  access: 'admin',
  input: z.object({
    login: z.string().trim().min(3).max(64),
    displayName: z.string().trim().min(1).max(120),
    /** Required since D-212: invites, email sign-in links, password resets and Google sign-in all need it. */
    email: Email,
    role: z.enum(['admin', 'teacher']),
    /** Required in the form (default English); the API falls back to English when it is left out. */
    locale: Locale.default('en'),
    setup: z.enum(['invite', 'temporary_password']).default('invite'),
  }),
  output: z.object({ user: AdminUser, temporaryPassword: z.string().nullable(), invite: InviteOut.nullable() }),
});

/** Send a new invite (the previous one stops working); also how an administrator resets a sign-in method. */
export const inviteUser = endpoint({ method: 'POST', path: '/api/admin/users/:userId/invite', access: 'admin', input: z.object({ userId: Id }), output: z.object({ user: AdminUser, invite: InviteOut }) });
export const revokeUserInvite = endpoint({ method: 'POST', path: '/api/admin/users/:userId/invite/revoke', access: 'admin', input: z.object({ userId: Id }), output: AdminUser });

export const updateUserByAdmin = endpoint({
  method: 'PATCH',
  path: '/api/admin/users/:userId',
  access: 'admin',
  input: z.object({ userId: Id, displayName: z.string().trim().min(1).max(120).optional(), email: Email.nullable().optional(), locale: Locale.optional() }),
  output: AdminUser,
});

export const deactivateUser = endpoint({ method: 'POST', path: '/api/admin/users/:userId/deactivate', access: 'admin', input: z.object({ userId: Id }), output: AdminUser });
export const reactivateUser = endpoint({ method: 'POST', path: '/api/admin/users/:userId/reactivate', access: 'admin', input: z.object({ userId: Id }), output: AdminUser });
export const resetUserPassword = endpoint({
  method: 'POST',
  path: '/api/admin/users/:userId/reset-password',
  access: 'admin',
  input: z.object({ userId: Id }),
  output: z.object({ temporaryPassword: z.string() }),
});
/** Removes every passkey of an account (a lost or stolen device); the person adds new ones after signing in another way. */
export const removeUserPasskeys = endpoint({ method: 'POST', path: '/api/admin/users/:userId/passkeys/remove', access: 'admin', input: z.object({ userId: Id }), output: AdminUser });
export const clearUserPin = endpoint({ method: 'POST', path: '/api/admin/users/:userId/clear-pin', access: 'admin', input: z.object({ userId: Id }), output: Ok });

// ---------------------------------------------------------------- sign-in policy (S30, D-207)
/**
 * "Nobody signs in with a password". `emailReady`: the school's email is set up (needed to switch it
 * on). `accountsWithPassword`: accounts whose password switching it on removes, administrators
 * included. `accountsWithoutEmail`: active accounts that could not sign in then; it cannot be switched
 * on while there are any. `ownEmail`: where the confirmation code for the administrator goes.
 */
export const SignInPolicy = z.object({
  passwordsOff: z.boolean(),
  emailReady: z.boolean(),
  accountsWithPassword: z.number().int(),
  accountsWithoutEmail: z.array(z.object({ id: z.string(), displayName: z.string() })),
  ownEmail: z.string().nullable(),
});
export const getSignInPolicy = endpoint({ method: 'GET', path: '/api/admin/sign-in-policy', access: 'admin', input: Empty, output: SignInPolicy });
/** Emails the administrator the code that `setSignInPolicy` needs to switch passwords off. */
export const requestSignInPolicyCode = endpoint({ method: 'POST', path: '/api/admin/sign-in-policy/code', access: 'admin', input: Empty, output: Ok });
/**
 * Switching passwords off needs the emailed `code` and removes every account's password in the same
 * step, the administrator's own too (everyone signs in with an emailed link or code, or Google, from
 * then on; sessions that are open stay open). Switching them on again gives no password back: a
 * person chooses one in the profile, or an administrator resets it.
 */
export const setSignInPolicy = endpoint({
  method: 'PUT',
  path: '/api/admin/sign-in-policy',
  access: 'admin',
  input: z.object({ passwordsOff: z.boolean(), code: z.string().regex(/^\d{6}$/u).optional() }),
  output: SignInPolicy,
});

// ---------------------------------------------------------------- audit log
export const AuditItem = z.object({
  id: z.string(),
  at: z.number(),
  actorType: z.enum(['user', 'student', 'system', 'scorer', 'display']),
  /** The change came through an AI tool acting for this account (S14h1, D-160). */
  viaAiTool: z.boolean(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
});
export const queryAudit = endpoint({
  method: 'GET',
  path: '/api/admin/audit',
  access: 'admin',
  input: z.object({
    entity: z.string().max(60).optional(),
    entityId: Id.optional(),
    actorId: Id.optional(),
    action: z.string().max(80).optional(),
    from: z.coerce.number().int().optional(),
    to: z.coerce.number().int().optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }),
  output: z.object({ items: z.array(AuditItem), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() }),
});

/** The action and record-type codes that occur in the audit log, for the viewer's filter lists (translated on the client). */
export const auditCodes = endpoint({
  method: 'GET',
  path: '/api/admin/audit/codes',
  access: 'admin',
  input: z.object({}),
  output: z.object({ actions: z.array(z.string()), entities: z.array(z.string()) }),
});
