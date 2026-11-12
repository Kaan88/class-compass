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

function buildRequest<I extends z.ZodType, O extends z.ZodType>(ep: Endpoint<I, O>, input: z.input<I>): { url: string; init: RequestInit } {
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
  return { url, init };
}

function failure(ep: Endpoint, res: { status: number; statusText: string }, body: any): ApiError {
  // A proxy in front of the app (Cloudflare's 100 MB limit) refuses a big upload with its own 413 page.
  if (res.status === 413 && !body?.error) return new ApiError(413, 'VALIDATION', 'The file is too large', { reason: 'FILE_TOO_LARGE' });
  const code: string = body?.error?.code ?? 'INTERNAL';
  // A 401 with a business reason (WRONG_PIN, WRONG_PASSWORD) is a form error, not a sign-out.
  const reason: unknown = body?.error?.details?.reason;
  const hasReason = typeof reason === 'string';
  if (code === 'PIN_REQUIRED' || (code === 'UNAUTHENTICATED' && ep.access !== 'public' && !hasReason)) {
    authListeners.forEach((l) => l(code as AuthProblem));
  } else if (code === 'FORBIDDEN' && reason === 'MUST_CHANGE_PASSWORD') {
    authListeners.forEach((l) => l('MUST_CHANGE_PASSWORD'));
  }
  return new ApiError(res.status, code, body?.error?.message ?? res.statusText, body?.error?.details);
}

/**
 * Typed call for a contract endpoint. Path params (`:name`) are filled from input; GET sends the rest
 * as query string, others as JSON body. Same-origin cookies + CSRF header.
 */
export async function call<I extends z.ZodType, O extends z.ZodType>(ep: Endpoint<I, O>, input: z.input<I>): Promise<z.infer<O>> {
  const { url, init } = buildRequest(ep, input);
  const res = await fetch(url, init);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw failure(ep as unknown as Endpoint, res, body);
  return body as z.infer<O>;
}

/**
 * Conditional GET for polled endpoints (lesson state): sends `If-None-Match` and resolves to
 * `{ notModified: true }` on 304, so an unchanged poll costs no body and no re-render.
 */
export async function callConditional<I extends z.ZodType, O extends z.ZodType>(
  ep: Endpoint<I, O>,
  input: z.input<I>,
  etag: string | null,
): Promise<{ notModified: true } | { notModified: false; data: z.infer<O>; etag: string | null; receivedAt: number }> {
  const { url, init } = buildRequest(ep, input);
  if (etag) init.headers = { ...init.headers, 'if-none-match': etag };
  const res = await fetch(url, init);
  if (res.status === 304) return { notModified: true };
  const body = await res.json().catch(() => null);
  if (!res.ok) throw failure(ep as unknown as Endpoint, res, body);
  return { notModified: false, data: body as z.infer<O>, etag: res.headers.get('etag'), receivedAt: Date.now() };
}

/** How far an upload is: 0 to 1. */
export type UploadProgress = (fraction: number) => void;

/** Send a form with XMLHttpRequest, the only browser API that reports upload progress. */
function sendWithProgress(method: string, url: string, form: FormData, onProgress: UploadProgress): Promise<{ status: number; statusText: string; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-cc-csrf', '1');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, statusText: xhr.statusText, body });
    };
    // A network failure: the same error `fetch` gives, so it reads as "no connection".
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.onabort = () => reject(new TypeError('Network request aborted'));
    xhr.send(form);
  });
}

/**
 * Upload one file to a multipart contract endpoint (S9, `rawRoute` on the server): the declared
 * input goes into the path and query string, the file into the multipart field `file`. The browser
 * sets the multipart content type; the server sniffs the content and never trusts the file name.
 * With `onProgress` (a large video, D-193) the upload reports how far it is.
 */
export async function upload<I extends z.ZodType, O extends z.ZodType>(ep: Endpoint<I, O>, input: z.input<I>, file: Blob, fileName?: string, onProgress?: UploadProgress): Promise<z.infer<O>> {
  const rest: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const path = ep.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => {
    const v = rest[k];
    delete rest[k];
    return encodeURIComponent(String(v));
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const form = new FormData();
  form.append('file', file, fileName ?? (file instanceof File ? file.name : 'upload'));
  const url = [...qs].length ? `${path}?${qs}` : path;
  if (onProgress && typeof XMLHttpRequest !== 'undefined') {
    const r = await sendWithProgress(ep.method, url, form, onProgress);
    if (r.status < 200 || r.status >= 300) throw failure(ep as unknown as Endpoint, r, r.body);
    return r.body as z.infer<O>;
  }
  const res = await fetch(url, { method: ep.method, credentials: 'same-origin', headers: { 'x-cc-csrf': '1' }, body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw failure(ep as unknown as Endpoint, res, body);
  return body as z.infer<O>;
}

/**
 * URL of a GET endpoint for a plain link (downloads such as report CSVs and exports): the browser
 * sends the same-origin session cookie; GET needs no CSRF header.
 */
export function urlFor<I extends z.ZodType, O extends z.ZodType>(ep: Endpoint<I, O>, input: z.input<I>): string {
  if (ep.method !== 'GET') throw new Error(`${ep.path} is not a GET endpoint`);
  return buildRequest(ep, input).url;
}
