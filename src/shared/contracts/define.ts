import { z } from 'zod';

/**
 * Access classes (ARCHITECTURE §3). Every endpoint MUST declare exactly one; the server refuses
 * to start otherwise and tests enumerate all endpoints.
 * - public:    no session (login, health, student link exchange)
 * - classroom: signed-in teacher; allowed while the classroom PIN lock is engaged
 * - teacher:   signed-in teacher; requires PIN unlock when the session is in classroom mode
 * - admin:     signed-in administrator; requires PIN unlock in classroom mode
 * - student:   student session derived from a personal link
 * - user:      any signed-in teacher or admin; allowed while locked (own profile/session basics only)
 * - account:   any signed-in teacher or admin; requires PIN unlock in classroom mode (password, PIN changes)
 */
export type Access = 'public' | 'classroom' | 'teacher' | 'admin' | 'student' | 'user' | 'account';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Endpoint<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  method: Method;
  /** Fastify-style path, e.g. /api/classes/:classId */
  path: string;
  access: Access;
  /** Input = path params + query (GET) or path params + JSON body (others). */
  input: I;
  /** Output schema doubles as a serialisation allow-list: unknown fields are stripped. */
  output: O;
  /** Responses carry sensitive data: forbid caching (always true for non-public). */
  sensitive?: boolean;
}

export function endpoint<I extends z.ZodType, O extends z.ZodType>(e: Endpoint<I, O>): Endpoint<I, O> {
  return e;
}

export const Empty = z.object({});
export const Ok = z.object({ ok: z.literal(true) });

/** Standard error body. `code` is stable and used for i18n on the client. */
export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const LocalizedText = z.object({ en: z.string().max(200).optional(), tr: z.string().max(200).optional() });

/** Stable error codes shared by client and server. */
export const ErrorCodes = {
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  PIN_REQUIRED: 'PIN_REQUIRED',
  PIN_LOCKED_OUT: 'PIN_LOCKED_OUT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  CSRF: 'CSRF',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
export type LocalizedTextValue = z.infer<typeof LocalizedText>;
