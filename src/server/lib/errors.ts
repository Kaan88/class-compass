import type { ErrorCode } from '../../shared/contracts/define.ts';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PIN_REQUIRED: 423,
  PIN_LOCKED_OUT: 423,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF: 403,
  FEATURE_DISABLED: 403,
  INTERNAL: 500,
};

/** Throw from services; the HTTP layer maps it to `{ error: { code, message } }`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  constructor(code: ErrorCode, message: string = code, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'Not allowed') => new AppError('FORBIDDEN', msg);
export const conflict = (msg: string, details?: unknown) => new AppError('CONFLICT', msg, details);
export const invalid = (msg: string, details?: unknown) => new AppError('VALIDATION', msg, details);
