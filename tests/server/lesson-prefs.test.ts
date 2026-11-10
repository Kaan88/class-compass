/**
 * S18 (D-167): "Full screen during lessons" is a per-account preference (UX-4), on by default, read on
 * the classroom board (LES-1, LES-3) while the teacher area is locked and changed only behind the PIN.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

describe('lesson preferences (S18, D-167)', () => {
  let env: TestEnv;
  let s: School;
  beforeEach(async () => {
    env = await makeEnv();
    s = await buildSchool(env);
  });
  afterEach(async () => {
    await env.app.close();
  });

  it('is on by default and follows the account, not other teachers (UX-4)', async () => {
    expect(await ok(s.teacherA.get('/api/classroom/lesson-prefs'))).toEqual({ fullscreen: true });
    expect(await ok(s.teacherA.put('/api/teacher/lesson-prefs', { fullscreen: false }))).toEqual({ fullscreen: false });
    expect(await ok(s.teacherA.get('/api/classroom/lesson-prefs'))).toEqual({ fullscreen: false });
    expect(await ok(s.teacherB.get('/api/classroom/lesson-prefs'))).toEqual({ fullscreen: true });
    expect(await ok(s.teacherA.put('/api/teacher/lesson-prefs', { fullscreen: true }))).toEqual({ fullscreen: true });
  });

  it('is readable on the locked classroom board but changed only after the PIN (LES-1)', async () => {
    await ok(s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' }));
    await ok(s.teacherA.post('/api/classroom/enter'));
    expect(await ok(s.teacherA.get('/api/classroom/lesson-prefs'))).toEqual({ fullscreen: true });
    expect((await s.teacherA.put('/api/teacher/lesson-prefs', { fullscreen: false })).status).not.toBe(200);
    expect(await ok(s.teacherA.get('/api/classroom/lesson-prefs'))).toEqual({ fullscreen: true });
  });

  it('is for teachers only and refuses anything but a boolean', async () => {
    expect((await s.admin.get('/api/classroom/lesson-prefs')).status).toBe(403);
    expect((await s.admin.put('/api/teacher/lesson-prefs', { fullscreen: false })).status).toBe(403);
    expect((await s.teacherA.put('/api/teacher/lesson-prefs', { fullscreen: 'no' })).status).toBe(400);
    expect((await s.teacherA.put('/api/teacher/lesson-prefs', {})).status).toBe(400);
    expect((await s.teacherA.put('/api/teacher/lesson-prefs', { fullscreen: false, extra: 1 })).status).toBe(400);
  });
});
