/*
 * Super Speakers scorer app service worker (S12, D-134). Scope `/p` (the link page and the installed
 * app). It keeps ONLY the app shell (the page, its built scripts and styles, the icons and manifest)
 * so the installed app opens without a connection. It never caches or answers API requests: student
 * lists and awards always come from the server, and awards made offline wait in the app's outbox.
 */
const CACHE = 'cc-scorer-shell-v1';
const SHELL = ['/p/app', '/p/manifest.webmanifest', '/p/icon-192.png', '/p/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cc-scorer-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isShellAsset = (url) => url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/p/'));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // The page: network first (fresh build), the cached shell when offline. Never the link page's
    // fragment (it is not part of the request) and never anything but the shell.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (url.pathname === '/p/app' || url.pathname === '/p')) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put('/p/app', copy));
          }
          return res;
        })
        .catch(() => caches.match('/p/app').then((r) => r || Response.error())),
    );
    return;
  }
  if (isShellAsset(url)) {
    // Built assets are content-hashed: cache first, filled on first use.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
