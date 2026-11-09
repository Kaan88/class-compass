/**
 * Redirect addresses, hosts and the resource indicator of the OAuth server for AI apps (S14h2, D-160).
 * Pure functions, so the rules are tested as a matrix.
 *
 * A redirect address is allowed when it is
 * - `https:` on a host in the administrator's allow-list (exact host, default port, no wildcard), or
 * - `http:` on a loopback host (`127.0.0.1`, `[::1]`, `localhost`) with any port (RFC 8252 §7.3; Claude
 *   Code declares both `localhost` and `127.0.0.1` in its Client ID Metadata Document),
 * and never has a fragment, user name or password, wildcard, white space or another scheme.
 * At the authorize step the requested address must equal a registered one exactly; only for loopback
 * addresses may the port differ (native apps pick a free port per session).
 */
import { MCP_PATH, OAUTH_HOST_PATTERN } from '../../../../shared/mcp.ts';

export const REDIRECT_URI_MAX = 512;
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', 'localhost'];

export type RedirectRefusal = 'invalid' | 'too_long' | 'fragment' | 'wildcard' | 'userinfo' | 'scheme' | 'http_not_loopback' | 'host_not_allowed' | 'port';
export type RedirectCheck = { ok: true; uri: string; host: string; loopback: boolean } | { ok: false; reason: RedirectRefusal };

const refuse = (reason: RedirectRefusal): RedirectCheck => ({ ok: false, reason });

/** Whether one redirect address may be registered (and used) at this school. */
export function checkRedirectUri(raw: unknown, allowedHosts: readonly string[]): RedirectCheck {
  if (typeof raw !== 'string' || !raw) return refuse('invalid');
  if (raw.length > REDIRECT_URI_MAX) return refuse('too_long');
  if (/[\s\u0000-\u001f\u007f\\]/u.test(raw)) return refuse('invalid');
  if (raw.includes('#')) return refuse('fragment');
  if (raw.includes('*')) return refuse('wildcard');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return refuse('invalid');
  }
  if (u.username || u.password) return refuse('userinfo');
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'https:') {
    if (u.port !== '') return refuse('port');
    if (!allowedHosts.includes(host)) return refuse('host_not_allowed');
    return { ok: true, uri: raw, host, loopback: false };
  }
  if (u.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.includes(host)) return refuse('http_not_loopback');
    return { ok: true, uri: raw, host, loopback: true };
  }
  return refuse('scheme');
}

/** Scheme, host, path and query of a loopback address: what must match when the port may differ. */
function loopbackKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(u.hostname.toLowerCase())) return null;
    return `http://${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * The registered address an authorization request may use: an exact match, or for loopback addresses
 * the same host, path and query on another port. The requested address must itself pass
 * `checkRedirectUri` (so a registration cannot smuggle in an address the school no longer allows).
 */
export function matchRedirectUri(registered: readonly string[], requested: unknown, allowedHosts: readonly string[]): string | null {
  const check = checkRedirectUri(requested, allowedHosts);
  if (!check.ok) return null;
  if (registered.includes(check.uri)) return check.uri;
  if (!check.loopback) return null;
  const key = loopbackKey(check.uri);
  return key !== null && registered.some((r) => loopbackKey(r) === key) ? check.uri : null;
}

/** The host to show on the consent page for a redirect address. */
export function redirectHostOf(raw: string): string {
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return '?';
  }
}

/** A host name an administrator may put on the allow-list (normalised to lower case), or null. */
export function normaliseAllowedHost(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/\.$/u, '');
  if (!OAUTH_HOST_PATTERN.test(h)) return null;
  if (LOOPBACK_HOSTS.includes(h) || h.endsWith('.localhost')) return null;
  return h;
}

/** The canonical resource indicator of the MCP endpoint (RFC 8707, RFC 9728): `<main origin>/mcp`. */
export const mcpResource = (origin: string) => `${origin}${MCP_PATH}`;

/**
 * Whether a `resource` parameter names our MCP endpoint. Scheme and host are compared without case and
 * one trailing slash is tolerated (MCP spec: canonical URIs use lower case, servers should accept upper
 * case); anything else (another path, a query, a fragment, the bare origin) is refused.
 */
export function isOurResource(raw: unknown, origin: string): boolean {
  if (typeof raw !== 'string' || !raw || raw.length > 512 || raw.includes('#')) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.search || u.username || u.password) return false;
  const want = new URL(mcpResource(origin));
  const path = u.pathname.endsWith('/') && u.pathname.length > 1 ? u.pathname.slice(0, -1) : u.pathname;
  return u.protocol === want.protocol && u.host.toLowerCase() === want.host.toLowerCase() && path === want.pathname;
}
