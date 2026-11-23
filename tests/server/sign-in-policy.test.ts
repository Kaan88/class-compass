/**
 * S30 (D-207): the school setting "Teachers sign in with email links only" (ACC-2, ACC-12).
 * While it is on no teacher account has or can get a password; administrators keep theirs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../src/server/db/schema.ts';
import { hashPassword } from '../../src/server/lib/crypto.ts';
import { Client, FakeMailer, makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

const SMTP = { SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' };
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/u.exec(text)![1]!;
const codeFrom = (text: string) => /\n(\d{6})\n/u.exec(text)![1]!;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const audits = (action: string) => count('select count(*) n from audit_events where action = ?', action);
const reason = (r: { body: any }) => r.body?.error?.details?.reason;
const POLICY = '/api/admin/sign-in-policy';

async function school(smtp = true) {
  const mailer = new FakeMailer();
  env = await makeEnv(smtp ? SMTP : {}, { mailer });
  return { mailer, s: await buildSchool(env) };
}

/** Both fixture teachers get an address, as the switch requires. */
async function withEmails(s: School) {
  await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { email: 'mehmet@school.example' }));
}

async function switchedOn() {
  const made = await school();
  await withEmails(made.s);
  await ok(made.s.admin.put(POLICY, { teacherEmailLinkOnly: true }));
  made.mailer.sent.length = 0;
  return made;
}

