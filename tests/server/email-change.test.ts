/**
 * S35 (D-214): changing the own email address in Profile (ACC-2, ACC-12). Re-authentication, a code
 * emailed to the NEW address and bound to this session and that exact address, then the change with
 * everything an administrator's change does, the other sessions ended and a notice to the old
 * address. An administrator's own address no longer changes through Admin → Accounts → Edit.
 * After the security review: the change code is its own kind of one-time token (as are the codes for
 * switching to email links and switching passwords off), so the public sign-in endpoints never see it
 * and anonymous sign-in requests neither use up, cancel nor lock it; the address is served only to
 * PIN-gated `account` callers (`GET /api/auth/email`), never in `Me`. Fictional people and addresses only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mcpTokens, users } from '../../src/server/db/schema.ts';
import { registeredEndpoints } from '../../src/server/lib/http.ts';
import { openSecret, sealSecret } from '../../src/server/lib/crypto.ts';
import { EMAIL_CHANGE_COOKIE } from '../../src/server/modules/auth/emailSignIn.ts';
import { Client, FakeMailer, makeEnv, type TestEnv } from '../helpers.ts';
import { makeToken, PASSWORD, setAi } from '../mcp-helpers.ts';
import { buildSchool, ok } from '../school-fixture.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

const SMTP = { SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' };
const START = '/api/auth/email/start';
const CONFIRM = '/api/auth/email/confirm';
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/u.exec(text)![1]!;
const codeFrom = (text: string) => /\n(\d{6})\n/u.exec(text)![1]!;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const audits = (action: string) => count('select count(*) n from audit_events where action = ?', action);
const reason = (r: { body: any }) => r.body?.error?.details?.reason;
const row = (id: string) => env.db.select().from(users).where(eq(users.id, id)).get()!;
const otherCode = (code: string) => (code === '000000' ? '000001' : '000000');
const OWN = '/api/auth/email';
const ANY_ID = 'fictional-request-id-0000000000';
const ownEmail = async (c: Client) => (await ok(c.get(OWN))).email as string | null;
/** The newest live session of an account (the one a test client just made). */
const sessionOf = (userId: string) =>
  (env.db.$client.prepare('select id from sessions where user_id = ? and revoked_at is null order by created_at desc, rowid desc').get(userId) as { id: string }).id;
const codeRows = (userId: string, kind: string) =>
  env.db.$client.prepare('select used_at u, code_attempts a from one_time_tokens where user_id = ? and kind = ? order by created_at').all(userId, kind) as Array<{ u: number | null; a: number }>;
/** Switches passwords off for the school (D-207): every teacher becomes an email-link account. */
async function passwordsOff(s: Awaited<ReturnType<typeof buildSchool>>, mailer: FakeMailer) {
  await ok(s.admin.post('/api/admin/sign-in-policy/code'));
  await ok(s.admin.put('/api/admin/sign-in-policy', { passwordsOff: true, code: codeFrom(mailer.sent.at(-1)!.text) }));
}
/** A fresh email-code sign-in on a new device (email-link accounts). */
async function emailSignIn(mailer: FakeMailer, address: string) {
  const c = new Client(env);
  const asked = await ok(c.post('/api/auth/email-link/request', { email: address }));
  await ok(c.post('/api/auth/email-link/code', { requestId: asked.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
  return c;
}

async function school(smtp = true) {
  const mailer = new FakeMailer();
  env = await makeEnv(smtp ? SMTP : {}, { mailer });
  const s = await buildSchool(env);
  await ok(s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: 'root@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse@school.example' }));
  await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { email: 'mehmet@school.example' }));
  mailer.sent.length = 0;
  return { mailer, s };
}

/** Step 1 as Ayşe (password account) and the code from the mail to the new address. */
async function start(c: Client, mailer: FakeMailer, email: string) {
  await ok(c.post(START, { currentPassword: PASSWORD, email }));
  const mail = mailer.sent.at(-1)!;
  expect(mail.to).toBe(email);
  return codeFrom(mail.text);
}

