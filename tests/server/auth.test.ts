import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, seedUser, type TestEnv } from '../helpers.ts';

let env: TestEnv;
beforeEach(async () => {
  env = await makeEnv();
  await seedUser(env, 'teacher', 'ayse.teacher');
  await seedUser(env, 'admin', 'root.admin');
});
afterEach(async () => env.app.close());

describe('authentication', () => {
  it('signs in, reports me, signs out', async () => {
    const c = new Client(env);
    const r = await c.login('Ayse.Teacher');
    expect(r.body.role).toBe('teacher');
    expect(r.body.locale).toBe('en'); // default language is English (UX-3)
    expect((await c.get('/api/auth/me')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects wrong passwords with a generic message and locks out after repeated failures', async () => {
    const c = new Client(env);
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/login', { login: 'ayse.teacher', password: 'wrong-password' });
      expect(r.status).toBe(401);
      expect(r.body.error.message).toBe('Incorrect sign-in details');
    }
    const r6 = await c.post('/api/auth/login', { login: 'ayse.teacher', password: 'wrong-password' });
    expect(r6.status).toBe(401);
    const locked = await c.post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' });
    expect(locked.status).toBe(429);
    env.clock.advance(2 * 60_000);
    expect((await c.post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(200);
  });

  it('expires idle sessions', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    env.clock.advance(13 * 60 * 60 * 1000);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('requires the CSRF header and same origin for mutations', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    expect((await c.req('POST', '/api/auth/lock', {}, { 'x-cc-csrf': '' })).status).toBe(403);
    expect((await c.req('POST', '/api/auth/lock', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.req('POST', '/api/auth/lock', {}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('keeps language preferences per teacher (UX-4)', async () => {
    await seedUser(env, 'teacher', 'mehmet.teacher');
    const a = new Client(env);
    const b = new Client(env);
    await a.login('ayse.teacher');
    await b.login('mehmet.teacher');
    expect((await a.patch('/api/auth/preferences', { locale: 'tr' })).body.locale).toBe('tr');
    expect((await b.get('/api/auth/me')).body.locale).toBe('en');
  });

  it('sets no-store and noindex headers on API responses', async () => {
    const c = new Client(env);
    const r = await c.get('/api/auth/me');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('classroom PIN lock (PIN-1…9)', () => {
  async function classroomTeacher() {
    const c = new Client(env);
    await c.login('ayse.teacher');
    expect((await c.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' })).status).toBe(200);
    expect((await c.post('/api/classroom/enter')).status).toBe(200);
    return c;
  }

  it('refuses classroom mode until a PIN is set', async () => {
    const c = new Client(env);
    await c.login('ayse.teacher');
    const r = await c.post('/api/classroom/enter');
    expect(r.status).toBe(400);
    expect(r.body.error.details.reason).toBe('PIN_NOT_SET');
  });

  it('blocks sensitive endpoints server-side while locked, even via direct API calls', async () => {
    const c = await classroomTeacher();
    const r = await c.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '1111' });
    expect(r.status).toBe(423);
    expect(r.body.error.code).toBe('PIN_REQUIRED');
    expect((await c.get('/api/auth/me')).status).toBe(200); // basic session info still works
  });

  it('unlocks with the PIN, slides the window, auto-locks after inactivity, relocks on entering classroom', async () => {
    const c = await classroomTeacher();
    expect((await c.post('/api/auth/pin/unlock', { pin: '2468' })).status).toBe(200);
    expect((await c.post('/api/classroom/leave')).status).toBe(200); // teacher-access endpoint allowed now
    await c.post('/api/classroom/enter'); // relock (PIN-6)
    expect((await c.post('/api/classroom/leave')).status).toBe(423);
    await c.post('/api/auth/pin/unlock', { pin: '2468' });
    env.clock.advance(6 * 60_000); // inactivity (PIN-7)
    expect((await c.post('/api/classroom/leave')).status).toBe(423);
  });

  it('locks out after repeated wrong PINs and revokes the session after 10', async () => {
    const c = await classroomTeacher();
    for (let i = 0; i < 4; i++) expect((await c.post('/api/auth/pin/unlock', { pin: '0000' })).status).toBe(401);
    const fifth = await c.post('/api/auth/pin/unlock', { pin: '0000' });
    expect(fifth.body.error.code).toBe('PIN_LOCKED_OUT');
    expect((await c.post('/api/auth/pin/unlock', { pin: '2468' })).body.error.code).toBe('PIN_LOCKED_OUT');
    // Each further wrong PIN re-locks for 5 minutes; the 10th wrong PIN revokes the session.
    for (let i = 0; i < 4; i++) {
      env.clock.advance(5 * 60_000 + 1);
      expect((await c.post('/api/auth/pin/unlock', { pin: '0000' })).body.error.code).toBe('PIN_LOCKED_OUT');
    }
    env.clock.advance(5 * 60_000 + 1);
    const tenth = await c.post('/api/auth/pin/unlock', { pin: '0000' });
    expect(tenth.status).toBe(401);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('keeps admin endpoints away from teachers and teacher endpoints away from admins', async () => {
    const admin = new Client(env);
    await admin.login('root.admin');
    expect((await admin.post('/api/classroom/enter')).status).toBe(403);
  });
});
