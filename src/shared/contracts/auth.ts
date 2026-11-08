import { z } from 'zod';
import { endpoint, Ok, Empty } from './define.ts';

export const Locale = z.enum(['en', 'tr']);
export type Locale = z.infer<typeof Locale>;

export const SignInMethod = z.enum(['password', 'email_link']);
export type SignInMethod = z.infer<typeof SignInMethod>;

export const Me = z.object({
  kind: z.literal('user'),
  id: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'teacher']),
  locale: Locale,
  textScale: z.number(),
  mustChangePassword: z.boolean(),
  hasPin: z.boolean(),
  /** S13b (D-108): password or email-link sign-in; whether the account has an email address. */
  signInMethod: SignInMethod,
  hasEmail: z.boolean(),
  /** This session was signed in with an email link, code or invite in the last 15 minutes (re-authentication for email-link accounts). */
  reauthFresh: z.boolean(),
  classroomMode: z.boolean(),
  pinUnlockedUntil: z.number().nullable(),
  /**
   * Server-computed: true when sensitive (teacher/admin/account) endpoints are currently usable on
   * this session — not in classroom mode, or PIN-unlocked. The client uses it instead of comparing
   * `pinUnlockedUntil` with its own (possibly skewed) clock.
   */
  pinUnlocked: z.boolean(),
});
export type Me = z.infer<typeof Me>;

export const login = endpoint({
  method: 'POST',
  path: '/api/auth/login',
  access: 'public',
  input: z.object({ login: z.string().min(1).max(100), password: z.string().min(1).max(200) }),
  output: Me,
});

export const logout = endpoint({ method: 'POST', path: '/api/auth/logout', access: 'user', input: Empty, output: Ok });

export const me = endpoint({ method: 'GET', path: '/api/auth/me', access: 'user', input: Empty, output: Me });

export const changePassword = endpoint({
  method: 'POST',
  path: '/api/auth/password',
  access: 'account',
  allowWithTemporaryPassword: true,
  input: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) }),
  output: Ok,
});

export const PinString = z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits');

export const setPin = endpoint({
  method: 'POST',
  path: '/api/auth/pin',
  access: 'account',
  /** `currentPassword` for password accounts; email-link accounts need a fresh email sign-in instead (D-108). */
  input: z.object({ currentPassword: z.string().min(1).max(200).optional(), pin: PinString }),
  output: Ok,
});

/** Enter classroom mode on this device: engages the PIN lock (PIN-6). */
export const enterClassroom = endpoint({
  method: 'POST',
  path: '/api/classroom/enter',
  access: 'user',
  input: Empty,
  output: z.object({ classroomMode: z.literal(true) }),
});

/** Leave classroom mode entirely (requires PIN unlock first). */
export const leaveClassroom = endpoint({
  method: 'POST',
  path: '/api/classroom/leave',
  access: 'teacher',
  input: Empty,
  output: Ok,
});

export const unlockPin = endpoint({
  method: 'POST',
  path: '/api/auth/pin/unlock',
  access: 'user',
  input: z.object({ pin: PinString }),
  output: z.object({ unlockedUntil: z.number() }),
});

export const lockNow = endpoint({ method: 'POST', path: '/api/auth/lock', access: 'user', input: Empty, output: Ok });

export const updatePreferences = endpoint({
  method: 'PATCH',
  path: '/api/auth/preferences',
  access: 'user',
  input: z.object({ locale: Locale.optional(), textScale: z.number().int().min(80).max(200).optional() }),
  output: Me,
});

// ---------------------------------------------------------------- email password reset (D-015)
/** Whether email reset is offered (SMTP configured). Public so the sign-in page can show the link. */
export const passwordResetAvailable = endpoint({
  method: 'GET',
  path: '/api/auth/password-reset',
  access: 'public',
  input: Empty,
  /**
   * `emailLinkEnabled`: email-link sign-in is offered (SMTP configured, S13b). `defaultLocale`: the
   * school's language for new accounts (D-025), the sign-in pages' language until the device picks one.
   */
  output: z.object({ emailResetEnabled: z.boolean(), emailLinkEnabled: z.boolean(), defaultLocale: Locale }),
});

