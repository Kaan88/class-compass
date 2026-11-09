/**
 * Super Speakers on its own origin (S14f, D-157; refines D-128, D-134, D-135; SSP-3, SSP-4, ENG-3):
 * - configuration: SPEAKERS_ORIGIN is optional, must be a bare origin with the main scheme and its own
 *   hostname; unset, empty or equal to PUBLIC_ORIGIN means "not split";
 * - CSRF by endpoint path: every mutating endpoint under /api/scorer… and /api/board… accepts the main
 *   and the speakers origin, every other endpoint only the main origin (matrix over every endpoint);
 * - host routing while split: the speakers host serves only the scorer app, the board, their assets
 *   and API and /healthz (404 for everything else, never the main app's page); the main host answers
 *   /p, /p/app and /board with a 308 (path and query kept, not cached) and serves the kill-switch
 *   scorer service worker; the raw Host header decides, so no X-Forwarded-Host value (trusted proxy
 *   or not) opens the main app on the speakers host; a device with queued scorer awards (queue cookie)
 *   still gets the scorer app on the main host so the queue is sent before it moves;
 * - scorer and board links (and so their QR codes) use the speakers origin;
 * - with SPEAKERS_ORIGIN unset nothing changes.
 * Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Endpoint } from '../../src/shared/contracts/define.ts';
import { loadConfig, resolveOrigins } from '../../src/server/config.ts';
import { originClassOf, registeredEndpoints } from '../../src/server/lib/http.ts';
import { isSpeakersHost, normalizeHost, SCORER_SW_KILL_SWITCH, speakersHostAllows } from '../../src/server/lib/speakersHost.ts';
import { SCORER_QUEUE_COOKIE } from '../../src/shared/contracts/superSpeakers.ts';
import { Client, makeEnv, TEST_ORIGIN, type TestEnv } from '../helpers.ts';
import { buildSchool, ok } from '../school-fixture.ts';

const SPEAKERS = 'http://speakers.localhost:5173';
const SPEAKERS_HOST = 'speakers.localhost:5173';
const MAIN_HOST = 'localhost:5173';
const EVIL = 'http://evil.example.com';
const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.app.close();
  env = null;
});

/** A raw request with an explicit Host (and Origin) header. */
async function raw(e: TestEnv, method: 'GET' | 'HEAD' | 'POST', url: string, host: string, extra: Record<string, string> = {}, payload?: object) {
  return e.app.inject({ method, url, headers: { host, 'x-cc-csrf': '1', ...extra }, ...(payload ? { payload } : {}) });
}

/** A same-origin browser on a given host: its Origin header is that host's origin. */
class HostClient extends Client {
  host: string;
  origin: string;
  constructor(e: TestEnv, host: string, origin: string) {
    super(e);
    this.host = host;
    this.origin = origin;
  }
  override req(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    return super.req(method, url, body, { host: this.host, origin: this.origin, ...extraHeaders });
  }
}

const base = { NODE_ENV: 'test', SECRET_PEPPER: 'config-test-pepper-0123456789', DATA_DIR: './data-config-test', PUBLIC_ORIGIN: 'https://school.example.org' };

