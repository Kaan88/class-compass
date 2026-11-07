/**
 * Permission matrix over EVERY registered endpoint (ACC-1, ACC-4, PIN-1, PIN-8, ENG-3):
 * - unauthenticated → 401 on every non-public endpoint
 * - teacher → 403 on every admin endpoint
 * - admin → 403 on every teacher/classroom endpoint
 * - teacher in locked classroom mode → 423 on every teacher/admin/account endpoint
 * Access is checked before input validation, so dummy ids and empty bodies are enough.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Endpoint } from '../../src/shared/contracts/define.ts';
import { registeredEndpoints } from '../../src/server/lib/http.ts';
import { Client, makeEnv, seedUser, type TestEnv } from '../helpers.ts';

let env: TestEnv;
let endpoints: Endpoint[];
beforeAll(async () => {
  env = await makeEnv();
  await seedUser(env, 'teacher', 'ayse.teacher');
  await seedUser(env, 'admin', 'root.admin');
  const seen = new Set<string>();
  endpoints = registeredEndpoints.filter((e) => {
    const k = `${e.method} ${e.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
});
afterAll(async () => env.app.close());

const DUMMY = '0190f0f0-0000-7000-8000-000000000000';
const urlOf = (e: Endpoint) => e.path.replace(/:([A-Za-z0-9_]+)/g, (_m, k: string) => (k === 'module' ? 'routines' : DUMMY));
const hit = (c: Client, e: Endpoint) => c.req(e.method, urlOf(e), e.method === 'GET' ? undefined : {});

async function expectAll(c: Client, filter: (e: Endpoint) => boolean, status: number) {
  const targets = endpoints.filter(filter);
  expect(targets.length).toBeGreaterThan(0);
  const wrong: string[] = [];
  for (const e of targets) {
    const r = await hit(c, e);
    if (r.status !== status) wrong.push(`${e.method} ${e.path} → ${r.status}`);
  }
  expect(wrong).toEqual([]);
}

describe('permission matrix over all endpoints', () => {
  it('registers a meaningful set of endpoints, each with an access class', () => {
    expect(endpoints.length).toBeGreaterThan(50);
    for (const e of endpoints) expect(['public', 'classroom', 'teacher', 'admin', 'student', 'user', 'account']).toContain(e.access);
  });

  it('answers 401 to unauthenticated callers on every non-public endpoint', async () => {
    await expectAll(new Client(env), (e) => e.access !== 'public', 401);
  });

  it('answers 403 to teachers on every admin endpoint (ACC-1)', async () => {
    const t = new Client(env);
    await t.login('ayse.teacher');
    await expectAll(t, (e) => e.access === 'admin', 403);
  });

  it('answers 403 to administrators on every teacher and classroom endpoint', async () => {
    const a = new Client(env);
    await a.login('root.admin');
    await expectAll(a, (e) => e.access === 'teacher' || e.access === 'classroom', 403);
  });

  it('answers 423 on every teacher/admin/account endpoint while the classroom lock is engaged (PIN-8)', async () => {
    const t = new Client(env);
    await t.login('ayse.teacher');
    expect((await t.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await t.post('/api/classroom/enter')).status).toBe(200);
    await expectAll(t, (e) => e.access === 'teacher' || e.access === 'admin' || e.access === 'account', 423);
  });
});
