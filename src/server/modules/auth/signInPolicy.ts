/**
 * School sign-in policy (S30, D-207): "Nobody signs in with a password".
 *
 * While the school setting is on, no account has a password or can get one, administrators included:
 * password sign-in is refused, an invite offers no password, the profile cannot switch back, and
 * neither an administrator's reset nor an emailed reset link sets one. People sign in with an emailed
 * link or code, or with Google when the school has set it up (D-208). The first administrator is made
 * on the server with a password (`admin:create`) and switches the setting on afterwards; the way back
 * when nobody can sign in (mail is down) is `signin:allow-passwords` on the server. Switching the
 * setting, with its checks and the removal of the passwords, is `setPasswordsOff` in the admin module.
 *
 * This file only reads the setting, so the sign-in code can use it without an import cycle.
 */
import type { Db } from '../../db/client.ts';
import type { UserRow } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { getSchoolSettings } from '../school/policy.ts';

export const passwordsOff = (db: Db): boolean => getSchoolSettings(db).passwordsOff;

/** No account may have or use a password right now. */
export const passwordBlocked = (db: Db): boolean => passwordsOff(db);

/**
 * May this account sign in without a password (email links, Google)? Teachers always may choose to
 * (D-108). An administrator only once the school has switched passwords off, or while the account is
 * still an email-link account after the school switched them back on.
 */
export const passwordlessAllowed = (db: Db, user: Pick<UserRow, 'role' | 'signInMethod'>): boolean =>
  user.role === 'teacher' || user.signInMethod === 'email_link' || passwordsOff(db);

export const emailLinkRequired = () => new AppError('FORBIDDEN', 'Nobody signs in with a password at this school', { reason: 'EMAIL_LINK_REQUIRED' });
