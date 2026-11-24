/**
 * S31 (D-208): Sign in with Google, beside email links (ACC-2, ACC-3). No self-registration: Google
 * only proves the address an administrator put on the account. Google itself is a fake here: the
 * token exchange is injected, so no test reaches the internet. Fictional people and addresses only.
 */
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../src/server/db/schema.ts';
import { GOOGLE_AUTHORIZE_URL, GOOGLE_CHOICE_COOKIE, GOOGLE_COOKIE } from '../../src/server/modules/auth/google.ts';
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

  it('never makes an account: unknown and deactivated addresses and administrators with a password are refused', async () => {
    const { s } = await school();
    expect(reason((await googleSignIn(standard('stranger@elsewhere.example', 'g-x'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    expect(reason((await googleSignIn(standard('root@school.example', 'g-root'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    await ok(s.admin.post(`/api/admin/users/${s.mehmet.id}/deactivate`));
    expect(reason((await googleSignIn(standard('mehmet@school.example', 'g-m'))).r)).toBe('GOOGLE_NO_ACCOUNT');
    expect(count('select count(*) n from users')).toBe(3);
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

describe('one proven address, several accounts: the person chooses (S36, D-216)', () => {
  const sub = (id: string) => env.db.select().from(users).where(eq(users.id, id)).get()!.googleSub;
  const choose = (c: Client, userId: string) => c.post('/api/auth/google/choose', { userId });
  /** Another account on an address (D-108 allows it). */
  const another = async (s: Awaited<ReturnType<typeof school>>['s'], login: string, role: 'teacher' | 'admin' = 'teacher', email = 'ayse@school.example') =>
    (await ok(s.admin.post('/api/admin/users', { login, displayName: `Ayşe ${login}`, role, email, setup: 'temporary_password' }))).user as { id: string };

  it('lists the accounts by name and role only; choosing one signs it in and links the id, so both end up with it; the list comes again', async () => {
    const { s } = await school();
    const two = await another(s, 'ayse.second');
    // A third account with the address that is linked to another Google account is not this person's.
    const other = await another(s, 'ayse.other');
    env.db.update(users).set({ googleSub: 'g-somebody-else' }).where(eq(users.id, other.id)).run();

    const first = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(first.r.status).toBe(200);
    expect(first.r.body.choose.map((a: any) => a.id).sort()).toEqual([s.ayse.id, two.id].sort());
    for (const a of first.r.body.choose) expect(Object.keys(a).sort()).toEqual(['displayName', 'id', 'role']);
    expect(first.r.body.choose.find((a: any) => a.id === two.id)).toEqual({ id: two.id, displayName: 'Ayşe ayse.second', role: 'teacher' });
    expect(Object.keys(first.r.body)).toEqual(['choose']);
    expect(JSON.stringify(first.r.body)).not.toContain('school.example');
    // Nothing is signed in or linked yet; the proof waits in a short-lived HttpOnly cookie.
    expect((await first.c.get('/api/auth/me')).status).toBe(401);
    expect(count('select count(*) n from users where google_sub = ?', 'g-ayse')).toBe(0);
    expect(count("select count(*) n from audit_events where action = 'auth.login' and after_json like '%google%'")).toBe(0);
    // The choice cookie's own attributes (the answer also clears the start cookie).
    const choiceCookie = ([first.r.headers['set-cookie']].flat() as string[]).find((h) => h.startsWith(`${GOOGLE_CHOICE_COOKIE}=`))!;
    expect(choiceCookie).toMatch(/; Max-Age=300(;|$)/u);
    expect(choiceCookie).toMatch(/; HttpOnly(;|$)/iu);
    expect(choiceCookie).toMatch(/; SameSite=Lax(;|$)/iu);
    expect(choiceCookie).toContain('; Path=/api/auth/google');
    expect(first.c.cookies.get(GOOGLE_CHOICE_COOKIE)).not.toContain('g-ayse');

    const chosen = await choose(first.c, two.id);
    expect(chosen.status).toBe(200);
    expect(chosen.body).toMatchObject({ id: two.id, role: 'teacher', reauthFresh: true });
    expect((await ok(first.c.get('/api/auth/me'))).id).toBe(two.id);
    expect(first.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    expect(sub(two.id)).toBe('g-ayse');
    expect(sub(s.ayse.id)).toBeNull();
    expect(count("select count(*) n from audit_events where action = 'auth.login' and entity_id = ? and after_json like '%google%'", two.id)).toBe(1);
    expect(audits('auth.google_linked')).toBe(1);
    // The cookie is cleared after a successful choice: this browser cannot choose again with it.
    expect(reason(await choose(first.c, two.id))).toBe('GOOGLE_SIGNIN_FAILED');

    // Next time: Ayşe's first account by the address, the second by the id. Choosing the first links it too.
    const next = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(next.r.body.choose.map((a: any) => a.id).sort()).toEqual([s.ayse.id, two.id].sort());
    expect((await ok(choose(next.c, s.ayse.id))).id).toBe(s.ayse.id);
    expect(sub(s.ayse.id)).toBe('g-ayse');
    expect(sub(two.id)).toBe('g-ayse');
    // Both linked: the list again, whatever address Google shows now.
    const later = await googleSignIn(standard('renamed@elsewhere.example', 'g-ayse'));
    expect(later.r.body.choose.map((a: any) => a.id).sort()).toEqual([s.ayse.id, two.id].sort());
    expect(sub(other.id)).toBe('g-somebody-else');
  });

  it('with passwords on, an administrator who has a password is not offered, so the teacher signs in at once; with passwords off both are offered', async () => {
    const { s, mailer } = await school();
    const boss = await another(s, 'ayse.admin', 'admin');
    const direct = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(direct.r.body).toMatchObject({ id: s.ayse.id, role: 'teacher' });
    expect(direct.r.body).not.toHaveProperty('choose');
    expect(direct.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    await ok(s.admin.post('/api/admin/sign-in-policy/code'));
    await ok(s.admin.put('/api/admin/sign-in-policy', { passwordsOff: true, code: codeFrom(mailer.sent.at(-1)!.text) }));
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(listed.r.body.choose).toHaveLength(2);
    expect(listed.r.body.choose).toEqual(
      expect.arrayContaining([
        { id: s.ayse.id, displayName: s.ayse.displayName, role: 'teacher' },
        { id: boss.id, displayName: 'Ayşe ayse.admin', role: 'admin' },
      ]),
    );
    expect((await ok(choose(listed.c, boss.id))).role).toBe('admin');
    expect((await listed.c.get('/api/admin/users')).status).toBe(200);
  });

  it('refuses a choice without the cookie, with an expired or tampered one, with another browser’s, or for an account not on the list', async () => {
    const { s } = await school();
    const two = await another(s, 'ayse.second');
    await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { email: 'shared@school.example' }));
    const mehmetTwo = await another(s, 'mehmet.second', 'teacher', 'shared@school.example');

    expect(reason(await choose(new Client(env), s.ayse.id))).toBe('GOOGLE_SIGNIN_FAILED');
    // Another browser with its own list (another address) cannot choose an account from Ayşe's.
    const mine = await googleSignIn(standard('shared@school.example', 'g-mehmet'));
    expect(mine.r.body.choose).toHaveLength(2);
    expect(reason(await choose(mine.c, s.ayse.id))).toBe('GOOGLE_SIGNIN_FAILED');
    expect(reason(await choose(mine.c, two.id))).toBe('GOOGLE_SIGNIN_FAILED');
    // A wrong id leaves the cookie: the right button still works.
    expect(mine.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(true);
    expect((await ok(choose(mine.c, mehmetTwo.id))).id).toBe(mehmetTwo.id);
    // A changed cookie is no proof, and is cleared.
    const tampered = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    const value = tampered.c.cookies.get(GOOGLE_CHOICE_COOKIE)!;
    tampered.c.cookies.set(GOOGLE_CHOICE_COOKIE, `${value.slice(0, -6)}AAAAAA`);
    expect(reason(await choose(tampered.c, two.id))).toBe('GOOGLE_SIGNIN_FAILED');
    expect(tampered.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    // Five minutes are the limit.
    const slow = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    env.clock.advance(5 * 60_000 + 1000);
    expect(reason(await choose(slow.c, two.id))).toBe('GOOGLE_SIGNIN_FAILED');
    expect(slow.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    expect(count('select count(*) n from users where google_sub = ?', 'g-ayse')).toBe(0);
    expect((await slow.c.get('/api/auth/me')).status).toBe(401);
  });

  it('checks the chosen account again: deactivated or given another address since the list, it is refused', async () => {
    const { s } = await school();
    const two = await another(s, 'ayse.second');
    const third = await another(s, 'ayse.third');
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(listed.r.body.choose).toHaveLength(3);
    await ok(s.admin.post(`/api/admin/users/${two.id}/deactivate`));
    expect(reason(await choose(listed.c, two.id))).toBe('GOOGLE_NO_ACCOUNT');
    await ok(s.admin.patch(`/api/admin/users/${third.id}`, { email: 'third@school.example' }));
    expect(reason(await choose(listed.c, third.id))).toBe('GOOGLE_NO_ACCOUNT');
    expect((await listed.c.get('/api/auth/me')).status).toBe(401);
    expect(count('select count(*) n from users where google_sub is not null')).toBe(0);
    // Still on the list and still a candidate: that one works.
    expect((await ok(choose(listed.c, s.ayse.id))).id).toBe(s.ayse.id);
  });

  it('an invited account chosen from the list is handled as on a direct sign-in: the invite counts as used', async () => {
    const { s, mailer } = await school();
    const made = await ok(s.admin.post('/api/admin/users', { login: 'ayse.invited', displayName: 'Ayşe Davetli', role: 'teacher', email: 'ayse@school.example' }));
    const invite = tokenFrom(mailer.sent.at(-1)!.text);
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(listed.r.body.choose).toHaveLength(2);
    expect(await ok(choose(listed.c, made.user.id))).toMatchObject({ id: made.user.id, signInMethod: 'email_link' });
    expect(reason(await new Client(env).post('/api/auth/invite/inspect', { token: invite }))).toBe('INVITE_INVALID');
    expect(count("select count(*) n from audit_events where action = 'auth.invite_accept' and entity_id = ?", made.user.id)).toBe(1);
  });
});

describe('S36 review: whom a linked person may reach, the cookie’s life, and the edges (D-216)', () => {
  const sub = (id: string) => env.db.select().from(users).where(eq(users.id, id)).get()!.googleSub;
  const choose = (c: Client, userId: string) => c.post('/api/auth/google/choose', { userId });
  const another = async (s: Awaited<ReturnType<typeof school>>['s'], login: string, role: 'teacher' | 'admin' = 'teacher', email = 'ayse@school.example') =>
    (await ok(s.admin.post('/api/admin/users', { login, displayName: `Ayşe ${login}`, role, email, setup: 'temporary_password' }))).user as { id: string };
  /** An administrator account that may use Google while passwords are on: an email-link account (D-207). */
  const emailLinkAccount = (id: string) => env.db.update(users).set({ signInMethod: 'email_link' }).where(eq(users.id, id)).run();
  const link = (id: string, googleSub: string | null) => env.db.update(users).set({ googleSub }).where(eq(users.id, id)).run();

  it('a linked teacher and an unlinked administrator with the same stored address are both offered, whatever address Google names now', async () => {
    const { s } = await school();
    const boss = await another(s, 'ayse.admin', 'admin');
    emailLinkAccount(boss.id);
    link(s.ayse.id, 'g-ayse');
    for (const named of ['ayse@school.example', 'ayse.private@elsewhere.example']) {
      const listed = await googleSignIn(standard(named, 'g-ayse'));
      expect(listed.r.body.choose.map((a: any) => a.id).sort(), named).toEqual([s.ayse.id, boss.id].sort());
    }
  });

  it('a linked teacher whose Google address now is somebody else’s does not reach that account: signed straight in, the other neither listed nor choosable', async () => {
    const { s } = await school();
    // The school's administrator may use Google too here (an email-link account) and has no Google id.
    emailLinkAccount(s.adminUser.id);
    link(s.ayse.id, 'g-ayse');
    const direct = await googleSignIn(standard('root@school.example', 'g-ayse'));
    expect(direct.r.body).toMatchObject({ id: s.ayse.id, role: 'teacher' });
    expect(direct.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    expect(sub(s.adminUser.id)).toBeNull();
    // With a second linked account there is a list, but only of this person's accounts.
    const two = await another(s, 'ayse.second');
    link(two.id, 'g-ayse');
    const listed = await googleSignIn(standard('root@school.example', 'g-ayse'));
    expect(listed.r.body.choose.map((a: any) => a.id).sort()).toEqual([s.ayse.id, two.id].sort());
    expect(reason(await choose(listed.c, s.adminUser.id))).toBe('GOOGLE_SIGNIN_FAILED');
    expect(sub(s.adminUser.id)).toBeNull();
  });

  it('no database row marks a choice as used: the old cookie value sent again after a successful choice still signs in within its 5 minutes, and not after', async () => {
    const { s } = await school();
    const two = await another(s, 'ayse.second');
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    const value = listed.c.cookies.get(GOOGLE_CHOICE_COOKIE)!;
    expect((await ok(choose(listed.c, two.id))).id).toBe(two.id);
    expect(listed.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    const replay = new Client(env);
    replay.cookies.set(GOOGLE_CHOICE_COOKIE, value);
    expect((await ok(choose(replay, s.ayse.id))).id).toBe(s.ayse.id);
    env.clock.advance(5 * 60_000 + 1000);
    const late = new Client(env);
    late.cookies.set(GOOGLE_CHOICE_COOKIE, value);
    expect(reason(await choose(late, two.id))).toBe('GOOGLE_SIGNIN_FAILED');
  });

  it('a new start and a sign-out clear the choice cookies', async () => {
    const { s } = await school();
    await another(s, 'ayse.second');
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    const value = listed.c.cookies.get(GOOGLE_CHOICE_COOKIE)!;
    const started = await listed.c.post('/api/auth/google/start');
    expect(String(started.headers['set-cookie'])).toMatch(new RegExp(`${GOOGLE_CHOICE_COOKIE}=;[^,]*Path=/api/auth/google`, 'u'));
    expect(listed.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    // A signed-in browser that still has lists of both providers: signing out clears both.
    s.admin.cookies.set(GOOGLE_CHOICE_COOKIE, value);
    s.admin.cookies.set('cc_sso_choice', 'v1.fictional');
    const out = await s.admin.post('/api/auth/logout');
    expect(out.status).toBe(200);
    const header = String(out.headers['set-cookie']);
    expect(header).toMatch(new RegExp(`${GOOGLE_CHOICE_COOKIE}=;[^,]*Path=/api/auth/google`, 'u'));
    expect(header).toMatch(/cc_sso_choice=;[^,]*Path=\/api\/auth\/sso/u);
    expect(s.admin.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    expect(s.admin.cookies.has('cc_sso_choice')).toBe(false);
  });

  it('an account that may no longer use Google, or now carries another Google id, is refused at the choice; the other stays choosable', async () => {
    const { s } = await school();
    const boss = await another(s, 'ayse.admin', 'admin');
    emailLinkAccount(boss.id);
    const two = await another(s, 'ayse.second');
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(listed.r.body.choose).toHaveLength(3);
    // The administrator got a password back while passwords are on: no longer an account for Google.
    env.db.update(users).set({ signInMethod: 'password', passwordHash: 'fictional-hash' }).where(eq(users.id, boss.id)).run();
    expect(reason(await choose(listed.c, boss.id))).toBe('GOOGLE_NO_ACCOUNT');
    link(two.id, 'g-somebody-else');
    expect(reason(await choose(listed.c, two.id))).toBe('GOOGLE_NO_ACCOUNT');
    expect((await ok(choose(listed.c, s.ayse.id))).id).toBe(s.ayse.id);
    expect(sub(boss.id)).toBeNull();
    expect(sub(two.id)).toBe('g-somebody-else');
  });

  it('is not available without a Google client, and needs the CSRF header', async () => {
    await school({});
    expect(reason(await new Client(env).post('/api/auth/google/choose', { userId: 'u-1' }))).toBe('GOOGLE_NOT_AVAILABLE');
    await env.app.close();
    const { s } = await school();
    const two = await another(s, 'ayse.second');
    const listed = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    const cookie = `${GOOGLE_CHOICE_COOKIE}=${listed.c.cookies.get(GOOGLE_CHOICE_COOKIE)!}`;
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/google/choose', headers: { origin: env.config.origins.main, cookie }, payload: { userId: two.id } });
    expect(res.statusCode).toBe(403);
    expect(sub(two.id)).toBeNull();
  });

  it('ten accounts on one address are listed; more are refused with their own reason and no cookie', async () => {
    const { s } = await school();
    for (let i = 2; i <= 10; i++) await another(s, `ayse.n${i}`);
    const ten = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(ten.r.body.choose).toHaveLength(10);
    await another(s, 'ayse.n11');
    const many = await googleSignIn(standard('ayse@school.example', 'g-ayse'));
    expect(many.r.status).toBe(401);
    expect(reason(many.r)).toBe('GOOGLE_TOO_MANY_ACCOUNTS');
    expect(many.c.cookies.has(GOOGLE_CHOICE_COOKIE)).toBe(false);
    expect((await many.c.get('/api/auth/me')).status).toBe(401);
  });
});
