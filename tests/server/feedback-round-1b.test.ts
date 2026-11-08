/**
 * S13b feedback round 1b (D-105..D-110): account invites and email-link sign-in, deleting students
 * (remove from class, permanent erasure), teacher class display settings, weather, the importer's sheet
 * picker and the teacher's time's-up clip. Test clock: Monday 2026-11-09, Europe/Istanbul. Fictional
 * data only; email goes to a fake transport.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../src/server/db/schema.ts';
import { clearWeatherCache, WEATHER_TIMEOUT_MS, type CurrentWeather } from '../../src/server/modules/weather/service.ts';
import { Client, FakeMailer, makeEnv, type TestEnv } from '../helpers.ts';
import { multipart } from '../import-fixtures.ts';
import { cmd, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

let env: TestEnv;
afterEach(async () => env?.app.close());

const SMTP = { SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' };
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)/u.exec(text)![1]!;
const codeFrom = (text: string) => /\n(\d{6})\n/u.exec(text)![1]!;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const audits = (action: string) => count('select count(*) n from audit_events where action = ?', action);

async function smtpSchool() {
  const mailer = new FakeMailer();
  env = await makeEnv(SMTP, { mailer });
  return { mailer, s: await buildSchool(env) };
}

async function invite(s: School, body: Record<string, unknown>) {
  return ok(s.admin.post('/api/admin/users', { displayName: 'Zehra Öğretmen', role: 'teacher', ...body }));
}

describe('account invites (S13b item 9, D-108)', () => {
  it('creates an account with a single-use invite that is emailed; the teacher picks a password and is signed in', async () => {
    const { mailer, s } = await smtpSchool();
    const made = await invite(s, { login: 'zehra.teacher', email: 'zehra@school.example', locale: 'tr' });
    expect(made.temporaryPassword).toBeNull();
    expect(made.invite).toMatchObject({ emailed: true });
    expect(made.user).toMatchObject({ invitePending: true, signInMethod: 'password', emailVerified: false });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toBe('Sınıf Pusulası: hesabınız hazır'); // the account's interface language
    const token = tokenFrom(mailer.sent[0]!.text);
    expect(tokenFrom(made.invite.link)).toBe(token);
    // Nobody can sign in before the invite is used (no password yet).
    expect((await new Client(env).post('/api/auth/login', { login: 'zehra.teacher', password: '' })).status).toBe(400);
    const c = new Client(env);
    const info = await ok(c.post('/api/auth/invite/inspect', { token }));
    expect(info).toMatchObject({ displayName: 'Zehra Öğretmen', locale: 'tr', role: 'teacher', emailLinkAllowed: true, emailLinkAvailable: true });
    // Inspecting twice does not use it up.
    await ok(c.post('/api/auth/invite/inspect', { token }));
    expect((await c.post('/api/auth/invite/accept', { token, method: 'password' })).body.error.details.reason).toBe('PASSWORD_REQUIRED');
    const done = await ok(c.post('/api/auth/invite/accept', { token, method: 'password', password: 'zehra-new-password' }));
    expect(done.status).toBe('signed_in');
    expect(done.me).toMatchObject({ displayName: 'Zehra Öğretmen', locale: 'tr', hasPin: false, signInMethod: 'password', mustChangePassword: false });
    // Signed in: the PIN comes next (still required, PIN-1).
    expect((await c.post('/api/auth/pin', { currentPassword: 'zehra-new-password', pin: '2468' })).status).toBe(200);
    // Single use.
    expect((await new Client(env).post('/api/auth/invite/accept', { token, method: 'password', password: 'another-password' })).body.error.details.reason).toBe('INVITE_INVALID');
    expect((await new Client(env).post('/api/auth/invite/inspect', { token })).status).toBe(400);
    await new Client(env).login('zehra.teacher', 'zehra-new-password');
    const row = env.db.select().from(users).all().find((u) => u.login === 'zehra.teacher')!;
    expect(row.emailVerifiedAt).not.toBeNull(); // the emailed invite proved the address
    expect(audits('auth.invite_accept')).toBe(1);
    expect(JSON.stringify(env.db.$client.prepare('select * from audit_events').all())).not.toContain(token);
  });

  it('expires after 7 days, can be revoked, and a new invite replaces the old one', async () => {
    const { s } = await smtpSchool();
    const made = await invite(s, { login: 'emre.teacher', email: 'emre@school.example' });
    const first = tokenFrom(made.invite.link);
    // Only admins manage invites.
    expect((await s.teacherA.post(`/api/admin/users/${made.user.id}/invite`)).status).toBe(403);
    const again = await ok(s.admin.post(`/api/admin/users/${made.user.id}/invite`));
    const second = tokenFrom(again.invite.link);
    expect((await new Client(env).post('/api/auth/invite/inspect', { token: first })).status).toBe(400);
    await ok(new Client(env).post('/api/auth/invite/inspect', { token: second }));
    const revoked = await ok(s.admin.post(`/api/admin/users/${made.user.id}/invite/revoke`));
    expect(revoked.invitePending).toBe(false);
    expect((await new Client(env).post('/api/auth/invite/inspect', { token: second })).status).toBe(400);
    const third = tokenFrom((await ok(s.admin.post(`/api/admin/users/${made.user.id}/invite`))).invite.link);
    env.clock.advance(7 * 24 * 3600_000 + 1);
    expect((await new Client(env).post('/api/auth/invite/accept', { token: third, method: 'password', password: 'late-password-123' })).body.error.details.reason).toBe('INVITE_INVALID');
    expect(audits('auth.invite_revoke')).toBe(1);
  });

  it('choosing email-link removes password sign-in; admins must keep passwords; without SMTP the option is disabled', async () => {
    const { s } = await smtpSchool();
    const made = await invite(s, { login: 'deniz.teacher', email: 'deniz@school.example' });
    const token = tokenFrom(made.invite.link);
    const c = new Client(env);
    const done = await ok(c.post('/api/auth/invite/accept', { token, method: 'email_link' }));
    expect(done.me).toMatchObject({ signInMethod: 'email_link', reauthFresh: true });
    // No password exists, so password sign-in never works.
    expect((await new Client(env).post('/api/auth/login', { login: 'deniz.teacher', password: 'anything-at-all' })).status).toBe(401);
    // A fresh email sign-in counts as re-authentication for the PIN.
    expect((await c.post('/api/auth/pin', { pin: '1357' })).status).toBe(200);
    env.clock.advance(16 * 60_000);
    expect((await c.post('/api/auth/pin', { pin: '1358' })).body.error.details.reason).toBe('REAUTH_REQUIRED');

    const adminInvite = await invite(s, { login: 'new.admin', email: 'boss@school.example', role: 'admin' });
    const at = tokenFrom(adminInvite.invite.link);
    expect(await ok(new Client(env).post('/api/auth/invite/inspect', { token: at }))).toMatchObject({ emailLinkAllowed: false, emailLinkAvailable: false });
    expect((await new Client(env).post('/api/auth/invite/accept', { token: at, method: 'email_link' })).body.error.details.reason).toBe('ADMIN_PASSWORD_REQUIRED');

    // Without SMTP (test VM): shown as unavailable with a reason, and refused.
    await env.app.close();
    env = await makeEnv({}, { mailer: null });
    const s2 = await buildSchool(env);
    const noMail = await ok(s2.admin.post('/api/admin/users', { login: 'ece.teacher', displayName: 'Ece', role: 'teacher', email: 'ece@school.example' }));
    expect(noMail.invite.emailed).toBe(false);
    const t2 = tokenFrom(noMail.invite.link);
    expect(await ok(new Client(env).post('/api/auth/invite/inspect', { token: t2 }))).toMatchObject({ emailLinkAllowed: true, emailLinkAvailable: false, emailLinkUnavailableReason: 'SMTP_NOT_CONFIGURED' });
    expect((await new Client(env).post('/api/auth/invite/accept', { token: t2, method: 'email_link' })).body.error.details.reason).toBe('SMTP_NOT_CONFIGURED');
    expect(await ok(new Client(env).get('/api/auth/password-reset'))).toEqual({ emailResetEnabled: false, emailLinkEnabled: false });
  });

  it('changing the email revokes an invite (and sign-in links) mailed to the old address and clears the verified mark', async () => {
    const { mailer, s } = await smtpSchool();
    // A typo: the invite goes to the wrong mailbox.
    const made = await invite(s, { login: 'typo.teacher', email: 'wrong@school.example' });
    const mailed = tokenFrom(mailer.sent[0]!.text);
    expect(mailer.sent[0]!.to).toBe('wrong@school.example');
    const fixed = await ok(s.admin.patch(`/api/admin/users/${made.user.id}`, { email: 'right@school.example' }));
    expect(fixed).toMatchObject({ invitePending: false, emailVerified: false });
    expect((await new Client(env).post('/api/auth/invite/accept', { token: mailed, method: 'password', password: 'taken-over-123' })).body.error.details.reason).toBe('INVITE_INVALID');
    // A new invite to the right address works and proves that address.
    const again = await ok(s.admin.post(`/api/admin/users/${made.user.id}/invite`));
    expect(mailer.sent.at(-1)!.to).toBe('right@school.example');
    await ok(new Client(env).post('/api/auth/invite/accept', { token: tokenFrom(again.invite.link), method: 'email_link' }));
    expect(env.db.select().from(users).where(eq(users.id, made.user.id)).get()!.emailVerifiedAt).not.toBeNull();
    // A sign-in link mailed before the next change stops working too, and the mark is cleared again.
    await ok(new Client(env).post('/api/auth/email-link/request', { email: 'right@school.example' }));
    const link = tokenFrom(mailer.sent.at(-1)!.text);
    expect((await ok(s.admin.patch(`/api/admin/users/${made.user.id}`, { email: 'other@school.example' }))).emailVerified).toBe(false);
    expect((await new Client(env).post('/api/auth/email-link/complete', { token: link })).body.error.details.reason).toBe('SIGNIN_LINK_INVALID');
  });

  it('deactivating an account or resetting its password revokes a pending invite; reactivation does not bring it back', async () => {
    const { s } = await smtpSchool();
    const made = await invite(s, { login: 'gone.teacher', email: 'gone@school.example' });
    const token = tokenFrom(made.invite.link);
    await ok(s.admin.post(`/api/admin/users/${made.user.id}/deactivate`));
    await ok(s.admin.post(`/api/admin/users/${made.user.id}/reactivate`));
    expect((await new Client(env).post('/api/auth/invite/accept', { token, method: 'password', password: 'back-again-123' })).body.error.details.reason).toBe('INVITE_INVALID');
    const second = tokenFrom((await ok(s.admin.post(`/api/admin/users/${made.user.id}/invite`))).invite.link);
    await ok(s.admin.post(`/api/admin/users/${made.user.id}/reset-password`));
    expect((await new Client(env).post('/api/auth/invite/inspect', { token: second })).body.error.details.reason).toBe('INVITE_INVALID');
    expect((await ok(s.admin.get('/api/admin/users'))).users.find((u: any) => u.id === made.user.id).invitePending).toBe(false);
  });

  it('the temporary-password flow stays available as a fallback', async () => {
    env = await makeEnv();
    const s = await buildSchool(env);
    const made = await ok(s.admin.post('/api/admin/users', { login: 'temp.teacher', displayName: 'Temp', role: 'teacher', setup: 'temporary_password' }));
    expect(made.invite).toBeNull();
    expect(typeof made.temporaryPassword).toBe('string');
    expect((await new Client(env).login('temp.teacher', made.temporaryPassword)).body.mustChangePassword).toBe(true);
  });
});

describe('email-link sign-in (S13b item 9, D-108)', () => {
  async function emailTeacher() {
    const { mailer, s } = await smtpSchool();
    const made = await invite(s, { login: 'deniz.teacher', email: 'deniz@school.example' });
    await ok(new Client(env).post('/api/auth/invite/accept', { token: tokenFrom(made.invite.link), method: 'email_link' }));
    mailer.sent.length = 0;
    return { mailer, s, userId: made.user.id as string };
  }

  it('sends a single-use link valid 15 minutes; GET never uses it (the landing page POSTs)', async () => {
    const { mailer } = await emailTeacher();
    const c = new Client(env);
    const asked = await ok(c.post('/api/auth/email-link/request', { email: 'Deniz@School.example' }));
    expect(asked).toMatchObject({ ok: true });
    expect(mailer.sent).toHaveLength(1);
    const token = tokenFrom(mailer.sent[0]!.text);
    // A mail scanner fetching the link only gets the static page: the token is in the fragment and no GET route uses it.
    expect((await c.get(`/signin-link#token=${token}`)).status).not.toBe(500);
    expect((await c.get(`/api/auth/email-link/complete?token=${token}`)).status).toBe(404);
    const me = await ok(c.post('/api/auth/email-link/complete', { token }));
    expect(me).toMatchObject({ signInMethod: 'email_link', reauthFresh: true });
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await new Client(env).post('/api/auth/email-link/complete', { token })).body.error.details.reason).toBe('SIGNIN_LINK_INVALID');
    // Expiry.
    await ok(new Client(env).post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
    const late = tokenFrom(mailer.sent[1]!.text);
    env.clock.advance(15 * 60_000 + 1);
    expect((await new Client(env).post('/api/auth/email-link/complete', { token: late })).status).toBe(401);
    const logins = env.db.$client.prepare("select after_json a from audit_events where action = 'auth.login'").all() as Array<{ a: string }>;
    expect(logins.some((l) => l.a.includes('email_link'))).toBe(true);
  });

  it('the 6-digit code works on the device that asked (bound to its request), 5 tries at most', async () => {
    const { mailer } = await emailTeacher();
    const pc = new Client(env);
    const { requestId } = await ok(pc.post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
    const code = codeFrom(mailer.sent[0]!.text);
    // Another device's request id does not fit the code.
    const other = await ok(new Client(env).post('/api/auth/email-link/request', { email: 'nobody@school.example' }));
    expect((await new Client(env).post('/api/auth/email-link/code', { requestId: other.requestId, code })).status).toBe(401);
    const wrong = code === '000000' ? '111111' : '000000';
    const r1 = await pc.post('/api/auth/email-link/code', { requestId, code: wrong });
    expect(r1.body.error.details).toMatchObject({ reason: 'SIGNIN_CODE_INVALID', attemptsLeft: 4 });
    const me = await ok(pc.post('/api/auth/email-link/code', { requestId, code }));
    expect(me.signInMethod).toBe('email_link');
    // Single use.
    expect((await new Client(env).post('/api/auth/email-link/code', { requestId, code })).status).toBe(401);
    // Five wrong tries kill the code.
    env.clock.advance(16 * 60_000);
    const again = await ok(new Client(env).post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
    const good = codeFrom(mailer.sent[1]!.text);
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await new Client(env).post('/api/auth/email-link/code', { requestId: again.requestId, code: bad });
    expect((await new Client(env).post('/api/auth/email-link/code', { requestId: again.requestId, code: good })).status).toBe(401);
  });

  it('two accounts with the same address each get a code for the same request; each code signs in its own account', async () => {
    const { mailer, s } = await emailTeacher();
    const twin = await invite(s, { login: 'deniz.twin', displayName: 'Deniz İkiz', email: 'deniz@school.example' });
    await ok(new Client(env).post('/api/auth/invite/accept', { token: tokenFrom(twin.invite.link), method: 'email_link' }));
    mailer.sent.length = 0;
    const pc = new Client(env);
    const { requestId } = await ok(pc.post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
    expect(mailer.sent).toHaveLength(2);
    const codes = mailer.sent.map((m) => codeFrom(m.text));
    // Whichever row the database returns first, the second account's code works for the second account.
    const me = await ok(pc.post('/api/auth/email-link/code', { requestId, code: codes[1]! }));
    const names = mailer.sent.map((m) => (m.text.includes('Deniz İkiz') ? 'Deniz İkiz' : 'Zehra Öğretmen'));
    expect(new Set(names).size).toBe(2);
    expect(me.displayName).toBe(names[1]);
    // The other account's code still works on its own.
    const me2 = await ok(new Client(env).post('/api/auth/email-link/code', { requestId, code: codes[0]! }));
    expect(me2.displayName).toBe(names[0]);
  });

  it('wrong codes are counted per account across codes: after 10 the code path closes, the emailed link still works', async () => {
    const { mailer } = await emailTeacher();
    const ask = async () => {
      const r = await ok(new Client(env).post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
      const text = mailer.sent.at(-1)!.text;
      return { requestId: r.requestId as string, code: codeFrom(text), token: tokenFrom(text) };
    };
    const guess = async (requestId: string, code: string) => new Client(env).post('/api/auth/email-link/code', { requestId, code });
    const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
    // Two codes, five wrong guesses each = 10 failures for the account.
    for (let round = 0; round < 2; round++) {
      const a = await ask();
      for (let i = 0; i < 5; i++) expect((await guess(a.requestId, wrongFor(a.code))).status).toBe(401);
    }
    // A fresh code is refused even when it is right; the last failure says no tries are left.
    const third = await ask();
    const refused = await guess(third.requestId, third.code);
    expect(refused.status).toBe(401);
    expect(refused.body.error.details).toMatchObject({ reason: 'SIGNIN_CODE_INVALID', attemptsLeft: 0 });
    // A day later it would open again; the emailed link works right away and resets the count.
    expect(await ok(new Client(env).post('/api/auth/email-link/complete', { token: third.token }))).toMatchObject({ signInMethod: 'email_link' });
    env.clock.advance(16 * 60_000);
    const fourth = await ask();
    expect((await ok(new Client(env).post('/api/auth/email-link/code', { requestId: fourth.requestId, code: fourth.code }))).signInMethod).toBe('email_link');
  });

  it('answers the same for unknown, password and admin accounts (no enumeration) and limits emails per account', async () => {
    const { mailer } = await emailTeacher();
    const shape = (b: any) => Object.keys(b).sort();
    const a = await ok(new Client(env).post('/api/auth/email-link/request', { email: 'nobody@school.example' }));
    const b = await ok(new Client(env).post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
    expect(shape(a)).toEqual(shape(b));
    expect(a.requestId).not.toBe(b.requestId);
    expect(mailer.sent).toHaveLength(1);
    // Password accounts never get a link.
    for (let i = 0; i < 4; i++) await ok(new Client(env).post('/api/auth/email-link/request', { email: 'deniz@school.example' }));
    expect(mailer.sent.length).toBeLessThanOrEqual(3); // 3 per account per 15 minutes
  });

  it('per-address rate limit on the request route', async () => {
    await emailTeacher();
    const c = new Client(env);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await c.post('/api/auth/email-link/request', { email: `x${i}@school.example` })).status);
    expect(statuses).toContain(429);
  });

  it('is off without SMTP: no email, same answer', async () => {
    const mailer = new FakeMailer();
    env = await makeEnv({}, { mailer });
    await buildSchool(env);
    expect(await ok(new Client(env).post('/api/auth/email-link/request', { email: 'a@b.example' }))).toMatchObject({ ok: true });
    expect(mailer.sent).toHaveLength(0);
  });

  it('switching method needs re-authentication: password + emailed code to email-link, fresh email sign-in back to password', async () => {
    const { mailer, s } = await smtpSchool();
    env.db.update(users).set({ email: 'ayse@school.example' }).where(eqLogin('ayse.teacher')).run();
    expect((await s.teacherA.post('/api/auth/sign-in-method/email-link/start', { currentPassword: 'wrong-password' })).body.error.details.reason).toBe('WRONG_PASSWORD');
    await ok(s.teacherA.post('/api/auth/sign-in-method/email-link/start', { currentPassword: 'correct-horse-battery' }));
    const code = codeFrom(mailer.sent.at(-1)!.text);
    const me = await ok(s.teacherA.post('/api/auth/sign-in-method/email-link/confirm', { code }));
    expect(me.signInMethod).toBe('email_link');
    expect((await new Client(env).post('/api/auth/login', { login: 'ayse.teacher', password: 'correct-horse-battery' })).status).toBe(401);
    // Back to a password: this session was signed in with a password long ago → re-auth required.
    expect((await s.teacherA.post('/api/auth/sign-in-method/password', { newPassword: 'brand-new-password' })).body.error.details.reason).toBe('REAUTH_REQUIRED');
    const phone = new Client(env);
    const { requestId } = await ok(phone.post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
    await ok(phone.post('/api/auth/email-link/code', { requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect((await ok(phone.post('/api/auth/sign-in-method/password', { newPassword: 'brand-new-password' }))).signInMethod).toBe('password');
    await new Client(env).login('ayse.teacher', 'brand-new-password');
    expect(audits('auth.method_change')).toBe(2);
    // Admins cannot switch to email links.
    env.db.update(users).set({ email: 'root@school.example' }).where(eqLogin('root.admin')).run();
    expect((await s.admin.post('/api/auth/sign-in-method/email-link/start', { currentPassword: 'correct-horse-battery' })).body.error.details.reason).toBe('ADMIN_PASSWORD_REQUIRED');
  });

  it('Maintenance warns about email-link accounts when SMTP is not configured', async () => {
    env = await makeEnv();
    const s = await buildSchool(env);
    expect((await ok(s.admin.get('/api/admin/maintenance'))).emailLinkAccountsWithoutSmtp).toBe(0);
    env.db.update(users).set({ signInMethod: 'email_link', passwordHash: '' }).where(eqLogin('mehmet.teacher')).run();
    expect((await ok(s.admin.get('/api/admin/maintenance'))).emailLinkAccountsWithoutSmtp).toBe(1);
    // The admin's way out: a temporary password (or a new invite) makes it a password account again.
    const u = env.db.select().from(users).all().find((x) => x.login === 'mehmet.teacher')!;
    await ok(s.admin.post(`/api/admin/users/${u.id}/reset-password`));
    expect((await ok(s.admin.get('/api/admin/maintenance'))).emailLinkAccountsWithoutSmtp).toBe(0);
  });
});

const READING = '00000000-0000-7000-8000-00000000c001';
const eqLogin = (login: string) => eq(users.login, login);

// ---------------------------------------------------------------- deleting students
describe('deleting students (S13b item 7, D-109)', () => {
  it('a teacher removes a student from the class: enrolment ends, history stays; other teachers cannot', async () => {
    env = await makeEnv();
    const s = await buildSchool(env);
    const ada = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ada Yılmaz' });
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Barış Kaya' });
    const lessonId = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId, studentId: ada.id, status: 'late' });
    expect((await s.teacherB.post(`/api/teacher/classes/${s.c3a.id}/students/${ada.id}/remove`)).status).toBe(403);
    await ok(s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students/${ada.id}/remove`));
    const roster = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    expect(roster.students.map((x: any) => x.fullName)).toEqual(['Barış Kaya']);
    expect(count('select count(*) n from attendance_daily where student_id = ?', ada.id)).toBe(1);
    expect(count('select count(*) n from students where id = ? and deactivated_at is null', ada.id)).toBe(1);
    expect(audits('student.remove_from_class')).toBe(1);
    expect((await s.teacherA.post(`/api/teacher/classes/${s.c3a.id}/students/${ada.id}/remove`)).status).toBe(404);
  });

  it('permanent deletion: dry run, typed confirmation, admin only, and nothing identifying remains in the database or uploads', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-erase-'));
    const uploadsDir = path.join(root, 'uploads');
    env = await makeEnv({ uploadsDir, ocrCacheDir: path.join(root, 'ocr') });
    const s = await buildSchool(env);
    // Ada and Bora come from an uploaded class list: the spreadsheet names them, so erasing Ada must remove it too.
    const csv = multipart(Buffer.from(['Öğrenci No;Adı Soyadı', '4711;Ada Zümrüt Yılmaz', '4712;Bora Kurgu', ''].join('\n'), 'utf8'), 'sinif-3a.csv', 'text/csv');
    const upload = await ok(s.teacherA.req('POST', '/api/files?kind=import_source', csv.body, csv.headers));
    const batch = await ok(s.teacherA.post('/api/import/batches', { classId: s.c3a.id, fileId: upload.id }));
    await ok(s.teacherA.post(`/api/import/batches/${batch.id}/commit`, {}));
    const imported = (await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`))).students as Array<{ id: string; fullName: string }>;
    const ada = imported.find((x) => x.fullName === 'Ada Zümrüt Yılmaz')!;
    const bora = imported.find((x) => x.fullName === 'Bora Kurgu')!;
    expect(ada).toBeTruthy();
    expect(count('select count(*) n from students where id = ? and student_number = ?', ada.id, '4711')).toBe(1);
    for (const n of ['Cem Demir', 'Deniz Şahin', 'Ece Çelik']) await addStudent(s.teacherA, s.c3a.id, { fullName: n });
    // A lesson with attendance and groups, a counter tap, a goal with evidence and a document file, a personal link.
    const lessonId = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId, studentId: ada.id, status: 'late' });
    const arr = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/grouping/arrangements`));
    await cmd(s.teacherA, 'grouping.apply', { contextId: s.ctxA.id, lessonId, templateId: arr.arrangements[2].id });
    const phone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, ada.id));
    const page = await ok(phone.get('/api/student/page'));
    void page;
    const goal = await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read one book every week.' }));
    await ok(phone.post('/api/student/evidence', { subjectId: s.english.id, goalId: goal.id, kind: 'text', body: 'Ada read Pip and the Moon' }));
    const m = multipart(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), 'ada-story.pdf', 'application/pdf');
    const file = await ok(s.teacherA.req('POST', `/api/files?kind=document&ownerStudentId=${ada.id}`, m.body, m.headers));
    const before = (await fsp.readdir(uploadsDir, { recursive: true })).length;
    expect(before).toBeGreaterThan(0);

    // Only a deactivated student can be erased (D-109), also through the API.
    expect((await s.admin.get(`/api/admin/students/${ada.id}/erase`)).body.error.details.reason).toBe('STUDENT_ACTIVE');
    const refused = await s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Zümrüt Yılmaz' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('STUDENT_ACTIVE');
    expect(count('select count(*) n from students where id = ?', ada.id)).toBe(1);
    await ok(s.admin.post(`/api/admin/students/${ada.id}/deactivate`));

    const preview = await ok(s.admin.get(`/api/admin/students/${ada.id}/erase`));
    expect(preview).toMatchObject({ fullName: 'Ada Zümrüt Yılmaz', files: 2 }); // the document and the class list
    expect(preview.tables.map((t: any) => t.table)).toEqual(expect.arrayContaining(['enrolments', 'attendance_daily', 'goals', 'evidence', 'student_links']));
    expect(JSON.stringify(preview)).not.toMatch(/secret/iu);
    expect((await s.teacherA.get(`/api/admin/students/${ada.id}/erase`)).status).toBe(403);
    expect((await s.teacherA.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Zümrüt Yılmaz' })).status).toBe(403);
    expect((await s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada' })).body.error.details.reason).toBe('CONFIRMATION_MISMATCH');
    expect(await ok(s.admin.post(`/api/admin/students/${ada.id}/erase`, { confirm: 'Ada Zümrüt Yılmaz' }))).toEqual({ ok: true, files: 2 });

    // Scan every table and text cell for the id, the name and the number.
    const needles = [ada.id, 'Ada Zümrüt Yılmaz', 'Zümrüt', '4711', file.id];
    // The class list is gone from the database (the batch keeps its rows without it) and from disk.
    expect(count('select count(*) n from files where id = ?', upload.id)).toBe(0);
    expect(count('select count(*) n from import_batches where id = ? and file_id is null', batch.id)).toBe(1);
    const tables = (env.db.$client.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
    const hits: string[] = [];
    for (const t of tables) {
      for (const row of env.db.$client.prepare(`select * from "${t}"`).all() as Array<Record<string, unknown>>) {
        const text = JSON.stringify(row);
        for (const n of needles) if (text.includes(n)) hits.push(`${t}: ${n}`);
      }
    }
    expect(hits).toEqual([]);
    expect((await fsp.readdir(uploadsDir, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).length).toBe(0);
    // The only trace: a 'student.erase' audit without personal data.
    const trace = env.db.$client.prepare("select entity_id, after_json from audit_events where action = 'student.erase'").all() as Array<{ entity_id: string | null; after_json: string }>;
    expect(trace).toHaveLength(1);
    expect(trace[0]!.entity_id).toBeNull();
    expect(JSON.parse(trace[0]!.after_json).tables.students).toBe(1);
    // The rest of the class is intact; the link and the phone stop working.
    expect((await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`))).students.map((x: any) => x.id)).toContain(bora.id);
    expect((await phone.get('/api/student/page')).status).toBe(401);
    const state = await ok(s.teacherA.get(`/api/classroom/contexts/${s.ctxA.id}/lesson`));
    expect(JSON.stringify(state)).not.toContain(ada.id);
    expect((await s.admin.get(`/api/admin/students/${ada.id}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- class display by teachers
describe('teacher class themes and display settings (S13b item 8, D-105)', () => {
  it('a teacher of the class changes theme, sounds, volume, quote and time-up; others cannot; audited', async () => {
    env = await makeEnv();
    const s = await buildSchool(env);
    const r = await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/display`, { theme: 'animals', soundVolume: 40, quoteEnabled: false, timeUpSound: 'chime' }));
    expect(r).toMatchObject({ classId: s.c3a.id, theme: 'animals', soundVolume: 40, quoteEnabled: false, timeUpSound: 'chime', soundsEnabled: true });
    const mine = await ok(s.teacherA.get('/api/teacher/contexts'));
    expect(mine.contexts[0]).toMatchObject({ theme: 'animals', soundVolume: 40, quoteEnabled: false, timeUpSound: 'chime' });
    expect(mine.timeUpClip).toBe(false);
    expect((await s.teacherB.put(`/api/teacher/classes/${s.c3a.id}/display`, { theme: 'classroom' })).status).toBe(403);
    expect((await s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/display`, { theme: 'space-pirates' })).status).toBe(400);
    expect((await s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/display`, { soundVolume: 101 })).status).toBe(400);
    expect(audits('class.display')).toBe(1);
    // Admins still create classes; teachers cannot.
    expect((await s.teacherA.post('/api/admin/classes', { schoolYearId: s.year.id, name: '9-Z' })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- weather
describe('classroom weather (S13b item 4, D-106)', () => {
  const sunny: CurrentWeather = { temperature_2m: 21.6, weather_code: 0, is_day: 1 };

  it('fetches once for the configured coordinates, caches 30 minutes, and hides when switched off', async () => {
    clearWeatherCache();
    const urls: string[] = [];
    env = await makeEnv({}, { weatherFetch: async (url) => (urls.push(url), sunny) });
    const s = await buildSchool(env);
    expect(await ok(s.teacherA.get('/api/classroom/weather'))).toEqual({ available: true, kind: 'sunny', temperatureC: 22, isDay: true });
    await ok(s.teacherA.get('/api/classroom/weather'));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('latitude=39.9200');
    expect(urls[0]).toContain('longitude=32.8500');
    expect(urls[0]).not.toMatch(/school|name|student/iu);
    env.clock.advance(31 * 60_000);
    await ok(s.teacherA.get('/api/classroom/weather'));
    expect(urls).toHaveLength(2);
    const settings = await ok(s.admin.patch('/api/admin/settings', { weatherEnabled: false }));
    expect(settings).toMatchObject({ weatherEnabled: false, weatherLabel: 'Ankara, Kızılay' });
    expect((await ok(s.teacherA.get('/api/classroom/weather'))).available).toBe(false);
    await ok(s.admin.patch('/api/admin/settings', { weatherEnabled: true, weatherLatitude: 41.01, weatherLongitude: 28.98, weatherLabel: 'İstanbul' }));
    await ok(s.teacherA.get('/api/classroom/weather'));
    expect(urls.at(-1)).toContain('latitude=41.0100');
  });

  it('offline or slow: answers unavailable (the widget hides) and does not retry on every poll', async () => {
    clearWeatherCache();
    let calls = 0;
    env = await makeEnv({}, { weatherFetch: () => (calls++, Promise.reject(new Error('ENOTFOUND'))) });
    const s = await buildSchool(env);
    expect(await ok(s.teacherA.get('/api/classroom/weather'))).toEqual({ available: false, kind: null, temperatureC: null, isDay: null });
    await ok(s.teacherA.get('/api/classroom/weather'));
    expect(calls).toBe(1);
    expect(WEATHER_TIMEOUT_MS).toBe(5000);
  });

  it('gives up after the timeout', async () => {
    clearWeatherCache();
    env = await makeEnv({ WEATHER_API_URL: 'https://weather.example.test/v1/forecast' }, { weatherFetch: () => new Promise<CurrentWeather>(() => undefined) });
    const s = await buildSchool(env);
    const started = Date.now();
    expect((await ok(s.teacherA.get('/api/classroom/weather'))).available).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(WEATHER_TIMEOUT_MS - 100);
  }, 15_000);
});

// ---------------------------------------------------------------- importer sheet picker
describe('importer sheet picker (S13b item 6)', () => {
  it('lists the sheets with row counts and a preview, requires a choice, and stores it on the batch', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-sheets-'));
    env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
    const s = await buildSchool(env);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Adı Soyadı'], ['Ceren Ak'], ['Doruk Bal']]), '3-A');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Adı Soyadı'], ['Kaan Er'], ['Lale Gül'], ['Mert Can']]), '3-B');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Boş');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const m = multipart(buf, 'classes.xlsx', 'application/octet-stream');
    const file = await ok(s.teacherA.req('POST', '/api/files?kind=import_source', m.body, m.headers));
    const sheets = await ok(s.teacherA.post('/api/import/sheets', { fileId: file.id }));
    expect(sheets.sheets.map((x: any) => [x.name, x.rows])).toEqual([
      ['3-A', 3],
      ['3-B', 4],
    ]);
    expect(sheets.sheets[1].preview[1]).toEqual(['Kaan Er']);
    const refused = await s.teacherA.post('/api/import/batches', { classId: s.c3a.id, fileId: file.id });
    expect(refused.body.error.details.reason).toBe('SHEET_CHOICE_REQUIRED');
    expect((await s.teacherA.post('/api/import/batches', { classId: s.c3a.id, fileId: file.id, sheets: ['Nope'] })).body.error.details.reason).toBe('SHEET_NOT_FOUND');
    const batch = await ok(s.teacherA.post('/api/import/batches', { classId: s.c3a.id, fileId: file.id, sheets: ['3-A'] }));
    expect(batch.sheets).toEqual(['3-A']);
    const names = JSON.stringify(batch.rows);
    expect(names).toContain('Ceren Ak');
    expect(names).toContain('Doruk Bal');
    expect(names).not.toContain('Kaan Er');
    // Another teacher cannot read this upload's sheets.
    expect((await s.teacherB.post('/api/import/sheets', { fileId: file.id })).status).toBe(404);
  }, 30_000);
});

// ---------------------------------------------------------------- time's-up clip
describe("teacher time's-up clip (S13b item 5, D-107)", () => {
  it('is uploaded through the pipeline (sniffed, size-limited), served to the teacher only, and replaceable', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-clip-'));
    env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
    const s = await buildSchool(env);
    const frame = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
    const mp3 = Buffer.concat(Array.from({ length: 30 }, () => Buffer.concat([frame, Buffer.alloc(413)])));
    const up = (data: Buffer, name: string, type: string) => {
      const m = multipart(data, name, type);
      return s.teacherA.req('POST', '/api/teacher/time-up-clip', m.body, m.headers);
    };
    expect((await up(Buffer.from('<script>alert(1)</script>'), 'x.mp3', 'audio/mpeg')).body.error.details.reason).toBeTruthy();
    expect((await up(Buffer.alloc(3 * 1024 * 1024, 1), 'big.mp3', 'audio/mpeg')).body.error.details.reason).toBe('FILE_TOO_LARGE');
    const first = await up(mp3, 'times-up.mp3', 'audio/mpeg');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ kind: 'teacher_sound', mime: 'audio/mpeg', ownerStudentId: null });
    expect((await ok(s.teacherA.get('/api/teacher/contexts'))).timeUpClip).toBe(true);
    expect((await env.app.inject({ method: 'GET', url: '/api/classroom/time-up-clip', headers: { cookie: [...s.teacherA.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url: '/api/classroom/time-up-clip', headers: { cookie: [...s.teacherB.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })).statusCode).toBe(404);
    // The general upload endpoint does not take this kind; student media flags do not apply here.
    const m = multipart(mp3, 'x.mp3', 'audio/mpeg');
    expect((await s.teacherA.req('POST', '/api/files?kind=teacher_sound', m.body, m.headers)).body.error.details.reason).toBe('WRONG_UPLOAD_KIND');
    const second = await up(mp3, 'again.mp3', 'audio/mpeg');
    expect(count('select count(*) n from files where kind = ? and deleted_at is null', 'teacher_sound')).toBe(1);
    expect(second.body.id).not.toBe(first.body.id);
    await ok(s.teacherA.del('/api/teacher/time-up-clip'));
    expect((await ok(s.teacherA.get('/api/teacher/contexts'))).timeUpClip).toBe(false);
    expect(count('select count(*) n from files where kind = ? and deleted_at is null', 'teacher_sound')).toBe(0);
  });
});