describe('configuration (D-157)', () => {
  it('is optional: unset, empty or equal to PUBLIC_ORIGIN keeps everything on the main origin', () => {
    for (const SPEAKERS_ORIGIN of [undefined, '', 'https://school.example.org', 'https://SCHOOL.example.org/']) {
      const c = loadConfig({ ...base, ...(SPEAKERS_ORIGIN === undefined ? {} : { SPEAKERS_ORIGIN }) });
      expect(c.origins).toEqual({ main: 'https://school.example.org', speakers: 'https://school.example.org', mainHost: 'school.example.org', speakersHost: 'school.example.org', split: false });
    }
  });

  it('splits on a hostname of its own (lower-cased, a trailing slash is fine)', () => {
    const c = loadConfig({ ...base, SPEAKERS_ORIGIN: 'https://Speakers.Example.org/' });
    expect(c.origins).toEqual({ main: 'https://school.example.org', speakers: 'https://speakers.example.org', mainHost: 'school.example.org', speakersHost: 'speakers.example.org', split: true });
    expect(resolveOrigins('http://localhost:5173', 'http://speakers.localhost:5173').speakersHost).toBe(SPEAKERS_HOST);
  });

  it('refuses invalid combinations', () => {
    const bad: Array<[string, RegExp]> = [
      ['not a url', /SPEAKERS_ORIGIN/u],
      ['ftp://speakers.example.org', /https/u],
      ['https://speakers.example.org/board', /origin only/u],
      ['https://speakers.example.org/?x=1', /origin only/u],
      ['https://speakers.example.org/#x', /origin only/u],
      ['https://user:pw@speakers.example.org', /user name/u],
      ['http://speakers.example.org', /same scheme/u],
      ['https://school.example.org:8443', /different hostname/u],
      // The same name spelled with a trailing dot (a dotted name is refused outright).
      ['https://school.example.org.', /dot/u],
      ['https://speakers.example.org.', /dot/u],
    ];
    for (const [value, why] of bad) expect(() => loadConfig({ ...base, SPEAKERS_ORIGIN: value }), value).toThrow(why);
    // PUBLIC_ORIGIN with the trailing dot and SPEAKERS_ORIGIN without it are the same hostname too.
    expect(() => resolveOrigins('https://school.example.org.', 'https://school.example.org')).toThrow(/different hostname/u);
  });

  it('stores the hosts the way the host routing compares them', () => {
    const o = resolveOrigins('https://school.example.org.:443', 'https://Speakers.Example.org:443/');
    expect(o).toMatchObject({ mainHost: 'school.example.org', speakersHost: 'speakers.example.org', split: true });
    expect(isSpeakersHost(o, { host: 'school.example.org' })).toBe(false);
    expect(isSpeakersHost(o, { host: 'school.example.org.' })).toBe(false);
    expect(isSpeakersHost(o, { host: 'speakers.example.org.' })).toBe(true);
  });

  it('is recomputed from test overrides', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    expect(env.config.origins).toMatchObject({ main: TEST_ORIGIN, speakers: SPEAKERS, split: true });
    await env.app.close();
    env = await makeEnv();
    expect(env.config.origins.split).toBe(false);
  });

  it('normalises Host headers like URL.host', () => {
    expect(normalizeHost('Speakers.Example.org:443')).toBe('speakers.example.org');
    expect(normalizeHost('speakers.example.org.')).toBe('speakers.example.org');
    expect(normalizeHost('localhost:5173')).toBe('localhost:5173');
    expect(normalizeHost('a@b')).toBe('');
    expect(normalizeHost(undefined)).toBe('');
  });
});

