/** Administrator contracts (ACC-1/2/9, DAT-3, DAT-5): accounts and the audit log. */
import { z } from 'zod';
import { Empty, Ok, endpoint } from './define.ts';
import { Id } from './school.ts';

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
  locale: z.enum(['en', 'tr']),
  createdAt: z.number(),
});

const Email = z.string().trim().toLowerCase().email().max(200);

export const listUsers = endpoint({ method: 'GET', path: '/api/admin/users', access: 'admin', input: Empty, output: z.object({ users: z.array(AdminUser) }) });

/** The temporary password is returned exactly once and never stored in clear. */
export const createUserByAdmin = endpoint({
  method: 'POST',
  path: '/api/admin/users',
  access: 'admin',
  input: z.object({
    login: z.string().trim().min(3).max(64),
    displayName: z.string().trim().min(1).max(120),
    email: Email.nullable().optional(),
    role: z.enum(['admin', 'teacher']),
    /** Required in the form (default English); the API falls back to English when it is left out. */
    locale: z.enum(['en', 'tr']).default('en'),
  }),
  output: z.object({ user: AdminUser, temporaryPassword: z.string() }),
});

export const updateUserByAdmin = endpoint({
  method: 'PATCH',
  path: '/api/admin/users/:userId',
  access: 'admin',
  input: z.object({ userId: Id, displayName: z.string().trim().min(1).max(120).optional(), email: Email.nullable().optional(), locale: z.enum(['en', 'tr']).optional() }),
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
export const clearUserPin = endpoint({ method: 'POST', path: '/api/admin/users/:userId/clear-pin', access: 'admin', input: z.object({ userId: Id }), output: Ok });

// ---------------------------------------------------------------- audit log
export const AuditItem = z.object({
  id: z.string(),
  at: z.number(),
  actorType: z.enum(['user', 'student', 'system']),
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
