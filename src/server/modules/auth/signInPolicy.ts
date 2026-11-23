/**
 * School sign-in policy (S30, D-207): "Teachers sign in with email links only".
 *
 * While the school setting is on, a teacher account has no password and cannot get one: password
 * sign-in is refused, an invite offers email links only, the profile cannot switch back, and neither
 * an administrator's reset nor an emailed reset link sets one. Administrators always keep a password
 * (D-108). Switching the setting on or off, with the checks and the removal of the teachers'
 * passwords, is `setTeacherEmailLinkOnly` in the admin module.
 *
 * This file only reads the setting, so the sign-in code can use it without an import cycle.
 */
import type { Db } from '../../db/client.ts';
import type { UserRow } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { getSchoolSettings } from '../school/policy.ts';

export const teacherEmailLinkOnly = (db: Db): boolean => getSchoolSettings(db).teacherEmailLinkOnly;

/** This account may neither have nor use a password right now. */
export const passwordBlocked = (db: Db, user: Pick<UserRow, 'role'>): boolean => user.role === 'teacher' && teacherEmailLinkOnly(db);

export const emailLinkRequired = () => new AppError('FORBIDDEN', 'Teachers sign in with email links at this school', { reason: 'EMAIL_LINK_REQUIRED' });
