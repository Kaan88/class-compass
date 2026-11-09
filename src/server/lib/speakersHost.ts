/**
 * Super Speakers on its own origin (S14f, D-157): host routing while `SPEAKERS_ORIGIN` is set
 * (`config.origins.split`). Pure helpers; `app.ts` installs them as an `onRequest` hook.
 *
 * - The speakers host serves only the scorer app, the board, their assets and API, the scorer service
 *   worker and `/healthz`. Everything else answers 404, so the teacher, admin and student pages, and
 *   their API, are never reachable on a hostname that a TV or a phone opens without Cloudflare Access.
 * - Every other host (the main hostname, and also a LAN address or `localhost`, e.g. the container
 *   health check) is the main app: it answers `/p`, `/p/app` and `/board` with a 308 to the speakers
 *   host (path and query kept; browsers keep the `#` fragment, so old links keep working on devices
 *   that reach the main host) and serves a kill-switch `/scorer-sw.js` that removes the old scorer
 *   shell. A scorer device with awards still queued (scorer queue cookie) gets the app here instead,
 *   sends them and then moves itself.
 */
import type { Origins } from '../config.ts';

/** Exact paths the speakers host serves. */
const SPEAKERS_EXACT = new Set(['/p', '/p/app', '/board', '/scorer-sw.js', '/healthz', '/api/scorer', '/api/board']);
/**
 * Path prefixes the speakers host serves (the scorer manifest and icons, built assets, the two APIs,
 * and enabled imported theme packages, which the board and the scorer app draw with; S14g, D-158:
 * public, read-only, no school data).
 */
const SPEAKERS_PREFIXES = ['/p/', '/assets/', '/api/scorer/', '/api/board/', '/api/themes/custom/'];
/** Pages the main host moves to the speakers host. */
const MOVED_PAGES = new Set(['/p', '/p/app', '/board']);

/** The path of a raw request URL (no query). */
export const pathOf = (url: string): string => {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
};

/**
 * Lower-case `host[:port]` as `URL.host` writes it: no default port, no trailing dot on the name.
 * Returns '' for a missing or malformed host.
 */
export function normalizeHost(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const u = new URL(`http://${raw.trim()}`);
    if (u.username || u.password || u.pathname !== '/') return '';
    const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';
    return `${u.hostname.replace(/\.$/u, '')}${port}`;
  } catch {
    return '';
  }
}

/**
 * True when this request is for the Super Speakers host (only while split). Decided from the raw
 * `Host` header (Cloudflare Tunnel sends the public hostname there), never from Fastify's `req.host`,
 * which follows the client-supplied `X-Forwarded-Host` when TRUST_PROXY is on. A forwarded host can
 * only narrow: when any `X-Forwarded-Host` entry names the speakers host the request is treated as one
 * too, but no forwarded value can turn a speakers-host request into a main-host one (fail closed).
 */
export function isSpeakersHost(origins: Origins, headers: { host?: string | undefined; 'x-forwarded-host'?: string | string[] | undefined }): boolean {
  if (!origins.split) return false;
  const speakers = normalizeHost(origins.speakersHost);
  if (normalizeHost(headers.host) === speakers) return true;
  const fwd = headers['x-forwarded-host'];
  const entries = (Array.isArray(fwd) ? fwd : [fwd ?? '']).flatMap((v) => v.split(','));
  return entries.some((h) => normalizeHost(h) === speakers);
}

/**
 * May the speakers host serve this path? An allow-list; a path with an encoded character, a dot
 * segment, a backslash or an empty segment is refused outright, so no spelling of another path can
 * slip through a prefix.
 */
export function speakersHostAllows(path: string): boolean {
  if (!path.startsWith('/') || /%|\\|\/\/|(?:^|\/)\.\.?(?:\/|$)/u.test(path)) return false;
  return SPEAKERS_EXACT.has(path) || SPEAKERS_PREFIXES.some((p) => path.startsWith(p) && path.length > p.length);
}

/**
 * Does the main host send this path to the speakers host (308)? Not the scorer app while this device
 * still has awards waiting in its outbox (`queued`, the scorer queue cookie): the app then opens here,
 * sends them and moves itself (D-157), so nothing queued offline before the move is stranded in this
 * origin's IndexedDB.
 */
export const movedToSpeakers = (path: string, queued = false): boolean => MOVED_PAGES.has(path) && !(queued && path !== '/board');

/** Where the main host sends a moved page: the speakers origin plus the same path and query. */
export const speakersRedirect = (origins: Origins, url: string): string => `${origins.speakers}${url}`;

/**
 * The kill-switch service worker the main host serves at `/scorer-sw.js` while split. A phone or
 * computer that installed the scorer app on the main hostname has the old worker (scope `/p`), which
 * could keep showing the cached app there. The browser's update check fetches this file instead: it
 * takes over at once, deletes the scorer shell caches, unregisters itself and reloads its pages, which
 * the main host then redirects to the speakers host (or, while awards are still queued on the device,
 * serves from the network so the app sends them before it moves). Reloading never loses the queue: it
 * lives in IndexedDB and every command is sent with its own op id. It has no fetch handler, so it
 * never answers a request itself.
 */
export const SCORER_SW_KILL_SWITCH = `/* Super Speakers moved to its own address (D-157): remove the old scorer app shell on this host. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('cc-scorer-shell-')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const pages = await self.clients.matchAll({ type: 'window' });
      for (const page of pages) page.navigate(page.url).catch(() => undefined);
    })(),
  );
});
`;
