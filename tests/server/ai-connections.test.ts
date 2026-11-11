/**
 * AI connections (S19a, D-179): administrators manage the school's connections; secrets are sealed
 * and never appear in any response, audit row or log line; the address rules for OpenAI-compatible
 * servers; "Test connection" against a local fake provider (never a real one); the school default;
 * teachers' own connections only while allowed and only visible to their owner; the monthly budget
 * and the daily message limit; OpenRouter's sign-in with PKCE (state bound to the account, single use,
 * expiry, verifier checked by the provider). Fictional data only.
 */
import zlib from 'node:zlib';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiConnections, aiOauthStates, auditEvents, users } from '../../src/server/db/schema.ts';
import type { RequestContext } from '../../src/server/lib/context.ts';
import { challengeOf } from '../../src/server/modules/aiConnections/oauth.ts';
import { openConnectionSecret } from '../../src/server/modules/aiConnections/provider.ts';
import { beginAssistantMessage, recordTokens } from '../../src/server/modules/aiConnections/service.ts';
import { TEST_MAX_TOKENS } from '../../src/server/modules/aiConnections/testConnection.ts';
import { FAKE_KEYS, FakeProvider } from '../ai-fake.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';

let env: TestEnv;
let s: School;
let fake: FakeProvider;
let base: string;
const logs: string[] = [];
/** Every response body of this file, scanned for keys at the end. */
const seen: string[] = [];

beforeAll(async () => {
  fake = new FakeProvider();
  base = await fake.start();
  env = await makeEnv({}, { logStream: { write: (l) => logs.push(l) }, aiProviderUrls: { anthropic: base, openai: `${base}/v1`, gemini: base, openrouter: `${base}/api/v1`, chatgpt: `${base}/chatgpt`, chatgptToken: `${base}/chatgpt/token` } });
  s = await buildSchool(env);
});
afterAll(async () => {
  await fake.close();
  await env.app.close();
});

const reason = (r: { body: any }) => r.body?.error?.details?.reason;
async function req(p: Promise<{ status: number; body: any }>) {
  const r = await p;
  seen.push(JSON.stringify(r.body));
  return r;
}
const okBody = async (p: Promise<{ status: number; body: any }>, status = 200) => {
  const r = await req(p);
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const create = (c: Client, body: Record<string, unknown>, path = '/api/admin/ai-connections') => req(c.post(path, { kvkkConfirmed: true, models: ['fake-model'], ...body }));

/** The entries of a zip as the export writes it (stored or deflated, sizes in the local headers). */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString('utf8');
    const data = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    i += 30 + nlen + xlen + csize;
  }
  return out;
}

function ctxOf(userId: string): RequestContext {
  const user = env.db.select().from(users).where(eq(users.id, userId)).get()!;
  return { ...env.deps, ip: '127.0.0.1', session: null, user, student: null, actor: { type: 'user', id: user.id, role: user.role } };
}

