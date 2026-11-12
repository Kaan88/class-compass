/**
 * Service worker of the teacher and classroom app (S26b, D-190; D-006 offline cold start).
 *
 * The build (`scripts/appWorker.ts`) turns this file into `/app-sw.js`: types are stripped, the
 * `export` keywords dropped and `CC_BUILD_ID` / `CC_PRECACHE` defined in front of it. The file has no
 * imports, so the built worker is exactly this code. Tests import the pure rules below.
 *
 * What it does, and only this:
 * - pages of the main app (sign-in, classroom, teacher, admin, help): network first; when the network
 *   fails (or takes longer than NAV_TIMEOUT_MS) the cached page of this build, stored as the server
 *   sent it (with its security headers). The personal student page (`/s`), the Super Speakers pages
 *   (`/p`, `/p/app`, `/board`), the API, AI tools and OAuth are never answered here: the browser
 *   fetches them as if there were no worker;
 * - built files under `/assets/` (content-hashed, so a name never changes its content): cache first.
 *   The worker installs with every script and style of the main app of its build (CC_PRECACHE);
 *   pictures are added when first shown. The files of a page left alone (the student page, the hall
 *   board: the scope `/` still covers them) are fetched from the network and never stored;
 * - nothing under `/api/` is ever cached or answered: lesson state, rosters and avatars that the board
 *   needs offline are kept by the page itself (`lib/offlineClassroom.ts`), cleared on sign-out.
 *
 * Versions: one cache per build (`cc-app-<build>`); activating a build deletes the older `cc-app-*`
 * caches (never the scorer's own `cc-scorer-shell-*`). A new build waits until the page says it is a
 * quiet moment (`SKIP_WAITING`, sent by `lib/appWorker.ts`), so a lesson on screen is never reloaded.
 */

declare const CC_BUILD_ID: string;
declare const CC_PRECACHE: readonly string[];

/** The shell is stored under this key (every app page is the same `index.html`). */
export const SHELL_KEY = '/';
export const CACHE_PREFIX = 'cc-app-';
/** A navigation that has not answered after this long is served from the cache (flaky school Wi-Fi). */
export const NAV_TIMEOUT_MS = 4000;

export const cacheNameOf = (build: string) => `${CACHE_PREFIX}${build}`;

/** Caches an activating build deletes: older builds of this app only (never the scorer's caches). */
export const isOldAppCache = (name: string, build: string) => name.startsWith(CACHE_PREFIX) && name !== cacheNameOf(build);

/**
 * Paths this worker never answers, as a page or otherwise: the API (personal data), the student page,
 * the Super Speakers pages and their worker, AI tools and OAuth, health and robots.
 */
export function isPassThroughPath(path: string): boolean {
  if (path.startsWith('/api/') || path === '/api') return true;
  if (/^\/s(?:\/|$)/u.test(path)) return true;
  if (/^\/p(?:\/|$)/u.test(path) || /^\/board(?:\/|$)/u.test(path)) return true;
  if (path === '/mcp' || path.startsWith('/mcp/')) return true;
  // The consent page is part of the app, but it needs the server anyway: never served from the cache.
  if (path.startsWith('/oauth/') || path.startsWith('/.well-known/')) return true;
  if (path === '/healthz' || path === '/robots.txt') return true;
  return false;
}

/** A page of the main app (no file extension in the last part, not a pass-through path). */
export function isAppPagePath(path: string): boolean {
  if (isPassThroughPath(path)) return false;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return !last.includes('.');
}

export type RequestKind = 'page' | 'asset' | 'pass';

/**
 * What the worker does with a request: `page` (network first, cached shell offline), `asset` (cache
 * first) or `pass` (not touched: the browser fetches it as if there were no worker).
 */
export function classifyRequest(req: { url: string; method: string; mode: string }, origin: string): RequestKind {
  if (req.method !== 'GET') return 'pass';
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return 'pass';
  }
  if (url.origin !== origin) return 'pass';
  if (isPassThroughPath(url.pathname)) return 'pass';
  if (req.mode === 'navigate') return isAppPagePath(url.pathname) ? 'page' : 'pass';
  if (url.pathname.startsWith('/assets/') && url.pathname.length > '/assets/'.length && !url.pathname.endsWith('.map')) return 'asset';
  return 'pass';
}

