/** Email password reset (D-015): only with SMTP, no account enumeration, 1-hour single-use tokens. */
import { afterEach, describe, expect, it } from 'vitest';
import { oneTimeTokens } from '../../src/server/db/schema.ts';
import { Client, FakeMailer, makeEnv, seedUser, type TestEnv } from '../helpers.ts';
import { createUser } from '../../src/server/modules/auth/service.ts';
import { smtpTransportOptions } from '../../src/server/lib/mailer.ts';
import { ok } from '../school-fixture.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

async function smtpEnv() {
  const mailer = new FakeMailer();
  env = await makeEnv({ SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' }, { mailer });
  await createUser(env.db, { login: 'ayse.teacher', displayName: 'Ayşe Öğretmen', role: 'teacher', password: 'correct-horse-battery', email: 'ayse@school.example' }, { type: 'system', id: null }, env.clock.now());
  return mailer;
}

const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)![1]!;

describe('email password reset (D-015)', () => {
  it('is disabled without SMTP: request still answers ok but nothing is sent', async () => {
    const mailer = new FakeMailer();
    env = await makeEnv({}, { mailer });
    await seedUser(env, 'teacher', 'ayse.teacher');
    const c = new Client(env);
    expect((await c.get('/api/auth/password-reset')).body).toEqual({ emailResetEnabled: false, emailLinkEnabled: false, defaultLocale: 'en' });
    expect((await c.post('/api/auth/password-reset/request', { email: 'ayse@school.example' })).body).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0);
  });

  it('answers identically for unknown emails and sends a link only to a matching account', async () => {
    const mailer = await smtpEnv();
    const c = new Client(env);
    expect((await c.get('/api/auth/password-reset')).body).toEqual({ emailResetEnabled: true, emailLinkEnabled: true, defaultLocale: 'en' });
    const unknown = await c.post('/api/auth/password-reset/request', { email: 'nobody@school.example' });
    const known = await c.post('/api/auth/password-reset/request', { email: 'AYSE@school.example ' });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('ayse@school.example');
    expect(mailer.sent[0]!.text).toContain('http://localhost:5173/reset-password#token=');
    // Stored hashed, never in clear.
    const token = tokenFrom(mailer.sent[0]!.text);
    expect(env.db.select().from(oneTimeTokens).all().some((r) => r.tokenHash === token)).toBe(false);
  });

  it('resets the password once, revokes sessions, and rejects reuse', async () => {
    const mailer = await smtpEnv();
    const signedIn = new Client(env);
    await signedIn.login('ayse.teacher');
    const c = new Client(env);
    await c.post('/api/auth/password-reset/request', { email: 'ayse@school.example' });
    const token = tokenFrom(mailer.sent[0]!.text);
    expect((await c.post('/api/auth/password-reset/complete', { token, newPassword: 'a-brand-new-secret' })).status).toBe(200);
    expect((await signedIn.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(401);
    await new Client(env).login('ayse.teacher', 'a-brand-new-secret');
    const reuse = await c.post('/api/auth/password-reset/complete', { token, newPassword: 'another-new-secret' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.details.reason).toBe('RESET_TOKEN_INVALID');
  });

  it('expires links after one hour and only the newest link works', async () => {
    const mailer = await smtpEnv();
    const c = new Client(env);
    await c.post('/api/auth/password-reset/request', { email: 'ayse@school.example' });
    await c.post('/api/auth/password-reset/request', { email: 'ayse@school.example' });
    const [older, newer] = mailer.sent.map((m) => tokenFrom(m.text));
    expect((await c.post('/api/auth/password-reset/complete', { token: older, newPassword: 'a-brand-new-secret' })).status).toBe(400);
    env.clock.advance(60 * 60 * 1000 + 1);
    expect((await c.post('/api/auth/password-reset/complete', { token: newer, newPassword: 'a-brand-new-secret' })).status).toBe(400);
  });

  it('limits reset emails per account and per client', async () => {
    const mailer = await smtpEnv();
    const c = new Client(env);
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await c.post('/api/auth/password-reset/request', { email: 'ayse@school.example' })).status);
    expect(mailer.sent).toHaveLength(3); // per-account cap per hour
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429); // per-IP rate limit
  });

  it('voids unused reset links when the email, password or account state changes (D-015)', async () => {
    const mailer = await smtpEnv();
    await seedUser(env, 'admin', 'root.admin');
    const admin = new Client(env);
    await admin.login('root.admin');
    const ayse = (await admin.get('/api/admin/users')).body.users.find((u: any) => u.login === 'ayse.teacher');
    const c = new Client(env);
    const freshToken = async () => {
      env.clock.advance(60 * 60 * 1000 + 1); // stay under the per-account hourly cap
      await admin.login('root.admin');
      await c.post('/api/auth/password-reset/request', { email: (await admin.get('/api/admin/users')).body.users.find((u: any) => u.id === ayse.id).email });
      return tokenFrom(mailer.sent.at(-1)!.text);
    };
    const completeFails = async (token: string) => {
      const r = await c.post('/api/auth/password-reset/complete', { token, newPassword: 'attacker-chosen-pass' });
      expect(r.status).toBe(400);
      expect(r.body.error.details.reason).toBe('RESET_TOKEN_INVALID');
    };
    // 1. Admin moves the account to a new mailbox: the link sent to the old one dies.
    let token = await freshToken();
    expect((await admin.patch(`/api/admin/users/${ayse.id}`, { email: 'ayse.new@school.example' })).status).toBe(200);
    await completeFails(token);
    // 2. Admin password reset (e.g. suspected compromise).
    token = await freshToken();
    expect((await admin.post(`/api/admin/users/${ayse.id}/reset-password`)).status).toBe(200);
    await completeFails(token);
    // 3. Deactivation (and later reactivation) does not revive the link.
    token = await freshToken();
    await ok(admin.post(`/api/admin/users/${ayse.id}/deactivate`));
    await ok(admin.post(`/api/admin/users/${ayse.id}/reactivate`));
    await completeFails(token);
    // 4. The user changes their own password.
    const tmp = (await ok(admin.post(`/api/admin/users/${ayse.id}/reset-password`))).temporaryPassword;
    token = await freshToken();
    const self = new Client(env);
    await self.login('ayse.teacher', tmp);
    await ok(self.post('/api/auth/password', { currentPassword: tmp, newPassword: 'my-own-new-secret' }));
    await completeFails(token);
    await new Client(env).login('ayse.teacher', 'my-own-new-secret');
  });

  it('requires TLS for SMTP: implicit on 465, STARTTLS enforced otherwise', () => {
    const base = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u', SMTP_PASS: 'p' };
    const starttls = smtpTransportOptions({ ...env.config, ...base, SMTP_PORT: 587 });
    expect(starttls).toMatchObject({ secure: false, requireTLS: true, tls: { rejectUnauthorized: true } });
    expect(smtpTransportOptions({ ...env.config, ...base, SMTP_PORT: 465 })).toMatchObject({ secure: true, tls: { rejectUnauthorized: true } });
  });

  it('connects to SMTP_CONNECT_HOST but checks the certificate against SMTP_HOST (D-192)', async () => {
    await smtpEnv();
    const plain = smtpTransportOptions({ ...env.config, SMTP_HOST: 'mail.example.test', SMTP_CONNECT_HOST: '', SMTP_PORT: 465 });
    expect(plain.host).toBe('mail.example.test');
    expect(plain.tls).not.toHaveProperty('servername');
    const viaGateway = smtpTransportOptions({ ...env.config, SMTP_HOST: 'mail.example.test', SMTP_CONNECT_HOST: 'host.docker.internal', SMTP_PORT: 465 });
    expect(viaGateway).toMatchObject({ host: 'host.docker.internal', secure: true, tls: { rejectUnauthorized: true, servername: 'mail.example.test' } });
  });

  it('does not send to deactivated accounts', async () => {
    const mailer = await smtpEnv();
    env.db.$client.prepare('update users set disabled_at = 1').run();
    await new Client(env).post('/api/auth/password-reset/request', { email: 'ayse@school.example' });
    expect(mailer.sent).toHaveLength(0);
  });
});
