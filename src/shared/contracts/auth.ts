import { z } from 'zod';
import { endpoint, Ok, Empty } from './define.ts';

export const Locale = z.enum(['en', 'tr']);
export type Locale = z.infer<typeof Locale>;

export const Me = z.object({
  kind: z.literal('user'),
  id: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'teacher']),
  locale: Locale,
  textScale: z.number(),
  mustChangePassword: z.boolean(),
  hasPin: z.boolean(),
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
  input: z.object({ currentPassword: z.string().min(1).max(200), pin: PinString }),
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
  output: z.object({ emailResetEnabled: z.boolean() }),
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
