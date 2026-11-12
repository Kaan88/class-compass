/**
 * The teacher and classroom app's service worker (S26b, D-190; D-006 offline cold start; UX-11):
 * which requests it answers, that it never caches or answers an API request, how it versions its
 * caches, and how the build turns it into a classic script with the build's file list.
 */
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheNameOf, classifyRequest, installWorker, isAppPagePath, isOldAppCache, isPassThroughPath, isShellOfBuild } from '../../src/client/sw/appWorker.ts';
import { buildIdOf, precacheList, workerScript } from '../../scripts/appWorker.ts';
import { isQuietMoment, pageBuild } from '../../src/client/lib/appWorker.ts';

const ORIGIN = 'https://school.example.org';
const req = (path: string, mode = 'cors', method = 'GET') => ({ url: `${ORIGIN}${path}`, method, mode });

describe('caching rules (D-190)', () => {
  it('never answers an API request, in any mode or method', () => {
    for (const p of ['/api/auth/me', '/api/classroom/layout?contextId=x', '/api/lessons/state', '/api/files/abc', '/api/avatars/pictures/1', '/api']) {
      expect(classifyRequest(req(p), ORIGIN), p).toBe('pass');
      expect(classifyRequest(req(p, 'navigate'), ORIGIN), p).toBe('pass');
      expect(classifyRequest(req(p, 'cors', 'POST'), ORIGIN), p).toBe('pass');
    }
  });

  it('leaves the student page, the Super Speakers pages, AI tools and OAuth to the network', () => {
    for (const p of ['/s', '/s/x', '/p', '/p/app', '/p/manifest.webmanifest', '/board', '/mcp', '/oauth/authorize', '/oauth/consent', '/.well-known/oauth-authorization-server', '/healthz', '/robots.txt', '/scorer-sw.js', '/app-sw.js', '/student.html']) {
      expect(classifyRequest(req(p, 'navigate'), ORIGIN), p).toBe('pass');
      expect(classifyRequest(req(p), ORIGIN), p).toBe('pass');
    }
    expect(isPassThroughPath('/s')).toBe(true);
    // Paths that only start like a pass-through path are pages of the app.
    expect(isAppPagePath('/signin-link')).toBe(true);
    expect(isAppPagePath('/settings')).toBe(true);
    expect(isAppPagePath('/pupils')).toBe(true);
  });

  it('answers pages of the main app network first (with the cached shell offline)', () => {
    for (const p of ['/', '/classroom', '/teacher', '/teacher/attendance', '/admin/users', '/login', '/help/en/teacher']) expect(classifyRequest(req(p, 'navigate'), ORIGIN), p).toBe('page');
  });

  it('serves built files cache first, but not source maps, other origins, other methods or other paths', () => {
    expect(classifyRequest(req('/assets/main-abc123.js'), ORIGIN)).toBe('asset');
    expect(classifyRequest(req('/assets/app-abc123.css'), ORIGIN)).toBe('asset');
    expect(classifyRequest(req('/assets/main-abc123.js.map'), ORIGIN)).toBe('pass');
    expect(classifyRequest(req('/assets/'), ORIGIN)).toBe('pass');
    expect(classifyRequest({ url: 'https://cdn.example.org/assets/x.js', method: 'GET', mode: 'cors' }, ORIGIN)).toBe('pass');
    expect(classifyRequest(req('/assets/main-abc123.js', 'cors', 'HEAD'), ORIGIN)).toBe('pass');
    expect(classifyRequest(req('/favicon.ico'), ORIGIN)).toBe('pass');
    expect(classifyRequest({ url: 'not a url', method: 'GET', mode: 'cors' }, ORIGIN)).toBe('pass');
  });

  it('deletes only older caches of this app, never the scorer app shell', () => {
    expect(isOldAppCache('cc-app-old', 'new')).toBe(true);
    expect(isOldAppCache(cacheNameOf('new'), 'new')).toBe(false);
    expect(isOldAppCache('cc-scorer-shell-v2', 'new')).toBe(false);
    expect(isOldAppCache('other', 'new')).toBe(false);
  });

  it('keeps as the offline shell only an HTML page of its own build', () => {
    const res = (over: Partial<{ ok: boolean; status: number; redirected: boolean; type: string; ct: string }> = {}) => ({
      ok: over.ok ?? true,
      status: over.status ?? 200,
      redirected: over.redirected ?? false,
      type: over.type ?? 'basic',
      headers: { get: () => over.ct ?? 'text/html; charset=utf-8' },
    });
    const html = '<head><meta name="cc-build" content="b1" /></head>';
    expect(isShellOfBuild(res(), html, 'b1')).toBe(true);
    expect(isShellOfBuild(res(), html, 'b2')).toBe(false);
    expect(isShellOfBuild(res({ status: 404, ok: false }), html, 'b1')).toBe(false);
    expect(isShellOfBuild(res({ redirected: true }), html, 'b1')).toBe(false);
    expect(isShellOfBuild(res({ ct: 'application/json' }), html, 'b1')).toBe(false);
  });
});

