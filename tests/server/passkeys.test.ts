/**
 * S33 (D-210): passkeys (ACC-2, ACC-3). A signed-in account adds a passkey after re-authentication and
 * signs in with it without a username, password or email. The authenticator here is a small software
 * one (a P-256 key, CBOR by hand), so the real WebAuthn checks of the server library run. Fictional
 * people only.
 */
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { passkeys, users } from '../../src/server/db/schema.ts';
import { NEVER_EXPORTED } from '../../src/server/modules/maintenance/exports.ts';
import { PASSKEY_COOKIE, PASSKEYS_PER_ACCOUNT } from '../../src/server/modules/auth/passkeys.ts';
import { Client, FakeMailer, makeEnv, TEST_ORIGIN, type TestEnv } from '../helpers.ts';
import { buildSchool, ok } from '../school-fixture.ts';

let env: TestEnv;
afterEach(async () => env.app.close());

const SMTP = { SMTP_HOST: 'smtp.example.test', smtpEnabled: true, SMTP_FROM: 'noreply@example.test' };
const PASSWORD = 'correct-horse-battery';
const codeFrom = (text: string) => /\n(\d{6})\n/u.exec(text)![1]!;
const count = (sql: string, ...args: unknown[]) => (env.db.$client.prepare(sql).get(...args) as { n: number }).n;
const audits = (action: string) => count('select count(*) n from audit_events where action = ?', action);
const reason = (r: { body: any }) => r.body?.error?.details?.reason;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();

// ---------------------------------------------------------------- a minimal CBOR encoder (what an authenticator writes)
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
}
function cbor(v: unknown): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('unsupported');
}

/** A software authenticator with one discoverable ES256 credential. */
class Authenticator {
  readonly key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credId = crypto.randomBytes(16);
  counter = 0;
  userHandle = '';
  get id() {
    return b64(this.credId);
  }
  private authData(flags: number, withCredential: boolean) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const parts: Buffer[] = [sha256('localhost'), Buffer.from([flags]), counter];
    if (withCredential) {
      const jwk = this.key.publicKey.export({ format: 'jwk' });
      const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credId.length);
      parts.push(Buffer.alloc(16), len, this.credId, cose);
    }
    return Buffer.concat(parts);
  }
  /** `navigator.credentials.create` */
  create(options: any, origin = TEST_ORIGIN) {
    this.userHandle = options.user.id;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
    // UP | UV | AT
    const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(0x45, true)]]));
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] }, clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  }
  /** `navigator.credentials.get` */
  get(options: any, over: { origin?: string; userVerified?: boolean; breakSignature?: boolean } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: over.origin ?? TEST_ORIGIN, crossOrigin: false }));
    const authenticatorData = this.authData(over.userVerified === false ? 0x01 : 0x05, false);
    const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.key.privateKey);
    if (over.breakSignature) signature[signature.length - 1]! ^= 0xff;
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(signature), userHandle: this.userHandle }, clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  }
}

async function school(config: Record<string, unknown> = {}) {
  const mailer = new FakeMailer();
  env = await makeEnv({ ...SMTP, ...config }, { mailer });
  return { mailer, s: await buildSchool(env) };
}

/** A signed-in account adds a passkey (re-authentication with the password). */
async function addPasskey(c: Client, device = new Authenticator(), name = 'My phone') {
  const started = await ok(c.post('/api/auth/passkeys/register/start', { currentPassword: PASSWORD }));
  const made = await ok(c.post('/api/auth/passkeys/register/finish', { response: device.create(started.options), name }));
  return { device, made, options: started.options };
}

/** Sign in on a fresh browser with the device's passkey. */
async function passkeySignIn(device: Authenticator, over: Parameters<Authenticator['get']>[1] = {}) {
  const c = new Client(env);
  const started = await ok(c.post('/api/auth/passkeys/signin/start'));
  const r = await c.post('/api/auth/passkeys/signin/finish', { response: device.get(started.options, over) });
  return { c, r, options: started.options };
}

