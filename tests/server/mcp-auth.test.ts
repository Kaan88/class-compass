/**
 * AI tools access (S14h1, D-160): personal tokens are made only through PIN-gated `account`
 * endpoints with re-authentication, for the role's scopes and the school's lifetime cap; the bearer
 * check runs in the brief's order on every request (school switch → token → account → role → scope →
 * the endpoint's ownership checks); bearer and cookie never mix; writes are audited with the token.
 * Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, mcpCalls, mcpTokens } from '../../src/server/db/schema.ts';
import { capped } from '../../src/server/modules/mcp/transport.ts';
import { MCP_RESULT_MAX_BYTES } from '../../src/shared/mcp.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { Mcp, makeToken, PASSWORD, setAi } from '../mcp-helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
beforeAll(async () => {
  env = await makeEnv();
  s = await buildSchool(env);
});
afterAll(async () => env.app.close());

const create = (c: Client, body: Record<string, unknown>) => c.post('/api/account/ai-tools/tokens', { name: 'Laptop', scopes: ['classes:read'], days: 30, currentPassword: PASSWORD, ...body });
const reason = (r: { body: any }) => r.body?.error?.details?.reason ?? r.body?.error?.data?.reason;

describe('personal tokens (D-160)', () => {
  it('cannot be made while AI tools are off', async () => {
    const r = await create(s.teacherA, {});
    expect(r.status).toBe(403);
    expect(reason(r)).toBe('MCP_DISABLED');
    expect((await ok(s.teacherA.get('/api/account/ai-tools'))).enabled).toBe(false);
  });

  it('need the password again, the role’s scopes, the school’s cap and its privacy rule', async () => {
    await setAi(s.admin, { mcpEnabled: true, mcpTokenMaxDays: 30 });
    expect(reason(await create(s.teacherA, { currentPassword: 'wrong-password-123' }))).toBe('WRONG_PASSWORD');
    const missing = await s.teacherA.post('/api/account/ai-tools/tokens', { name: 'Laptop', scopes: ['classes:read'], days: 7 });
    expect(missing.status).toBe(401);
    expect(reason(await create(s.teacherA, { scopes: ['school:read'] }))).toBe('SCOPE_NOT_ALLOWED');
    expect(reason(await create(s.admin, { scopes: ['classes:read'] }))).toBe('SCOPE_NOT_ALLOWED');
    expect(reason(await create(s.teacherA, { days: 31 }))).toBe('TOKEN_TOO_LONG');
    expect(reason(await create(s.teacherA, { privacy: 'named' }))).toBe('STUDENT_DATA_OFF');
    await setAi(s.admin, { mcpTokenMaxDays: 90 });
  });

  it('423 while the classroom lock is engaged (the PIN cannot be bypassed)', async () => {
    const t = new Client(env);
    await t.login('ayse.teacher');
    await ok(t.post('/api/auth/pin', { currentPassword: PASSWORD, pin: '2468' }));
    await ok(t.post('/api/classroom/enter'));
    expect((await create(t, {})).status).toBe(423);
    expect((await t.get('/api/account/ai-tools')).status).toBe(423);
    await ok(t.post('/api/auth/pin/unlock', { pin: '2468' }));
    expect((await create(t, { name: 'After unlock' })).status).toBe(200);
  });

  it('shows the secret once and stores only its HMAC', async () => {
    const r = await ok(create(s.teacherA, { name: 'Shown once' }));
    expect(r.secret).toMatch(/^ccmcp_[A-Za-z0-9_-]{43}$/u);
    const list = await ok(s.teacherA.get('/api/account/ai-tools'));
    expect(JSON.stringify(list)).not.toContain(r.secret);
    expect(list.tokens.find((x: { id: string }) => x.id === r.token.id)).toMatchObject({ name: 'Shown once', status: 'active', prefix: r.secret.slice(0, 10) });
    const row = env.db.select().from(mcpTokens).where(eq(mcpTokens.id, r.token.id)).get()!;
    expect(row.tokenHash).not.toContain(r.secret);
    expect(row).toMatchObject({ kind: 'pat', familyId: r.token.id, clientId: null, privacyMode: 'pseudonymous' });
    // The administrator sees every token, never a secret or a hash.
    const admin = await ok(s.admin.get('/api/admin/ai-tools'));
    expect(admin.tokens.some((x: { id: string }) => x.id === r.token.id)).toBe(true);
    expect(JSON.stringify(admin)).not.toContain(r.secret);
    expect(JSON.stringify(admin)).not.toContain(row.tokenHash);
    // Audited, without the secret.
    const audit = env.db.select().from(auditEvents).where(eq(auditEvents.action, 'mcp_token.create')).all();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(r.secret);
  });

  it('only the owner (or an administrator) revokes a token', async () => {
    const mine = await ok(create(s.teacherA, { name: 'To revoke' }));
    expect((await s.teacherB.post(`/api/account/ai-tools/tokens/${mine.token.id}/revoke`)).status).toBe(404);
    await ok(s.teacherA.post(`/api/account/ai-tools/tokens/${mine.token.id}/revoke`));
    const other = await ok(create(s.teacherB, { name: 'Admin revokes' }));
    await ok(s.admin.post(`/api/admin/ai-tools/tokens/${other.token.id}/revoke`));
    for (const secret of [mine.secret, other.secret]) {
      const r = await new Mcp(env, secret).raw('POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
      expect(r.status).toBe(401);
      expect(r.body.error.data.reason).toBe('TOKEN_REVOKED');
    }
  });
});

describe('the order of checks on every call (D-160)', () => {
  const init = (token: string | null, headers: Record<string, string> = {}) =>
    new Mcp(env, token).raw('POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, headers);

  it('school switch → token → account', async () => {
    const { secret } = await makeToken(s.teacherA, { scopes: ['classes:read'] });
    // 1. The school switch comes before everything, even a valid token.
    await setAi(s.admin, { mcpEnabled: false });
    expect(reason(await init(secret))).toBe('MCP_DISABLED');
    expect((await init(secret)).status).toBe(403);
    await setAi(s.admin, { mcpEnabled: true });
    // 2. The token: missing, unknown, expired (revoked above).
    const none = await init(null);
    expect(none.status).toBe(401);
    expect(String(none.headers['www-authenticate'])).toMatch(/^Bearer /u);
    expect(reason(none)).toBe('TOKEN_MISSING');
    expect(reason(await init('ccmcp_not-a-real-token'))).toBe('TOKEN_INVALID');
    expect(reason(await init(null, { authorization: 'Basic YWJjOmRlZg==' }))).toBe('TOKEN_MISSING');
    const short = await makeToken(s.teacherA, { scopes: ['classes:read'], days: 1, name: 'One day' });
    env.clock.advance(25 * 60 * 60 * 1000);
    expect(reason(await init(short.secret))).toBe('TOKEN_EXPIRED');
    // A day later the browser sessions have ended too: sign in again.
    await s.teacherA.login('ayse.teacher');
    await s.teacherB.login('mehmet.teacher');
    await s.admin.login('root.admin');
    // 3. The account: deactivated accounts' tokens stop at once.
    const mehmet = await makeToken(s.teacherB, { scopes: ['classes:read'], name: 'Mehmet' });
    expect((await init(mehmet.secret)).status).toBe(200);
    await ok(s.admin.post(`/api/admin/users/${s.mehmet.id}/deactivate`));
    const inactive = await init(mehmet.secret);
    expect(inactive.status).toBe(403);
    expect(reason(inactive)).toBe('ACCOUNT_INACTIVE');
    await ok(s.admin.post(`/api/admin/users/${s.mehmet.id}/reactivate`));
    expect((await init(mehmet.secret)).status).toBe(200);
  });

  it('then role → scope → the endpoint’s own ownership checks', async () => {
    const teacher = new Mcp(env, (await makeToken(s.teacherA, { scopes: ['classes:read'], name: 'Read classes' })).secret);
    await teacher.init();
    const admin = new Mcp(env, (await makeToken(s.admin, { scopes: ['school:read'], name: 'Admin read' })).secret);
    await admin.init();
    // Role first: an administrator's token cannot use a teacher tool (whatever its scopes).
    const role = await admin.call('list_my_classes');
    expect(role.isError).toBe(true);
    expect(role.data.error.reason).toBe('ROLE_MISMATCH');
    expect((await teacher.call('list_classes')).data.error.reason).toBe('ROLE_MISMATCH');
    // Then the scope.
    const scope = await teacher.call('class_report', { contextId: s.ctxA.id });
    expect(scope.data.error.reason).toBe('SCOPE_NOT_GRANTED');
    // Then the endpoint: another teacher's class is not found (ACC-10).
    const other = await teacher.call('class_overview', { contextId: s.ctxB.id });
    expect(other.data.error.code).toBe('NOT_FOUND');
    expect((await teacher.call('list_my_classes')).isError).toBe(false);
    expect((await admin.call('list_classes')).isError).toBe(false);
    const denied = env.db.select().from(mcpCalls).where(eq(mcpCalls.status, 'denied')).all();
    expect(denied.map((r) => r.errorCode)).toEqual(expect.arrayContaining(['ROLE_MISMATCH', 'SCOPE_NOT_GRANTED']));
  });

  it('the Origin header, when sent, must be the main origin', async () => {
    const { secret } = await makeToken(s.teacherA, { scopes: ['classes:read'], name: 'Origin' });
    expect((await init(secret, { origin: 'https://evil.example.org' })).status).toBe(403);
    expect((await init(secret, { origin: 'http://localhost:5173' })).status).toBe(200);
    expect((await init(secret)).status).toBe(200);
  });

  it('bearer and cookie never mix', async () => {
    const { secret } = await makeToken(s.teacherA, { scopes: ['classes:read'], name: 'Mix' });
    // A cookie on /mcp is not a credential.
    const cookieOnly = await env.app.inject({ method: 'POST', url: '/mcp', headers: { cookie: [...s.teacherA.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/json' }, payload: '{}' });
    expect(cookieOnly.statusCode).toBe(401);
    // A bearer token on /api is refused even next to a valid cookie.
    const both = await s.teacherA.req('GET', '/api/teacher/contexts', undefined, { authorization: `Bearer ${secret}` });
    expect(both.status).toBe(401);
    expect(both.body.error.details.reason).toBe('BEARER_NOT_ALLOWED');
    expect((await s.teacherA.get('/api/teacher/contexts')).status).toBe(200);
  });
});

describe('writes through AI tools (D-160)', () => {
  it('are audited as the account with the token, and classroom writes go through the command log', async () => {
    await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/homework`, { enabled: true }));
    const { secret, id } = await makeToken(s.teacherA, { scopes: ['classes:read', 'homework:write', 'classroom:command'], name: 'Writer' });
    const c = new Mcp(env, secret);
    await c.init();
    const hw = await c.call('create_homework', { contextId: s.ctxA.id, title: 'Spelling list', dueOn: '2026-11-20' });
    expect(hw.isError).toBe(false);
    const row = env.db.select().from(auditEvents).where(eq(auditEvents.entityId, hw.data.id)).get()!;
    expect(row).toMatchObject({ actorType: 'user', actorId: s.ayse.id, viaTokenId: id });
    const log = await ok(s.admin.get(`/api/admin/audit?page=1&pageSize=50`));
    expect(log.items.find((i: { entityId: string }) => i.entityId === hw.data.id)).toMatchObject({ viaAiTool: true, actorName: 'Test ayse.teacher' });
    // A classroom command needs a running lesson and is idempotent by opId.
    const noLesson = await c.call('classroom_command', { command: 'attendance.markAllPresent', contextId: s.ctxA.id, lessonId: '0190f0f0-0000-7000-8000-000000000000' });
    expect(noLesson.data.ok).toBe(false);
  });

  it('results over 256 KB are cut with a note', () => {
    const big = 'x'.repeat(MCP_RESULT_MAX_BYTES + 5000);
    const out = capped(big);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(MCP_RESULT_MAX_BYTES);
    expect(out).toMatch(/\[truncated: .* Ask for a shorter period/u);
    expect(capped('small')).toBe('small');
  });
});

describe('the school switches (D-161)', () => {
  it('student data needs the typed confirmation and is audited', async () => {
    const r = await s.admin.put('/api/admin/ai-tools', { aiStudentDataAllowed: true, confirm: 'yes' });
    expect(reason(r)).toBe('CONFIRMATION_MISMATCH');
    expect((await s.teacherA.put('/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(403);
    await setAi(s.admin, { aiStudentDataAllowed: true });
    try {
      expect((await ok(s.teacherA.get('/api/account/ai-tools'))).studentDataAllowed).toBe(true);
      const audit = env.db.select().from(auditEvents).where(eq(auditEvents.action, 'school.ai_tools')).all();
      expect(audit.some((a) => (a.afterJson ?? '').includes('aiStudentDataAllowed'))).toBe(true);
    } finally {
      await setAi(s.admin, { aiStudentDataAllowed: false });
    }
  });
});
