import { z } from 'zod';
import { LOCALES } from '../languages.ts';
import { endpoint, Ok, Empty } from './define.ts';

/** The ready interface languages (S26c, D-191: `shared/languages.ts`; a language that is not ready is refused). */
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

/**
 * S22d (D-178): how roomy the teacher and admin areas are, per account (user setting `area.density`).
 * Compact / Normal / Large change spacing, table row height and card padding only (layout variables
 * on `<html data-area-density>`); touch targets keep `--cc-touch`. Normal is the look before S22d.
 * The classroom screen sizes its student cards by itself (the D-177 fit; its own choice was removed
 * in S27c, D-195).
 */
export const AREA_DENSITIES = ['compact', 'normal', 'large'] as const;
export const AreaDensity = z.enum(AREA_DENSITIES);
export type AreaDensity = z.infer<typeof AreaDensity>;
export const DEFAULT_AREA_DENSITY: AreaDensity = 'normal';

export const SignInMethod = z.enum(['password', 'email_link']);
export type SignInMethod = z.infer<typeof SignInMethod>;

export const Me = z.object({
  kind: z.literal('user'),
  id: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'teacher']),
  locale: Locale,
  textScale: z.number(),
  /** S22d (D-178): Compact / Normal / Large in the teacher and admin areas (per account). */
  density: AreaDensity,
  mustChangePassword: z.boolean(),
  hasPin: z.boolean(),
  /** S13b (D-108): password or email-link sign-in; whether the account has an email address. */
  signInMethod: SignInMethod,
  hasEmail: z.boolean(),
  /**
   * S35: a password account with no password yet (invited, then signed in through the operator's
   * sign-in server without opening the invite, D-213). Profile tells the person to open the invite.
   */
  passwordNotSet: z.boolean(),
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
  input: z.object({ locale: Locale.optional(), textScale: z.number().int().min(80).max(200).optional(), density: AreaDensity.optional() }),
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
   * `passwordsOff`: nobody signs in with a password at this school (S30, D-207), so the sign-in page
   * shows no password form and the profile offers no way back to a password. `googleSignInEnabled`: the
   * server has a Google client, so the sign-in page offers "Sign in with Google" (S31, D-208).
   * `passkeysEnabled`: passkeys can work on this address (S33, D-210; not on a bare IP address).
   */
  output: z.object({
    emailResetEnabled: z.boolean(),
    emailLinkEnabled: z.boolean(),
    passwordsOff: z.boolean(),
    googleSignInEnabled: z.boolean(),
    passkeysEnabled: z.boolean(),
    /** S34 (D-213): the operator's own sign-in server, when set up: the button's name and whether it has an icon. */
    sso: z.object({ name: z.string(), hasIcon: z.boolean() }).nullable(),
    defaultLocale: Locale,
  }),
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
    /** False while the school has switched passwords off (S30, D-207): no password choice, for any role. */
    passwordAllowed: z.boolean(),
    /** Email-link sign-in is offered to teachers, and to administrators while passwords are off (always shown; disabled with a reason when SMTP is not configured or the account has no email). */
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

// ---------------------------------------------------------------- Sign in with Google (S31, D-208)
/**
 * S36 (D-216): the proven address belongs to several accounts the person may be (D-108). Nothing is
 * signed in; the page lets the person choose. Only the name and the role of each account: no login
 * name, no address.
 */
export const ChooseAccount = z.object({
  choose: z
    .array(z.object({ id: z.string(), displayName: z.string(), role: z.enum(['admin', 'teacher']) }))
    .min(2)
    .max(10),
});
/** A finished provider sign-in: signed in, or the accounts to choose from. */
export const ProviderSignInResult = z.union([ChooseAccount, Me]);
/** The account chosen from the list; the proof comes from the short-lived cookie the list set. */
const ChooseInput = z.object({ userId: z.string().min(1).max(100) });

/**
 * Where to send the browser. Also sets a short-lived HttpOnly cookie that binds Google's answer to this
 * browser. Teachers only; nothing about any account is revealed.
 */
export const startGoogleSignIn = endpoint({
  method: 'POST',
  path: '/api/auth/google/start',
  access: 'public',
  input: Empty,
  output: z.object({ authorizeUrl: z.string() }),
});

/**
 * The `state` and `code` Google sent back to `/signin-google`, posted by that page (a GET never uses a
 * code). Several accounts with the proven address (2 to 10): the list to choose from, and a 5-minute cookie (D-216).
 */
export const completeGoogleSignIn = endpoint({
  method: 'POST',
  path: '/api/auth/google/complete',
  access: 'public',
  input: z.object({ state: z.string().min(20).max(200), code: z.string().min(1).max(2000) }),
  output: ProviderSignInResult,
});

/**
 * One of the accounts `completeGoogleSignIn` listed (D-216). The proof is the list's cookie: it lives 5 minutes and is
 * cleared after a successful choice, when invalid or expired, on a new start and on sign-out.
 */
export const chooseGoogleAccount = endpoint({ method: 'POST', path: '/api/auth/google/choose', access: 'public', input: ChooseInput, output: Me });

// ---------------------------------------------------------------- the operator's own sign-in server (S34, D-213)
/** Where to send the browser; sets the short-lived HttpOnly cookie that binds the answer to this browser. Any role. */
export const startSsoSignIn = endpoint({
  method: 'POST',
  path: '/api/auth/sso/start',
  access: 'public',
  input: Empty,
  output: z.object({ authorizeUrl: z.string() }),
});

