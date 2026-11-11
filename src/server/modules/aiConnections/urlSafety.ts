/**
 * Address rules for AI connections (S19a, D-179). An OpenAI-compatible connection takes any base URL
 * an administrator types, so the server must not become a way into places only it can reach:
 *
 * - Never: cloud metadata services (169.254.169.254, fd00:ec2::254, 100.100.100.200, the GCE name),
 *   link-local addresses (169.254.0.0/16, fe80::/10), "this network" (0.0.0.0/8, ::), multicast,
 *   broadcast and reserved or documentation ranges. A ticked box does not change this.
 * - Only when the administrator ticks "on this server or school network": loopback (127.0.0.0/8, ::1,
 *   localhost), private ranges (10/8, 172.16/12, 192.168/16, fc00::/7) and carrier-grade NAT
 *   (100.64/10). Plain `http://` is allowed only then too (a key must not cross the internet unencrypted).
 * - Public addresses: always.
 *
 * The check runs twice: on the typed address when it is saved (literal addresses and names), and on
 * every address the name resolves to at the moment of each request (`policyLookup`, the `lookup` of
 * the socket), so a name that later resolves somewhere else (DNS rebinding) is refused at connect time.
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is judged as the IPv4 address.
 */
import dns from 'node:dns';
import net from 'node:net';
import { isPublicAddress } from '../mcp/oauth/cimd.ts';

export type AddressClass = 'public' | 'loopback' | 'private' | 'metadata' | 'linkLocal' | 'blocked';
/** `public`: only public addresses (the providers' own APIs); `local`: also loopback and private ones. */
export type NetPolicy = 'public' | 'local';

const subnets = (list: ReadonlyArray<readonly [string, number]>, family: 'ipv4' | 'ipv6') => {
  const b = new net.BlockList();
  for (const [a, p] of list) b.addSubnet(a, p, family);
  return b;
};
const METADATA4 = new Set(['169.254.169.254', '169.254.170.2', '100.100.100.200']);
const METADATA6 = new Set(['fd00:ec2::254']);
const LOOPBACK4 = subnets([['127.0.0.0', 8]], 'ipv4');
const PRIVATE4 = subnets(
  [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10],
  ],
  'ipv4',
);
const LINK_LOCAL4 = subnets([['169.254.0.0', 16]], 'ipv4');
const LINK_LOCAL6 = subnets([['fe80::', 10]], 'ipv6');
const PRIVATE6 = subnets([['fc00::', 7]], 'ipv6');

/** Names that point at a cloud metadata service on every provider that has one. */
const METADATA_NAMES = /^(?:metadata|metadata\.google\.internal|metadata\.goog|instance-data|instance-data\.ec2\.internal|metadata\.azure\.com)\.?$/iu;

/** What kind of address this is (an IP literal; anything else is `blocked`). */
export function classifyAddress(raw: string): AddressClass {
  const ip = raw.replace(/^\[|\]$/gu, '').toLowerCase();
  const family = net.isIP(ip);
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(ip);
    if (mapped) return classifyAddress(mapped[1]!);
    if (METADATA6.has(ip)) return 'metadata';
    if (ip === '::1') return 'loopback';
    if (LINK_LOCAL6.check(ip, 'ipv6')) return 'linkLocal';
    if (PRIVATE6.check(ip, 'ipv6')) return 'private';
    return isPublicAddress(ip) ? 'public' : 'blocked';
  }
  if (family === 4) {
    if (METADATA4.has(ip)) return 'metadata';
    if (LOOPBACK4.check(ip, 'ipv4')) return 'loopback';
    if (LINK_LOCAL4.check(ip, 'ipv4')) return 'linkLocal';
    if (PRIVATE4.check(ip, 'ipv4')) return 'private';
    return isPublicAddress(ip) ? 'public' : 'blocked';
  }
  return 'blocked';
}

/** May a request go to this address under the policy? */
export const addressAllowed = (ip: string, policy: NetPolicy): boolean => {
  const c = classifyAddress(ip);
  return c === 'public' || (policy === 'local' && (c === 'loopback' || c === 'private'));
};

export type UrlRefusal = 'NOT_A_URL' | 'SCHEME' | 'CREDENTIALS' | 'QUERY' | 'METADATA' | 'LINK_LOCAL' | 'LOCAL_NOT_TICKED' | 'BLOCKED' | 'HTTP_NOT_LOCAL';

/**
 * Checks and normalises a typed base URL (no trailing slash). Throws nothing: returns the refusal.
 * Names are checked against the metadata names here and resolved at request time (`policyLookup`).
 */
export function checkBaseUrl(raw: string, localNetwork: boolean): { ok: true; url: string } | { ok: false; reason: UrlRefusal } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'NOT_A_URL' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'SCHEME' };
  if (u.username || u.password) return { ok: false, reason: 'CREDENTIALS' };
  if (u.search || u.hash) return { ok: false, reason: 'QUERY' };
  const host = u.hostname.replace(/^\[|\]$/gu, '');
  if (METADATA_NAMES.test(host)) return { ok: false, reason: 'METADATA' };
  if (net.isIP(host)) {
    const c = classifyAddress(host);
    if (c === 'metadata') return { ok: false, reason: 'METADATA' };
    if (c === 'linkLocal') return { ok: false, reason: 'LINK_LOCAL' };
    if (c === 'blocked') return { ok: false, reason: 'BLOCKED' };
    if ((c === 'loopback' || c === 'private') && !localNetwork) return { ok: false, reason: 'LOCAL_NOT_TICKED' };
  } else if (!localNetwork && (/^localhost\.?$/iu.test(host) || /\.(?:localhost|local|internal|lan|home\.arpa)\.?$/iu.test(host))) {
    return { ok: false, reason: 'LOCAL_NOT_TICKED' };
  }
  if (u.protocol === 'http:' && !localNetwork) return { ok: false, reason: 'HTTP_NOT_LOCAL' };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/u, '')}` };
}

/** Thrown at connect time when a name resolves to an address the policy refuses. */
export class AddressRefused extends Error {
  constructor() {
    super('The address is not allowed');
    this.name = 'AddressRefused';
  }
}

/**
 * A socket `lookup` that resolves the name now and refuses the connection when any of its addresses
 * is not allowed (all of them must be: an attacker's name could list a public and a private one).
 */
export function policyLookup(policy: NetPolicy): net.LookupFunction {
  return (hostname, options, callback) => {
    if (METADATA_NAMES.test(hostname)) return callback(new AddressRefused(), '', 0);
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as dns.LookupAddress[];
      if (!list.length || list.some((a) => !addressAllowed(a.address, policy))) return callback(new AddressRefused(), '', 0);
      if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
}
