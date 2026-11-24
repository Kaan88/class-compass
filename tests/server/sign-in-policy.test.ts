/**
 * S30 (D-207): the school setting "Nobody signs in with a password" (ACC-2, ACC-3, ACC-12).
 * While it is on no account has or can get a password, administrators included; switching it on is
 * confirmed with a code emailed to the administrator.
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

/** Every fixture account gets an address, as the switch requires. */
async function withEmails(s: School) {
  await ok(s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: 'root@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { email: 'mehmet@school.example' }));
}

/** The administrator asks for the code, reads it from the email and switches passwords off. */
async function switchOff(s: School, mailer: FakeMailer) {
  await ok(s.admin.post(`${POLICY}/code`));
  const mail = mailer.sent.at(-1)!;
  expect(mail.to).toBe('root@school.example');
  return ok(s.admin.put(POLICY, { passwordsOff: true, code: codeFrom(mail.text) }));
}

async function switchedOff() {
  const made = await school();
  await withEmails(made.s);
  await switchOff(made.s, made.mailer);
  made.mailer.sent.length = 0;
  return made;
}

/** Sign in with the emailed code, as everyone does while passwords are off. */
async function emailSignIn(mailer: FakeMailer, address: string) {
  const c = new Client(env);
  const asked = await ok(c.post('/api/auth/email-link/request', { email: address }));
  const me = await ok(c.post('/api/auth/email-link/code', { requestId: asked.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
  return { c, me };
}

describe('nobody signs in with a password (S30, D-207)', () => {
  it('is off by default, admin-only, and cannot be switched on without email or while an account has no address', async () => {
    const { s } = await school(false);
    expect(await ok(s.admin.get(POLICY))).toEqual({
      passwordsOff: false,
      emailReady: false,
      accountsWithPassword: 3,
      accountsWithoutEmail: [expect.anything(), expect.anything(), expect.anything()],
      ownEmail: null,
    });
    for (const call of [() => s.teacherA.get(POLICY), () => s.teacherA.post(`${POLICY}/code`), () => s.teacherA.put(POLICY, { passwordsOff: true, code: '123456' })]) expect((await call()).status).toBe(403);
    expect((await new Client(env).get(POLICY)).status).toBe(401);
    expect(reason(await s.admin.post(`${POLICY}/code`))).toBe('SMTP_NOT_CONFIGURED');
    expect(reason(await s.admin.put(POLICY, { passwordsOff: true, code: '123456' }))).toBe('SMTP_NOT_CONFIGURED');
    await env.app.close();

    const again = await school();
    expect(reason(await again.s.admin.post(`${POLICY}/code`))).toBe('ACCOUNTS_WITHOUT_EMAIL');
    // The administrator's own account counts too: without an address they could not sign in afterwards.
    await ok(again.s.admin.patch(`/api/admin/users/${again.s.ayse.id}`, { email: 'ayse@school.example' }));
    await ok(again.s.admin.patch(`/api/admin/users/${again.s.mehmet.id}`, { email: 'mehmet@school.example' }));
    expect((await ok(again.s.admin.get(POLICY))).accountsWithoutEmail).toEqual([{ id: again.s.adminUser.id, displayName: again.s.adminUser.displayName }]);
    expect(reason(await again.s.admin.put(POLICY, { passwordsOff: true, code: '123456' }))).toBe('ACCOUNTS_WITHOUT_EMAIL');
    expect(again.mailer.sent).toHaveLength(0);
  });

  it('needs the code emailed to the administrator: no code and a wrong code change nothing', async () => {
    const { s, mailer } = await school();
    await withEmails(s);
    expect(reason(await s.admin.put(POLICY, { passwordsOff: true }))).toBe('SIGNIN_CODE_INVALID');
    await ok(s.admin.post(`${POLICY}/code`));
    const real = codeFrom(mailer.sent.at(-1)!.text);
    expect(mailer.sent.at(-1)!.subject).toContain('switch off passwords');
    const wrong = real === '000000' ? '000001' : '000000';
    const r = await s.admin.put(POLICY, { passwordsOff: true, code: wrong });
    expect(r.status).toBe(401);
    expect(r.body.error.details).toMatchObject({ reason: 'SIGNIN_CODE_INVALID', attemptsLeft: 4 });
    expect((await ok(s.admin.get(POLICY))).passwordsOff).toBe(false);
    await new Client(env).login('ayse.teacher'); // passwords still work
    // A code asked for in another session is not this session's code.
    const other = new Client(env);
    await other.login('root.admin');
    expect((await other.put(POLICY, { passwordsOff: true, code: real })).status).toBe(401);
    expect((await ok(s.admin.put(POLICY, { passwordsOff: true, code: real }))).passwordsOff).toBe(true);
    // Used once.
    await ok(s.admin.put(POLICY, { passwordsOff: false }));
    expect((await s.admin.put(POLICY, { passwordsOff: true, code: real })).status).toBe(401);
  });

  it('switching it on removes every password, the administrator’s too; open sessions stay; everyone signs in by email', async () => {
    const { s, mailer } = await school();
    await withEmails(s);
    // A reset link asked for before the switch must not set a password afterwards.
    await ok(new Client(env).post('/api/auth/password-reset/request', { email: 'ayse@school.example' }));
    const oldReset = tokenFrom(mailer.sent.at(-1)!.text);

    const after = await switchOff(s, mailer);
    expect(after).toEqual({ passwordsOff: true, emailReady: true, accountsWithPassword: 0, accountsWithoutEmail: [], ownEmail: 'root@school.example' });
    expect(audits('auth.method_change')).toBe(3);
    expect(audits('school.sign_in_policy')).toBe(1);
    expect(env.db.select().from(users).all().every((u) => u.passwordHash === '' && u.signInMethod === 'email_link' && !u.mustChangePassword)).toBe(true);
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).passwordsOff).toBe(true);

    // Nobody is signed out: the lesson that is running goes on, and the administrator can keep working.
    expect((await ok(s.teacherA.get('/api/auth/me'))).signInMethod).toBe('email_link');
    expect((await ok(s.admin.get('/api/auth/me'))).signInMethod).toBe('email_link');
    for (const login of ['ayse.teacher', 'root.admin']) expect((await new Client(env).post('/api/auth/login', { login, password: 'correct-horse-battery' })).status).toBe(401);
    expect(reason(await new Client(env).post('/api/auth/password-reset/complete', { token: oldReset, newPassword: 'a-brand-new-secret' }))).toBe('RESET_TOKEN_INVALID');

    // Teachers and administrators sign in with the emailed code from now on.
    expect((await emailSignIn(mailer, 'ayse@school.example')).me).toMatchObject({ role: 'teacher', signInMethod: 'email_link' });
    const boss = await emailSignIn(mailer, 'root@school.example');
    expect(boss.me).toMatchObject({ role: 'admin', signInMethod: 'email_link', reauthFresh: true });
    expect((await boss.c.get('/api/admin/users')).status).toBe(200);

    // Switching it on twice changes nothing more.
    await ok(s.admin.put(POLICY, { passwordsOff: true }));
    expect(audits('school.sign_in_policy')).toBe(1);
  });

  it('while it is on, a password is never accepted, even if one is in the database', async () => {
    const { s } = await switchedOff();
    for (const [id, login] of [
      [s.ayse.id, 'ayse.teacher'],
      [s.adminUser.id, 'root.admin'],
    ] as const) {
      env.db.update(users).set({ passwordHash: await hashPassword('left-over-password'), signInMethod: 'password' }).where(eq(users.id, id)).run();
      const r = await new Client(env).post('/api/auth/login', { login, password: 'left-over-password' });
      expect(r.status).toBe(401);
      expect(reason(r)).toBeUndefined(); // the same answer as a wrong password
    }
  });

  it('while it is on, no route gives anyone a password: create, invite, profile, admin reset, email reset', async () => {
    const { s, mailer } = await switchedOff();
    for (const role of ['teacher', 'admin'] as const) {
      const base = { displayName: 'Zehra Öğretmen', role, login: `zehra.${role}` };
      const address = `zehra.${role}@school.example`;
      expect(reason(await s.admin.post('/api/admin/users', { ...base, email: address, setup: 'temporary_password' }))).toBe('EMAIL_LINK_REQUIRED');
      expect((await s.admin.post('/api/admin/users', base)).status).toBe(400); // an address is always required (D-212)
      const made = await ok(s.admin.post('/api/admin/users', { ...base, email: address }));
      const token = tokenFrom(made.invite.link);

      // An open invite cannot be turned into a password through the reset email either.
      const sentBefore = mailer.sent.length;
      await ok(new Client(env).post('/api/auth/password-reset/request', { email: address }));
      expect(mailer.sent).toHaveLength(sentBefore);

      const c = new Client(env);
      expect(await ok(c.post('/api/auth/invite/inspect', { token }))).toMatchObject({ passwordAllowed: false, emailLinkAllowed: true, emailLinkAvailable: true });
      expect(reason(await c.post('/api/auth/invite/accept', { token, method: 'password', password: 'zehra-new-password' }))).toBe('EMAIL_LINK_REQUIRED');
      const done = await ok(c.post('/api/auth/invite/accept', { token, method: 'email_link' }));
      expect(done.me).toMatchObject({ role, signInMethod: 'email_link', reauthFresh: true });
      // Signed in a moment ago, so the profile's "use a password" would be allowed without the policy.
      expect(reason(await c.post('/api/auth/sign-in-method/password', { newPassword: 'zehra-new-password' }))).toBe('EMAIL_LINK_REQUIRED');

      expect(reason(await s.admin.post(`/api/admin/users/${made.user.id}/reset-password`))).toBe('EMAIL_LINK_REQUIRED');
      expect(reason(await s.admin.patch(`/api/admin/users/${made.user.id}`, { email: null }))).toBe('EMAIL_REQUIRED');
      await ok(s.admin.patch(`/api/admin/users/${made.user.id}`, { email: `new.${address}` }));
    }
  });

  it('switching it off gives no password back, nobody is locked out, and passwords can be set again', async () => {
    const { s, mailer } = await switchedOff();
    const off = await ok(s.admin.put(POLICY, { passwordsOff: false }));
    expect(off).toMatchObject({ passwordsOff: false, accountsWithPassword: 0 });
    expect(audits('school.sign_in_policy')).toBe(2);
    expect((await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(401);

    // An administrator who is still an email-link account keeps signing in by email, and may choose a password.
    const boss = await emailSignIn(mailer, 'root@school.example');
    expect((await ok(boss.c.post('/api/auth/sign-in-method/password', { newPassword: 'root-own-password' }))).signInMethod).toBe('password');
    await new Client(env).login('root.admin', 'root-own-password');

    // So may a teacher, after a fresh email sign-in.
    const c = new Client(env);
    await ok(c.post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
    await ok(c.post('/api/auth/email-link/complete', { token: tokenFrom(mailer.sent.at(-1)!.text) }));
    expect((await ok(c.post('/api/auth/sign-in-method/password', { newPassword: 'ayse-own-password' }))).signInMethod).toBe('password');
    await new Client(env).login('ayse.teacher', 'ayse-own-password');

    // And the administrator can give a temporary password again.
    const reset = await ok(boss.c.post(`/api/admin/users/${s.mehmet.id}/reset-password`));
    expect((await new Client(env).login('mehmet.teacher', reset.temporaryPassword)).body.mustChangePassword).toBe(true);
    // With passwords allowed, an administrator who has one cannot choose email links (D-108).
    expect(reason(await boss.c.post('/api/auth/sign-in-method/email-link/start', { currentPassword: 'root-own-password' }))).toBe('ADMIN_PASSWORD_REQUIRED');
  });
});
