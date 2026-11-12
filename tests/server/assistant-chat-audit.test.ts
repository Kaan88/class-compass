/**
 * Audit fixes of the assistant chat (D-180), against the scripted local model (never a real provider):
 * the earlier summary goes through the name filter in a later compaction once student data is off; a
 * tool call with a name the provider would refuse back never breaks the chat; a send or a Yes refused
 * as busy has no side effects (daily limit, the change); a Yes on a tool the account may no longer use
 * leaves the card refused; a chat follows the school default until the teacher picks a model, and a
 * picked model that can no longer be used falls back to it; a stopped or failed reply (or summary) is
 * counted with an estimate; a card shows a renamed default category by the teacher's name (D-176) and
 * another teacher's category as missing. Fictional data only; every school switch turned on is turned
 * off again in `finally`.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { aiConnectionUsage, assistantChats, assistantMessages, homeworkAssignments } from '../../src/server/db/schema.ts';
import { ASSISTANT_TUNING } from '../../src/server/modules/assistantChat/agent.ts';
import { settleRuns } from '../../src/server/modules/assistantChat/routes.ts';
import { FAKE_KEYS, FakeProvider } from '../ai-fake.ts';
import { script, sentText } from '../assistant-fake.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { setAi } from '../mcp-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const DEFNE = 'Defne Yıldız';
const API = '/api/teacher/assistant-chat';

let env: TestEnv;
let s: School;
let fake: FakeProvider;
let connectionId: string;

beforeAll(async () => {
  fake = new FakeProvider();
  const base = await fake.start();
  env = await makeEnv({}, { aiProviderUrls: { anthropic: base, openai: `${base}/v1`, gemini: base, openrouter: `${base}/api/v1`, chatgpt: `${base}/chatgpt`, chatgptToken: `${base}/chatgpt/token` } });
  s = await buildSchool(env);
  await addStudent(s.teacherA, s.c3a.id, { fullName: DEFNE });
  await addStudent(s.teacherA, s.c3a.id, { fullName: 'Emre Kılıç' });
  for (const m of ['goals', 'homework']) await ok(s.teacherA.put(`/api/teacher/contexts/${s.ctxA.id}/modules/${m}`, { enabled: true }));
  const conn = await ok(s.admin.post('/api/admin/ai-connections', { type: 'openai', name: 'School model', models: ['fake-chat'], apiKey: FAKE_KEYS.openai, kvkkConfirmed: true }));
  connectionId = conn.id;
  await ok(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: connectionId, defaultModel: 'fake-chat' }));
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

/** Switches the chat on for a test (AI tools and the assistant) and off again afterwards. */
async function withAssistant(fn: () => Promise<void>, opts: { studentData?: boolean } = {}) {
  await setAi(s.admin, { mcpEnabled: true, ...(opts.studentData ? { aiStudentDataAllowed: true } : {}) });
  await ok(s.admin.put('/api/admin/assistant-chat', { enabled: true }));
  try {
    await fn();
  } finally {
    await settleRuns(env.app);
    await ok(s.admin.put('/api/admin/assistant-chat', { enabled: false }));
    await setAi(s.admin, { mcpEnabled: false, aiStudentDataAllowed: false });
  }
}

