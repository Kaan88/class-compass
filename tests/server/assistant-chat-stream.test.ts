/**
 * The assistant chat with a model that thinks first (D-203, the DeepSeek incident of 2026-11-12: "This
 * answer failed: The answer was not in the expected format."), against a scripted local model (never a
 * real provider; fictional data only): a stream the provider ends early (`STREAM_ENDED`) is asked again
 * once, and a failed thinking reply still counts its reasoning; `insufficient_system_resource` after
 * text fails and keeps the text; the reasoning goes back with a tool-call message during the same run
 * for OpenAI-compatible and OpenRouter connections only, and is never stored; the server's warn line for
 * a failed provider call holds facts only, never chat content (AI-1, PRIV-1).
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { aiConnectionUsage, assistantMessages } from '../../src/server/db/schema.ts';
import { settleRuns } from '../../src/server/modules/assistantChat/routes.ts';
import { FAKE_KEYS, FakeProvider } from '../ai-fake.ts';
import { script, type Turn } from '../assistant-fake.ts';
import { Client, makeEnv, type TestEnv } from '../helpers.ts';
import { setAi } from '../mcp-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const API = '/api/teacher/assistant-chat';
const DEFNE = 'Defne Yıldız';
/** Words that must never reach the server log. */
const SECRET_QUESTION = 'Plan a lesson about volcanoes for Defne';
const SECRET_REASONING = 'The teacher wants volcano facts, I will read the roster first.';

let env: TestEnv;
let s: School;
let fake: FakeProvider;
const logs: string[] = [];
const conn: Record<'openai' | 'openaiCompatible' | 'openrouter', string> = { openai: '', openaiCompatible: '', openrouter: '' };

beforeAll(async () => {
  fake = new FakeProvider();
  const base = await fake.start();
  env = await makeEnv({}, { logStream: { write: (l) => logs.push(l) }, aiProviderUrls: { anthropic: base, openai: `${base}/v1`, gemini: base, openrouter: `${base}/api/v1`, chatgpt: `${base}/chatgpt`, chatgptToken: `${base}/chatgpt/token` } });
  s = await buildSchool(env);
  await addStudent(s.teacherA, s.c3a.id, { fullName: DEFNE });
  conn.openai = (await ok(s.admin.post('/api/admin/ai-connections', { type: 'openai', name: 'School model', models: ['fake-chat'], apiKey: FAKE_KEYS.openai, kvkkConfirmed: true }))).id;
  conn.openaiCompatible = (
    await ok(s.admin.post('/api/admin/ai-connections', { type: 'openaiCompatible', name: 'Thinking server', baseUrl: `${base}/v1`, localNetwork: true, models: ['deepseek-v4-pro'], apiKey: FAKE_KEYS.compatible, kvkkConfirmed: true }))
  ).id;
  conn.openrouter = (await ok(s.admin.post('/api/admin/ai-connections', { type: 'openrouter', name: 'Router', models: ['vendor/thinker'], apiKey: FAKE_KEYS.openrouter, kvkkConfirmed: true }))).id;
  await ok(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: conn.openai, defaultModel: 'fake-chat' }));
});
afterAll(async () => {
  await settleRuns(env.app);
  await fake.close();
  await env.app.close();
});
afterEach(async () => {
  await settleRuns(env.app);
  fake.override = null;
});

async function withAssistant(fn: () => Promise<void>) {
  await setAi(s.admin, { mcpEnabled: true });
  await ok(s.admin.put('/api/admin/assistant-chat', { enabled: true }));
  try {
    await fn();
  } finally {
    await settleRuns(env.app);
    await ok(s.admin.put('/api/admin/assistant-chat', { enabled: false }));
    await setAi(s.admin, { mcpEnabled: false, aiStudentDataAllowed: false });
  }
}

async function events(c: Client, runId: string): Promise<any[]> {
  const r = await c.get(`${API}/runs/${runId}/events?after=0`);
  expect(r.status).toBe(200);
  const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((l) => l.startsWith('data: ')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(6)));
}
const endOf = (evs: any[]) => evs.find((e) => e.type === 'end');
const streamedText = (evs: any[]) => evs.filter((e) => e.type === 'text').map((e) => e.text).join('');
async function newChat(choice: { connectionId?: string; model?: string } = {}) {
  return ok(s.teacherA.post(`${API}/chats`, choice));
}
async function ask(chatId: string, text: string) {
  return events(s.teacherA, (await ok(s.teacherA.post(`${API}/chats/${chatId}/messages`, { text }))).runId);
}
const detail = (chatId: string) => ok(s.teacherA.get(`${API}/chats/${chatId}`));
const outputTokens = (connectionId: string) => env.db.select().from(aiConnectionUsage).where(eq(aiConnectionUsage.connectionId, connectionId)).all().reduce((n, r) => n + r.outputTokens, 0);
const failureLines = () => logs.filter((l) => l.includes('assistant provider call failed')).map((l) => JSON.parse(l));