describe('teachers sign in with email links only (S30, D-207)', () => {
  it('is off by default, admin-only, and cannot be switched on without email or while a teacher has no address', async () => {
    const { s } = await school(false);
    expect(await ok(s.admin.get(POLICY))).toEqual({
      teacherEmailLinkOnly: false,
      emailReady: false,
      teachersWithPassword: 2,
      teachersWithoutEmail: [expect.objectContaining({ id: s.ayse.id }), expect.objectContaining({ id: s.mehmet.id })],
    });
    expect((await s.teacherA.get(POLICY)).status).toBe(403);
    expect((await s.teacherA.put(POLICY, { teacherEmailLinkOnly: true })).status).toBe(403);
    expect((await new Client(env).get(POLICY)).status).toBe(401);
    expect(reason(await s.admin.put(POLICY, { teacherEmailLinkOnly: true }))).toBe('SMTP_NOT_CONFIGURED');
    await env.app.close();

    const again = await school();
    expect(reason(await again.s.admin.put(POLICY, { teacherEmailLinkOnly: true }))).toBe('TEACHERS_WITHOUT_EMAIL');
    // A deactivated teacher without an address does not hold it up.
    await ok(again.s.admin.patch(`/api/admin/users/${again.s.ayse.id}`, { email: 'ayse@school.example' }));
    await ok(again.s.admin.post(`/api/admin/users/${again.s.mehmet.id}/deactivate`));
    expect((await ok(again.s.admin.put(POLICY, { teacherEmailLinkOnly: true }))).teacherEmailLinkOnly).toBe(true);
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).teacherEmailLinkOnly).toBe(true);
    expect(audits('school.sign_in_policy')).toBe(1);
  });

  it('switching it on removes every teacher password in one step; open sessions stay, administrators keep their password', async () => {
    const { s, mailer } = await school();
    await withEmails(s);
    // A reset link asked for before the switch must not set a password afterwards.
    await ok(new Client(env).post('/api/auth/password-reset/request', { email: 'ayse@school.example' }));
    const oldReset = tokenFrom(mailer.sent.at(-1)!.text);

    const after = await ok(s.admin.put(POLICY, { teacherEmailLinkOnly: true }));
    expect(after).toEqual({ teacherEmailLinkOnly: true, emailReady: true, teachersWithPassword: 0, teachersWithoutEmail: [] });
    expect(audits('auth.method_change')).toBe(2);
    expect(audits('school.sign_in_policy')).toBe(1);
    const rows = env.db.select().from(users).all();
    expect(rows.filter((u) => u.role === 'teacher').every((u) => u.passwordHash === '' && u.signInMethod === 'email_link' && !u.mustChangePassword)).toBe(true);
    expect(rows.find((u) => u.role === 'admin')!.passwordHash).not.toBe('');

    // The lesson that is running is not interrupted: the teacher's session is still good.
    expect((await ok(s.teacherA.get('/api/auth/me'))).signInMethod).toBe('email_link');
    expect((await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(401);
    expect(reason(await new Client(env).post('/api/auth/password-reset/complete', { token: oldReset, newPassword: 'a-brand-new-secret' }))).toBe('RESET_TOKEN_INVALID');
    await new Client(env).login('root.admin'); // administrators still use their password

    // The teacher signs in with the emailed code from now on.
    const c = new Client(env);
    const asked = await ok(c.post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
    const me = await ok(c.post('/api/auth/email-link/code', { requestId: asked.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect(me).toMatchObject({ role: 'teacher', signInMethod: 'email_link' });

    // Switching it on twice changes nothing more.
    await ok(s.admin.put(POLICY, { teacherEmailLinkOnly: true }));
    expect(audits('school.sign_in_policy')).toBe(1);
  });

  it('while it is on, a password is never accepted for a teacher, even if one is in the database', async () => {
    const { s } = await switchedOn();
    env.db.update(users).set({ passwordHash: await hashPassword('left-over-password'), signInMethod: 'password' }).where(eq(users.id, s.ayse.id)).run();
    const r = await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'left-over-password' });
    expect(r.status).toBe(401);
    expect(reason(r)).toBeUndefined(); // the same answer as a wrong password
  });

  it('while it is on, no route gives a teacher a password: create, invite, profile, admin reset, email reset', async () => {
    const { s, mailer } = await switchedOn();
    const base = { displayName: 'Zehra Öğretmen', role: 'teacher', login: 'zehra.teacher' };
    expect(reason(await s.admin.post('/api/admin/users', { ...base, email: 'zehra@school.example', setup: 'temporary_password' }))).toBe('EMAIL_LINK_REQUIRED');
    expect(reason(await s.admin.post('/api/admin/users', base))).toBe('EMAIL_REQUIRED');
    const made = await ok(s.admin.post('/api/admin/users', { ...base, email: 'zehra@school.example' }));
    const token = tokenFrom(made.invite.link);

    // An open invite cannot be turned into a password through the reset email either.
    const sentBefore = mailer.sent.length;
    await ok(new Client(env).post('/api/auth/password-reset/request', { email: 'zehra@school.example' }));
    expect(mailer.sent).toHaveLength(sentBefore);

    const c = new Client(env);
    expect(await ok(c.post('/api/auth/invite/inspect', { token }))).toMatchObject({ passwordAllowed: false, emailLinkAllowed: true, emailLinkAvailable: true });
    expect(reason(await c.post('/api/auth/invite/accept', { token, method: 'password', password: 'zehra-new-password' }))).toBe('EMAIL_LINK_REQUIRED');
    const done = await ok(c.post('/api/auth/invite/accept', { token, method: 'email_link' }));
    expect(done.me).toMatchObject({ signInMethod: 'email_link', reauthFresh: true });
    // Signed in a moment ago, so the profile's "use a password" would be allowed without the policy.
    expect(reason(await c.post('/api/auth/sign-in-method/password', { newPassword: 'zehra-new-password' }))).toBe('EMAIL_LINK_REQUIRED');

    expect(reason(await s.admin.post(`/api/admin/users/${made.user.id}/reset-password`))).toBe('EMAIL_LINK_REQUIRED');
    expect(reason(await s.admin.patch(`/api/admin/users/${made.user.id}`, { email: null }))).toBe('EMAIL_REQUIRED');
    await ok(s.admin.patch(`/api/admin/users/${made.user.id}`, { email: 'zehra.new@school.example' }));

    // Administrators are not affected.
    const boss = await ok(s.admin.post('/api/admin/users', { login: 'second.admin', displayName: 'İkinci Yönetici', role: 'admin', setup: 'temporary_password' }));
    expect(boss.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/u);
    const bossInvite = await ok(s.admin.post('/api/admin/users', { login: 'third.admin', displayName: 'Üçüncü Yönetici', role: 'admin' }));
    expect(await ok(new Client(env).post('/api/auth/invite/inspect', { token: tokenFrom(bossInvite.invite.link) }))).toMatchObject({ passwordAllowed: true, emailLinkAllowed: false });
  });

  it('switching it off gives no password back, but teachers and administrators can set one again', async () => {
    const { s, mailer } = await switchedOn();
    const off = await ok(s.admin.put(POLICY, { teacherEmailLinkOnly: false }));
    expect(off).toMatchObject({ teacherEmailLinkOnly: false, teachersWithPassword: 0 });
    expect(audits('school.sign_in_policy')).toBe(2);
    expect((await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(401);

    // A teacher with a fresh email sign-in chooses a password in the profile.
    const c = new Client(env);
    await ok(c.post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
    await ok(c.post('/api/auth/email-link/complete', { token: tokenFrom(mailer.sent.at(-1)!.text) }));
    expect((await ok(c.post('/api/auth/sign-in-method/password', { newPassword: 'ayse-own-password' }))).signInMethod).toBe('password');
    await new Client(env).login('ayse.teacher', 'ayse-own-password');

    // And the administrator can give a temporary password again.
    const reset = await ok(s.admin.post(`/api/admin/users/${s.mehmet.id}/reset-password`));
    expect((await new Client(env).login('mehmet.teacher', reset.temporaryPassword)).body.mustChangePassword).toBe(true);
  });
});