describe('changing the own email address (S35, D-214)', () => {
  it('needs re-authentication; the code goes to the new address; the old address hears of it only after the change', async () => {
    const { s, mailer } = await school();
    expect(reason(await s.teacherA.post(START, { email: 'ayse.new@school.example' }))).toBe('WRONG_PASSWORD');
    expect(reason(await s.teacherA.post(START, { currentPassword: 'not-the-password', email: 'ayse.new@school.example' }))).toBe('WRONG_PASSWORD');
    // Validated like the administrator's form: a bad address is refused before anything is sent.
    expect((await s.teacherA.post(START, { currentPassword: PASSWORD, email: 'not an address' })).status).toBe(400);
    expect(reason(await s.teacherA.post(START, { currentPassword: PASSWORD, email: 'AYSE@school.example' }))).toBe('EMAIL_UNCHANGED');
    expect(mailer.sent).toHaveLength(0);

    await ok(s.teacherA.post(START, { currentPassword: PASSWORD, email: ' Ayse.New@School.example ' }));
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe('ayse.new@school.example');
    expect(mail.subject).toContain('confirm your new email address');
    expect(mail.text).not.toContain('http');
    // Nothing has changed yet; Profile can offer the code form again after a reload (masked address).
    expect(await ok(s.teacherA.get(OWN))).toEqual({ email: 'ayse@school.example', pendingTo: 'a***@school.example' });

    const me = await ok(s.teacherA.post(CONFIRM, { code: codeFrom(mail.text) }));
    expect(me).toMatchObject({ id: s.ayse.id, hasEmail: true, passwordNotSet: false });
    expect(me).not.toHaveProperty('email');
    expect(await ok(s.teacherA.get(OWN))).toEqual({ email: 'ayse.new@school.example', pendingTo: null });
    expect(row(s.ayse.id).emailVerifiedAt).toBe(env.clock.now());
    // The notice to the old address: no link, no new address.
    expect(mailer.sent).toHaveLength(2);
    const notice = mailer.sent[1]!;
    expect(notice.to).toBe('ayse@school.example');
    expect(notice.subject).toContain('was changed');
    expect(notice.text).toContain('administrator');
    expect(notice.text).not.toMatch(/https?:|ayse\.new|\d{6}/u);
    // Audited with the old and the new address (as the administrator's edit records them), never the code.
    const entry = env.db.$client.prepare("select before_json b, after_json a from audit_events where action = 'auth.email_change'").all() as Array<{ b: string; a: string }>;
    expect(entry).toHaveLength(1);
    expect(JSON.parse(entry[0]!.b)).toEqual({ email: 'ayse@school.example' });
    expect(JSON.parse(entry[0]!.a)).toEqual({ email: 'ayse.new@school.example', verified: true });
    expect(entry[0]!.a + entry[0]!.b).not.toContain(codeFrom(mail.text));
    // Used once.
    expect(reason(await s.teacherA.post(CONFIRM, { code: codeFrom(mail.text) }))).toBe('SIGNIN_CODE_INVALID');
  });

  it('a wrong code counts; after five the code is dead; three emails per account and 15 minutes', async () => {
    const { s, mailer } = await school();
    const code = await start(s.teacherA, mailer, 'ayse.new@school.example');
    const wrong = await s.teacherA.post(CONFIRM, { code: otherCode(code) });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.details).toMatchObject({ reason: 'SIGNIN_CODE_INVALID', attemptsLeft: 4 });
    for (let i = 0; i < 4; i++) await s.teacherA.post(CONFIRM, { code: otherCode(code) });
    expect(reason(await s.teacherA.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    expect(row(s.ayse.id).email).toBe('ayse@school.example');
    expect(mailer.sent).toHaveLength(1); // no notice: nothing changed

    // A new code, then the per-account limit of address-change emails (3 in 15 minutes).
    await start(s.teacherA, mailer, 'ayse.new@school.example');
    await start(s.teacherA, mailer, 'ayse.new@school.example');
    const r = await s.teacherA.post(START, { currentPassword: PASSWORD, email: 'ayse.new@school.example' });
    expect(r.status).toBe(429);
    // The code expires with the 15 minutes.
    const last = codeFrom(mailer.sent.at(-1)!.text);
    env.clock.advance(16 * 60 * 1000);
    expect(reason(await s.teacherA.post(CONFIRM, { code: last }))).toBe('SIGNIN_CODE_INVALID');
    expect(row(s.ayse.id).email).toBe('ayse@school.example');
  });

  it('a code for one address does not confirm another, and another session cannot use it', async () => {
    const { s, mailer } = await school();
    const code = await start(s.teacherA, mailer, 'ayse.a@school.example');
    const cookie = s.teacherA.cookies.get(EMAIL_CHANGE_COOKIE)!;
    expect(cookie).toMatch(/^v1\./u);
    expect(cookie).not.toContain('ayse.a'); // sealed, not readable

    // The same cookie re-sealed for another address (as if the browser could forge it): the code is for ayse.a only.
    const sessionId = env.db.$client.prepare('select id from sessions where user_id = ? and revoked_at is null order by created_at desc').get(s.ayse.id) as { id: string };
    const pending = JSON.parse(openSecret(env.config.SECRET_PEPPER, 'email-change', sessionId.id, cookie)!);
    s.teacherA.cookies.set(EMAIL_CHANGE_COOKIE, sealSecret(env.config.SECRET_PEPPER, 'email-change', sessionId.id, JSON.stringify({ ...pending, email: 'ayse.b@school.example' })));
    expect(reason(await s.teacherA.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    expect(row(s.ayse.id).email).toBe('ayse@school.example');

    // Another session of the same account, with the cookie and the code, or with the code alone.
    const other = new Client(env);
    await other.login('ayse.teacher');
    expect(reason(await other.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    other.cookies.set(EMAIL_CHANGE_COOKIE, cookie);
    expect(reason(await other.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    // Another account's session with the cookie.
    s.teacherB.cookies.set(EMAIL_CHANGE_COOKIE, cookie);
    expect(reason(await s.teacherB.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    expect(row(s.mehmet.id).email).toBe('mehmet@school.example');

    // The browser that asked, with its own cookie, still can.
    s.teacherA.cookies.set(EMAIL_CHANGE_COOKIE, cookie);
    await ok(s.teacherA.post(CONFIRM, { code }));
    expect(await ownEmail(s.teacherA)).toBe('ayse.a@school.example');
  });

  it('ends what belonged to the old address: links, invites, Google and sign-in server ids, other sessions and AI tool tokens; this session stays', async () => {
    const { s, mailer } = await school();
    try {
      await setAi(s.admin, { mcpEnabled: true });
      const token = await makeToken(s.teacherA, { scopes: ['classes:read'] });
      env.db.update(users).set({ googleSub: 'google-fictional-1', ssoSub: 'sso-fictional-1', emailVerifiedAt: 1 }).where(eq(users.id, s.ayse.id)).run();
      await ok(new Client(env).post('/api/auth/password-reset/request', { email: 'ayse@school.example' }));
      const reset = tokenFrom(mailer.sent.at(-1)!.text);
      await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/invite`));
      const invite = tokenFrom(mailer.sent.at(-1)!.text);
      const laptop = new Client(env);
      await laptop.login('ayse.teacher');

      const code = await start(s.teacherA, mailer, 'ayse.new@school.example');
      await ok(s.teacherA.post(CONFIRM, { code }));

      expect((await laptop.get('/api/auth/me')).status).toBe(401);
      expect(await ownEmail(s.teacherA)).toBe('ayse.new@school.example');
      expect((await s.teacherB.get('/api/auth/me')).status).toBe(200); // other people are not touched
      expect(reason(await new Client(env).post('/api/auth/password-reset/complete', { token: reset, newPassword: 'a-new-password-123' }))).toBe('RESET_TOKEN_INVALID');
      expect(reason(await new Client(env).post('/api/auth/invite/inspect', { token: invite }))).toBe('INVITE_INVALID');
      expect(row(s.ayse.id)).toMatchObject({ googleSub: null, ssoSub: null, email: 'ayse.new@school.example' });
      expect(env.db.select().from(mcpTokens).where(eq(mcpTokens.id, token.id)).get()!.revokedAt).not.toBeNull();
      const revoked = env.db.$client.prepare("select after_json a from audit_events where action = 'mcp_token.revoke_all'").get() as { a: string };
      expect(JSON.parse(revoked.a)).toMatchObject({ reason: 'email_change' });
      // The password still works; a reset to the new address does.
      await new Client(env).login('ayse.teacher');
      await ok(new Client(env).post('/api/auth/password-reset/request', { email: 'ayse.new@school.example' }));
      expect(mailer.sent.at(-1)!.to).toBe('ayse.new@school.example');
    } finally {
      await setAi(s.admin, { mcpEnabled: false });
    }
  });

  it('answers the same whether or not another account uses the address; accounts may share one', async () => {
    const { s, mailer } = await school();
    const used = await s.teacherA.post(START, { currentPassword: PASSWORD, email: 'mehmet@school.example' });
    const code = codeFrom(mailer.sent.at(-1)!.text);
    const unused = await s.teacherA.post(START, { currentPassword: PASSWORD, email: 'nobody@school.example' });
    expect(used.status).toBe(200);
    expect(used.body).toEqual(unused.body);
    expect(used.body).toEqual({ ok: true });
    // The code sent to Mehmet's mailbox stopped working when a newer one was asked for; the newer one works.
    expect(reason(await s.teacherA.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    await ok(s.teacherA.post(CONFIRM, { code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect(await ownEmail(s.teacherA)).toBe('nobody@school.example');
    expect(row(s.mehmet.id).email).toBe('mehmet@school.example');
  });

  it('is refused when email is not set up on the server', async () => {
    const { s } = await school(false);
    expect(reason(await s.teacherA.post(START, { currentPassword: PASSWORD, email: 'ayse.new@school.example' }))).toBe('SMTP_NOT_CONFIGURED');
    expect(reason(await s.teacherA.post(START, { email: 'ayse.new@school.example' }))).toBe('SMTP_NOT_CONFIGURED');
    expect(reason(await s.teacherA.post(CONFIRM, { code: '123456' }))).toBe('SMTP_NOT_CONFIGURED');
    // The administrator still changes addresses.
    expect((await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse.new@school.example' }))).email).toBe('ayse.new@school.example');
  });

  it('an administrator’s own address no longer changes through Admin → Accounts → Edit; other accounts still do', async () => {
    const { s, mailer } = await school();
    expect(reason(await s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: 'root.typo@school.example' }))).toBe('OWN_EMAIL');
    expect(reason(await s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: null }))).toBe('OWN_EMAIL');
    expect(row(s.adminUser.id).email).toBe('root@school.example');
    // An own account without an address may get its first one here (nothing to lose; the fixture does this too).
    env.db.update(users).set({ email: null }).where(eq(users.id, s.adminUser.id)).run();
    expect((await ok(s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { email: 'root@school.example' }))).email).toBe('root@school.example');
    // The rest of the own row, and the same address, still save.
    expect((await ok(s.admin.patch(`/api/admin/users/${s.adminUser.id}`, { displayName: 'Kök Yönetici', email: 'ROOT@school.example' }))).displayName).toBe('Kök Yönetici');
    // Someone else's address: the recovery path when a mailbox is lost. Unverified until proven.
    const ayse = await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse.new@school.example' }));
    expect(ayse).toMatchObject({ email: 'ayse.new@school.example', emailVerified: false });
    // The administrator changes the own address in Profile.
    const code = await start(s.admin, mailer, 'root.new@school.example');
    await ok(s.admin.post(CONFIRM, { code }));
    expect(await ownEmail(s.admin)).toBe('root.new@school.example');
  });

  it('works with a fresh sign-in as re-authentication while passwords are off (D-207)', async () => {
    const { s, mailer } = await school();
    await passwordsOff(s, mailer);
    const signIn = (address: string) => emailSignIn(mailer, address);
    // An old session (signed in with a password before the switch) is not fresh.
    expect(reason(await s.teacherA.post(START, { email: 'ayse.new@school.example' }))).toBe('REAUTH_REQUIRED');
    const c = await signIn('ayse@school.example');
    env.clock.advance(16 * 60 * 1000);
    expect(reason(await c.post(START, { email: 'ayse.new@school.example' }))).toBe('REAUTH_REQUIRED');

    const fresh = await signIn('ayse@school.example');
    expect((await ok(fresh.get('/api/auth/me'))).reauthFresh).toBe(true);
    await ok(fresh.post(START, { email: 'ayse.new@school.example' }));
    expect(mailer.sent.at(-1)!.to).toBe('ayse.new@school.example');
    await ok(fresh.post(CONFIRM, { code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect(await ownEmail(fresh)).toBe('ayse.new@school.example');
    expect((await c.get('/api/auth/me')).status).toBe(401);
    // From now on sign-in mail goes to the new address only.
    const before = mailer.sent.length;
    await ok(new Client(env).post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
    expect(mailer.sent).toHaveLength(before);
    await signIn('ayse.new@school.example');
    expect(audits('auth.email_change')).toBe(1);
  });

  // ---------------------------------------------------------------- security review
  it('the public code endpoint never signs in with a change, method or policy code, whatever request id is sent', async () => {
    const { s, mailer } = await school();
    // Method code (switching to email links) for Mehmet and policy code for the administrator, both on password accounts.
    await ok(s.teacherB.post('/api/auth/sign-in-method/email-link/start', { currentPassword: PASSWORD }));
    const methodCode = codeFrom(mailer.sent.at(-1)!.text);
    const mehmetSession = sessionOf(s.mehmet.id);
    await ok(s.admin.post('/api/admin/sign-in-policy/code'));
    const policyCode = codeFrom(mailer.sent.at(-1)!.text);
    const adminSession = sessionOf(s.adminUser.id);
    // As if both had become email-link accounts in the meantime: before the review, the binding string
    // as the request id would have signed them in.
    env.db.update(users).set({ signInMethod: 'email_link', passwordHash: '' }).where(eq(users.id, s.mehmet.id)).run();
    env.db.update(users).set({ signInMethod: 'email_link', passwordHash: '' }).where(eq(users.id, s.adminUser.id)).run();
    const anon = new Client(env);
    for (const [requestId, code] of [[`switch:${mehmetSession}`, methodCode], [`policy:${adminSession}`, policyCode], ['', methodCode], ['', policyCode]] as const) {
      const r = await anon.post('/api/auth/email-link/code', { requestId: requestId || ANY_ID, code });
      expect(reason(r)).toBe('SIGNIN_CODE_INVALID');
    }
    expect(anon.cookies.size).toBe(0);
    // The rows were not even looked at: no try counted.
    expect(codeRows(s.mehmet.id, 'email_method')).toEqual([{ u: null, a: 0 }]);
    expect(codeRows(s.adminUser.id, 'email_policy')).toEqual([{ u: null, a: 0 }]);
  });

  it('the change code of an email-link account does not sign anyone in through the public endpoints', async () => {
    const { s, mailer } = await school();
    await passwordsOff(s, mailer);
    const fresh = await emailSignIn(mailer, 'ayse@school.example');
    await ok(fresh.post(START, { email: 'ayse.new@school.example' }));
    const code = codeFrom(mailer.sent.at(-1)!.text);
    const sid = sessionOf(s.ayse.id);
    const pending = JSON.parse(openSecret(env.config.SECRET_PEPPER, 'email-change', sid, fresh.cookies.get(EMAIL_CHANGE_COOKIE))!);
    const anon = new Client(env);
    const ids = [`emailchange:${sid}:${pending.nonce}:${pending.email}`, sid, pending.nonce, 'ayse.new@school.example', ANY_ID];
    for (const requestId of ids) expect(reason(await anon.post('/api/auth/email-link/code', { requestId, code }))).toBe('SIGNIN_CODE_INVALID');
    expect(anon.cookies.size).toBe(0);
    expect(codeRows(s.ayse.id, 'email_change')).toEqual([{ u: null, a: 0 }]);
    // Whoever reads the new mailbox and asks for a sign-in link for it gets nothing: no account has it yet.
    const before = mailer.sent.length;
    await ok(anon.post('/api/auth/email-link/request', { email: 'ayse.new@school.example' }));
    expect(mailer.sent).toHaveLength(before);
    // The code still does what it is for.
    await ok(fresh.post(CONFIRM, { code }));
    expect(await ownEmail(fresh)).toBe('ayse.new@school.example');
  });

  it('anonymous sign-in requests for the address neither block, cancel nor lock a change', async () => {
    const { s, mailer } = await school();
    await passwordsOff(s, mailer);
    const fresh = await emailSignIn(mailer, 'ayse@school.example');
    const stranger = new Client(env);
    stranger.ip = '203.0.113.7';
    // Before the start: the public limit of three sign-in emails is used up by someone else.
    for (let i = 0; i < 3; i++) await ok(stranger.post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
    await ok(fresh.post(START, { email: 'ayse.new@school.example' }));
    const code = codeFrom(mailer.sent.at(-1)!.text);
    expect(mailer.sent.at(-1)!.to).toBe('ayse.new@school.example');
    // Between start and confirm: more requests (which would void older codes) and ten wrong public codes (which lock the public code path).
    const asked = [];
    for (let i = 0; i < 3; i++) asked.push((await ok(stranger.post('/api/auth/email-link/request', { email: 'ayse@school.example' }))).requestId);
    for (let i = 0; i < 10; i++) await stranger.post('/api/auth/email-link/code', { requestId: asked[0], code: otherCode(code) });
    expect(codeRows(s.ayse.id, 'email_change')).toEqual([{ u: null, a: 0 }]);
    await ok(fresh.post(CONFIRM, { code }));
    expect(await ownEmail(fresh)).toBe('ayse.new@school.example');
  });

  it('an administrator’s address edit, a deactivation and a password reset between start and confirm each end the pending code', async () => {
    const { s, mailer } = await school();
    // The administrator edits the address: the code dies (the session stays, so confirm is answered).
    let code = await start(s.teacherA, mailer, 'ayse.new@school.example');
    await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse.lost@school.example' }));
    expect(codeRows(s.ayse.id, 'email_change').at(-1)!.u).not.toBeNull();
    expect(reason(await s.teacherA.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    expect(row(s.ayse.id).email).toBe('ayse.lost@school.example');

    // The administrator resets the password.
    code = await start(s.teacherA, mailer, 'ayse.new@school.example');
    const { temporaryPassword } = await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/reset-password`));
    expect(codeRows(s.ayse.id, 'email_change').at(-1)!.u).not.toBeNull();
    const again = new Client(env);
    await again.login('ayse.teacher', temporaryPassword);
    await ok(again.post('/api/auth/password', { currentPassword: temporaryPassword, newPassword: PASSWORD }));
    expect(reason(await again.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');

    // A reset by email link (the person's own).
    code = await start(again, mailer, 'ayse.new@school.example');
    await ok(new Client(env).post('/api/auth/password-reset/request', { email: 'ayse.lost@school.example' }));
    await ok(new Client(env).post('/api/auth/password-reset/complete', { token: tokenFrom(mailer.sent.at(-1)!.text), newPassword: 'another-password-456' }));
    expect(codeRows(s.ayse.id, 'email_change').at(-1)!.u).not.toBeNull();

    // A deactivation (after the 15 minutes: address-change codes have their own limit of three).
    env.clock.advance(16 * 60 * 1000);
    const after = new Client(env);
    await after.login('ayse.teacher', 'another-password-456');
    await ok(after.post(START, { currentPassword: 'another-password-456', email: 'ayse.new@school.example' }));
    code = codeFrom(mailer.sent.at(-1)!.text);
    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    expect(codeRows(s.ayse.id, 'email_change').at(-1)!.u).not.toBeNull();
    expect((await after.post(CONFIRM, { code })).status).toBe(401);
    expect(row(s.ayse.id).email).toBe('ayse.lost@school.example');
    expect(audits('auth.email_change')).toBe(0);
  });

  it('after signing out, the old cookie and code do nothing in a new session', async () => {
    const { s, mailer } = await school();
    const code = await start(s.teacherA, mailer, 'ayse.new@school.example');
    const cookie = s.teacherA.cookies.get(EMAIL_CHANGE_COOKIE)!;
    await ok(s.teacherA.post('/api/auth/logout'));
    expect((await s.teacherA.post(CONFIRM, { code })).status).toBe(401);
    const next = new Client(env);
    await next.login('ayse.teacher');
    next.cookies.set(EMAIL_CHANGE_COOKIE, cookie);
    expect(await ok(next.get(OWN))).toEqual({ email: 'ayse@school.example', pendingTo: null });
    expect(reason(await next.post(CONFIRM, { code }))).toBe('SIGNIN_CODE_INVALID');
    expect(row(s.ayse.id).email).toBe('ayse@school.example');
  });

  it('a locked classroom screen never receives the address: not from any user or classroom endpoint (PIN-8)', async () => {
    const { s } = await school();
    const t = s.teacherA;
    await ok(t.post('/api/auth/pin', { currentPassword: PASSWORD, pin: '2468' }));
    await ok(t.post('/api/classroom/enter'));
    expect((await ok(t.get('/api/auth/me'))).pinUnlocked).toBe(false);
    expect((await t.get(OWN)).status).toBe(423);
    const DUMMY = '0190f0f0-0000-7000-8000-000000000000';
    const seen = new Set<string>();
    const targets = registeredEndpoints.filter((e) => {
      const k = `${e.method} ${e.path}`;
      if (seen.has(k) || (e.access !== 'user' && e.access !== 'classroom') || e.path === '/api/auth/logout') return false;
      seen.add(k);
      return true;
    });
    expect(targets.length).toBeGreaterThan(10);
    const leaks: string[] = [];
    for (const e of targets) {
      const url = e.path.replace(/:([A-Za-z0-9_]+)/gu, (_m, k: string) => (k === 'module' ? 'routines' : k === 'classId' ? s.c3a.id : DUMMY));
      const r = await t.req(e.method, url, e.method === 'GET' ? undefined : {});
      if (JSON.stringify(r.body ?? '').includes('ayse@school.example')) leaks.push(`${e.method} ${e.path}`);
    }
    expect(leaks).toEqual([]);
  });
});
