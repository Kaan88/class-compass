/**
 * S34 (D-213): sign-in with the operator's own sign-in server, one OpenID Connect provider set in the
 * server's settings (ACC-2, ACC-3). It never makes an account; every role may use it. The provider is a
 * fake here: the one HTTPS helper is injected, so no test reaches the internet. Fictional people,
 * addresses and hosts only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../src/server/db/schema.ts';
import { loadConfig } from '../../src/server/config.ts';
import { forgetSsoDiscovery, SSO_COOKIE, SSO_ICON_MAX_BYTES } from '../../src/server/modules/auth/sso.ts';
import { Client, FakeMailer, makeEnv, TEST_ORIGIN, type TestEnv } from '../helpers.ts';
import { buildSchool, ok } from '../school-fixture.ts';

let env: TestEnv;
let dataDir: string;
beforeEach(() => {
  forgetSsoDiscovery();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sso-'));
});
afterEach(async () => {
  await env.app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ISSUER = 'https://mail.demo.example';
const SMTP = { SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' };
const SSO = { SSO_ISSUER: ISSUER, SSO_CLIENT_ID: 'fictional-class-compass', SSO_NAME: 'Demo Mail', SSO_TRUST_EMAIL: true };
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/u.exec(text)![1]!;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const audits = (action: string) => count('select count(*) n from audit_events where action = ?', action);
const reason = (r: { body: any }) => r.body?.error?.details?.reason;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.fictional-signature`;
const DISCOVERY = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/login`, token_endpoint: `${ISSUER}/auth/token` };

/** What the fake provider is asked and what it answers. */
interface Fake {
  discovery: Record<string, unknown>;
  claims: ((nonce: string) => Record<string, unknown>) | null;
  fail: boolean;
  calls: Array<{ url: string; form: Record<string, string> | null }>;
  nonce: string;
}

async function school(config: Record<string, unknown> = SSO) {
  const mailer = new FakeMailer();
  env = await makeEnv({ ...SMTP, DATA_DIR: dataDir, ...config }, { mailer });
  const s = await buildSchool(env);
  await ok(s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: 'root@mail.demo.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse@mail.demo.example' }));
  mailer.sent.length = 0;
  const fake: Fake = { discovery: DISCOVERY, claims: null, fail: false, calls: [], nonce: '' };
  env.deps.ssoHttp = async (url, form) => {
    fake.calls.push({ url, form: form ? Object.fromEntries(form) : null });
    if (!form) return fake.discovery;
    if (fake.fail) throw new Error('fictional outage');
    return { id_token: idToken(fake.claims!(fake.nonce)), access_token: 'never-used' };
  };
  return { mailer, s, fake };
}

const standard = (email: string, sub: unknown, extra: Record<string, unknown> = {}) => (nonce: string) => ({
  iss: ISSUER,
  aud: SSO.SSO_CLIENT_ID,
  exp: Math.floor(env.clock.now() / 1000) + 900,
  nonce,
  sub,
  email,
  ...extra,
});

/** Start on a browser, go "through the provider" and come back. */
async function signIn(fake: Fake, claims: NonNullable<Fake['claims']>, c = new Client(env)) {
  const started = await ok(c.post('/api/auth/sso/start'));
  const url = new URL(started.authorizeUrl);
  fake.nonce = url.searchParams.get('nonce')!;
  fake.claims = claims;
  const r = await c.post('/api/auth/sso/complete', { state: url.searchParams.get('state')!, code: 'fictional-code' });
  return { c, r, url };
}

