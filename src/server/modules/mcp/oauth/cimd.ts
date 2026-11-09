/**
 * OAuth Client ID Metadata Documents (S14h2, D-160; draft-ietf-oauth-client-id-metadata-document,
 * MCP authorization 2025-11-25). An app may use the https address of a JSON document as its client id;
 * the server reads the document to learn the app's name and redirect addresses.
 *
 * Reading a URL that a stranger chose is a server-side request forgery risk, so the reader is strict:
 * https only, on the default port, only hosts on the administrator's allow-list (checked by the
 * caller), every resolved address must be public (private, loopback, link-local, CGNAT, multicast and
 * documentation ranges refused, checked at connect time so DNS rebinding cannot slip through), no
 * redirects followed, 5 seconds, at most 16 KiB, JSON only, no cookies or credentials sent.
 */
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

export const CIMD_TIMEOUT_MS = 5000;
export const CIMD_MAX_BYTES = 16 * 1024;

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(a, p, 'ipv6');

/** Whether an IP address is public (allowed for a metadata request). IPv4-mapped IPv6 is judged as IPv4 (BlockList would match every IPv4 address against an IPv4-mapped rule, so there is none). */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(ip);
    if (mapped) return !blocked.check(mapped[1]!, 'ipv4');
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

/** DNS lookup for the request that refuses non-public addresses at connect time. */
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = (addresses as dns.LookupAddress[]).filter((a) => isPublicAddress(a.address));
    if (!list.length || list.length !== (addresses as dns.LookupAddress[]).length) return callback(new Error('The address is not public'), '', 0);
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

/** Read one metadata document (the production reader; tests inject `deps.clientMetadataFetch`). */
export function fetchClientMetadata(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('Not a URL'));
    }
    if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password || net.isIP(u.hostname.replace(/^\[|\]$/gu, ''))) return reject(new Error('Not an allowed address'));
    const req = https.get(
      u,
      { lookup: publicLookup, timeout: CIMD_TIMEOUT_MS, headers: { accept: 'application/json', 'user-agent': 'class-compass-oauth' }, agent: false },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode ?? 0}`)); // redirects (3xx) are refused, never followed
        }
        if (!/^application\/(?:[\w.+-]*\+)?json\b/iu.test(String(res.headers['content-type'] ?? ''))) {
          res.resume();
          return reject(new Error('Not JSON'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > CIMD_MAX_BYTES) {
            req.destroy(new Error('Too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Not JSON'));
          }
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(CIMD_TIMEOUT_MS, () => req.destroy(new Error('Timed out')));
    // A hard cap on the whole exchange, whatever the socket does.
    const hard = setTimeout(() => req.destroy(new Error('Timed out')), CIMD_TIMEOUT_MS + 500);
    req.on('close', () => clearTimeout(hard));
    req.on('error', reject);
  });
}