describe('passkeys (S33, D-210)', () => {
  it('are offered on a named address and not on a bare IP address', async () => {
    await school();
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).passkeysEnabled).toBe(true);
    await env.app.close();
    await school({ PUBLIC_ORIGIN: 'http://127.0.0.1:5173' });
    expect((await ok(new Client(env).get('/api/auth/password-reset'))).passkeysEnabled).toBe(false);
    expect(reason(await new Client(env).post('/api/auth/passkeys/signin/start'))).toBe('PASSKEY_NOT_AVAILABLE');
  });

  it('adding one needs re-authentication and asks for a discoverable key with user verification; only the public key is stored', async () => {
    const { s } = await school();
    expect((await new Client(env).post('/api/auth/passkeys/register/start', {})).status).toBe(401);
    expect(reason(await s.teacherA.post('/api/auth/passkeys/register/start', {}))).toBe('WRONG_PASSWORD');
    expect(reason(await s.teacherA.post('/api/auth/passkeys/register/start', { currentPassword: 'not-the-password' }))).toBe('WRONG_PASSWORD');

    const { device, made, options } = await addPasskey(s.teacherA);
    expect(options).toMatchObject({ rp: { id: 'localhost', name: 'Class Compass' }, user: { name: 'ayse.teacher' }, attestation: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
    expect(made).toMatchObject({ name: 'My phone', lastUsedAt: null });
    expect((await ok(s.teacherA.get('/api/auth/passkeys'))).passkeys).toEqual([made]);
    expect(s.teacherA.cookies.has(PASSKEY_COOKIE)).toBe(false);
    expect(audits('auth.passkey_add')).toBe(1);
    const row = env.db.select().from(passkeys).where(eq(passkeys.id, made.id)).get()!;
    expect(row).toMatchObject({ userId: s.ayse.id, credentialId: device.id, counter: 0 });
    // What is stored is the public key: nothing of the private key, and nothing of it in any answer.
    const privateD = device.key.privateKey.export({ format: 'jwk' }).d!;
    expect(JSON.stringify(row)).not.toContain(privateD);
    const listed = (await ok(s.admin.get('/api/admin/users'))).users.find((u: any) => u.id === s.ayse.id);
    expect(listed.passkeys).toBe(1);
    expect(JSON.stringify(listed)).not.toContain(row.publicKey);
    expect(NEVER_EXPORTED).toContain('passkeys');

    // The options name the passkeys the account has, so a browser does not add the same one twice; the server refuses it too.
    const again = await ok(s.teacherA.post('/api/auth/passkeys/register/start', { currentPassword: PASSWORD }));
    expect(again.options.excludeCredentials).toEqual([expect.objectContaining({ id: device.id })]);
    expect(reason(await s.teacherA.post('/api/auth/passkeys/register/finish', { response: device.create(again.options) }))).toBe('PASSKEY_EXISTS');
  });

  it('signs in without a username, password or email, for teachers and administrators', async () => {
    const { s } = await school();
    const { device } = await addPasskey(s.teacherA);
    const { c, r, options } = await passkeySignIn(device);
    expect(options).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: s.ayse.id, role: 'teacher' });
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect(c.cookies.has(PASSKEY_COOKIE)).toBe(false);
    expect((await ok(c.get('/api/auth/passkeys'))).passkeys[0].lastUsedAt).not.toBeNull();
    expect(count("select count(*) n from audit_events where action = 'auth.login' and after_json like '%passkey%'")).toBe(1);

    const boss = await addPasskey(s.admin, new Authenticator(), 'Office laptop');
    const asBoss = await passkeySignIn(boss.device);
    expect(asBoss.r.body).toMatchObject({ id: s.adminUser.id, role: 'admin' });
    expect((await asBoss.c.get('/api/admin/users')).status).toBe(200);
  });

  it('refuses a wrong site, a missing fingerprint check, a broken signature, an unknown key, a replay and a deactivated account, all with one answer', async () => {
    const { s } = await school();
    const { device } = await addPasskey(s.teacherA);
    for (const over of [{ origin: 'https://sareteacher.example.org' }, { userVerified: false }, { breakSignature: true }]) expect(reason((await passkeySignIn(device, over)).r), JSON.stringify(over)).toBe('PASSKEY_SIGNIN_FAILED');
    expect(reason((await passkeySignIn(new Authenticator())).r)).toBe('PASSKEY_SIGNIN_FAILED');

    // The answer to one browser's challenge does not work in another browser, and works once.
    const a = new Client(env);
    const first = await ok(a.post('/api/auth/passkeys/signin/start'));
    const answer = device.get(first.options);
    const b = new Client(env);
    await ok(b.post('/api/auth/passkeys/signin/start'));
    expect(reason(await b.post('/api/auth/passkeys/signin/finish', { response: answer }))).toBe('PASSKEY_SIGNIN_FAILED');
    expect(reason(await new Client(env).post('/api/auth/passkeys/signin/finish', { response: answer }))).toBe('PASSKEY_SIGNIN_FAILED');
    expect((await a.post('/api/auth/passkeys/signin/finish', { response: answer })).status).toBe(200);
    expect(reason(await a.post('/api/auth/passkeys/signin/finish', { response: answer }))).toBe('PASSKEY_SIGNIN_FAILED');
    // Five minutes are the limit.
    const slow = new Client(env);
    const late = await ok(slow.post('/api/auth/passkeys/signin/start'));
    env.clock.advance(6 * 60_000);
    expect(reason(await slow.post('/api/auth/passkeys/signin/finish', { response: device.get(late.options) }))).toBe('PASSKEY_SIGNIN_FAILED');

    // An authenticator that counts: a lower count than the last one is a copied key.
    device.counter = 7;
    expect((await passkeySignIn(device)).r.status).toBe(200);
    device.counter = 3;
    expect(reason((await passkeySignIn(device)).r)).toBe('PASSKEY_SIGNIN_FAILED');
    device.counter = 8;

    await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/deactivate`));
    expect(reason((await passkeySignIn(device)).r)).toBe('PASSKEY_SIGNIN_FAILED');
  });

  it('a registration answer belongs to the account and the browser that asked', async () => {
    const { s } = await school();
    const device = new Authenticator();
    const forAyse = await ok(s.teacherA.post('/api/auth/passkeys/register/start', { currentPassword: PASSWORD }));
    // Mehmet's browser has its own challenge: Ayşe's answer is not accepted there.
    await ok(s.teacherB.post('/api/auth/passkeys/register/start', { currentPassword: PASSWORD }));
    expect(reason(await s.teacherB.post('/api/auth/passkeys/register/finish', { response: device.create(forAyse.options) }))).toBe('PASSKEY_ADD_FAILED');
    // A wrong site in the answer is refused.
    const fresh = await ok(s.teacherA.post('/api/auth/passkeys/register/start', { currentPassword: PASSWORD }));
    expect(reason(await s.teacherA.post('/api/auth/passkeys/register/finish', { response: device.create(fresh.options, 'https://sareteacher.example.org') }))).toBe('PASSKEY_ADD_FAILED');
    expect(count('select count(*) n from passkeys')).toBe(0);
  });

  it('is removed by its owner or, for a lost device, by an administrator; an account holds a limited number', async () => {
    const { s } = await school();
    const { device, made } = await addPasskey(s.teacherA);
    const second = await addPasskey(s.teacherA, new Authenticator(), 'Tablet');
    // Nobody removes somebody else's passkey.
    expect((await s.teacherB.del(`/api/auth/passkeys/${made.id}`)).status).toBe(404);
    await ok(s.teacherA.del(`/api/auth/passkeys/${made.id}`));
    expect(audits('auth.passkey_remove')).toBe(1);
    expect(reason((await passkeySignIn(device)).r)).toBe('PASSKEY_SIGNIN_FAILED');
    expect((await passkeySignIn(second.device)).r.status).toBe(200);

    // A lost tablet: the administrator removes the passkeys, and the account's sessions end.
    expect((await s.teacherB.post(`/api/admin/users/${s.ayse.id}/passkeys/remove`)).status).toBe(403);
    const after = await ok(s.admin.post(`/api/admin/users/${s.ayse.id}/passkeys/remove`));
    expect(after.passkeys).toBe(0);
    expect(audits('auth.passkey_remove_admin')).toBe(1);
    expect((await s.teacherA.get('/api/auth/me')).status).toBe(401);
    expect(reason((await passkeySignIn(second.device)).r)).toBe('PASSKEY_SIGNIN_FAILED');

    for (let i = 0; i < PASSKEYS_PER_ACCOUNT; i++) await addPasskey(s.teacherB, new Authenticator(), `Device ${i + 1}`);
    expect(reason(await s.teacherB.post('/api/auth/passkeys/register/start', { currentPassword: PASSWORD }))).toBe('PASSKEY_LIMIT');
  });

  it('works while passwords are off (D-207), and a passkey sign-in counts as re-authentication', async () => {
    const { s, mailer } = await school();
    const admins = await addPasskey(s.admin);
    const teachers = await addPasskey(s.teacherA);
    for (const [id, email] of [[s.adminUser.id, 'root@school.example'], [s.ayse.id, 'ayse@school.example'], [s.mehmet.id, 'mehmet@school.example']] as const) await ok(s.admin.patch(`/api/admin/users/${id}`, { email }));
    await ok(s.admin.post('/api/admin/sign-in-policy/code'));
    await ok(s.admin.put('/api/admin/sign-in-policy', { passwordsOff: true, code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect(env.db.select().from(users).all().every((u) => u.passwordHash === '')).toBe(true);

    expect((await passkeySignIn(admins.device)).r.body).toMatchObject({ role: 'admin', signInMethod: 'email_link', reauthFresh: true });
    const { c, r } = await passkeySignIn(teachers.device);
    expect(r.body).toMatchObject({ role: 'teacher', signInMethod: 'email_link', reauthFresh: true });
    // No password exists; the fresh passkey sign-in is the re-authentication for a new PIN and another passkey.
    expect((await c.post('/api/auth/pin', { pin: '2468' })).status).toBe(200);
    const started = await ok(c.post('/api/auth/passkeys/register/start', {}));
    await ok(c.post('/api/auth/passkeys/register/finish', { response: new Authenticator().create(started.options), name: 'Second device' }));
    env.clock.advance(16 * 60_000);
    expect(reason(await c.post('/api/auth/passkeys/register/start', {}))).toBe('REAUTH_REQUIRED');
  });

  it('is offered once right after an email sign-in, until the account has one or says "Don’t ask again"', async () => {
    const { s, mailer } = await school();
    await ok(s.admin.patch(`/api/admin/users/${s.ayse.id}`, { email: 'ayse@school.example' }));
    const OFFER = '/api/auth/passkeys/offer';
    expect((await new Client(env).get(OFFER)).status).toBe(401);
    // A password sign-in is not offered one: adding would ask for the password again, in Profile.
    expect(await ok(s.teacherA.get(OFFER))).toEqual({ offer: false });

    // The teacher moves to email links and signs in with a code: the offer appears, and adding needs nothing more.
    await ok(s.teacherA.post('/api/auth/sign-in-method/email-link/start', { currentPassword: PASSWORD }));
    await ok(s.teacherA.post('/api/auth/sign-in-method/email-link/confirm', { code: codeFrom(mailer.sent.at(-1)!.text) }));
    const signIn = async () => {
      const c = new Client(env);
      const asked = await ok(c.post('/api/auth/email-link/request', { email: 'ayse@school.example' }));
      await ok(c.post('/api/auth/email-link/code', { requestId: asked.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
      return c;
    };
    const c = await signIn();
    expect(await ok(c.get(OFFER))).toEqual({ offer: true });
    // Fifteen minutes later the sign-in is no longer fresh, so nothing is offered.
    env.clock.advance(16 * 60_000);
    expect(await ok(c.get(OFFER))).toEqual({ offer: false });

    const again = await signIn();
    expect(await ok(again.get(OFFER))).toEqual({ offer: true });
    const started = await ok(again.post('/api/auth/passkeys/register/start', {}));
    await ok(again.post('/api/auth/passkeys/register/finish', { response: new Authenticator().create(started.options) }));
    expect(await ok(again.get(OFFER))).toEqual({ offer: false });

    // "Don't ask again" is for the account, on every device, also once it has no passkey any more.
    await ok(s.admin.patch(`/api/admin/users/${s.mehmet.id}`, { email: 'mehmet@school.example' }));
    await ok(s.teacherB.post('/api/auth/sign-in-method/email-link/start', { currentPassword: PASSWORD }));
    await ok(s.teacherB.post('/api/auth/sign-in-method/email-link/confirm', { code: codeFrom(mailer.sent.at(-1)!.text) }));
    const m = new Client(env);
    const asked = await ok(m.post('/api/auth/email-link/request', { email: 'mehmet@school.example' }));
    await ok(m.post('/api/auth/email-link/code', { requestId: asked.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect(await ok(m.get(OFFER))).toEqual({ offer: true });
    await ok(m.post(`${OFFER}/dismiss`));
    expect(await ok(m.get(OFFER))).toEqual({ offer: false });
    const other = new Client(env);
    const asked2 = await ok(other.post('/api/auth/email-link/request', { email: 'mehmet@school.example' }));
    await ok(other.post('/api/auth/email-link/code', { requestId: asked2.requestId, code: codeFrom(mailer.sent.at(-1)!.text) }));
    expect(await ok(other.get(OFFER))).toEqual({ offer: false });
  });
});