describe('the operator’s own sign-in server (S34, D-213)', () => {
  it('is not offered until an issuer and a client id are set; the issuer must be https', async () => {
    await school({});
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).sso).toBeNull();
    expect(reason(await new Client(env).post('/api/auth/sso/start'))).toBe('SSO_NOT_AVAILABLE');
    expect(reason(await new Client(env).post('/api/auth/sso/complete', { state: 'x'.repeat(40), code: 'c' }))).toBe('SSO_NOT_AVAILABLE');
    expect((await new Client(env).get('/api/auth/sso/icon')).status).toBe(404);
    await env.app.close();
    await school({ SSO_ISSUER: ISSUER });
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).sso).toBeNull();
    // The settings refuse an address that is not https, and the flow refuses one that got in anyway.
    const base = { NODE_ENV: 'test', SECRET_PEPPER: 'test-pepper-0123456789abcdef', PUBLIC_ORIGIN: TEST_ORIGIN };
    expect(() => loadConfig({ ...base, SSO_ISSUER: 'http://mail.demo.example', SSO_CLIENT_ID: 'x' })).toThrow();
    expect(loadConfig({ ...base, SSO_ISSUER: ISSUER, SSO_CLIENT_ID: 'x' }).SSO_ISSUER).toBe(ISSUER);
    await env.app.close();
    const plain = await school({ ...SSO, SSO_ISSUER: 'http://mail.demo.example' });
    plain.fake.discovery = { issuer: 'http://mail.demo.example', authorization_endpoint: 'http://mail.demo.example/login', token_endpoint: 'http://mail.demo.example/auth/token' };
    expect(reason(await new Client(env).post('/api/auth/sso/start'))).toBe('SSO_SIGNIN_FAILED');
    expect(plain.fake.calls).toEqual([]); // nothing was sent over plain http
    await env.app.close();
    for (const odd of ['https://user:pw@mail.demo.example', 'https://mail.demo.example?x=1', 'https://mail.demo.example?', 'https://mail.demo.example#']) {
      const o = await school({ ...SSO, SSO_ISSUER: odd });
      expect(reason(await new Client(env).post('/api/auth/sso/start')), odd).toBe('SSO_SIGNIN_FAILED');
      expect(o.fake.calls, odd).toEqual([]);
      await env.app.close();
    }
    await school();
  });

  it('reads the provider’s addresses once, and sends the browser there with PKCE, a nonce and a sealed cookie', async () => {
    const { fake } = await school();
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).sso).toEqual({ name: 'Demo Mail', hasIcon: false });
    const c = new Client(env);
    const res = await c.post('/api/auth/sso/start');
    const url = new URL(res.body.authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/login`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: SSO.SSO_CLIENT_ID, redirect_uri: `${TEST_ORIGIN}/signin-sso`, scope: 'openid email', code_challenge_method: 'S256' });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toContain('Path=/api/auth/sso');
    expect(c.cookies.get(SSO_COOKIE)).not.toContain(url.searchParams.get('state')!);
    await ok(new Client(env).post('/api/auth/sso/start'));
    expect(fake.calls.map((x) => x.url)).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
  });

  it('refuses a discovery document that names another issuer or sends people or the code to another host', async () => {
    const { fake } = await school();
    for (const bad of [
      { ...DISCOVERY, issuer: 'https://other.demo.example' },
      { ...DISCOVERY, authorization_endpoint: 'https://other.demo.example/login' },
      { ...DISCOVERY, token_endpoint: 'https://other.demo.example/auth/token' },
      { ...DISCOVERY, token_endpoint: 'http://mail.demo.example/auth/token' },
      { issuer: ISSUER },
    ]) {
      forgetSsoDiscovery();
      fake.discovery = bad;
      expect(reason(await new Client(env).post('/api/auth/sso/start')), JSON.stringify(bad)).toBe('SSO_SIGNIN_FAILED');
    }
  });

  it('signs in any role, an administrator with a password too, and remembers the provider’s id', async () => {
    const { s, fake } = await school();
    const { c, r, url } = await signIn(fake, standard('Root@Mail.Demo.Example', 'acct-17'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: s.adminUser.id, role: 'admin', signInMethod: 'password' });
    expect((await c.get('/api/admin/users')).status).toBe(200);
    // A public client: PKCE carries the proof, no secret is sent.
    const sent = fake.calls.at(-1)!;
    expect(sent.url).toBe(`${ISSUER}/auth/token`);
    expect(sent.form).toMatchObject({ grant_type: 'authorization_code', code: 'fictional-code', client_id: SSO.SSO_CLIENT_ID, redirect_uri: `${TEST_ORIGIN}/signin-sso` });
    expect(sent.form).not.toHaveProperty('client_secret');
    expect(crypto.createHash('sha256').update(sent.form!.code_verifier!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(c.cookies.has(SSO_COOKIE)).toBe(false);
    expect(audits('auth.sso_linked')).toBe(1);
    expect(count("select count(*) n from audit_events where action = 'auth.login' and after_json like '%sso%'")).toBe(1);
    expect(env.db.select().from(users).where(eq(users.id, s.adminUser.id)).get()!.ssoSub).toBe('acct-17');
    // Later the id decides, also when it arrives as a number.
    expect((await signIn(fake, standard('ayse@mail.demo.example', 42))).r.body).toMatchObject({ id: s.ayse.id, role: 'teacher' });
    expect((await signIn(fake, standard('moved@mail.demo.example', 42))).r.body.id).toBe(s.ayse.id);
    expect((await signIn(fake, standard('renamed@mail.demo.example', 'acct-17'))).r.body.id).toBe(s.adminUser.id);
  });

  it('sends the client secret when one is configured', async () => {
    const { fake } = await school({ ...SSO, SSO_CLIENT_SECRET: 'fictional-secret' });
    expect((await signIn(fake, standard('root@mail.demo.example', 'acct-17'))).r.status).toBe(200);
    expect(fake.calls.at(-1)!.form).toMatchObject({ client_secret: 'fictional-secret' });
  });

  it('needs email_verified unless the operator says the provider only names addresses it owns', async () => {
    const { fake } = await school({ ...SSO, SSO_TRUST_EMAIL: false });
    expect(reason((await signIn(fake, standard('root@mail.demo.example', 'acct-17'))).r)).toBe('SSO_SIGNIN_FAILED');
    expect(reason((await signIn(fake, standard('root@mail.demo.example', 'acct-17', { email_verified: 'true' }))).r)).toBe('SSO_SIGNIN_FAILED');
    expect((await signIn(fake, standard('root@mail.demo.example', 'acct-17', { email_verified: true }))).r.status).toBe(200);
  });

  it('refuses a wrong issuer, audience, nonce or expiry, a missing address, a failed exchange, another browser and a second try', async () => {
    const { fake } = await school();
    const bad: Array<[string, NonNullable<Fake['claims']>]> = [
      ['issuer', standard('root@mail.demo.example', 'a', { iss: 'https://other.demo.example' })],
      ['audience', standard('root@mail.demo.example', 'a', { aud: 'another-client' })],
      ['expired', (n) => ({ ...standard('root@mail.demo.example', 'a')(n), exp: Math.floor(env.clock.now() / 1000) - 3600 })],
      ['nonce', (n) => ({ ...standard('root@mail.demo.example', 'a')(n), nonce: `${n}x` })],
      ['no address', standard('', 'a')],
      ['no subject', standard('root@mail.demo.example', '')],
    ];
    for (const [name, claims] of bad) expect(reason((await signIn(fake, claims)).r), name).toBe('SSO_SIGNIN_FAILED');
    fake.fail = true;
    expect(reason((await signIn(fake, standard('root@mail.demo.example', 'a'))).r)).toBe('SSO_SIGNIN_FAILED');
    fake.fail = false;
    // Another browser (no cookie) cannot finish somebody's sign-in; ten minutes are the limit; one try per start.
    const victim = new Client(env);
    const state = new URL((await ok(victim.post('/api/auth/sso/start'))).authorizeUrl).searchParams.get('state')!;
    expect(reason(await new Client(env).post('/api/auth/sso/complete', { state, code: 'fictional-code' }))).toBe('SSO_SIGNIN_FAILED');
    const slow = new Client(env);
    const s2 = new URL((await ok(slow.post('/api/auth/sso/start'))).authorizeUrl).searchParams.get('state')!;
    env.clock.advance(11 * 60_000);
    expect(reason(await slow.post('/api/auth/sso/complete', { state: s2, code: 'fictional-code' }))).toBe('SSO_SIGNIN_FAILED');
    const once = await signIn(fake, standard('root@mail.demo.example', 'a'));
    expect(once.r.status).toBe(200);
    expect(reason(await once.c.post('/api/auth/sso/complete', { state: once.url.searchParams.get('state')!, code: 'fictional-code' }))).toBe('SSO_SIGNIN_FAILED');
    expect(count('select count(*) n from users where sso_sub is not null')).toBe(1);
  });

  it('never makes an account: unknown, deactivated and shared addresses are refused; a changed address clears the id', async () => {
    const { s, fake } = await school();
    expect(reason((await signIn(fake, standard('stranger@mail.demo.example', 'x'))).r)).toBe('SSO_NO_ACCOUNT');
    expect((await signIn(fake, standard('ayse@mail.demo.example', 'acct-ayse'))).r.status).toBe(200);
    await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse.new@mail.demo.example' }));
    expect(env.db.select().from(users).where(eq(users.id, s.ayse.id)).get()!.ssoSub).toBeNull();
    expect(reason((await signIn(fake, standard('ayse@mail.demo.example', 'acct-ayse'))).r)).toBe('SSO_NO_ACCOUNT');
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    expect(reason((await signIn(fake, standard('ayse.new@mail.demo.example', 'acct-ayse'))).r)).toBe('SSO_NO_ACCOUNT');
    await ok(s.admin.post('/api/admin/users', { login: 'root.second', displayName: 'İkinci Yönetici', role: 'admin', email: 'root@mail.demo.example', setup: 'temporary_password' }));
    expect(reason((await signIn(fake, standard('root@mail.demo.example', 'acct-17'))).r)).toBe('SSO_AMBIGUOUS');
    expect(count('select count(*) n from users')).toBe(4);
  });

  it('an invited person may use it straight away: the invite counts as used, no password; it counts as re-authentication', async () => {
    const { s, fake, mailer } = await school();
    const made = await ok(s.admin.post('/api/admin/users', { login: 'zehra.teacher', displayName: 'Zehra Öğretmen', role: 'teacher', email: 'zehra@mail.demo.example' }));
    const invite = tokenFrom(mailer.sent.at(-1)!.text);
    const { c, r } = await signIn(fake, standard('zehra@mail.demo.example', 'acct-zehra'));
    expect(r.body).toMatchObject({ id: made.user.id, signInMethod: 'email_link', reauthFresh: true });
    expect(reason(await new Client(env).post('/api/auth/invite/inspect', { token: invite }))).toBe('INVITE_INVALID');
    expect((await c.post('/api/auth/pin', { pin: '1357' })).status).toBe(200);
  });

  it('serves the icon as an image only, and only a small file of an allowed kind from the data folder', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16"/></svg>';
    fs.writeFileSync(path.join(dataDir, 'sso-icon.svg'), svg);
    await school({ ...SSO, SSO_ICON_FILE: 'sso-icon.svg' });
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).sso).toEqual({ name: 'Demo Mail', hasIcon: true });
    const res = await new Client(env).get('/api/auth/sso/icon');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(String(res.headers['content-security-policy'])).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toContain('<svg');
    await env.app.close();

    // A path, another kind of file or a large file is not an icon.
    fs.writeFileSync(path.join(dataDir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dataDir, 'big.png'), Buffer.alloc(SSO_ICON_MAX_BYTES + 1));
    for (const name of ['../sso-icon.svg', 'notes.txt', 'big.png', 'missing.png']) {
      await school({ ...SSO, SSO_ICON_FILE: name });
      expect((await ok(new Client(env).get('/api/auth/password-reset'))).sso, name).toEqual({ name: 'Demo Mail', hasIcon: false });
      expect((await new Client(env).get('/api/auth/sso/icon')).status, name).toBe(404);
      await env.app.close();
    }
    await school();
  });

  it('review fixes: a wrong state with the right cookie, an invited administrator, large numeric ids, a domain limit, a deactivated account', async () => {
    const { s, fake, mailer } = await school();
    // The browser that asked, but another state.
    const c = new Client(env);
    const started = new URL((await ok(c.post('/api/auth/sso/start'))).authorizeUrl);
    fake.nonce = started.searchParams.get('nonce')!;
    fake.claims = standard('root@mail.demo.example', 'acct-17');
    const state = started.searchParams.get('state')!;
    expect(reason(await c.post('/api/auth/sso/complete', { state: `${state.slice(0, -4)}AAAA`, code: 'fictional-code' }))).toBe('SSO_SIGNIN_FAILED');
    // An id too large to be exact, or negative, is refused.
    expect(reason((await signIn(fake, standard('root@mail.demo.example', 2 ** 53 + 2))).r)).toBe('SSO_SIGNIN_FAILED');
    expect(reason((await signIn(fake, standard('root@mail.demo.example', -1))).r)).toBe('SSO_SIGNIN_FAILED');
    expect(count('select count(*) n from users where sso_sub is not null')).toBe(0);

    // An invited administrator while passwords are on: signed in, but the invite stays and the account does not become password-less.
    const boss = await ok(s.admin.post('/api/admin/users', { login: 'new.admin', displayName: 'Yeni Yönetici', role: 'admin', email: 'new.admin@mail.demo.example' }));
    const invite = tokenFrom(mailer.sent.at(-1)!.text);
    const asBoss = await signIn(fake, standard('new.admin@mail.demo.example', 'acct-boss'));
    expect(asBoss.r.body).toMatchObject({ id: boss.user.id, role: 'admin', signInMethod: 'password' });
    await ok(new Client(env).post('/api/auth/invite/inspect', { token: invite }));
    expect(audits('auth.invite_accept')).toBe(0);
    // No sign-in link is mailed to that administrator: the account is not an email-link account.
    const sentBefore = mailer.sent.length;
    await ok(new Client(env).post('/api/auth/email-link/request', { email: 'new.admin@mail.demo.example' }));
    expect(mailer.sent).toHaveLength(sentBefore);

    // A deactivated account lets go of its id, so a new account with the address can be linked.
    expect((await signIn(fake, standard('ayse@mail.demo.example', 'acct-ayse'))).r.status).toBe(200);
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    expect(env.db.select().from(users).where(eq(users.id, s.ayse.id)).get()!.ssoSub).toBeNull();
    const fresh = await ok(s.admin.post('/api/admin/users', { login: 'ayse.again', displayName: 'Ayşe Yeniden', role: 'teacher', email: 'ayse@mail.demo.example', setup: 'temporary_password' }));
    expect((await signIn(fake, standard('ayse@mail.demo.example', 'acct-ayse'))).r.body.id).toBe(fresh.user.id);
    await env.app.close();

    // With a domain limit the provider may vouch only for addresses in those domains.
    const limited = await school({ ...SSO, SSO_EMAIL_DOMAINS: ' Mail.Demo.Example , @second.demo.example ' });
    await ok(limited.s.admin.patch(`/api/admin/users/${limited.s.mehmet.id}`, { email: 'mehmet@elsewhere.demo.example' }));
    expect((await signIn(limited.fake, standard('root@mail.demo.example', 'acct-17'))).r.status).toBe(200);
    expect(reason((await signIn(limited.fake, standard('mehmet@elsewhere.demo.example', 'acct-m'))).r)).toBe('SSO_SIGNIN_FAILED');
    expect(reason((await signIn(limited.fake, standard('mehmet@notmail.demo.example', 'acct-m'))).r)).toBe('SSO_SIGNIN_FAILED');
  });

  it('S35: an invited administrator signed in this way has no password yet: Me says so, and what asks for the password says PASSWORD_NOT_SET', async () => {
    const { s, fake, mailer } = await school();
    const boss = await ok(s.admin.post('/api/admin/users', { login: 'new.admin', displayName: 'Yeni Yönetici', role: 'admin', email: 'new.admin@mail.demo.example' }));
    const invite = tokenFrom(mailer.sent.at(-1)!.text);
    const { c, r } = await signIn(fake, standard('new.admin@mail.demo.example', 'acct-boss'));
    expect(r.body).toMatchObject({ id: boss.user.id, signInMethod: 'password', invitePending: true, email: 'new.admin@mail.demo.example' });
    // Everyone else is not in this state.
    expect((await ok(s.admin.get('/api/auth/me'))).invitePending).toBe(false);
    for (const body of [{}, { currentPassword: 'never-had-one-123' }]) {
      expect(reason(await c.post('/api/auth/pin', { ...body, pin: '2468' }))).toBe('PASSWORD_NOT_SET');
      expect(reason(await c.post('/api/auth/email/start', { ...body, email: 'boss@mail.demo.example' }))).toBe('PASSWORD_NOT_SET');
      expect(reason(await c.post('/api/auth/passkeys/register/start', body))).toBe('PASSWORD_NOT_SET');
    }
    expect(reason(await c.post('/api/auth/password', { currentPassword: 'never-had-one-123', newPassword: 'a-new-password-123' }))).toBe('PASSWORD_NOT_SET');
    // Opening the invite and choosing a password ends the state.
    await ok(new Client(env).post('/api/auth/invite/accept', { token: invite, method: 'password', password: 'chosen-password-123' }));
    const after = new Client(env);
    await after.login('new.admin', 'chosen-password-123');
    expect((await ok(after.get('/api/auth/me'))).invitePending).toBe(false);
  });
});
