/**
 * S16c (D-165): classroom screen size recorded for administrators. A classroom endpoint (works while
 * the teacher area is locked), an admin-only read, tight validation, last value + ring of 5 sizes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userSettings } from '../../src/server/db/schema.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

const sample = (over: Record<string, unknown> = {}) => ({
  innerWidth: 1920,
  innerHeight: 1080,
  screenWidth: 1920,
  screenHeight: 1080,
  pixelRatio: 1,
  density: 'normal',
  theme: 'explorer',
  layout: 'default',
  browser: 'Chrome 142',
  os: 'Windows',
  touch: true,
  reducedMotion: false,
  textScale: 100,
  fullscreen: false,
  ...over,
});

describe('displayInfo (S16c, D-165)', () => {
  let env: TestEnv;
  let s: School;
  beforeEach(async () => {
    env = await makeEnv();
    s = await buildSchool(env);
  });
  afterEach(async () => {
    await env.app.close();
  });

  it('records the sample from the classroom while the teacher area is locked', async () => {
    await ok(s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' }));
    await ok(s.teacherA.post('/api/classroom/enter'));
    // A teacher endpoint is locked now; the display report still works.
    expect((await s.teacherA.get('/api/admin/display-info')).status).not.toBe(200);
    await ok(s.teacherA.post('/api/classroom/display-info', sample()));
    const list = await ok(s.admin.get('/api/admin/display-info'));
    expect(list.teachers).toHaveLength(1);
    expect(list.teachers[0]).toMatchObject({ userId: s.ayse.id, displayName: 'Test ayse.teacher', last: { innerWidth: 1920, browser: 'Chrome 142', touch: true, seenAt: env.clock.now() } });
  });

  it('is admin-only to read and classroom-only to write', async () => {
    expect((await s.teacherA.get('/api/admin/display-info')).status).toBe(403);
    expect((await s.admin.post('/api/classroom/display-info', sample())).status).toBe(403);
  });

  it.each([
    ['too small', { innerWidth: 10 }],
    ['too big', { screenHeight: 99999 }],
    ['not an integer', { innerWidth: 1000.5 }],
    ['pixel ratio', { pixelRatio: 50 }],
    ['text scale', { textScale: 1000 }],
    ['a full user agent', { browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0' }],
    ['a long browser', { browser: 'A'.repeat(40) }],
    ['an unknown OS', { os: 'Plan 9' }],
    ['an odd theme', { theme: '<script>' }],
    ['an unknown density', { density: 'huge' }],
    ['an extra field', { userAgent: 'x' }],
    ['a missing full screen flag (S18)', { fullscreen: undefined }],
    ['a full screen flag that is not a boolean (S18)', { fullscreen: 'yes' }],
  ])('refuses %s', async (_name, over) => {
    expect((await s.teacherA.post('/api/classroom/display-info', sample(over))).status).toBe(400);
  });

  it('overwrites the last sample and keeps the last 5 distinct sizes, newest first', async () => {
    const widths = [800, 1024, 1280, 1366, 1440, 1600, 1024];
    for (const w of widths) {
      env.clock.advance(60_000);
      await ok(s.teacherA.post('/api/classroom/display-info', sample({ innerWidth: w, browser: `Firefox ${w % 200}` })));
    }
    const { teachers } = await ok(s.admin.get('/api/admin/display-info'));
    expect(teachers).toHaveLength(1);
    expect(teachers[0].last.innerWidth).toBe(1024);
    expect(teachers[0].last.seenAt).toBe(env.clock.now());
    expect(teachers[0].recent.map((r: { innerWidth: number }) => r.innerWidth)).toEqual([1024, 1600, 1440, 1366, 1280]);
  });

  it('records whether the board was in full screen (S18, D-167)', async () => {
    await ok(s.teacherA.post('/api/classroom/display-info', sample({ fullscreen: true })));
    const { teachers } = await ok(s.admin.get('/api/admin/display-info'));
    expect(teachers[0].last.fullscreen).toBe(true);
  });

  it('keeps a sample stored before S18 and shows its full screen flag as not recorded (D-167)', async () => {
    await ok(s.teacherA.post('/api/classroom/display-info', sample()));
    // Rewrite the stored row as an S16c version stored it: no `fullscreen` field.
    const row = env.db.select().from(userSettings).all().find((r) => r.key === 'displayInfo.lastSeen')!;
    const old = structuredClone(row.valueJson) as { last: Record<string, unknown> };
    delete old.last.fullscreen;
    env.db.update(userSettings).set({ valueJson: old }).run();
    const { teachers } = await ok(s.admin.get('/api/admin/display-info'));
    expect(teachers).toHaveLength(1);
    expect(teachers[0].last.fullscreen).toBeNull();
    expect(teachers[0].last.innerWidth).toBe(1920);
  });

  it('is rate-limited per address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await s.teacherA.post('/api/classroom/display-info', sample())).status);
    expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
    expect(codes[12]).toBe(429);
  });

  it('lists every teacher with a record, by name', async () => {
    await ok(s.teacherB.post('/api/classroom/display-info', sample({ innerWidth: 1280 })));
    await ok(s.teacherA.post('/api/classroom/display-info', sample()));
    const { teachers } = await ok(s.admin.get('/api/admin/display-info'));
    expect(teachers.map((t: { userId: string }) => t.userId)).toEqual([s.ayse.id, s.mehmet.id]);
  });
});
