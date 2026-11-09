/**
 * Helpers for the OAuth tests (S14h2, D-160): PKCE pairs, Dynamic Client Registration, the authorize
 * step through a signed-in browser-like client (which keeps the `ccoa` cookie), the consent decision
 * and the token endpoint (form bodies, like the real clients). Fictional data only.
 */
import crypto from 'node:crypto';
import { expect } from 'vitest';
import type { Client, TestEnv } from './helpers.ts';
import { PASSWORD } from './mcp-helpers.ts';

export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
export const LOOPBACK = 'http://127.0.0.1:33418/callback';

export function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

let ipSeq = 1;
/** A fresh client address per call, so the per-address registration limit is tested on purpose only. */
export const freshIp = () => `10.20.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

export interface Res {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}
const parse = (b: string) => {
  try {
    return b ? JSON.parse(b) : null;
  } catch {
    return b;
  }
};

export async function register(env: TestEnv, body: Record<string, unknown>, ip = freshIp()): Promise<Res> {
  const r = await env.app.inject({ method: 'POST', url: '/oauth/register', remoteAddress: ip, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) });
  return { status: r.statusCode, body: parse(r.body), headers: r.headers };
}

export async function registerOk(env: TestEnv, redirectUris: string[] = [CLAUDE_CALLBACK], name = 'Claude'): Promise<string> {
  const r = await register(env, { client_name: name, redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.client_id as string;
}

export const authorizeUrl = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined) q.set(k, v);
  return `/oauth/authorize?${q.toString()}`;
};

/** Standard authorize parameters for a registered client. */
export const authParams = (env: TestEnv, clientId: string, challenge: string, extra: Record<string, string | undefined> = {}) => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: CLAUDE_CALLBACK,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'st-123',
  resource: `${env.config.origins.main}/mcp`,
  scope: 'classes:read reports:read',
  ...extra,
});

/** Open the authorize address in `browser` (keeps its cookies) and return the Location it redirects to. */
export async function authorize(browser: Client, params: Record<string, string | undefined>): Promise<{ status: number; location: string }> {
  const r = await browser.req('GET', authorizeUrl(params));
  return { status: r.status, location: String(r.headers.location ?? '') };
}

export const requestIdOf = (location: string) => new URL(location, 'http://x').searchParams.get('request') ?? '';

/** Authorize, then allow on the consent page; returns the code and the redirect it went to. */
export async function consent(
  browser: Client,
  params: Record<string, string | undefined>,
  decision: { scopes?: string[]; days?: number; privacy?: 'pseudonymous' | 'named' } = {},
): Promise<{ code: string; redirectTo: URL; requestId: string }> {
  const a = await authorize(browser, params);
  expect(a.status, a.location).toBe(303);
  const requestId = requestIdOf(a.location);
  expect(requestId, a.location).not.toBe('');
  const d = await browser.post(`/api/account/oauth/requests/${requestId}`, { allow: true, currentPassword: PASSWORD, ...decision });
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  const redirectTo = new URL(d.body.redirectTo as string);
  return { code: redirectTo.searchParams.get('code') ?? '', redirectTo, requestId };
}

/** POST a form to the token (or revoke) endpoint like a real public client. */
export async function form(env: TestEnv, url: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<Res> {
  const r = await env.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers }, payload: new URLSearchParams(body).toString() });
  return { status: r.statusCode, body: parse(r.body), headers: r.headers };
}

export const exchange = (env: TestEnv, clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) =>
  form(env, '/oauth/token', { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK, resource: `${env.config.origins.main}/mcp`, ...extra });

export const refresh = (env: TestEnv, clientId: string, refreshToken: string, extra: Record<string, string> = {}) =>
  form(env, '/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: `${env.config.origins.main}/mcp`, ...extra });

/** Register, consent and exchange: a connected app's tokens. */
export async function connectApp(env: TestEnv, browser: Client, decision: { scopes?: string[]; days?: number; privacy?: 'pseudonymous' | 'named' } = {}, scope = 'classes:read reports:read') {
  const clientId = await registerOk(env);
  const { verifier, challenge } = pkce();
  const { code } = await consent(browser, authParams(env, clientId, challenge, { scope }), decision);
  const t = await exchange(env, clientId, code, verifier);
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  return { clientId, access: t.body.access_token as string, refresh: t.body.refresh_token as string, body: t.body };
}