/** Lowers the compaction thresholds for one test. */
async function withTuning(fn: () => Promise<void>) {
  const old = { ...ASSISTANT_TUNING };
  ASSISTANT_TUNING.compactAtTokens = 300;
  ASSISTANT_TUNING.keepRecentTokens = 120;
  try {
    await fn();
  } finally {
    Object.assign(ASSISTANT_TUNING, old);
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
const newChat = (c: Client = s.teacherA) => ok(c.post(`${API}/chats`, {}));
const send = (c: Client, chatId: string, text: string, extra: Record<string, unknown> = {}) => ok(c.post(`${API}/chats/${chatId}/messages`, { text, ...extra }));
const detail = (c: Client, chatId: string) => ok(c.get(`${API}/chats/${chatId}`));
const reason = (r: { body: any }) => r.body?.error?.details?.reason;
const lastUser = (body: any): string => [...(body.messages as Array<{ role: string; content: string }>)].reverse().find((m) => m.role === 'user')?.content ?? '';
/** Tokens counted for an account so far (every connection, every day). */
const tokensOf = (userId: string) =>
  env.db
    .select()
    .from(aiConnectionUsage)
    .where(eq(aiConnectionUsage.userId, userId))
    .all()
    .reduce((t, r) => ({ input: t.input + r.inputTokens, output: t.output + r.outputTokens }), { input: 0, output: 0 });

describe('assistant chat audit fixes', () => {
  it('finding 1: a summary written with names goes through the name filter in the next compaction once student data is off', async () => {
    await withTuning(async () => {
      let named = true;
      const seen = script(fake, [(body) => (body.tools ? { text: `Answer ${'x'.repeat(400)}` } : { text: named ? `SUMMARY: ${DEFNE} read four books.` : 'SUMMARY: more questions.' })]);
      let chatId = '';
      await withAssistant(
        async () => {
          const chat = await newChat();
          chatId = chat.id;
          for (let i = 1; i <= 4; i += 1) await events(s.teacherA, (await send(s.teacherA, chat.id, `Question ${i} about ${DEFNE} ${'y'.repeat(300)}`)).runId);
          expect(env.db.select().from(assistantChats).where(eq(assistantChats.id, chat.id)).get()!.summary).toContain(DEFNE);
        },
        { studentData: true },
      );
      const before = seen.length;
      named = false;
      await withAssistant(async () => {
        for (let i = 5; i <= 9; i += 1) await events(s.teacherA, (await send(s.teacherA, chatId, `Question ${i} ${'y'.repeat(300)}`)).runId);
      });
      const later = seen.slice(before);
      const compactions = later.filter((r) => !r.body.tools);
      expect(compactions.length).toBeGreaterThan(0);
      expect(compactions[0]!.body.messages.at(-1).content).toContain('Earlier summary:');
      for (const r of later) expect(sentText(r)).not.toMatch(/Defne|Yıldız/u);
    });
  });

  it('finding 2: a tool call with a name the provider would refuse back is answered as unknown and the chat keeps working', async () => {
    await withAssistant(async () => {
      const seen = script(fake, [
        () => ({
          text: 'Trying.',
          calls: [
            { id: 'bad_dot', name: 'class.roster', args: { contextId: s.ctxA.id } },
            { id: 'bad_long', name: `x${'y'.repeat(80)}`, args: {} },
            { id: 'bad_empty', name: '', args: {} },
          ],
        }),
        () => ({ text: 'That did not work.' }),
      ]);
      const chat = await newChat();
      expect(endOf(await events(s.teacherA, (await send(s.teacherA, chat.id, 'Who is in 3-A?')).runId))).toMatchObject({ end: 'complete' });
      const calls = (await detail(s.teacherA, chat.id)).messages[1].calls;
      expect(calls.map((c: any) => [c.id, c.tool, c.state, c.failed])).toEqual([
        ['bad_dot', 'unknown', 'refused', true],
        ['bad_long', 'unknown', 'refused', true],
        ['bad_empty', 'unknown', 'refused', true],
      ]);
      expect(endOf(await events(s.teacherA, (await send(s.teacherA, chat.id, 'Try again')).runId))).toMatchObject({ end: 'complete' });
      // Every later request names each stored call in a way every provider accepts.
      const later = seen.slice(1);
      expect(later.length).toBeGreaterThanOrEqual(2);
      for (const r of later) {
        const names = (r.body.messages as Array<{ tool_calls?: Array<{ function: { name: string } }> }>).flatMap((m) => (m.tool_calls ?? []).map((c) => c.function.name));
        expect(names).toHaveLength(3);
        for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/u);
      }
    });
  });

  it('finding 3: a send or a Yes refused as busy (runs per account) uses up no message and applies no change', async () => {
    // Room for exactly four more messages today (earlier tests sent some).
    const sentToday = env.db.select().from(aiConnectionUsage).where(eq(aiConnectionUsage.userId, s.ayse.id)).all().reduce((n, r) => n + r.messages, 0);
    await ok(s.admin.patch(`/api/admin/ai-connections/${connectionId}`, { dailyMessageLimit: sentToday + 4 }));
    try {
      await withAssistant(async () => {
        script(fake, [
          (body) => {
            if (body.messages.at(-1).role === 'tool') return { text: 'Done.' };
            const last = lastUser(body);
            if (last.includes('slow')) return { text: 'A long answer that keeps going. '.repeat(6), delayMs: 40 };
            if (last.includes('Homework')) return { calls: [{ id: 'call_busy', name: 'create_homework', args: { contextId: s.ctxA.id, title: 'Busy homework', dueOn: '2026-11-20' } }] };
            return { text: 'Ok.' };
          },
        ]);
        const t = s.teacherA;
        const hwChat = await newChat(t);
        expect(endOf(await events(t, (await send(t, hwChat.id, 'Homework please')).runId)).end).toBe('awaiting');
        const msg = (await detail(t, hwChat.id)).messages[1];
        const slow1 = await send(t, (await newChat(t)).id, 'slow one');
        const slow2 = await send(t, (await newChat(t)).id, 'slow two');
        const third = await newChat(t);
        const refused = await t.post(`${API}/chats/${third.id}/messages`, { text: 'Hello' });
        expect(refused.status).toBe(409);
        expect(reason(refused)).toBe('ASSISTANT_BUSY');
        const yes = await t.post(`${API}/chats/${hwChat.id}/messages/${msg.id}/calls/call_busy`, { approve: true });
        expect(yes.status).toBe(409);
        expect(reason(yes)).toBe('ASSISTANT_BUSY');
        expect(env.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.title, 'Busy homework')).all()).toEqual([]);
        expect((await detail(t, hwChat.id)).messages[1].calls[0].state).toBe('pending');
        await ok(t.post(`${API}/runs/${slow1.runId}/cancel`));
        await ok(t.post(`${API}/runs/${slow2.runId}/cancel`));
        await settleRuns(env.app);
        // The refused send was not counted: this is the fourth message of the day, within the limit of 4.
        expect(endOf(await events(t, (await send(t, third.id, 'Hello')).runId)).end).toBe('complete');
        const again = await ok(t.post(`${API}/chats/${hwChat.id}/messages/${msg.id}/calls/call_busy`, { approve: true }));
        await events(t, again.runId);
        expect(env.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.title, 'Busy homework')).all()).toHaveLength(1);
      });
    } finally {
      await ok(s.admin.patch(`/api/admin/ai-connections/${connectionId}`, { dailyMessageLimit: null }));
    }
  });

  it('finding 4: a Yes on a tool the account may no longer use leaves the card refused with an error result, not approved', async () => {
    await withAssistant(async () => {
      const seen = script(fake, [() => ({ calls: [{ id: 'call_gone', name: 'create_homework', args: { contextId: s.ctxA.id, title: 'Gone homework', dueOn: '2026-11-20' } }] }), () => ({ text: 'I see.' })]);
      const chat = await newChat();
      await events(s.teacherA, (await send(s.teacherA, chat.id, 'Set homework')).runId);
      const msg = (await detail(s.teacherA, chat.id)).messages[1];
      // The tool was taken away since the card was shown (a role change or a removed tool).
      const row = env.db.select().from(assistantMessages).where(eq(assistantMessages.id, msg.id)).get()!;
      env.db
        .update(assistantMessages)
        .set({ toolCallsJson: row.toolCallsJson!.map((c) => ({ ...c, name: 'retired_tool' })) })
        .where(eq(assistantMessages.id, msg.id))
        .run();
      const yes = await s.teacherA.post(`${API}/chats/${chat.id}/messages/${msg.id}/calls/call_gone`, { approve: true });
      expect(yes.status, JSON.stringify(yes.body)).toBe(200);
      expect(endOf(await events(s.teacherA, yes.body.runId)).end).toBe('complete');
      const call = (await detail(s.teacherA, chat.id)).messages[1].calls[0];
      expect(call).toMatchObject({ id: 'call_gone', state: 'refused', failed: true });
      expect(seen.at(-1)!.body.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('not available') });
      expect(env.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.title, 'Gone homework')).all()).toEqual([]);
      const again = await s.teacherA.post(`${API}/chats/${chat.id}/messages/${msg.id}/calls/call_gone`, { approve: true });
      expect(reason(again)).toBe('ASSISTANT_ALREADY_ANSWERED');
    });
  });

  it('finding 5: a chat follows the school default until a model is picked; a picked model that cannot be used falls back to the default', async () => {
    const other = await ok(s.admin.post('/api/admin/ai-connections', { type: 'openai', name: 'Second model', models: ['fake-other'], apiKey: FAKE_KEYS.openai, kvkkConfirmed: true }));
    try {
      await withAssistant(async () => {
        const seen = script(fake, [() => ({ text: 'Hello there.' })]);
        const chat = await newChat();
        expect(endOf(await events(s.teacherA, (await send(s.teacherA, chat.id, 'Hello')).runId)).end).toBe('complete');
        // Not pinned: the message used the default, the chat keeps following it.
        expect((await detail(s.teacherA, chat.id)).chat).toMatchObject({ connectionId: null, model: null });
        expect(env.db.select().from(assistantMessages).where(eq(assistantMessages.chatId, chat.id)).all()[0]).toMatchObject({ connectionId, model: 'fake-chat' });
        // An explicit choice is kept with the chat.
        await events(s.teacherA, (await send(s.teacherA, chat.id, 'On the other one', { connectionId: other.id, model: 'fake-other' })).runId);
        expect((await detail(s.teacherA, chat.id)).chat).toMatchObject({ connectionId: other.id, model: 'fake-other' });
        expect(seen.at(-1)!.body.model).toBe('fake-other');
        await events(s.teacherA, (await send(s.teacherA, chat.id, 'Still the other one')).runId);
        expect(seen.at(-1)!.body.model).toBe('fake-other');
        // Paused since: the chat falls back to the school default instead of failing.
        await ok(s.admin.patch(`/api/admin/ai-connections/${other.id}`, { enabled: false }));
        const r = await s.teacherA.post(`${API}/chats/${chat.id}/messages`, { text: 'And now?' });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(endOf(await events(s.teacherA, r.body.runId)).end).toBe('complete');
        expect(seen.at(-1)!.body.model).toBe('fake-chat');
        // Deleted: the same.
        await ok(s.admin.del(`/api/admin/ai-connections/${other.id}`));
        expect(endOf(await events(s.teacherA, (await send(s.teacherA, chat.id, 'Once more')).runId)).end).toBe('complete');
        expect(seen.at(-1)!.body.model).toBe('fake-chat');
      });
    } finally {
      await s.admin.del(`/api/admin/ai-connections/${other.id}`);
    }
  });

  it('finding 6: a stopped, failed or summary-failed reply is counted with an estimate when no usage arrived', async () => {
    await withAssistant(async () => {
      const user = s.ayse.id;
      // A provider error: nothing written, the input is counted.
      script(fake, [() => ({ status: 500 })]);
      let before = tokensOf(user);
      const failed = await newChat();
      expect(endOf(await events(s.teacherA, (await send(s.teacherA, failed.id, `Hello ${'z'.repeat(400)}`)).runId))).toMatchObject({ end: 'error' });
      let after = tokensOf(user);
      expect(after.input - before.input).toBeGreaterThan(100);
      expect(after.output - before.output).toBe(0);
      // Stopped half-way (the fake sends usage only at the end): input and what was written are counted.
      script(fake, [() => ({ text: 'A long answer that keeps going and going for a while. '.repeat(4), delayMs: 40 })]);
      before = tokensOf(user);
      const stopped = await newChat();
      const { runId } = await send(s.teacherA, stopped.id, 'Tell me a story');
      await new Promise((r) => setTimeout(r, 200));
      await ok(s.teacherA.post(`${API}/runs/${runId}/cancel`));
      expect(endOf(await events(s.teacherA, runId)).end).toBe('cancelled');
      after = tokensOf(user);
      expect(after.input - before.input).toBeGreaterThan(0);
      expect(after.output - before.output).toBeGreaterThan(0);
      const stored = env.db.select().from(assistantMessages).where(eq(assistantMessages.chatId, stopped.id)).all().find((m) => m.role === 'assistant')!;
      expect(stored.outputTokens).toBeGreaterThan(0);
      // A failed summary: its prompt is counted.
      await withTuning(async () => {
        script(fake, [(body) => (body.tools ? { text: `Answer ${'x'.repeat(400)}` } : { status: 500 })]);
        const chat = await newChat();
        let last: { input: number; output: number } | null = null;
        for (let i = 1; i <= 6 && !last; i += 1) {
          const b = tokensOf(user);
          const evs = await events(s.teacherA, (await send(s.teacherA, chat.id, `Question ${i} ${'y'.repeat(300)}`)).runId);
          if (endOf(evs).end === 'error') {
            const a = tokensOf(user);
            last = { input: a.input - b.input, output: a.output - b.output };
          }
        }
        expect(last).not.toBeNull();
        expect(last!.input).toBeGreaterThan(100);
        expect(last!.output).toBe(0);
      });
    });
  });

  it("finding 7: a card names a renamed default category by the teacher's name (D-176); another teacher's category is missing", async () => {
    await ok(s.teacherA.patch(`/api/teacher/goal-categories/${READING}`, { contextId: s.ctxA.id, name: { en: 'Book club', tr: 'Kitap kulübü' } }));
    const theirs = await ok(s.teacherB.post(`/api/teacher/contexts/${s.ctxB.id}/goal-categories`, { name: { en: 'Secret maths', tr: 'Gizli matematik' } }));
    try {
      await withAssistant(async () => {
        script(fake, [
          () => ({
            calls: [
              { id: 'st_mine', name: 'create_sentence_starter', args: { contextId: s.ctxA.id, kind: 'goal', categoryId: READING, text: { en: 'I will read…' } } },
              { id: 'st_theirs', name: 'create_sentence_starter', args: { contextId: s.ctxA.id, kind: 'goal', categoryId: theirs.id, text: { en: 'I will count…' } } },
            ],
          }),
        ]);
        const chat = await newChat();
        await events(s.teacherA, (await send(s.teacherA, chat.id, 'Two starters')).runId);
        const [mine, other] = (await detail(s.teacherA, chat.id)).messages[1].calls;
        expect(mine.changes.find((l: any) => l.key === 'categoryId')).toMatchObject({ kind: 'name', value: 'Book club' });
        expect(other.changes.find((l: any) => l.key === 'categoryId')).toMatchObject({ kind: 'missing' });
        expect(JSON.stringify(other)).not.toContain('Secret maths');
      });
    } finally {
      await ok(s.teacherA.patch(`/api/teacher/goal-categories/${READING}`, { contextId: s.ctxA.id, resetName: true }));
    }
  });
});