/** Always answers `{ ok: true }` so the response never reveals whether an account exists. */
export const requestPasswordReset = endpoint({
  method: 'POST',
  path: '/api/auth/password-reset/request',
  access: 'public',
  input: z.object({ email: z.string().trim().max(200) }),
  output: Ok,
});

export const completePasswordReset = endpoint({
  method: 'POST',
  path: '/api/auth/password-reset/complete',
  access: 'public',
  input: z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(10).max(200) }),
  output: Ok,
});

// ---------------------------------------------------------------- invites and email-link sign-in (S13b, D-108)
const TokenString = z.string().min(20).max(200);
export const SixDigitCode = z.string().regex(/^\d{6}$/u, 'The code has 6 digits');

/** What the invite page needs (POST so the token never appears in a URL or log). Does not use the invite. */
export const inspectInvite = endpoint({
  method: 'POST',
  path: '/api/auth/invite/inspect',
  access: 'public',
  input: z.object({ token: TokenString }),
  output: z.object({
    displayName: z.string(),
    login: z.string(),
    role: z.enum(['admin', 'teacher']),
    locale: Locale,
    /** Email-link sign-in is offered to teachers (always shown; disabled with a reason when SMTP is not configured or the account has no email). */
    emailLinkAllowed: z.boolean(),
    emailLinkAvailable: z.boolean(),
    emailLinkUnavailableReason: z.enum(['SMTP_NOT_CONFIGURED', 'NO_EMAIL']).nullable(),
    expiresAt: z.number(),
  }),
});

/**
 * Use an invite: choose password (set here) or email-link sign-in. Signs in (status 'signed_in', the
 * PIN comes next), or, for email-link when the invite was not emailed, sends a first sign-in email and
 * returns a `requestId` for the code (status 'check_email').
 */
export const acceptInvite = endpoint({
  method: 'POST',
  path: '/api/auth/invite/accept',
  access: 'public',
  input: z.object({ token: TokenString, method: SignInMethod, password: z.string().min(10).max(200).optional() }),
  output: z.object({ status: z.enum(['signed_in', 'check_email']), me: Me.nullable(), requestId: z.string().nullable() }),
});

/** Always the same answer (no account enumeration): a request id that binds the 6-digit code to this device. */
export const requestEmailLink = endpoint({
  method: 'POST',
  path: '/api/auth/email-link/request',
  access: 'public',
  input: z.object({ email: z.string().trim().max(200) }),
  output: z.object({ ok: z.literal(true), requestId: z.string() }),
});

/** The landing page's button (POST): a link pre-fetched by a mail scanner is never used. */
export const completeEmailLink = endpoint({
  method: 'POST',
  path: '/api/auth/email-link/complete',
  access: 'public',
  input: z.object({ token: TokenString }),
  output: Me,
});

/** The 6-digit code typed on the device that asked for the email (5 tries). */
export const completeEmailCode = endpoint({
  method: 'POST',
  path: '/api/auth/email-link/code',
  access: 'public',
  input: z.object({ requestId: TokenString, code: SixDigitCode }),
  output: Me,
});

/** Switching to email-link sign-in, step 1: current password, then a code is emailed to the account's address. */
export const startEmailLinkMethod = endpoint({
  method: 'POST',
  path: '/api/auth/sign-in-method/email-link/start',
  access: 'account',
  input: z.object({ currentPassword: z.string().min(1).max(200) }),
  output: Ok,
});

/** Step 2: the emailed code proves the address; the password is removed. */
export const confirmEmailLinkMethod = endpoint({
  method: 'POST',
  path: '/api/auth/sign-in-method/email-link/confirm',
  access: 'account',
  input: z.object({ code: SixDigitCode }),
  output: Me,
});

/** Back to a password (needs a fresh email sign-in on this session). */
export const switchToPassword = endpoint({
  method: 'POST',
  path: '/api/auth/sign-in-method/password',
  access: 'account',
  input: z.object({ newPassword: z.string().min(10).max(200) }),
  output: Me,
});