describe('D-203: a stream the provider ends early', () => {
  it('is asked again once when nothing was written, and the failed attempt counts its reasoning (output tokens > 0)', async () => {
    await withAssistant(async () => {
      const before = outputTokens(conn.openaiCompatible);
      const seen = script(fake, [() => ({ reasoning: 'r'.repeat(4000), endEarly: true }), () => ({ text: 'Hello there.' })]);
      const chat = await newChat({ connectionId: conn.openaiCompatible, model: 'deepseek-v4-pro' });
      const evs = await ask(chat.id, 'Hello');
      expect(endOf(evs)).toMatchObject({ end: 'complete' });
      expect(streamedText(evs)).toBe('Hello there.');
      expect(seen).toHaveLength(2);
      // 4000 reasoning characters estimated at about 1000 tokens, plus the second reply's 20 reported.
      expect(outputTokens(conn.openaiCompatible) - before).toBeGreaterThanOrEqual(1020);
      const d = await detail(chat.id);
      // The failed attempt left no message behind.
      expect(d.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
      expect(d.messages[1]).toMatchObject({ text: 'Hello there.', errorCode: null });
    });
  });

  it('a reasoning-only stream cut short twice is stored as STREAM_ENDED and still records output tokens', async () => {
    await withAssistant(async () => {
      const before = outputTokens(conn.openaiCompatible);
      const seen = script(fake, [() => ({ reasoning: 'r'.repeat(2000), endEarly: true })]);
      const chat = await newChat({ connectionId: conn.openaiCompatible, model: 'deepseek-v4-pro' });
      const evs = await ask(chat.id, 'Hello');
      expect(endOf(evs)).toMatchObject({ end: 'error', reason: 'STREAM_ENDED' });
      expect(seen).toHaveLength(2);
      expect(outputTokens(conn.openaiCompatible) - before).toBeGreaterThanOrEqual(1000);
      const d = await detail(chat.id);
      expect(d.messages[1]).toMatchObject({ role: 'assistant', status: 'error', errorCode: 'STREAM_ENDED', text: '' });
      expect(env.db.select().from(assistantMessages).where(eq(assistantMessages.id, d.messages[1].id)).get()!.outputTokens).toBeGreaterThanOrEqual(500);
    });
  });

  it('is not asked again once text was written: the text is kept on the failed message', async () => {
    await withAssistant(async () => {
      const seen = script(fake, [() => ({ text: 'Half an answer', endEarly: true })]);
      const chat = await newChat({ connectionId: conn.openaiCompatible, model: 'deepseek-v4-pro' });
      const evs = await ask(chat.id, 'Hello');
      expect(endOf(evs)).toMatchObject({ end: 'error', reason: 'STREAM_ENDED' });
      expect(seen).toHaveLength(1);
      expect((await detail(chat.id)).messages[1]).toMatchObject({ status: 'error', errorCode: 'STREAM_ENDED', text: 'Half an answer' });
    });
  });

  it('finish insufficient_system_resource after text fails (PROVIDER_ERROR) and keeps the text', async () => {
    await withAssistant(async () => {
      script(fake, [() => ({ text: 'Partial answer', finish: 'insufficient_system_resource' })]);
      const chat = await newChat({ connectionId: conn.openaiCompatible, model: 'deepseek-v4-pro' });
      const evs = await ask(chat.id, 'Hello');
      expect(endOf(evs)).toMatchObject({ end: 'error', reason: 'PROVIDER_ERROR' });
      expect((await detail(chat.id)).messages[1]).toMatchObject({ role: 'assistant', status: 'error', errorCode: 'PROVIDER_ERROR', text: 'Partial answer' });
    });
  });
});

describe('D-203: reasoning goes back with a tool-call message during the same run', () => {
  const roster: () => Turn = () => () => ({ reasoning: SECRET_REASONING, text: 'Let me look.', calls: [{ name: 'class_roster', args: { contextId: s.ctxA.id } }] });
  const assistantWithCalls = (body: any) => (body.messages as any[]).filter((m) => m.role === 'assistant' && m.tool_calls);

  for (const type of ['openaiCompatible', 'openrouter'] as const) {
    it(`${type}: reasoning_content is sent back in the next round, never stored, and not carried into a new run`, async () => {
      await withAssistant(async () => {
        const seen = script(fake, [roster(), () => ({ text: 'Three students.' })]);
        const chat = await newChat({ connectionId: conn[type], model: type === 'openrouter' ? 'vendor/thinker' : 'deepseek-v4-pro' });
        const evs = await ask(chat.id, 'Who is in 3-A?');
        expect(endOf(evs)).toMatchObject({ end: 'complete' });
        expect(seen).toHaveLength(2);
        expect(assistantWithCalls(seen[1]!.body)).toEqual([expect.objectContaining({ reasoning_content: SECRET_REASONING })]);
        // Never shown, never stored.
        expect(JSON.stringify(evs)).not.toContain('volcano facts');
        expect(JSON.stringify(await detail(chat.id))).not.toContain('volcano facts');
        expect(JSON.stringify(env.db.select().from(assistantMessages).all())).not.toContain('volcano facts');
        // A new run rebuilds the history from the database: the reasoning is gone (run memory only).
        const again = script(fake, [() => ({ text: 'Still three.' })]);
        await ask(chat.id, 'And now?');
        expect(assistantWithCalls(again[0]!.body)[0]).not.toHaveProperty('reasoning_content');
      });
    });
  }

  it('openai: reasoning is never sent back', async () => {
    await withAssistant(async () => {
      const seen = script(fake, [roster(), () => ({ text: 'Three students.' })]);
      const chat = await newChat({ connectionId: conn.openai, model: 'fake-chat' });
      expect(endOf(await ask(chat.id, 'Who is in 3-A?'))).toMatchObject({ end: 'complete' });
      expect(seen).toHaveLength(2);
      expect(JSON.stringify(seen[1]!.body)).not.toContain('reasoning_content');
      expect(JSON.stringify(seen[1]!.body)).not.toContain('volcano facts');
    });
  });
});

describe('D-203: the failure log line', () => {
  it('has the failure, its detail and the stream counters, and no chat content, reasoning, prompt, names or key', async () => {
    await withAssistant(async () => {
      logs.length = 0;
      script(fake, [() => ({ reasoning: SECRET_REASONING, endEarly: true })]);
      const chat = await newChat({ connectionId: conn.openaiCompatible, model: 'deepseek-v4-pro' });
      expect(endOf(await ask(chat.id, SECRET_QUESTION))).toMatchObject({ end: 'error', reason: 'STREAM_ENDED' });
      const lines = failureLines();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ level: 40 });
      expect(lines.map((l) => l.assistantProviderFailure.retry)).toEqual(['again', null]);
      expect(lines[0].assistantProviderFailure).toMatchObject({
        failure: 'STREAM_ENDED',
        detail: 'STREAM_ENDED_EARLY',
        httpStatus: null,
        round: 0,
        connectionType: 'openaiCompatible',
        model: 'deepseek-v4-pro',
        sawDone: false,
        lastFinishReason: null,
        sawUsage: false,
        reasoningChars: SECRET_REASONING.length,
        contentChars: 0,
        toolCalls: 0,
      });
      expect(lines[0].assistantProviderFailure.bytes).toBeGreaterThan(0);
      expect(lines[0].assistantProviderFailure.events).toBeGreaterThan(0);
      expect(typeof lines[0].assistantProviderFailure.elapsedMs).toBe('number');
      // An HTTP failure is logged too, with its status.
      script(fake, [() => ({ status: 500 })]);
      expect(endOf(await ask(chat.id, SECRET_QUESTION))).toMatchObject({ end: 'error', reason: 'PROVIDER_ERROR' });
      expect(failureLines().pop().assistantProviderFailure).toMatchObject({ failure: 'PROVIDER_ERROR', httpStatus: 500 });
      const all = logs.join('\n');
      for (const secret of [SECRET_QUESTION, 'volcano', 'volcanoes', SECRET_REASONING, 'Defne', 'Yıldız', 'Student 1', 'assistant inside Class Compass', FAKE_KEYS.compatible, FAKE_KEYS.openai, 'must never be shown']) {
        expect(all, secret).not.toContain(secret);
      }
    });
  });
});
