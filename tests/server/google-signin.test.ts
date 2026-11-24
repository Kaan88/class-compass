/**
 * S31 (D-208): Sign in with Google, beside email links (ACC-2, ACC-3). No self-registration: Google
 * only proves the address an administrator put on the account. Google itself is a fake here: the
 * token exchange is injected, so no test reaches the internet. Fictional people and addresses only.
 */
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../src/server/db/schema.ts';
import { GOOGLE_AUTHORIZE_URL, GOOGLE_COOKIE } from '../../src/server/modules/auth/google.ts';
import { Client, FakeMailer, makeEnv, TEST_ORIGIN, type TestEnv } from '../helpers.ts';
import { buildSchool, ok } from '../school-fixture.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

const SMTP = { SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' };
const GOOGLE = { GOOGLE_SIGNIN_CLIENT_ID: 'fictional-client.apps.example', GOOGLE_SIGNIN_CLIENT_SECRET: 'fictional-client-secret' };
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/u.exec(text)![1]!;
const codeFrom = (text: string) => /\n(\d{6})\n/u.exec(text)![1]!;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const audits = (action: string) => count('select count(*) n from audit_events where action = ?', action);
const reason = (r: { body: any }) => r.body?.error?.details?.reason;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
/** An ID token as the token endpoint returns it (the signature part is not read: D-208). */
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.fictional-signature`;

/** What the fake Google answers with, and what the server sent it. */
interface Fake {
  claims: (nonce: string) => Record<string, unknown>;
  fail?: boolean;
  sent: URLSearchParams[];
}

async function school(config: Record<string, unknown> = GOOGLE) {
  const mailer = new FakeMailer();
  env = await makeEnv({ ...SMTP, ...config }, { mailer });
  const s = await buildSchool(env);
  await ok(s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: 'root@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { email: 'mehmet@school.example' }));
  mailer.sent.length = 0;
  return { mailer, s };
}

const standard = (email: string, sub: string, extra: Record<string, unknown> = {}) => (nonce: string) => ({
  iss: 'https://accounts.google.com',
  aud: GOOGLE.GOOGLE_SIGNIN_CLIENT_ID,
  exp: Math.floor(env.clock.now() / 1000) + 3600,
  nonce,
  sub,
  email,
  email_verified: true,
  ...extra,
});

/** Start on a browser, go "through Google" and come back: returns the completion's raw answer. */
async function googleSignIn(claims: Fake['claims'], opts: { c?: Client; fail?: boolean; tamperState?: boolean } = {}) {
  const c = opts.c ?? new Client(env);
  const started = await ok(c.post('/api/auth/google/start'));
  const url = new URL(started.authorizeUrl);
  const nonce = url.searchParams.get('nonce')!;
  const fake: Fake = { claims, sent: [] };
  env.deps.googleTokenExchange = async (params) => {
    fake.sent.push(params);
    if (opts.fail) throw new Error('fictional outage');
    return { id_token: idToken(fake.claims(nonce)), access_token: 'never-used' };
  };
  const state = opts.tamperState ? `${url.searchParams.get('state')!.slice(0, -4)}AAAA` : url.searchParams.get('state')!;
  const r = await c.post('/api/auth/google/complete', { state, code: 'fictional-code' });
  return { c, r, url, fake };
}

describe('Sign in with Google (S31, D-208)', () => {
  it('is not offered until the server has a Google client', async () => {
    await school({});
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).googleSignInEnabled).toBe(false);
    const r = await new Client(env).post('/api/auth/google/start');
    expect(r.status).toBe(403);
    expect(reason(r)).toBe('GOOGLE_NOT_AVAILABLE');
    expect(reason(await new Client(env).post('/api/auth/google/complete', { state: 'x'.repeat(40), code: 'c' }))).toBe('GOOGLE_NOT_AVAILABLE');
  });

  it('sends the browser to Google with PKCE, a nonce and "choose an account", and keeps the secrets in an HttpOnly cookie', async () => {
    await school();
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).googleSignInEnabled).toBe(true);
    const c = new Client(env);
    const res = await c.post('/api/auth/google/start');
    const url = new URL(res.body.authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: GOOGLE.GOOGLE_SIGNIN_CLIENT_ID,
      redirect_uri: `${TEST_ORIGIN}/signin-google`,
      scope: 'openid email',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`${GOOGLE_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toMatch(/SameSite=Lax/iu);
    expect(setCookie).toContain('Path=/api/auth/google');
    // Neither the state nor the verifier can be read from the cookie, and the secret never goes to the browser.
    const cookie = c.cookies.get(GOOGLE_COOKIE)!;
    expect(cookie).not.toContain(url.searchParams.get('state')!);
    expect(res.body.authorizeUrl).not.toContain(GOOGLE.GOOGLE_SIGNIN_CLIENT_SECRET);
  });

  it('signs a teacher in when Google confirms the address on the account, and remembers Google’s id', async () => {
    const { s } = await school();
    const { c, r, url, fake } = await googleSignIn(standard('Ayse@School.example', 'google-sub-ayse'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: s.ayse.id, role: 'teacher', signInMethod: 'password' });
    expect((await c.get('/api/auth/me')).status).toBe(200);
    // The code was exchanged with the verifier that matches the challenge, the secret and the same redirect address.
    const sent = Object.fromEntries(fake.sent[0]!);
    expect(sent).toMatchObject({ grant_type: 'authorization_code', code: 'fictional-code', client_id: GOOGLE.GOOGLE_SIGNIN_CLIENT_ID, client_secret: GOOGLE.GOOGLE_SIGNIN_CLIENT_SECRET, redirect_uri: `${TEST_ORIGIN}/signin-google` });
    expect(crypto.createHash('sha256').update(sent.code_verifier!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(c.cookies.has(GOOGLE_COOKIE)).toBe(false);
    expect(audits('auth.google_linked')).toBe(1);
    expect(count("select count(*) n from audit_events where action = 'auth.login' and after_json like '%google%'")).toBe(1);
    const row = env.db.select().from(users).where(eq(users.id, s.ayse.id)).get()!;
    expect(row.googleSub).toBe('google-sub-ayse');
    expect(row.emailVerifiedAt).not.toBeNull();
    const listed = (await ok(s.admin.get('/api/admin/users'))).users.find((u: any) => u.id === s.ayse.id);
    expect(listed.googleLinked).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('google-sub-ayse');

    // Later the id decides, whatever address Google shows for the person.
    const again = await googleSignIn(standard('renamed@elsewhere.example', 'google-sub-ayse'));
    expect(again.r.body.id).toBe(s.ayse.id);
    expect(audits('auth.google_linked')).toBe(1);
  });

  it('refuses an answer that does not belong to this browser, is too old, or is used twice', async () => {
    await school();
    expect(reason((await googleSignIn(standard('ayse@school.example', 'g-1'), { tamperState: true })).r)).toBe('GOOGLE_SIGNIN_FAILED');
    // Another browser (no cookie) cannot finish somebody's sign-in.
    const victim = new Client(env);
    const started = await ok(victim.post('/api/auth/google/start'));
    const state = new URL(started.authorizeUrl).searchParams.get('state')!;
    expect(reason(await new Client(env).post('/api/auth/google/complete', { state, code: 'fictional-code' }))).toBe('GOOGLE_SIGNIN_FAILED');
    // Ten minutes are the limit.
    const slow = new Client(env);
    const s2 = new URL((await ok(slow.post('/api/auth/google/start'))).authorizeUrl).searchParams.get('state')!;
    env.clock.advance(11 * 60_000);
    expect(reason(await slow.post('/api/auth/google/complete', { state: s2, code: 'fictional-code' }))).toBe('GOOGLE_SIGNIN_FAILED');
    // One try per start: the cookie is gone after the first completion.
    const once = await googleSignIn(standard('ayse@school.example', 'g-1'));
    expect(once.r.status).toBe(200);
    const state2 = once.url.searchParams.get('state')!;
    expect(reason(await once.c.post('/api/auth/google/complete', { state: state2, code: 'fictional-code' }))).toBe('GOOGLE_SIGNIN_FAILED');
  });

  it('checks the ID token: issuer, audience, expiry, nonce and a verified address', async () => {
    await school();
    const bad: Array<[string, Fake['claims']]> = [
      ['issuer', standard('ayse@school.example', 'g', { iss: 'https://accounts.example.org' })],
      ['audience', standard('ayse@school.example', 'g', { aud: 'another-client.apps.example' })],
      ['expired', (n) => ({ ...standard('ayse@school.example', 'g')(n), exp: Math.floor(env.clock.now() / 1000) - 3600 })],
      ['nonce', (n) => ({ ...standard('ayse@school.example', 'g')(n), nonce: `${n}x` })],
      ['unverified', standard('ayse@school.example', 'g', { email_verified: false })],
      ['verified as text', standard('ayse@school.example', 'g', { email_verified: 'true' })],
      ['no subject', standard('ayse@school.example', '')],
    ];
    for (const [name, claims] of bad) expect(reason((await googleSignIn(claims)).r), name).toBe('GOOGLE_SIGNIN_FAILED');
    expect(reason((await googleSignIn(standard('ayse@school.example', 'g'), { fail: true })).r)).toBe('GOOGLE_SIGNIN_FAILED');
    expect(count('select count(*) n from users where google_sub is not null')).toBe(0);
  });

  it('never makes an account: unknown and deactivated addresses, administrators with a password and shared addresses are refused', async () => {
    const { s } = await school();
    expect(reason((await googleSignIn(standard('stranger@elsewhere.example', 'g-x'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    expect(reason((await googleSignIn(standard('root@school.example', 'g-root'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    await ok(s.admin.post(`/api/admin/users/${s.mehmet.id}/deactivate`));
    expect(reason((await googleSignIn(standard('mehmet@school.example', 'g-m'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    // Two accounts with one address (D-108 allows it): Google cannot say which one is meant.
    await ok(s.admin.post('/api/admin/users', { login: 'ayse.second', displayName: 'Ayşe İkinci', role: 'teacher', email: 'ayse@school.example', setup: 'temporary_password' }));
    expect(reason((await googleSignIn(standard('ayse@school.example', 'g-a'))).r)).toBe('GOOGLE_AMBIGUOUS');
    expect(count('select count(*) n from users')).toBe(4);
    expect(count('select count(*) n from users where google_sub is not null')).toBe(0);
  });

  it('an invited teacher may sign in with Google straight away: the invite counts as used, no password', async () => {
    const { s, mailer } = await school();
    const made = await ok(s.admin.post('/api/admin/users', { login: 'zehra.teacher', displayName: 'Zehra Öğretmen', role: 'teacher', email: 'zehra@school.example' }));
    const invite = tokenFrom(mailer.sent.at(-1)!.text);
    const { c, r } = await googleSignIn(standard('zehra@school.example', 'g-zehra'));
    expect(r.body).toMatchObject({ id: made.user.id, signInMethod: 'email_link', reauthFresh: true, hasPin: false });
    expect(reason(await new Client(env).post('/api/auth/invite/inspect', { token: invite }))).toBe('INVITE_INVALID');
    // A Google sign-in a moment ago counts as re-authentication, as a fresh email sign-in does.
    expect((await c.post('/api/auth/pin', { pin: '1357' })).status).toBe(200);
    // Email links work for the account too.
    const other = new Client(env);
    const asked = await ok(other.post('/api/auth/email-link/request', { email: 'zehra@school.example' }));
    expect((await ok(other.post('/api/auth/email-link/code', { requestId: asked.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }))).id).toBe(made.user.id);
  });

  it('a changed address clears Google’s id: the old Google account no longer gets in', async () => {
    const { s } = await school();
    expect((await googleSignIn(standard('ayse@school.example', 'g-ayse'))).r.status).toBe(200);
    await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse.new@school.example' }));
    expect(env.db.select().from(users).where(eq(users.id, s.ayse.id)).get()!.googleSub).toBeNull();
    expect(reason((await googleSignIn(standard('ayse@school.example', 'g-ayse'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    expect((await googleSignIn(standard('ayse.new@school.example', 'g-ayse-new'))).r.body.id).toBe(s.ayse.id);
    // A deactivated account lets go of the id too, so an old link cannot shut out a new account with the address.
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    expect(env.db.select().from(users).where(eq(users.id, s.ayse.id)).get()!.googleSub).toBeNull();
  });

  it('administrators sign in with Google once the school has switched passwords off (D-207)', async () => {
    const { s, mailer } = await school();
    await ok(s.admin.post('/api/admin/sign-in-policy/code'));
    await ok(s.admin.put('/api/admin/sign-in-policy', { passwordsOff: true, code: codeFrom(mailer.sent.at(-1)!.text) }));
    const { c, r } = await googleSignIn(standard('root@school.example', 'g-root'));
    expect(r.body).toMatchObject({ id: s.adminUser.id, role: 'admin', signInMethod: 'email_link' });
    expect((await c.get('/api/admin/users')).status).toBe(200);
  });
});
