import type { z } from 'zod';
import type { Endpoint } from '../../shared/contracts/define.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Listeners notified on PIN_REQUIRED / UNAUTHENTICATED / MUST_CHANGE_PASSWORD so the shell can lock,
 * sign out or show the forced password change.
 */
export type AuthProblem = 'PIN_REQUIRED' | 'UNAUTHENTICATED' | 'MUST_CHANGE_PASSWORD';
type AuthListener = (code: AuthProblem) => void;
const authListeners = new Set<AuthListener>();
export const onAuthProblem = (fn: AuthListener) => {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
};

/**
 * Typed call for a contract endpoint. Path params (`:name`) are filled from input; GET sends the rest
 * as query string, others as JSON body. Same-origin cookies + CSRF header.
 */
export async function call<I extends z.ZodType, O extends z.ZodType>(ep: Endpoint<I, O>, input: z.input<I>): Promise<z.infer<O>> {
  const rest: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const path = ep.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => {
    const v = rest[k];
    delete rest[k];
    return encodeURIComponent(String(v));
  });
  let url = path;
  const init: RequestInit = { method: ep.method, credentials: 'same-origin', headers: { 'x-cc-csrf': '1' } };
  if (ep.method === 'GET') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) qs.set(k, String(v));
    if ([...qs].length) url += `?${qs}`;
  } else {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(rest);
  }
  const res = await fetch(url, init);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code: string = body?.error?.code ?? 'INTERNAL';
    // A 401 with a business reason (WRONG_PIN, WRONG_PASSWORD) is a form error, not a sign-out.
    const reason: unknown = body?.error?.details?.reason;
    const hasReason = typeof reason === 'string';
    if (code === 'PIN_REQUIRED' || (code === 'UNAUTHENTICATED' && ep.access !== 'public' && !hasReason)) {
      authListeners.forEach((l) => l(code as AuthProblem));
    } else if (code === 'FORBIDDEN' && reason === 'MUST_CHANGE_PASSWORD') {
      authListeners.forEach((l) => l('MUST_CHANGE_PASSWORD'));
    }
    throw new ApiError(res.status, code, body?.error?.message ?? res.statusText, body?.error?.details);
  }
  return body as z.infer<O>;
}
