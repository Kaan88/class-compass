/** Email password reset (D-015): only with SMTP, no account enumeration, 1-hour single-use tokens. */
import { afterEach, describe, expect, it } from 'vitest';
import { oneTimeTokens } from '../../src/server/db/schema.ts';
import { Client, FakeMailer, makeEnv, seedUser, type TestEnv } from '../helpers.ts';
import { createUser } from '../../src/server/modules/auth/service.ts';

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
    expect((await c.get('/api/auth/password-reset')).body).toEqual({ emailResetEnabled: false });
    expect((await c.post('/api/auth/password-reset/request', { email: 'ayse@school.example' })).body).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0);
  });

  it('answers identically for unknown emails and sends a link only to a matching account', async () => {
    const mailer = await smtpEnv();
    const c = new Client(env);
    expect((await c.get('/api/auth/password-reset')).body).toEqual({ emailResetEnabled: true });
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

  it('does not send to deactivated accounts', async () => {
    const mailer = await smtpEnv();
    env.db.$client.prepare('update users set disabled_at = 1').run();
    await new Client(env).post('/api/auth/password-reset/request', { email: 'ayse@school.example' });
    expect(mailer.sent).toHaveLength(0);
  });
});