describe('school connections (administrators only)', () => {
  it('teachers cannot read or change them (ACC-1)', async () => {
    expect((await s.teacherA.get('/api/admin/ai-connections')).status).toBe(403);
    expect((await s.teacherA.post('/api/admin/ai-connections', { type: 'openai', name: 'X', models: ['m'], kvkkConfirmed: true })).status).toBe(403);
    const v = await okBody(s.admin.get('/api/admin/ai-connections'));
    expect(v).toMatchObject({ connections: [], settings: { defaultConnectionId: null, defaultModel: null, teacherConnectionsAllowed: false }, chatgptAvailable: false, personalConnections: 0 });
  });

  it('need the KVKK processor confirmation', async () => {
    const r = await req(s.admin.post('/api/admin/ai-connections', { type: 'anthropic', name: 'Claude', models: ['m'] }));
    expect(r.status).toBe(400);
  });

  it('seal the key: shown nowhere, opened only with the row id', async () => {
    const v = await okBody(create(s.admin, { type: 'anthropic', name: 'Claude (school)', apiKey: FAKE_KEYS.anthropic, monthlyTokenBudget: 100000, dailyMessageLimit: 30 }));
    expect(v).toMatchObject({ type: 'anthropic', scope: 'school', hasSecret: true, secretSource: 'pasted', status: 'ready', baseUrl: null, models: [{ name: 'fake-model', testedAt: null, text: null, tools: null }] });
    expect(JSON.stringify(v)).not.toContain('S19A');
    const row = env.db.select().from(aiConnections).where(eq(aiConnections.id, v.id)).get()!;
    expect(row.secretCipher).toMatch(/^v1\./u);
    expect(row.secretCipher).not.toContain(FAKE_KEYS.anthropic);
    expect(openConnectionSecret(env.deps, row)).toBe(FAKE_KEYS.anthropic);
    expect(openConnectionSecret(env.deps, { id: 'another-row', secretCipher: row.secretCipher })).toBeNull();
  });

  it('a key is refused where the type signs in instead, and an address where the type has none', async () => {
    expect(reason(await create(s.admin, { type: 'anthropic', name: 'X', baseUrl: 'https://example.org/v1' }))).toBe('AI_URL_NOT_FOR_TYPE');
    expect(reason(await create(s.admin, { type: 'chatgpt', name: 'X' }))).toBe('AI_CHATGPT_NOT_AVAILABLE');
  });

  it('a key type without a key waits for one', async () => {
    const v = await okBody(create(s.admin, { type: 'gemini', name: 'Gemini' }));
    expect(v).toMatchObject({ hasSecret: false, status: 'needsKey' });
    const t = await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'fake-model' }));
    expect(t).toMatchObject({ ok: false, failure: 'NEEDS_KEY' });
    const u = await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { apiKey: FAKE_KEYS.gemini }));
    expect(u).toMatchObject({ hasSecret: true, status: 'ready' });
    const t2 = await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'fake-model' }));
    expect(t2).toMatchObject({ ok: true, text: true, tools: true, failure: null });
  });
});

