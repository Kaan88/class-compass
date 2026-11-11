/**
 * S22d (D-178): Compact / Normal / Large in the teacher and admin areas is a per-account preference
 * (UX-4, UX-6, THM-6), kept as the user setting `area.density`, Normal by default, sent with `me` and
 * changed with the language and text size preferences.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userSettings } from '../../src/server/db/schema.ts';
import { getUserSetting, USER_SETTINGS } from '../../src/server/lib/userSettings.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

describe('teacher and admin area density (S22d, D-178)', () => {
  let env: TestEnv;
  let s: School;
  beforeEach(async () => {
    env = await makeEnv();
    s = await buildSchool(env);
  });
  afterEach(async () => {
    await env.app.close();
  });

  it('is Normal by default and follows the account, not other teachers (UX-4)', async () => {
    expect(USER_SETTINGS['area.density'].default).toBe('normal');
    expect((await ok(s.teacherA.get('/api/auth/me'))).density).toBe('normal');
    const after = await ok(s.teacherA.patch('/api/auth/preferences', { density: 'compact' }));
    expect(after.density).toBe('compact');
    // Only the density changed: the text size and language stay as they were.
    expect(after.textScale).toBe(100);
    expect((await ok(s.teacherA.get('/api/auth/me'))).density).toBe('compact');
    expect((await ok(s.teacherB.get('/api/auth/me'))).density).toBe('normal');
    expect(getUserSetting(env.db, s.ayse.id, 'area.density')).toBe('compact');
    // A text size change keeps the density.
    expect((await ok(s.teacherA.patch('/api/auth/preferences', { textScale: 130 }))).density).toBe('compact');
  });

  it('follows the account to a new sign-in on another device and works for administrators (UX-6)', async () => {
    await ok(s.teacherA.patch('/api/auth/preferences', { density: 'large' }));
    const other = new Client(env);
    expect((await other.login('ayse.teacher')).body.density).toBe('large');
    expect((await ok(s.admin.patch('/api/auth/preferences', { density: 'compact' }))).density).toBe('compact');
    expect((await ok(s.admin.get('/api/auth/me'))).density).toBe('compact');
  });

  it('refuses unknown values and reads a broken stored value as Normal (THM-6)', async () => {
    expect((await s.teacherA.patch('/api/auth/preferences', { density: 'tiny' })).status).toBe(400);
    expect((await s.teacherA.patch('/api/auth/preferences', { density: 2 })).status).toBe(400);
    expect((await ok(s.teacherA.get('/api/auth/me'))).density).toBe('normal');
    env.db.insert(userSettings).values({ userId: s.ayse.id, key: 'area.density', valueJson: 'huge', updatedAt: 0 }).run();
    expect((await ok(s.teacherA.get('/api/auth/me'))).density).toBe('normal');
  });

  it('needs a signed-in account', async () => {
    const anon = new Client(env);
    expect((await anon.patch('/api/auth/preferences', { density: 'compact' })).status).toBe(401);
  });
});