describe('CSRF by endpoint path (D-157)', () => {
  const DUMMY = '0190f0f0-0000-7000-8000-000000000000';
  const urlOf = (e: Endpoint) => e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => (k === 'module' ? 'routines' : DUMMY));
  const mutating = () => {
    const seen = new Set<string>();
    return registeredEndpoints.filter((e) => {
      const k = `${e.method} ${e.path}`;
      if (e.method === 'GET' || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  it('only the scorer and board API is in the speakers class', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    const all = registeredEndpoints;
    for (const e of all) {
      if (e.access === 'scorer' || e.access === 'display') expect(originClassOf(e.path), e.path).toBe('speakers');
      if (originClassOf(e.path) === 'speakers') expect(['scorer', 'display', 'public'], e.path).toContain(e.access);
    }
    expect(originClassOf('/api/scorer')).toBe('speakers');
    expect(originClassOf('/api/board/session')).toBe('speakers');
    expect(originClassOf('/api/scorers')).toBe('main');
    expect(originClassOf('/api/admin/speakers/board')).toBe('main');
  });

  it('every mutating endpoint: speakers origin only for /api/scorer… and /api/board…, a foreign origin never (ENG-3)', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    const targets = mutating();
    expect(targets.length).toBeGreaterThan(50);
    const wrong: string[] = [];
    for (const e of targets) {
      const speakersClass = originClassOf(e.path) === 'speakers';
      // On the main host (host routing is not what is tested here).
      const fromSpeakers = await raw(env, e.method as 'POST', urlOf(e), MAIN_HOST, { origin: SPEAKERS, 'content-type': 'application/json' }, {});
      const isCsrf = fromSpeakers.statusCode === 403 && fromSpeakers.json().error?.code === 'CSRF';
      if (isCsrf === speakersClass) wrong.push(`${e.method} ${e.path} from the speakers origin → ${fromSpeakers.statusCode}`);
      const fromMain = await raw(env, e.method as 'POST', urlOf(e), MAIN_HOST, { origin: TEST_ORIGIN, 'content-type': 'application/json' }, {});
      if (fromMain.statusCode === 403 && fromMain.json().error?.code === 'CSRF') wrong.push(`${e.method} ${e.path} from the main origin → CSRF`);
      const fromEvil = await raw(env, e.method as 'POST', urlOf(e), MAIN_HOST, { origin: EVIL, 'content-type': 'application/json' }, {});
      if (!(fromEvil.statusCode === 403 && fromEvil.json().error?.code === 'CSRF')) wrong.push(`${e.method} ${e.path} from a foreign origin → ${fromEvil.statusCode}`);
    }
    expect(wrong).toEqual([]);
  });

  it('unset: another origin is refused everywhere, as before', async () => {
    env = await makeEnv();
    for (const url of ['/api/board/session', '/api/scorer/pair', '/api/auth/login']) {
      const r = await raw(env, 'POST', url, MAIN_HOST, { origin: SPEAKERS, 'content-type': 'application/json' }, {});
      expect(r.statusCode, url).toBe(403);
      expect(r.json().error.code).toBe('CSRF');
    }
  });

  it('cross-site fetch metadata is still refused on the speakers endpoints', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    const r = await raw(env, 'POST', '/api/board/session', SPEAKERS_HOST, { origin: SPEAKERS, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, {});
    expect(r.json().error.code).toBe('CSRF');
  });
});

describe('host routing while split (D-157)', () => {
  it('the speakers host serves only the scorer app, the board, their API and /healthz', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    expect((await raw(env, 'GET', '/healthz', SPEAKERS_HOST)).statusCode).toBe(200);
    // The two APIs are reached (no session → 401 / validation), not refused by the host.
    expect((await raw(env, 'GET', '/api/board', SPEAKERS_HOST)).statusCode).toBe(401);
    expect((await raw(env, 'GET', '/api/scorer/me', SPEAKERS_HOST)).statusCode).toBe(401);
    expect((await raw(env, 'POST', '/api/board/session', SPEAKERS_HOST, { origin: SPEAKERS, 'content-type': 'application/json' }, {})).statusCode).toBe(400);
    // The pages are reached (200 when the client is built, else the "not built" note), never the host's 404.
    for (const url of ['/p', '/p/app', '/p?x=1', '/board']) {
      const r = await raw(env, 'GET', url, SPEAKERS_HOST);
      expect(r.body, url).not.toBe('Not found');
      expect(r.statusCode, url).not.toBe(308);
    }
    // The real scorer service worker (a static file of the built client), never the kill switch.
    const worker = await raw(env, 'GET', '/scorer-sw.js', SPEAKERS_HOST);
    expect(worker.statusCode).toBe(fs.existsSync(path.resolve(import.meta.dirname, '../../dist/client/scorer-sw.js')) ? 200 : 404);
    expect(worker.body).not.toBe(SCORER_SW_KILL_SWITCH);
    // Everything else is 404, including spellings that try to escape a prefix.
    const denied = [
      '/',
      '/login',
      '/classroom',
      '/admin/speakers',
      '/teacher',
      '/s',
      '/index.html',
      '/scorer.html',
      '/robots.txt',
      '/api/auth/me',
      '/api/admin/speakers',
      '/api/student/page',
      '/api/commands',
      '/api/scorer/../admin/speakers',
      '/api/scorer/%2e%2e/admin/speakers',
      '/api/board%2F..%2Fadmin',
      '/p/../index.html',
      '//p',
      '/p/no-such-file',
      '/assets/no-such-file.js',
    ];
    for (const url of denied) {
      const r = await raw(env, 'GET', url, SPEAKERS_HOST);
      expect(r.statusCode, url).toBe(404);
      expect(r.body, url).not.toContain('<div id="root">');
    }
    const api = await raw(env, 'POST', '/api/auth/login', SPEAKERS_HOST, { origin: SPEAKERS, 'content-type': 'application/json' }, { login: 'x', password: 'y' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
  });

  it('the main host moves /p, /p/app and /board with a 308 that keeps path and query and is not cached', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    for (const url of ['/p', '/p/app', '/board', '/board?screen=hall', '/p/app?source=pwa']) {
      for (const method of ['GET', 'HEAD'] as const) {
        const r = await raw(env, method, url, MAIN_HOST);
        expect(r.statusCode, `${method} ${url}`).toBe(308);
        expect(r.headers.location).toBe(`${SPEAKERS}${url}`);
        expect(r.headers['cache-control']).toBe('no-store');
      }
    }
    // An unknown host (a LAN address, the container health check) is the main app too.
    expect((await raw(env, 'GET', '/board', '127.0.0.1:3210')).headers.location).toBe(`${SPEAKERS}/board`);
    expect((await raw(env, 'GET', '/healthz', '127.0.0.1:3210')).statusCode).toBe(200);
    // The rest of the main app is untouched.
    expect((await raw(env, 'GET', '/api/admin/speakers', MAIN_HOST)).statusCode).toBe(401);
    expect((await raw(env, 'GET', '/', MAIN_HOST)).statusCode).not.toBe(308);
    expect((await raw(env, 'GET', '/p/manifest.webmanifest', MAIN_HOST)).statusCode).not.toBe(308);
    expect((await raw(env, 'GET', '/boards', MAIN_HOST)).statusCode).not.toBe(308);
  });

  it('a spoofed X-Forwarded-Host never opens the main app on the speakers host, even behind a trusted proxy', async () => {
    for (const TRUST_PROXY of [true, false]) {
      env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS, TRUST_PROXY });
      for (const fwd of [MAIN_HOST, 'anything', `${SPEAKERS_HOST}, ${MAIN_HOST}`, `${MAIN_HOST}, evil.example.com`]) {
        const h = { 'x-forwarded-host': fwd };
        for (const url of ['/login', '/', '/api/auth/me', '/api/admin/speakers']) {
          const r = await raw(env, 'GET', url, SPEAKERS_HOST, h);
          expect(r.statusCode, `${TRUST_PROXY} ${fwd} ${url}`).toBe(404);
          expect(r.body).not.toContain('<div id="root">');
        }
        const login = await raw(env, 'POST', '/api/auth/login', SPEAKERS_HOST, { ...h, origin: TEST_ORIGIN, 'content-type': 'application/json' }, { login: 'x', password: 'y' });
        expect(login.statusCode, `${TRUST_PROXY} ${fwd} login`).toBe(404);
        expect(login.json().error.code).toBe('NOT_FOUND');
        // The speakers allow-list itself still works with the header present.
        expect((await raw(env, 'GET', '/api/scorer/me', SPEAKERS_HOST, h)).statusCode).toBe(401);
      }
      await env.app.close();
      env = null;
    }
  });

  it('a forwarded speakers host can only narrow a request to the speakers allow-list', async () => {
    for (const TRUST_PROXY of [true, false]) {
      env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS, TRUST_PROXY });
      for (const fwd of [SPEAKERS_HOST, `${MAIN_HOST}, ${SPEAKERS_HOST}`, 'SPEAKERS.localhost:5173']) {
        expect((await raw(env, 'GET', '/login', '127.0.0.1:3210', { 'x-forwarded-host': fwd })).statusCode, fwd).toBe(404);
        expect((await raw(env, 'GET', '/api/auth/me', MAIN_HOST, { 'x-forwarded-host': fwd })).statusCode, fwd).toBe(404);
      }
      // Without the header the main host is the main app.
      expect((await raw(env, 'GET', '/api/auth/me', MAIN_HOST)).statusCode).toBe(401);
      await env.app.close();
      env = null;
    }
  });

  it('a device with queued awards (scorer queue cookie) gets the scorer app on the main host, never the board', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    for (const url of ['/p', '/p/app', '/p/app?source=pwa']) {
      const r = await raw(env, 'GET', url, MAIN_HOST, { cookie: `${SCORER_QUEUE_COOKIE}=1` });
      expect(r.statusCode, url).not.toBe(308);
      expect(r.headers.location, url).toBeUndefined();
      // The probe the app sends once its queue is empty and the cookie is gone.
      expect((await raw(env, 'HEAD', '/p', MAIN_HOST)).statusCode).toBe(308);
    }
    expect((await raw(env, 'GET', '/board', MAIN_HOST, { cookie: `${SCORER_QUEUE_COOKIE}=1` })).statusCode).toBe(308);
    for (const cookie of [`${SCORER_QUEUE_COOKIE}=0`, `${SCORER_QUEUE_COOKIE}=`, 'other=1']) expect((await raw(env, 'GET', '/p/app', MAIN_HOST, { cookie })).statusCode, cookie).toBe(308);
    // The queued app on the main host can still send its outbox there (the scorer API stays on the main host).
    expect((await raw(env, 'GET', '/api/scorer/me', MAIN_HOST, { cookie: `${SCORER_QUEUE_COOKIE}=1` })).statusCode).toBe(401);
    // The cookie changes nothing on the speakers host.
    expect((await raw(env, 'GET', '/login', SPEAKERS_HOST, { cookie: `${SCORER_QUEUE_COOKIE}=1` })).statusCode).toBe(404);
  });

  it('the main host serves a kill-switch scorer service worker', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    const r = await raw(env, 'GET', '/scorer-sw.js', MAIN_HOST);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/javascript/u);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toBe(SCORER_SW_KILL_SWITCH);
  });

  it('unset: no redirects, no host filter, the normal service worker', async () => {
    env = await makeEnv();
    expect((await raw(env, 'GET', '/board', MAIN_HOST)).statusCode).not.toBe(308);
    expect((await raw(env, 'GET', '/p/app', SPEAKERS_HOST)).statusCode).not.toBe(308);
    expect((await raw(env, 'GET', '/api/admin/speakers', SPEAKERS_HOST)).statusCode).toBe(401);
    expect((await raw(env, 'GET', '/scorer-sw.js', MAIN_HOST)).body).not.toBe(SCORER_SW_KILL_SWITCH);
  });

  it('speakersHostAllows is an allow-list', () => {
    for (const p of ['/p', '/p/app', '/p/icon-192.png', '/board', '/assets/index-abc.js', '/scorer-sw.js', '/healthz', '/api/scorer/me', '/api/board', '/api/board/events']) expect(speakersHostAllows(p), p).toBe(true);
    for (const p of ['/', '/p/', '/assets/', '/boards', '/api/scorers', '/api/boardx', '/api/admin', '/p/%2e%2e/x', '/p/../x', '/p//x', '/p\\x', 'p']) expect(speakersHostAllows(p), p).toBe(false);
  });
});