/** Is this network answer the app page of this build (so it may become the offline shell)? */
export function isShellOfBuild(res: { ok: boolean; status: number; redirected: boolean; type: string; headers: { get(name: string): string | null } }, html: string, build: string): boolean {
  if (!res.ok || res.status !== 200 || res.redirected || (res.type !== 'basic' && res.type !== 'default')) return false;
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return false;
  return html.includes(`<meta name="cc-build" content="${build}"`);
}

// ---------------------------------------------------------------- the worker itself
interface WorkerEvent {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike extends WorkerEvent {
  request: Request;
  /** The page that made the request (empty for navigations and worker requests). */
  clientId?: string;
  respondWith(r: Response | Promise<Response>): void;
}
interface MessageEventLike extends WorkerEvent {
  data: unknown;
  ports: readonly MessagePort[];
}
interface WorkerScope {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; get(id: string): Promise<{ url: string } | undefined> };
  addEventListener(type: 'install' | 'activate', fn: (e: WorkerEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEventLike) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEventLike) => void): void;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const h = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(h);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(h);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function installWorker(scope: WorkerScope, build: string, precache: readonly string[]): void {
  const CACHE = cacheNameOf(build);

  /** The path of the page that made a request, or null when unknown (no page, or it is gone). */
  const clientPath = async (id: string | undefined): Promise<string | null> => {
    if (!id) return null;
    try {
      const client = await scope.clients.get(id);
      return client ? new URL(client.url).pathname : null;
    } catch {
      return null;
    }
  };

  scope.addEventListener('install', (event) => {
    // Every script and style of this build, and the page. `reload` skips the HTTP cache. No
    // skipWaiting here: an update waits for the page's quiet moment (D-190).
    event.waitUntil(
      caches.open(CACHE).then(async (cache) => {
        await cache.addAll(precache.map((u) => new Request(u, { cache: 'reload' })));
        const res = await fetch(new Request(SHELL_KEY, { cache: 'reload', credentials: 'same-origin' }));
        const html = await res.clone().text();
        if (isShellOfBuild(res, html, build)) await cache.put(SHELL_KEY, res);
      }),
    );
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => isOldAppCache(k, build)).map((k) => caches.delete(k))))
        .then(() => scope.clients.claim()),
    );
  });

  scope.addEventListener('message', (event) => {
    const data = event.data as { type?: string } | null;
    if (data?.type === 'SKIP_WAITING') event.waitUntil(scope.skipWaiting());
    if (data?.type === 'BUILD') event.ports[0]?.postMessage({ build });
  });

  scope.addEventListener('fetch', (event) => {
    const req = event.request;
    const kind = classifyRequest(req, scope.location.origin);
    if (kind === 'pass') return;
    if (kind === 'page') {
      event.respondWith(
        withTimeout(fetch(req), NAV_TIMEOUT_MS)
          .then((res) => {
            // Keep the newest page of THIS build as the offline shell (a newer build's page would ask
            // for files this build's cache does not hold).
            // The server's answer itself is stored, with its security headers (Content-Security-Policy,
            // frame-ancestors): the page served offline runs under the same policy as online.
            const copy = res.clone();
            const keep = res.clone();
            event.waitUntil(
              copy
                .text()
                .then((html) => (isShellOfBuild(copy, html, build) ? caches.open(CACHE).then((c) => c.put(SHELL_KEY, keep)) : undefined))
                .catch(() => undefined),
            );
            return res;
          })
          .catch(() => caches.open(CACHE).then((c) => c.match(SHELL_KEY)).then((hit) => hit ?? fetch(req))),
      );
      return;
    }
    // A file asked for by a page this worker leaves alone (the student page, the hall board): the
    // network, as with no worker, and never stored in this app's cache.
    event.respondWith(
      clientPath(event.clientId).then((path) =>
        path !== null && isPassThroughPath(path)
          ? fetch(req)
          : caches
              .open(CACHE)
              .then((c) => c.match(req))
              .then(
                (hit) =>
                  hit ??
                  fetch(req).then((res) => {
                    if (res.ok && res.status === 200) {
                      const copy = res.clone();
                      event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
                    }
                    return res;
                  }),
              ),
      ),
    );
  });
}

// Runs only inside the built worker (CC_BUILD_ID is defined there), never in tests or the page.
if (typeof CC_BUILD_ID === 'string') installWorker(self as unknown as WorkerScope, CC_BUILD_ID, CC_PRECACHE);