describe('OpenAI-compatible addresses', () => {
  it('refuses metadata, link-local, and loopback unless ticked', async () => {
    expect(reason(await create(s.admin, { type: 'openaiCompatible', name: 'X', baseUrl: 'http://169.254.169.254/v1', localNetwork: true }))).toBe('AI_URL_METADATA');
    expect(reason(await create(s.admin, { type: 'openaiCompatible', name: 'X', baseUrl: 'http://169.254.1.1/v1', localNetwork: true }))).toBe('AI_URL_LINK_LOCAL');
    expect(reason(await create(s.admin, { type: 'openaiCompatible', name: 'X', baseUrl: `${base}/v1` }))).toBe('AI_URL_LOCAL_NOT_TICKED');
    expect(reason(await create(s.admin, { type: 'openaiCompatible', name: 'X' }))).toBe('AI_URL_REQUIRED');
  });

  it('a ticked local server works with or without a key, and the test marks the model', async () => {
    const v = await okBody(create(s.admin, { type: 'openaiCompatible', name: 'School server', baseUrl: `${base}/v1/`, localNetwork: true, apiKey: FAKE_KEYS.compatible, models: ['local-small', 'local-large'] }));
    expect(v).toMatchObject({ baseUrl: `${base}/v1`, localNetwork: true, status: 'ready' });
    const t = await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'local-small' }));
    expect(t).toMatchObject({ ok: true, text: true, tools: true });
    const after = (await okBody(s.admin.get('/api/admin/ai-connections'))).connections.find((c: any) => c.id === v.id);
    expect(after.models).toEqual([
      { name: 'local-small', testedAt: env.clock.now(), text: true, tools: true },
      { name: 'local-large', testedAt: null, text: null, tools: null },
    ]);
    expect(after.usage.monthInputTokens).toBeGreaterThan(0);
    expect(after.usage.monthMessages).toBe(0);
    // Unticking makes the stored address invalid: refused on save.
    expect(reason(await req(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { localNetwork: false })))).toBe('AI_URL_LOCAL_NOT_TICKED');
    // A model that is not listed cannot be tested.
    expect(reason(await req(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'other' })))).toBe('AI_MODEL_NOT_ALLOWED');
  });

  it('a model that answers text but refuses a request with tools: text works, tools failed with the reason', async () => {
    const v = await okBody(create(s.admin, { type: 'openaiCompatible', name: 'No tools here', baseUrl: `${base}/v1`, localNetwork: true, apiKey: FAKE_KEYS.compatible, models: ['local-no-tools'] }));
    const t = await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'local-no-tools' }));
    expect(t).toMatchObject({ ok: false, text: true, tools: false, failure: 'PROVIDER_ERROR', httpStatus: 400 });
    const after = (await okBody(s.admin.get('/api/admin/ai-connections'))).connections.find((c: any) => c.id === v.id);
    expect(after.models[0]).toMatchObject({ text: true, tools: false });
    await okBody(s.admin.del(`/api/admin/ai-connections/${v.id}`));
  });

  it('the test leaves room for a reasoning model’s thinking; a reply cut off before any output is OUT_OF_TOKENS', async () => {
    const v = await okBody(create(s.admin, { type: 'openaiCompatible', name: 'Thinker', baseUrl: `${base}/v1`, localNetwork: true, apiKey: FAKE_KEYS.compatible, models: ['local-thinker'] }));
    const caps: number[] = [];
    // Like a reasoning model that spends the whole cap thinking: no text, no tool call, finish "length".
    fake.override = (r, res) => {
      if (!r.path.endsWith('/chat/completions')) return false;
      caps.push(r.body.max_tokens);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 4096 } })}\n\ndata: [DONE]\n\n`);
      return true;
    };
    try {
      const t = await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'local-thinker' }));
      expect(t).toMatchObject({ ok: false, text: false, tools: false, failure: 'OUT_OF_TOKENS', httpStatus: null });
    } finally {
      fake.override = null;
    }
    expect(caps).toEqual([TEST_MAX_TOKENS, TEST_MAX_TOKENS]);
    expect(TEST_MAX_TOKENS).toBeGreaterThanOrEqual(4096);
    await okBody(s.admin.del(`/api/admin/ai-connections/${v.id}`));
  });

  it('a rejected key is reported as such, without the provider’s text', async () => {
    const v = await okBody(create(s.admin, { type: 'openai', name: 'OpenAI', apiKey: 'sk-wrong-fake-key-S19A-0000' }));
    const t = await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'fake-model' }));
    expect(t).toMatchObject({ ok: false, text: false, tools: false, failure: 'KEY_REJECTED', httpStatus: 401 });
    // Replacing the key keeps the connection and the models; the test then passes.
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { apiKey: FAKE_KEYS.openai }));
    expect(await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'fake-model' }))).toMatchObject({ ok: true });
    const sent = fake.requests.filter((r) => r.path === '/v1/chat/completions').pop()!;
    expect(sent.headers.authorization).toBe(`Bearer ${FAKE_KEYS.openai}`);
    expect(sent.body.max_completion_tokens).toBeGreaterThan(0);
  });

  it('Test connection sends nothing while the connection is paused or its monthly budget is used up (security review)', async () => {
    const v = await okBody(create(s.admin, { type: 'anthropic', name: 'Paused test', apiKey: FAKE_KEYS.anthropic, monthlyTokenBudget: 1000 }));
    const before = fake.requests.length;
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { enabled: false }));
    expect(await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'fake-model' }))).toMatchObject({ ok: false, text: false, tools: false, failure: 'PAUSED', httpStatus: null });
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { enabled: true }));
    recordTokens(env.deps, v.id, s.ayse.id, { inputTokens: 600, outputTokens: 400 });
    expect(await okBody(s.admin.post(`/api/admin/ai-connections/${v.id}/test`, { model: 'fake-model' }))).toMatchObject({ ok: false, text: false, tools: false, failure: 'OVER_BUDGET', httpStatus: null });
    expect(fake.requests.length).toBe(before);
    // No test ran, so the stored result is unchanged.
    const after = (await okBody(s.admin.get('/api/admin/ai-connections'))).connections.find((c: any) => c.id === v.id);
    expect(after.models[0]).toMatchObject({ testedAt: null, text: null, tools: null });
    await okBody(s.admin.del(`/api/admin/ai-connections/${v.id}`));
  });
});

describe('school default and edits', () => {
  it('the default is a school connection and one of its models; removing either clears it', async () => {
    const v = await okBody(create(s.admin, { type: 'openrouter', name: 'OpenRouter', apiKey: FAKE_KEYS.openrouter, models: ['vendor/a', 'vendor/b'] }));
    expect(reason(await req(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: v.id, defaultModel: 'vendor/zzz' })))).toBe('AI_MODEL_NOT_ALLOWED');
    expect(await okBody(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: v.id }))).toMatchObject({ defaultConnectionId: v.id, defaultModel: 'vendor/a' });
    await okBody(s.admin.put('/api/admin/ai-connection-settings', { defaultModel: 'vendor/b' }));
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { models: ['vendor/a'] }));
    expect((await okBody(s.admin.get('/api/admin/ai-connections'))).settings).toMatchObject({ defaultConnectionId: v.id, defaultModel: null });
    await okBody(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: v.id, defaultModel: 'vendor/a' }));
    // The teacher sees the default by name.
    expect((await okBody(s.teacherA.get('/api/teacher/ai-connections'))).schoolDefault).toEqual({ name: 'OpenRouter', type: 'openrouter', model: 'vendor/a' });
    // A paused default is not named to teachers as if it were in use.
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { enabled: false }));
    expect((await okBody(s.teacherA.get('/api/teacher/ai-connections'))).schoolDefault).toBeNull();
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { enabled: true }));
    await okBody(s.admin.del(`/api/admin/ai-connections/${v.id}`));
    expect((await okBody(s.admin.get('/api/admin/ai-connections'))).settings).toMatchObject({ defaultConnectionId: null, defaultModel: null });
    const row = env.db.select().from(aiConnections).where(eq(aiConnections.id, v.id)).get()!;
    expect(row.deletedAt).not.toBeNull();
    expect(row.secretCipher).toBeNull();
    expect((await req(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { name: 'Back' }))).status).toBe(404);
  });

  it('every change is audited without the key', async () => {
    const rows = env.db.select().from(auditEvents).all().filter((a) => a.action.startsWith('ai_connection.'));
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['ai_connection.create', 'ai_connection.update', 'ai_connection.delete', 'ai_connection.settings']));
    expect(rows.some((r) => r.afterJson?.includes('"keyReplaced":true'))).toBe(true);
  });
});

describe('teachers’ own connections', () => {
  let own: string;
  it('are refused while the administrator has not allowed them (off by default)', async () => {
    const r = await create(s.teacherA, { type: 'openai', name: 'Mine', apiKey: FAKE_KEYS.openai }, '/api/teacher/ai-connections');
    expect(r.status).toBe(403);
    expect(reason(r)).toBe('AI_OWN_CONNECTIONS_OFF');
    expect((await okBody(s.teacherA.get('/api/teacher/ai-connections'))).allowed).toBe(false);
  });

  it('when allowed, a teacher adds one that only they see and use', async () => {
    await okBody(s.admin.put('/api/admin/ai-connection-settings', { teacherConnectionsAllowed: true }));
    // No addresses for teachers: an OpenAI-compatible connection is not offered.
    expect((await create(s.teacherA, { type: 'openaiCompatible', name: 'X', baseUrl: 'https://example.org/v1' }, '/api/teacher/ai-connections')).status).toBe(400);
    const v = await okBody(create(s.teacherA, { type: 'openai', name: 'My OpenAI', apiKey: FAKE_KEYS.openai, dailyMessageLimit: 2 }, '/api/teacher/ai-connections'));
    own = v.id;
    expect(v).toMatchObject({ scope: 'personal', hasSecret: true, status: 'ready' });
    expect((await okBody(s.teacherA.post(`/api/teacher/ai-connections/${own}/test`, { model: 'fake-model' }))).ok).toBe(true);
    // Invisible to the other teacher and to administrators (a count only).
    expect((await okBody(s.teacherB.get('/api/teacher/ai-connections'))).connections).toEqual([]);
    for (const r of [
      await s.teacherB.patch(`/api/teacher/ai-connections/${own}`, { name: 'Taken' }),
      await s.teacherB.post(`/api/teacher/ai-connections/${own}/test`, { model: 'fake-model' }),
      await s.teacherB.del(`/api/teacher/ai-connections/${own}`),
      await s.admin.patch(`/api/admin/ai-connections/${own}`, { name: 'Taken' }),
      await s.admin.post(`/api/admin/ai-connections/${own}/test`, { model: 'fake-model' }),
    ])
      expect(r.status).toBe(404);
    const admin = await okBody(s.admin.get('/api/admin/ai-connections'));
    expect(admin.connections.some((c: any) => c.id === own)).toBe(false);
    expect(admin.personalConnections).toBe(1);
    // A teacher cannot reach a school connection through their own endpoints.
    const school = admin.connections[0].id;
    expect((await s.teacherA.patch(`/api/teacher/ai-connections/${school}`, { name: 'Mine now' })).status).toBe(404);
    // Another teacher cannot use it in the assistant either.
    expect(() => beginAssistantMessage(ctxOf(s.mehmet.id), own, null)).toThrow('Connection not found');
  });

  it('the daily message limit counts per teacher and day', async () => {
    const ctx = ctxOf(s.ayse.id);
    expect(beginAssistantMessage(ctx, own, null).model).toBe('fake-model');
    beginAssistantMessage(ctx, own, 'fake-model');
    expect(() => beginAssistantMessage(ctx, own, null)).toThrow('Daily message limit reached');
    expect(() => beginAssistantMessage(ctx, own, 'not-listed')).toThrow();
    env.clock.advance(24 * 60 * 60 * 1000);
    // Sessions do not survive a day of idleness: sign in again.
    await s.admin.login('root.admin');
    await s.teacherA.login('ayse.teacher');
    await s.teacherB.login('mehmet.teacher');
    beginAssistantMessage(ctx, own, null);
    const v = (await okBody(s.teacherA.get('/api/teacher/ai-connections'))).connections[0];
    expect(v.usage).toMatchObject({ todayMessages: 1, monthMessages: 3 });
  });

  it('switching own connections off stops their use, tests and sign-ins; the owner can still delete', async () => {
    // A sign-in started while allowed cannot be finished after the switch goes off.
    const router = (await okBody(create(s.teacherA, { type: 'openrouter', name: 'My OpenRouter' }, '/api/teacher/ai-connections'))).id;
    const started = new URL((await okBody(s.teacherA.post(`/api/teacher/ai-connections/${router}/oauth`, {}))).authorizeUrl);
    const state = new URL(started.searchParams.get('callback_url')!).searchParams.get('state')!;
    fake.expectChallenge = started.searchParams.get('code_challenge');
    await okBody(s.admin.put('/api/admin/ai-connection-settings', { teacherConnectionsAllowed: false }));
    const before = fake.requests.length;
    expect(() => beginAssistantMessage(ctxOf(s.ayse.id), own, null)).toThrow('Own connections are not allowed');
    for (const r of [
      await req(s.teacherA.post(`/api/teacher/ai-connections/${own}/test`, { model: 'fake-model' })),
      await req(s.teacherA.post(`/api/teacher/ai-connections/${router}/oauth`, {})),
      await req(s.teacherA.post('/api/account/ai-connections/oauth/finish', { state, code: fake.acceptCode })),
      await req(s.teacherA.patch(`/api/teacher/ai-connections/${own}`, { name: 'Renamed' })),
    ]) {
      expect(r.status).toBe(403);
      expect(reason(r)).toBe('AI_OWN_CONNECTIONS_OFF');
    }
    // Nothing reached the provider and no key was stored.
    expect(fake.requests.length).toBe(before);
    expect(env.db.select().from(aiConnections).where(eq(aiConnections.id, router)).get()!.secretCipher).toBeNull();
    await okBody(s.teacherA.del(`/api/teacher/ai-connections/${own}`));
    await okBody(s.teacherA.del(`/api/teacher/ai-connections/${router}`));
    expect((await okBody(s.teacherA.get('/api/teacher/ai-connections'))).connections).toEqual([]);
  });
});

describe('monthly token budget (school connection)', () => {
  it('a used-up budget stops new messages until it is raised', async () => {
    const v = await okBody(create(s.admin, { type: 'anthropic', name: 'Budgeted', apiKey: FAKE_KEYS.anthropic, monthlyTokenBudget: 1000 }));
    const ctx = ctxOf(s.ayse.id);
    beginAssistantMessage(ctx, v.id, null);
    recordTokens(env.deps, v.id, s.ayse.id, { inputTokens: 700, outputTokens: 300 });
    expect((await okBody(s.admin.get('/api/admin/ai-connections'))).connections.find((c: any) => c.id === v.id).status).toBe('overBudget');
    expect(() => beginAssistantMessage(ctx, v.id, null)).toThrow('monthly budget');
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { monthlyTokenBudget: 5000 }));
    expect(beginAssistantMessage(ctx, v.id, null).row.id).toBe(v.id);
    // Paused connections cannot be used either.
    await okBody(s.admin.patch(`/api/admin/ai-connections/${v.id}`, { enabled: false }));
    expect(() => beginAssistantMessage(ctx, v.id, null)).toThrow('not ready');
  });

  it('with no default and no connection asked for, the assistant has nothing to use', () => {
    expect(() => beginAssistantMessage(ctxOf(s.ayse.id), null, null)).toThrow('No connection');
  });
});

describe('Connect OpenRouter (OAuth with PKCE)', () => {
  let conn: string;
  const start = async () => {
    const r = await okBody(s.admin.post(`/api/admin/ai-connections/${conn}/oauth`, {}));
    const u = new URL(r.authorizeUrl);
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(u.searchParams.get('callback_url')!);
    expect(callback.origin + callback.pathname).toBe(`${env.config.origins.main}/ai-connections/return`);
    return { state: callback.searchParams.get('state')!, challenge: u.searchParams.get('code_challenge')! };
  };

  it('only for OpenRouter (and ChatGPT when available)', async () => {
    const key = (await okBody(s.admin.get('/api/admin/ai-connections'))).connections.find((c: any) => c.type === 'anthropic');
    expect(reason(await req(s.admin.post(`/api/admin/ai-connections/${key.id}/oauth`, {})))).toBe('AI_OAUTH_NOT_FOR_TYPE');
    conn = (await okBody(create(s.admin, { type: 'openrouter', name: 'OpenRouter account', models: ['vendor/a'] }))).id;
  });

  it('stores the key the provider issues after the verifier matches; the state works once', async () => {
    const { state, challenge } = await start();
    expect(state.length).toBeGreaterThanOrEqual(40);
    fake.expectChallenge = challenge;
    // The state is stored only as an HMAC; the verifier sealed.
    const stored = env.db.select().from(aiOauthStates).all();
    expect(stored.some((r) => r.id === state)).toBe(false);
    expect(stored.every((r) => r.verifierCipher.startsWith('v1.'))).toBe(true);
    // Another account cannot finish it (same 404 as an unknown state).
    expect((await req(s.teacherA.post('/api/account/ai-connections/oauth/finish', { state, code: fake.acceptCode }))).status).toBe(404);
    expect((await req(s.admin.post('/api/account/ai-connections/oauth/finish', { state: 'x'.repeat(43), code: fake.acceptCode }))).status).toBe(404);
    const done = await okBody(s.admin.post('/api/account/ai-connections/oauth/finish', { state, code: fake.acceptCode }));
    expect(done).toEqual({ connectionId: conn, scope: 'school', name: 'OpenRouter account' });
    const row = env.db.select().from(aiConnections).where(eq(aiConnections.id, conn)).get()!;
    expect(openConnectionSecret(env.deps, row)).toBe(FAKE_KEYS.oauthIssued);
    expect(row.secretSource).toBe('oauth');
    const keyReq = fake.requests.filter((r) => r.path === '/api/v1/auth/keys').pop()!;
    expect(challengeOf(keyReq.body.code_verifier)).toBe(challenge);
    // Replay: refused.
    expect((await req(s.admin.post('/api/account/ai-connections/oauth/finish', { state, code: fake.acceptCode }))).status).toBe(404);
    // The issued key works.
    expect(await okBody(s.admin.post(`/api/admin/ai-connections/${conn}/test`, { model: 'vendor/a' }))).toMatchObject({ ok: true });
  });

  it('a wrong code or verifier fails and uses the state up; an expired state is refused', async () => {
    const a = await start();
    fake.expectChallenge = 'some-other-challenge';
    const r = await req(s.admin.post('/api/account/ai-connections/oauth/finish', { state: a.state, code: fake.acceptCode }));
    expect(reason(r)).toBe('AI_OAUTH_FAILED');
    expect((await req(s.admin.post('/api/account/ai-connections/oauth/finish', { state: a.state, code: fake.acceptCode }))).status).toBe(404);
    const b = await start();
    fake.expectChallenge = b.challenge;
    env.clock.advance(11 * 60 * 1000);
    expect((await req(s.admin.post('/api/account/ai-connections/oauth/finish', { state: b.state, code: fake.acceptCode }))).status).toBe(404);
  });
});

describe('secrets never leave', () => {
  it('no key, verifier or issued key in any response, audit row or log line', () => {
    const keys = [...Object.values(FAKE_KEYS), 'sk-wrong-fake-key-S19A-0000'];
    const audits = env.db.select().from(auditEvents).all().map((a) => `${a.beforeJson ?? ''}${a.afterJson ?? ''}`).join('\n');
    const verifiers = fake.requests.filter((r) => r.path.endsWith('/auth/keys')).map((r) => String(r.body.code_verifier));
    for (const k of [...keys, ...verifiers]) {
      expect(seen.join('\n')).not.toContain(k);
      expect(audits).not.toContain(k);
      expect(logs.join('\n')).not.toContain(k);
    }
    expect(seen.join('\n')).not.toMatch(/S19A/u);
  });

  it('the full export blanks the sealed key and leaves out waiting sign-ins', async () => {
    const v = await okBody(create(s.admin, { type: 'gemini', name: 'Exported', apiKey: FAKE_KEYS.gemini }));
    expect(env.db.select().from(aiConnections).where(eq(aiConnections.id, v.id)).get()!.secretCipher).not.toBeNull();
    expect(env.db.select().from(aiOauthStates).all().length).toBeGreaterThan(0);
    const ready = await okBody(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: false }));
    const res = await env.app.inject({ method: 'GET', url: `/api/admin/exports/${ready.token}`, headers: { cookie: [...s.admin.cookies].map(([k, val]) => `${k}=${val}`).join('; ') } });
    expect(res.statusCode).toBe(200);
    const entries = unzip(res.rawPayload);
    expect(Object.keys(entries).some((n) => n.includes('ai_oauth_states'))).toBe(false);
    const csv = entries['tables/ai_connections.csv']!.toString('utf8');
    expect(csv).toContain('Exported');
    expect(csv.split('\n')[0]).toContain('secret_cipher');
    // Not one stored sealed value made it into the file (the column is there, blank).
    const sealed = env.db.select().from(aiConnections).all().flatMap((r) => (r.secretCipher ? [r.secretCipher] : []));
    expect(sealed.length).toBeGreaterThan(0);
    for (const c of sealed) expect(csv).not.toContain(c);
    const all = Object.values(entries).map((b) => b.toString('utf8')).join('\n');
    for (const k of Object.values(FAKE_KEYS)) expect(all).not.toContain(k);
    expect(all).not.toMatch(/v1\.[A-Za-z0-9_-]{20,}/u);
  });

  it('the list endpoints never carry a secret field', async () => {
    const v = await okBody(s.admin.get('/api/admin/ai-connections'));
    for (const c of v.connections) expect(Object.keys(c)).not.toEqual(expect.arrayContaining(['secretCipher', 'apiKey', 'secret']));
    void ok;
  });
});
