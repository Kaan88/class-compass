/**
 * The scorer app moving to the Super Speakers origin (S14f review, D-157; SSP-5/6, D-130): awards
 * queued offline on the main origin are never stranded by the split.
 * - while awards wait, the app sets the scorer queue cookie (path /p), so the main host keeps serving
 *   the app there and the queue is sent;
 * - once the queue is empty the cookie is cleared; a page that was opened with the cookie set asks the
 *   server (HEAD /p, redirects not followed) and reopens itself only when the server now redirects, so
 *   the 308 takes it (and the link's token, in the fragment) to the speakers origin;
 * - with SPEAKERS_ORIGIN unset the server never redirects, so the app stays where it is.
 * The probe is answered by the real server (app.inject). Fictional data only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createQueueMover, hasQueueCookie, queueCookieString, type MoveEnv } from '../../src/client/scorer/move.ts';
import { SCORER_QUEUE_COOKIE } from '../../src/shared/contracts/superSpeakers.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';

const MAIN_HOST = 'localhost:5173';
let server: TestEnv | null = null;
afterEach(async () => {
  await server?.app.close();
  server = null;
});

/** A browser page on the main host: a cookie jar for `/p` and a probe answered by the server. */
function page(e: TestEnv | null, initialCookie = '') {
  let cookie = initialCookie;
  const writes: string[] = [];
  const reopened: string[] = [];
  let probes = 0;
  const env: MoveEnv = {
    readCookie: () => cookie,
    writeCookie: (v) => {
      writes.push(v);
      const [pair] = v.split(';');
      cookie = /Max-Age=0/u.test(v) ? '' : pair!.trim();
    },
    secure: false,
    probeRedirect: async () => {
      probes += 1;
      if (!e) throw new Error('offline');
      const r = await e.app.inject({ method: 'HEAD', url: '/p', headers: { host: MAIN_HOST, ...(cookie ? { cookie } : {}) } });
      return r.statusCode >= 300 && r.statusCode < 400;
    },
    reopen: (url) => reopened.push(url),
    here: () => '/p/app',
  };
  return { env, writes, reopened, probes: () => probes, cookie: () => cookie };
}

describe('scorer queue cookie (D-157)', () => {
  it('is a plain path-scoped flag, Secure on https', () => {
    expect(queueCookieString(true, true)).toBe(`${SCORER_QUEUE_COOKIE}=1; Path=/p; Max-Age=5184000; SameSite=Strict; Secure`);
    expect(queueCookieString(false, false)).toBe(`${SCORER_QUEUE_COOKIE}=; Path=/p; Max-Age=0; SameSite=Strict`);
    expect(hasQueueCookie(`a=b; ${SCORER_QUEUE_COOKIE}=1`)).toBe(true);
    expect(hasQueueCookie(`${SCORER_QUEUE_COOKIE}=0; x=1`)).toBe(false);
    expect(hasQueueCookie(`x${SCORER_QUEUE_COOKIE}=1`)).toBe(false);
  });

  it('set while awards wait (written once), cleared when the queue is empty', async () => {
    const p = page(null);
    const mover = createQueueMover(p.env, false, null);
    mover.queued();
    mover.queued();
    expect(p.writes).toHaveLength(1);
    expect(p.cookie()).toBe(`${SCORER_QUEUE_COOKIE}=1`);
    await mover.drained();
    expect(p.cookie()).toBe('');
    // Opened without the cookie: the main host would have redirected already if split, so no probe.
    expect(p.probes()).toBe(0);
    expect(p.reopened).toEqual([]);
  });
});

describe('moving after the queue is sent (D-157)', () => {
  it('split: a page opened with queued awards moves once the queue is empty, keeping the link token', async () => {
    server = await makeEnv({ SPEAKERS_ORIGIN: 'http://speakers.localhost:5173' });
    // The main host serves the app while the cookie is set ...
    expect((await server.app.inject({ method: 'GET', url: '/p/app', headers: { host: MAIN_HOST, cookie: `${SCORER_QUEUE_COOKIE}=1` } })).statusCode).not.toBe(308);
    const p = page(server, `${SCORER_QUEUE_COOKIE}=1`);
    const mover = createQueueMover(p.env, true, 'tok-fictional');
    mover.queued(); // still waiting: nothing happens
    expect(p.probes()).toBe(0);
    // ... and once the queue is empty the cookie goes and the page reopens through the 308.
    await mover.drained();
    expect(p.cookie()).toBe('');
    expect(p.probes()).toBe(1);
    expect(p.reopened).toEqual(['/p/app#tok-fictional']);
    // Only one probe per page.
    await mover.drained();
    expect(p.probes()).toBe(1);
  });

  it('unset: the server never redirects, so the app stays (one probe at most)', async () => {
    server = await makeEnv();
    const p = page(server, `${SCORER_QUEUE_COOKIE}=1`);
    const mover = createQueueMover(p.env, true, null);
    await mover.drained();
    await mover.drained();
    expect(p.probes()).toBe(1);
    expect(p.reopened).toEqual([]);
  });

  it('no answer to the probe: the app stays and asks again next time', async () => {
    const p = page(null, `${SCORER_QUEUE_COOKIE}=1`);
    const mover = createQueueMover(p.env, true, null);
    await mover.drained();
    await mover.drained();
    expect(p.probes()).toBe(2);
    expect(p.reopened).toEqual([]);
  });
});