/** The `state` and `code` the provider sent back to `/signin-sso`, posted by that page; as Google's, it may answer a list (D-216). */
export const completeSsoSignIn = endpoint({
  method: 'POST',
  path: '/api/auth/sso/complete',
  access: 'public',
  input: z.object({ state: z.string().min(20).max(200), code: z.string().min(1).max(4000) }),
  output: ProviderSignInResult,
});

/** One of the accounts `completeSsoSignIn` listed (D-216); the cookie as for `chooseGoogleAccount`. */
export const chooseSsoAccount = endpoint({ method: 'POST', path: '/api/auth/sso/choose', access: 'public', input: ChooseInput, output: Me });

/** The button's icon (a small image file the operator put in the data folder); 404 when there is none. */
export const ssoIcon = endpoint({ method: 'GET', path: '/api/auth/sso/icon', access: 'public', input: Empty, output: z.unknown() });

// ---------------------------------------------------------------- passkeys (S33, D-210)
/** WebAuthn options and answers are JSON objects defined by the standard; the server library checks them. */
const WebAuthnJson = z.record(z.string(), z.unknown());

export const Passkey = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  /** The authenticator says the key is synced to the person's other devices. */
  backedUp: z.boolean(),
});

export const listPasskeys = endpoint({ method: 'GET', path: '/api/auth/passkeys', access: 'account', input: Empty, output: z.object({ passkeys: z.array(Passkey) }) });

/** Adding a passkey, step 1: re-authentication (the password, or a fresh email, Google or passkey sign-in), then the options for the browser. */
export const startPasskeyRegistration = endpoint({
  method: 'POST',
  path: '/api/auth/passkeys/register/start',
  access: 'account',
  input: z.object({ currentPassword: z.string().min(1).max(200).optional() }),
  output: z.object({ options: WebAuthnJson }),
});

/** Step 2: the browser's answer and a name for the passkey ("My phone"). */
export const finishPasskeyRegistration = endpoint({
  method: 'POST',
  path: '/api/auth/passkeys/register/finish',
  access: 'account',
  input: z.object({ response: WebAuthnJson, name: z.string().trim().max(60).optional() }),
  output: Passkey,
});

export const removePasskey = endpoint({ method: 'DELETE', path: '/api/auth/passkeys/:passkeyId', access: 'account', input: z.object({ passkeyId: z.string().min(1).max(64) }), output: Ok });

/**
 * Should this session be offered a passkey now (S33, D-210)? True right after a sign-in by email link,
 * code, invite or Google, while the account has no passkey, passkeys can work on this address and the
 * person has not said "Don't ask again". The browser adds its own checks (it supports passkeys, it is
 * not a classroom display, "Not now" on this device).
 */
export const passkeyOffer = endpoint({ method: 'GET', path: '/api/auth/passkeys/offer', access: 'account', input: Empty, output: z.object({ offer: z.boolean() }) });
/** "Don't ask again": no more offers for this account, on any device. */
export const dismissPasskeyOffer = endpoint({ method: 'POST', path: '/api/auth/passkeys/offer/dismiss', access: 'account', input: Empty, output: Ok });

/** Signing in with a passkey: no username; the browser offers the passkeys it holds for this site. */
export const startPasskeySignIn = endpoint({ method: 'POST', path: '/api/auth/passkeys/signin/start', access: 'public', input: Empty, output: z.object({ options: WebAuthnJson }) });
export const finishPasskeySignIn = endpoint({ method: 'POST', path: '/api/auth/passkeys/signin/finish', access: 'public', input: z.object({ response: WebAuthnJson }), output: Me });

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

// ---------------------------------------------------------------- changing the own address (S35, D-214)
/** Validated like the administrator's `Email` (contracts/admin.ts). */
const NewEmail = z.string().trim().toLowerCase().email().max(200);

/**
 * The own address for Profile, and `pendingTo`: the masked new address of a change that still waits
 * for its code in this browser (the sealed cookie), so Profile can offer the code form after a reload.
 * `account` (PIN-gated in classroom mode): the address is not in `Me`, which a locked classroom
 * screen loads (S35 review).
 */
export const ownEmail = endpoint({
  method: 'GET',
  path: '/api/auth/email',
  access: 'account',
  input: Empty,
  output: z.object({ email: z.string().nullable(), pendingTo: z.string().nullable() }),
});

/**
 * Step 1: re-authentication (the password, or a fresh sign-in for accounts without one), then a
 * 6-digit code is emailed to the NEW address. The same answer whether or not another account uses it.
 * The pending address is kept in a sealed HttpOnly cookie of this browser.
 */
export const startEmailChange = endpoint({
  method: 'POST',
  path: '/api/auth/email/start',
  access: 'account',
  input: z.object({ currentPassword: z.string().min(1).max(200).optional(), email: NewEmail }),
  output: Ok,
});

/** Step 2: the code from the new address; only then the address changes. Other sessions end. */
export const confirmEmailChange = endpoint({
  method: 'POST',
  path: '/api/auth/email/confirm',
  access: 'account',
  input: z.object({ code: SixDigitCode }),
  output: Me,
});

/** Cancel: the pending change code of this browser stops working and its cookie is cleared. */
export const cancelEmailChange = endpoint({
  method: 'POST',
  path: '/api/auth/email/cancel',
  access: 'account',
  input: Empty,
  output: Ok,
});

/** Back to a password (needs a fresh email sign-in on this session). */
export const switchToPassword = endpoint({
  method: 'POST',
  path: '/api/auth/sign-in-method/password',
  access: 'account',
  input: z.object({ newPassword: z.string().min(10).max(200) }),
  output: Me,
});