describe('links, QR codes and sessions on the speakers origin (D-157, SSP-3)', () => {
  it('scorer and board links point at the speakers origin and work there end to end', async () => {
    env = await makeEnv({ SPEAKERS_ORIGIN: SPEAKERS });
    const s = await buildSchool(env);
    await ok(s.admin.put('/api/admin/module-policies/superSpeakers', { availability: 'enabled' }));
    const scorerLink = await ok(s.admin.post('/api/admin/speakers/scorers', { label: 'Ms Deniz' }));
    const boardLink = await ok(s.admin.post('/api/admin/speakers/displays', { label: 'Hall screen' }));
    expect(scorerLink.url).toMatch(new RegExp(`^${SPEAKERS}/p#`, 'u'));
    expect(boardLink.url).toMatch(new RegExp(`^${SPEAKERS}/board#`, 'u'));
    const overview = await ok(s.admin.get('/api/admin/speakers'));
    for (const l of [...overview.scorerLinks, ...overview.displayLinks]) expect(l.url.startsWith(`${SPEAKERS}/`)).toBe(true);

    const phone = new HostClient(env, SPEAKERS_HOST, SPEAKERS);
    await ok(phone.post('/api/scorer/session', { token: tokenOf(scorerLink.url) }));
    expect((await ok(phone.get('/api/scorer/me'))).enabled).toBe(true);
    const screen = new HostClient(env, SPEAKERS_HOST, SPEAKERS);
    await ok(screen.post('/api/board/session', { token: tokenOf(boardLink.url) }));
    expect((await screen.get('/api/board')).status).toBe(200);
    // The board session cannot reach anything of the main app on the speakers host.
    expect((await screen.get('/api/admin/speakers')).status).toBe(404);
  });

  it('unset: links stay on PUBLIC_ORIGIN', async () => {
    env = await makeEnv();
    const s = await buildSchool(env);
    const scorerLink = await ok(s.admin.post('/api/admin/speakers/scorers', { label: 'Ms Deniz' }));
    expect(scorerLink.url.startsWith(`${TEST_ORIGIN}/p#`)).toBe(true);
  });
});

