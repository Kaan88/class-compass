/**
 * The server side of the app's service worker (S26b, D-190; D-006): the CSP allows a same-origin
 * worker only, the worker file is never cached by browsers or proxies (a new deploy is found on the
 * next load), the Super Speakers host never serves it, and API answers stay `no-store`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_WORKER_PATH } from '../../src/server/app.ts';
import { speakersHostAllows } from '../../src/server/lib/speakersHost.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.app.close();
  env = null;
});

const built = fs.existsSync(path.resolve(import.meta.dirname, '../../dist/client/app-sw.js'));

describe('app service worker headers (D-190)', () => {
  it('the CSP allows workers from this origin only', async () => {
    env = await makeEnv();
    const r = await env.app.inject({ method: 'GET', url: '/healthz' });
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toMatch(/worker-src[^;]*(blob:|\*|https?:)/u);
  });

  it('the worker file is never cached, whether or not the client is built', async () => {
    env = await makeEnv();
    for (const url of [APP_WORKER_PATH, `${APP_WORKER_PATH}?v=1`]) {
      const r = await env.app.inject({ method: 'GET', url });
      expect(r.headers['cache-control'], url).toBe('no-store');
      if (built) {
        expect(r.statusCode).toBe(200);
        expect(r.headers['content-type']).toMatch(/javascript/u);
        expect(r.body).toContain('CC_BUILD_ID');
      }
    }
  });

  it('API answers stay no-store (the worker never caches them either)', async () => {
    env = await makeEnv();
    const r = await env.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('the Super Speakers host never serves the app worker (D-157)', () => {
    expect(speakersHostAllows(APP_WORKER_PATH)).toBe(false);
  });
});
