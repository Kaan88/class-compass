/**
 * Super Speakers on its own origin (S14f, D-157): host routing while `SPEAKERS_ORIGIN` is set
 * (`config.origins.split`). Pure helpers; `app.ts` installs them as an `onRequest` hook.
 *
 * - The speakers host serves only the scorer app, the board, their assets and API, the scorer service
 *   worker and `/healthz`. Everything else answers 404, so the teacher, admin and student pages, and
 *   their API, are never reachable on a hostname that a TV or a phone opens without Cloudflare Access.
 * - Every other host (the main hostname, and also a LAN address or `localhost`, e.g. the container
 *   health check) is the main app: it answers `/p`, `/p/app` and `/board` with a 308 to the speakers
 *   host (path and query kept; browsers keep the `#` fragment, so old links and printed QR codes keep
 *   working) and serves a kill-switch `/scorer-sw.js` that removes the old scorer shell.
 */
import type { Origins } from '../config.ts';

/** Exact paths the speakers host serves. */
const SPEAKERS_EXACT = new Set(['/p', '/p/app', '/board', '/scorer-sw.js', '/healthz', '/api/scorer', '/api/board']);
/** Path prefixes the speakers host serves (the scorer manifest and icons, built assets, the two APIs). */
const SPEAKERS_PREFIXES = ['/p/', '/assets/', '/api/scorer/', '/api/board/'];
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

/** True when this request's host is the Super Speakers host (only while split). */
export const isSpeakersHost = (origins: Origins, host: string | undefined): boolean => origins.split && normalizeHost(host) === normalizeHost(origins.speakersHost);

/**
 * May the speakers host serve this path? An allow-list; a path with an encoded character, a dot
 * segment, a backslash or an empty segment is refused outright, so no spelling of another path can
 * slip through a prefix.
 */
export function speakersHostAllows(path: string): boolean {
  if (!path.startsWith('/') || /%|\\|\/\/|(?:^|\/)\.\.?(?:\/|$)/u.test(path)) return false;
  return SPEAKERS_EXACT.has(path) || SPEAKERS_PREFIXES.some((p) => path.startsWith(p) && path.length > p.length);
}

/** Does the main host send this path to the speakers host (308)? */
export const movedToSpeakers = (path: string): boolean => MOVED_PAGES.has(path);

/** Where the main host sends a moved page: the speakers origin plus the same path and query. */
export const speakersRedirect = (origins: Origins, url: string): string => `${origins.speakers}${url}`;

/**
 * The kill-switch service worker the main host serves at `/scorer-sw.js` while split. A phone or
 * computer that installed the scorer app on the main hostname has the old worker (scope `/p`), which
 * could keep showing the cached app there. The browser's update check fetches this file instead: it
 * takes over at once, deletes the scorer shell caches, unregisters itself and reloads its pages, which
 * the main host then redirects to the speakers host. It has no fetch handler, so it never answers a
 * request itself.
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
