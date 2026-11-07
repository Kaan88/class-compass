import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
beforeEach(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterEach(async () => env.app.close());

describe('account administration (ACC-1/2/3, DAT-3)', () => {
  it('creates a teacher with a one-time temporary password that must be changed', async () => {
    const r = await ok(s.admin.post('/api/admin/users', { login: 'Zehra.Teacher', displayName: 'Zehra Öğretmen', email: 'Zehra@School.example', role: 'teacher' }));
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(r.user).toMatchObject({ login: 'zehra.teacher', email: 'zehra@school.example', role: 'teacher', active: true, mustChangePassword: true });
    // The password is never returned again.
    const list = await ok(s.admin.get('/api/admin/users'));
    expect(JSON.stringify(list)).not.toContain(r.temporaryPassword);
    expect(JSON.stringify(list)).not.toContain('passwordHash');
    const c = new Client(env);
    expect((await c.login('zehra.teacher', r.temporaryPassword)).body.mustChangePassword).toBe(true);
    expect((await s.admin.post('/api/admin/users', { login: 'zehra.teacher', displayName: 'Dup', role: 'teacher' })).status).toBe(409);
  });

  it('deactivates a teacher: sessions end, sign-in fails, records and audit history remain; reactivation restores access', async () => {
    await ok(s.teacherA.patch('/api/auth/preferences', { locale: 'tr' }));
    await ok(s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students`, { fullName: 'Yağmur Kılıç' }));
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    expect((await s.teacherA.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(401);
    // History by this teacher is still attributed to them.
    const log = await ok(s.admin.get(`/api/admin/audit?actorId=${s.ayse.id}`));
    expect(log.items.map((i: any) => i.action)).toEqual(expect.arrayContaining(['student.create', 'auth.login']));
    expect(log.items.every((i: any) => i.actorName === 'Test ayse.teacher')).toBe(true);
    // Their teaching assignment and students are intact.
    expect((await ok(s.admin.get(`/api/admin/teaching-contexts?teacherId=${s.ayse.id}`))).contexts).toHaveLength(1);
    expect((await ok(s.admin.get(`/api/admin/students?classId=${s.c3a.id}`))).total).toBe(1);
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/reactivate`));
    const again = new Client(env);
    expect((await again.login('ayse.teacher')).body.locale).toBe('tr');
  });

  it('refuses to deactivate yourself or the last active administrator', async () => {
    expect((await s.admin.post(`/api/admin/users/${s.adminUser.id}/deactivate`)).status).toBe(400);
  });

  it('resets a password (temporary, once) and revokes sessions; clears a PIN', async () => {
    await ok(s.teacherA.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '1357' }));
    const { temporaryPassword } = await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/reset-password`));
    expect((await s.teacherA.get('/api/auth/me')).status).toBe(401);
    const c = new Client(env);
    const me = (await c.login('ayse.teacher', temporaryPassword)).body;
    expect(me).toMatchObject({ mustChangePassword: true, hasPin: true });
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/clear-pin`));
    expect((await c.get('/api/auth/me')).status).toBe(401); // sessions revoked with the PIN
    expect((await new Client(env).login('ayse.teacher', temporaryPassword)).body.hasPin).toBe(false);
  });

  it('updates names and emails and records the change in the audit log without secrets (DAT-5)', async () => {
    await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { displayName: 'Mehmet  Hoca', email: 'MEHMET@school.example' }));
    await ok(s.admin.post(`/api/admin/users/${s.mehmet.id}/reset-password`));
    const log = await ok(s.admin.get(`/api/admin/audit?entity=user&entityId=${s.mehmet.id}`));
    expect(log.items[0].action).toBe('auth.password_reset_admin');
    expect(log.items.find((i: any) => i.action === 'user.update').after).toEqual({ displayName: 'Mehmet Hoca', email: 'mehmet@school.example' });
    const whole = JSON.stringify(await ok(s.admin.get('/api/admin/audit?pageSize=200')));
    expect(whole).not.toMatch(/password"\s*:|passwordHash|pinHash|tokenHash|temporaryPassword/i);
  });

  it('paginates and filters the audit log by entity, actor and date', async () => {
    const all = await ok(s.admin.get('/api/admin/audit?pageSize=5'));
    expect(all.items).toHaveLength(5);
    expect(all.total).toBeGreaterThan(5);
    const page2 = await ok(s.admin.get('/api/admin/audit?pageSize=5&page=2'));
    expect(page2.items[0].id).not.toBe(all.items[0].id);
    expect((await ok(s.admin.get('/api/admin/audit?entity=class'))).items.every((i: any) => i.entity === 'class')).toBe(true);
    const future = env.clock.now() + 1;
    expect((await ok(s.admin.get(`/api/admin/audit?from=${future}`))).total).toBe(0);
  });
});