// ---------------------------------------------------------------- the worker with fake caches
class FakeCache {
  store = new Map<string, Response>();
  async match(r: Request | string) {
    const hit = this.store.get(typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
    return hit ? hit.clone() : undefined;
  }
  async put(r: Request | string, res: Response) {
    this.store.set(typeof r === 'string' ? new URL(r, ORIGIN).href : r.url, res);
  }
  async addAll(rs: Request[]) {
    for (const r of rs) await this.put(r, await fetch(r));
  }
}
class FakeCaches {
  all = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.all.has(name)) this.all.set(name, new FakeCache());
    return this.all.get(name)!;
  }
  async keys() {
    return [...this.all.keys()];
  }
  async delete(name: string) {
    return this.all.delete(name);
  }
}

type Handler = (e: any) => void;
function fakeScope() {
  const handlers = new Map<string, Handler>();
  const scope = {
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined), get: async (id: string) => (id ? { url: `${ORIGIN}${id}` } : undefined) },
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
  };
  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  /**
   * Dispatch a fetch; resolves to the response, or null when the worker did not answer. `client` is
   * the path of the page that asks (the fake `clients.get` takes the path as the client id).
   */
  const fetchEvent = async (path: string, mode: RequestMode | 'navigate' = 'cors', client = '') => {
    let answer: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    const request = { url: `${ORIGIN}${path}`, method: 'GET', mode } as unknown as Request;
    handlers.get('fetch')!({ request, clientId: client, respondWith: (r: Promise<Response>) => (answer = Promise.resolve(r)), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const answered = answer as Promise<Response> | null;
    const res = answered ? await answered : null;
    await Promise.all(waits);
    return res;
  };
  return { scope, lifecycle, fetchEvent, handlers };
}

const CSP = "default-src 'self'; frame-ancestors 'none'";
const page = (build: string) =>
  new Response(`<html><head><meta name="cc-build" content="${build}" /></head></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-frame-options': 'DENY' } });

describe('the worker (fake caches, D-190)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(build = 'b1') {
    const caches = new FakeCaches();
    let online = true;
    const fetched: string[] = [];
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', async (r: Request | string) => {
      const url = typeof r === 'string' ? new URL(r, ORIGIN).href : new URL(r.url, ORIGIN).href;
      fetched.push(url);
      if (!online) throw new TypeError('Failed to fetch');
      const path = new URL(url).pathname;
      if (path.startsWith('/assets/')) return new Response(`/* ${path} */`, { status: 200, headers: { 'content-type': 'text/javascript' } });
      if (path.startsWith('/api/')) return new Response('{"students":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
      return page(build);
    });
    vi.stubGlobal('Request', class {
      url: string;
      constructor(u: string) {
        this.url = new URL(u, ORIGIN).href;
      }
    });
    const w = fakeScope();
    installWorker(w.scope as never, build, ['/assets/main-1.js', '/assets/app-1.css']);
    return { caches, w, fetched, setOnline: (v: boolean) => (online = v) };
  }

  it('installs with the build files and the page, and answers them offline (UX-11)', async () => {
    const { caches, w, setOnline } = setup();
    await w.lifecycle('install');
    const cache = caches.all.get(cacheNameOf('b1'))!;
    expect([...cache.store.keys()].sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/assets/app-1.css`, `${ORIGIN}/assets/main-1.js`]);
    setOnline(false);
    const shell = await w.fetchEvent('/classroom', 'navigate');
    expect(await shell!.text()).toContain('content="b1"');
    expect(await (await w.fetchEvent('/assets/main-1.js'))!.text()).toContain('main-1.js');
  });

  it('never answers or stores an API request, online or offline', async () => {
    const { caches, w, setOnline } = setup();
    await w.lifecycle('install');
    expect(await w.fetchEvent('/api/lessons/state?contextId=c1')).toBeNull();
    expect(await w.fetchEvent('/api/classroom/avatars', 'navigate')).toBeNull();
    setOnline(false);
    expect(await w.fetchEvent('/api/auth/me')).toBeNull();
    for (const c of caches.all.values()) for (const k of c.store.keys()) expect(k).not.toContain('/api/');
  });

  it('does not answer the student page or the Super Speakers pages', async () => {
    const { w } = setup();
    await w.lifecycle('install');
    for (const p of ['/s', '/p', '/p/app', '/board']) expect(await w.fetchEvent(p, 'navigate'), p).toBeNull();
  });

  it('keeps the newest page of its own build, not a newer build’s page', async () => {
    const { caches, w } = setup('b1');
    await w.lifecycle('install');
    vi.stubGlobal('fetch', async () => page('b2'));
    await w.fetchEvent('/classroom', 'navigate');
    const shell = await caches.all.get(cacheNameOf('b1'))!.match('/');
    expect(await shell!.text()).toContain('content="b1"');
  });

  it('activating deletes older builds of the app but never the scorer shell; it waits for SKIP_WAITING', async () => {
    const { caches, w } = setup('b2');
    await caches.open('cc-app-b1');
    await caches.open('cc-scorer-shell-v2');
    await w.lifecycle('install');
    expect(w.scope.skipWaiting).not.toHaveBeenCalled();
    await w.lifecycle('activate');
    expect((await caches.keys()).sort()).toEqual([cacheNameOf('b2'), 'cc-scorer-shell-v2']);
    const waits: Promise<unknown>[] = [];
    w.handlers.get('message')!({ data: { type: 'SKIP_WAITING' }, ports: [], waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(w.scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it('serves the offline page with the server’s security headers (review of S26b)', async () => {
    const { w, setOnline } = setup();
    await w.lifecycle('install');
    // The first online visit replaces the installed shell; it keeps the headers too.
    expect(await (await w.fetchEvent('/teacher', 'navigate'))!.text()).toContain('content="b1"');
    setOnline(false);
    const shell = (await w.fetchEvent('/classroom', 'navigate'))!;
    expect(shell.headers.get('content-security-policy')).toBe(CSP);
    expect(shell.headers.get('x-frame-options')).toBe('DENY');
    expect(await shell.text()).toContain('content="b1"');
  });

  it('never stores the files of the student page or the hall board (review of S26b)', async () => {
    const { caches, w, fetched, setOnline } = setup();
    await w.lifecycle('install');
    const cache = caches.all.get(cacheNameOf('b1'))!;
    for (const client of ['/s', '/s/x', '/board']) {
      const res = await w.fetchEvent(`/assets/student-7${client.replace(/\//gu, '-')}.js`, 'cors', client);
      expect(await res!.text()).toContain('/assets/student-7');
    }
    expect([...cache.store.keys()].filter((k) => k.includes('student-7'))).toEqual([]);
    // Not even a file of this build that is cached: those pages get the network's answer.
    const before = fetched.length;
    await w.fetchEvent('/assets/main-1.js', 'cors', '/s');
    expect(fetched.length).toBe(before + 1);
    // The same file asked for by the classroom is cached.
    await w.fetchEvent('/assets/student-7-shared.js', 'cors', '/classroom');
    expect(cache.store.has(`${ORIGIN}/assets/student-7-shared.js`)).toBe(true);
    setOnline(false);
    expect(await (await w.fetchEvent('/assets/student-7-shared.js', 'cors', '/classroom'))!.text()).toContain('student-7-shared');
  });

  it('fills the cache with a built file on first use', async () => {
    const { caches, w } = setup();
    await w.lifecycle('install');
    await w.fetchEvent('/assets/guide-picture-9.png');
    expect(caches.all.get(cacheNameOf('b1'))!.store.has(`${ORIGIN}/assets/guide-picture-9.png`)).toBe(true);
  });
});

// ---------------------------------------------------------------- the build
const chunk = (fileName: string, name: string, over: Partial<{ isEntry: boolean; imports: string[]; dynamicImports: string[]; css: string[] }> = {}) => ({
  type: 'chunk' as const,
  fileName,
  name,
  isEntry: over.isEntry ?? false,
  imports: over.imports ?? [],
  dynamicImports: over.dynamicImports ?? [],
  viteMetadata: { importedCss: new Set(over.css ?? []) },
});

describe('the build of the worker (D-190)', () => {
  const bundle = {
    'assets/main-1.js': chunk('assets/main-1.js', 'main', { isEntry: true, imports: ['assets/vendor-1.js'], dynamicImports: ['assets/School-1.js'], css: ['assets/app-1.css'] }),
    'assets/vendor-1.js': chunk('assets/vendor-1.js', 'vendor'),
    'assets/School-1.js': chunk('assets/School-1.js', 'School', { imports: ['assets/vendor-1.js'] }),
    'assets/student-1.js': chunk('assets/student-1.js', 'student', { isEntry: true, imports: ['assets/vendor-1.js', 'assets/student-only-1.js'] }),
    'assets/student-only-1.js': chunk('assets/student-only-1.js', 'student-only'),
    'assets/scorer-1.js': chunk('assets/scorer-1.js', 'scorer', { isEntry: true }),
    'assets/main-1.js.map': { type: 'asset' as const, fileName: 'assets/main-1.js.map' },
    'index.html': { type: 'asset' as const, fileName: 'index.html' },
  };

  it('precaches what the main entry loads, never the student page’s or the scorer’s own files', () => {
    expect(precacheList(bundle)).toEqual(['/assets/School-1.js', '/assets/app-1.css', '/assets/main-1.js', '/assets/vendor-1.js']);
  });

  it('has a build id that changes with the files and the worker code', () => {
    const id = buildIdOf(bundle, 'code');
    expect(id).toMatch(/^[0-9a-f]{16}$/u);
    expect(buildIdOf(bundle, 'code')).toBe(id);
    expect(buildIdOf(bundle, 'other')).not.toBe(id);
    expect(buildIdOf({ ...bundle, 'assets/main-2.js': chunk('assets/main-2.js', 'x') }, 'code')).not.toBe(id);
  });

  it('is a classic script with the build id and file list, without exports or types', async () => {
    const { readFileSync } = await import('node:fs');
    const { WORKER_SOURCE } = await import('../../scripts/appWorker.ts');
    const code = await workerScript(readFileSync(WORKER_SOURCE, 'utf8'), 'abc', ['/assets/main-1.js']);
    expect(code).not.toMatch(/^export /mu);
    expect(code).toContain('const CC_BUILD_ID = "abc";');
    expect(code).toContain('const CC_PRECACHE = ["/assets/main-1.js"];');
    // Runs as a classic script: it installs its listeners on `self`.
    const types: string[] = [];
    const self = { location: { origin: ORIGIN }, addEventListener: (t: string) => types.push(t), clients: {}, skipWaiting: () => undefined };
    vm.runInNewContext(code, { self, URL, Response, Request, setTimeout, clearTimeout });
    expect(types.sort()).toEqual(['activate', 'fetch', 'install', 'message']);
  });
});

describe('moving to a new build (D-190)', () => {
  it('reloads only at a quiet moment: never with a lesson or a flow on screen, waiting commands or offline', () => {
    const base = { screen: 'idle' as const, hidden: false, pending: 0, online: true };
    expect(isQuietMoment(base)).toBe(true);
    expect(isQuietMoment({ ...base, pending: 1 })).toBe(false);
    expect(isQuietMoment({ ...base, online: false })).toBe(false);
    expect(isQuietMoment({ ...base, screen: 'lesson' })).toBe(false);
    expect(isQuietMoment({ ...base, screen: 'lesson', hidden: true })).toBe(false);
    expect(isQuietMoment({ ...base, screen: 'flow', hidden: true })).toBe(false);
    expect(isQuietMoment({ ...base, screen: null })).toBe(false);
    // A teacher page in a background tab may hold a typed draft: never reloaded (review of S26b).
    expect(isQuietMoment({ screen: null, hidden: true, pending: 0, online: true })).toBe(false);
    expect(isQuietMoment({ ...base, hidden: true })).toBe(true);
  });

  it('reads the page’s build from its meta tag', () => {
    const doc = { querySelector: () => ({ getAttribute: () => 'b9' }) } as unknown as Document;
    expect(pageBuild(doc)).toBe('b9');
    expect(pageBuild({ querySelector: () => null } as unknown as Document)).toBeNull();
  });
});