describe('scorer service worker (D-135, D-157)', () => {
  const sw = fs.readFileSync(path.resolve(import.meta.dirname, '../../public/scorer-sw.js'), 'utf8');

  it('the shell cache is v2 and its name is one the kill switch deletes', () => {
    const cache = /const CACHE = '([^']+)'/u.exec(sw)?.[1];
    expect(cache).toBe('cc-scorer-shell-v2');
    expect(SCORER_SW_KILL_SWITCH).toContain("k.startsWith('cc-scorer-shell-')");
    expect(SCORER_SW_KILL_SWITCH).not.toContain("addEventListener('fetch'");
  });

  it('the kill switch deletes the scorer caches, unregisters and reloads its pages', async () => {
    const handlers = new Map<string, (event: any) => void>();
    const deleted: string[] = [];
    const unregister = vi.fn(async () => true);
    const navigate = vi.fn(async () => null);
    const skipWaiting = vi.fn();
    const self = {
      addEventListener: (type: string, fn: (event: any) => void) => handlers.set(type, fn),
      skipWaiting,
      registration: { unregister },
      clients: { matchAll: async () => [{ url: 'https://school.example.org/p/app', navigate }] },
    };
    const caches = { keys: async () => ['cc-scorer-shell-v1', 'cc-scorer-shell-v2', 'other-cache'], delete: async (k: string) => deleted.push(k) };
    new Function('self', 'caches', SCORER_SW_KILL_SWITCH)(self, caches);
    handlers.get('install')!({});
    expect(skipWaiting).toHaveBeenCalled();
    let done: Promise<unknown> = Promise.resolve();
    handlers.get('activate')!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(deleted).toEqual(['cc-scorer-shell-v1', 'cc-scorer-shell-v2']);
    expect(unregister).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('https://school.example.org/p/app');
  });
});
