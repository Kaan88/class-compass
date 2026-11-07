/** Demo seed (OPS-5, ENG-4): fictional school, random passwords, refuses on real data/production. */
import { afterEach, describe, expect, it } from 'vitest';
import { schoolYears, students } from '../../src/server/db/schema.ts';
import { SeedRefused, seedDemo } from '../../src/server/seed/demo.ts';
import { Client, makeEnv, seedUser, type TestEnv } from '../helpers.ts';
import { ok } from '../school-fixture.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

describe('seed:demo', () => {
  it('creates the demo school with realistic Turkish/English names and working random accounts', async () => {
    env = await makeEnv();
    const r = await seedDemo(env.deps);
    expect(r.schoolYear).toBe('2026–2027'); // from the clock (Nov 2026)
    expect(r.classes).toEqual([
      { name: '3-A', students: 19 },
      { name: '3-B', students: 20 },
      { name: '4-C', students: 34 },
      { name: '2-D', students: 3 },
    ]);
    const passwords = r.accounts.map((a) => a.password);
    expect(new Set(passwords).size).toBe(3);
    for (const p of passwords) expect(p).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const all = env.db.select().from(students).all();
    expect(all).toHaveLength(76);
    const names = all.map((s) => s.fullName).join(' ');
    for (const ch of ['ç', 'ğ', 'ı', 'İ', 'ö', 'ş', 'ü']) expect(names).toContain(ch);
    expect(all.some((s) => s.fullName.split(' ').length >= 3)).toBe(true); // multi-part names
    expect(all.some((s) => s.studentNumber === null)).toBe(true);
    expect(env.db.select().from(schoolYears).all()[0]).toMatchObject({ startsOn: '2026-09-01', endsOn: '2027-06-30' });

    const english = new Client(env);
    await english.login('english', r.accounts.find((a) => a.login === 'english')!.password);
    const ctx = await ok(english.get('/api/teacher/contexts'));
    expect(ctx.contexts.map((c: any) => c.className).sort()).toEqual(['2-D', '3-A', '3-B', '4-C']);
    const c3a = await ok(new Client(env).login('classroom3a', r.accounts.find((a) => a.login === 'classroom3a')!.password));
    expect(c3a.role).toBe('teacher');
    const admin = new Client(env);
    await admin.login('admin', r.accounts.find((a) => a.login === 'admin')!.password);
    expect((await ok(admin.get('/api/admin/settings'))).schoolName).toBe('Demo Primary School');
  });

  it('refuses in production, on existing data, and with --force-demo when school data exists', async () => {
    env = await makeEnv({ NODE_ENV: 'production', isProd: true });
    await expect(seedDemo(env.deps)).rejects.toBeInstanceOf(SeedRefused);
    await env.app.close();

    env = await makeEnv();
    await seedUser(env, 'admin', 'owner.admin');
    await expect(seedDemo(env.deps)).rejects.toThrow(/--force-demo/);
    await seedDemo(env.deps, { force: true }); // only accounts existed: allowed with the flag
    await expect(seedDemo(env.deps, { force: true })).rejects.toThrow(/school data/);
  });
});
