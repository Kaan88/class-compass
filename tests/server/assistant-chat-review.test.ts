/**
 * The assistant chat after the S19b review (D-180), against the scripted local model (never a real
 * provider): the connection a chat without its own choice uses is the one the status shows (no school
 * default, a paused default); a running answer stops when an administrator switches AI tools or student
 * data off; tool-call arguments written with names are withheld once student data is off (D-161); a
 * change whose free text holds a pseudonym is refused and a card shows text exactly as it is written;
 * repeated call ids from a provider get their own ids; bulk changes show every item; goal and homework
 * cards say whose and which; a deactivated teacher's chats are deleted; every tool and argument has
 * words in English and Turkish. Its own app (the send rate limit is per server). Fictional data only;
 * every school switch turned on is turned off again in `finally`.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assistantChats, assistantMessages, goals, homeworkAssignments, schoolSettings, teacherFeedback, users } from '../../src/server/db/schema.ts';
import { purgeOldChats } from '../../src/server/modules/assistantChat/retention.ts';
import { settleRuns } from '../../src/server/modules/assistantChat/routes.ts';
import { assistantTools } from '../../src/server/modules/mcp/assistant.ts';
import { inputJsonSchema } from '../../src/server/modules/mcp/registry.ts';
import { en, tr } from '../../src/shared/i18n/areas/assistantChat.ts';
import { FAKE_KEYS, FakeProvider } from '../ai-fake.ts';
import { lastToolResult, script, sentText, type Turn } from '../assistant-fake.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { setAi } from '../mcp-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { linkUrl, openLink } from '../student-helpers.ts';

const READING = '00000000-0000-7000-8000-00000000c001';
const DEFNE = 'Defne Yıldız';
const EMRE = 'Emre Kılıç';
const API = '/api/teacher/assistant-chat';

let env: TestEnv;
let s: School;
let fake: FakeProvider;
let connectionId: string;
let defne: { id: string };

beforeAll(async () => {
  fake = new FakeProvider();
  const base = await fake.start();
  env = await makeEnv({}, { aiProviderUrls: { anthropic: base, openai: `${base}/v1`, gemini: base, openrouter: `${base}/api/v1`, chatgpt: `${base}/chatgpt`, chatgptToken: `${base}/chatgpt/token` } });
  s = await buildSchool(env);
  defne = await addStudent(s.teacherA, s.c3a.id, { fullName: DEFNE });
  await addStudent(s.teacherA, s.c3a.id, { fullName: EMRE });
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
const send = (c: Client, chatId: string, text: string) => ok(c.post(`${API}/chats/${chatId}/messages`, { text }));
const detail = (c: Client, chatId: string) => ok(c.get(`${API}/chats/${chatId}`));
const rosterTurn: Turn = () => ({ text: 'Let me look.', calls: [{ name: 'class_roster', args: { contextId: s.ctxA.id } }] });

describe('review fixes (S19b)', () => {
  it('a ready connection without a school default: the status and every message use the same connection', async () => {
    await ok(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: null, defaultModel: null }));
    try {
      await withAssistant(async () => {
        const st = await ok(s.teacherA.get(API));
        expect(st).toMatchObject({ available: true, defaultConnectionId: connectionId, defaultModel: 'fake-chat' });
        script(fake, [() => ({ text: 'Hello there.' })]);
        const chat = await newChat();
        const r = await s.teacherA.post(`${API}/chats/${chat.id}/messages`, { text: 'Hello' });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(endOf(await events(s.teacherA, r.body.runId))).toMatchObject({ end: 'complete' });
        expect((await detail(s.teacherA, chat.id)).chat).toMatchObject({ connectionId, model: 'fake-chat' });
      });
    } finally {
      await ok(s.admin.put('/api/admin/ai-connection-settings', { defaultConnectionId: connectionId, defaultModel: 'fake-chat' }));
    }
  });

  it('a paused default with another ready connection: the status and the message both use the ready one', async () => {
    const other = await ok(s.admin.post('/api/admin/ai-connections', { type: 'openai', name: 'Second model', models: ['fake-other'], apiKey: FAKE_KEYS.openai, kvkkConfirmed: true }));
    await ok(s.admin.patch(`/api/admin/ai-connections/${connectionId}`, { enabled: false }));
    try {
      await withAssistant(async () => {
        const st = await ok(s.teacherA.get(API));
        expect(st).toMatchObject({ available: true, defaultConnectionId: other.id, defaultModel: 'fake-other' });
        const seen = script(fake, [() => ({ text: 'Hello from the other one.' })]);
        const chat = await newChat();
        const r = await s.teacherA.post(`${API}/chats/${chat.id}/messages`, { text: 'Hello' });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(endOf(await events(s.teacherA, r.body.runId))).toMatchObject({ end: 'complete' });
        expect(seen[0]!.body.model).toBe('fake-other');
      });
    } finally {
      await ok(s.admin.patch(`/api/admin/ai-connections/${connectionId}`, { enabled: true }));
      await ok(s.admin.del(`/api/admin/ai-connections/${other.id}`));
    }
  });

  it('a running answer stops when an administrator switches AI tools off, before anything more goes out', async () => {
    await withAssistant(async () => {
      const seen = script(fake, [
        () => {
          // The administrator switches AI tools off while the model is answering.
          env.db.update(schoolSettings).set({ mcpEnabled: false }).where(eq(schoolSettings.id, 1)).run();
          return { calls: [{ name: 'class_roster', args: { contextId: s.ctxA.id } }] };
        },
        () => ({ text: 'Should never be asked.' }),
      ]);
      const chat = await newChat();
      const evs = await events(s.teacherA, (await send(s.teacherA, chat.id, 'Who is in 3-A?')).runId);
      expect(endOf(evs)).toMatchObject({ end: 'error', reason: 'MCP_DISABLED' });
      expect(seen).toHaveLength(1);
      // The read tool did not run either.
      expect(env.db.select().from(assistantMessages).where(eq(assistantMessages.chatId, chat.id)).all().filter((m) => m.role === 'tool' && !m.isError)).toEqual([]);
    });
  });

  it('a running answer stops when student data is switched off; no named result goes out', async () => {
    await withAssistant(
      async () => {
        const seen = script(fake, [
          () => {
            env.db.update(schoolSettings).set({ aiStudentDataAllowed: false }).where(eq(schoolSettings.id, 1)).run();
            return { calls: [{ name: 'class_roster', args: { contextId: s.ctxA.id } }] };
          },
          () => ({ text: 'Should never be asked.' }),
        ]);
        const chat = await newChat();
        const evs = await events(s.teacherA, (await send(s.teacherA, chat.id, `How is ${DEFNE}?`)).runId);
        expect(endOf(evs)).toMatchObject({ end: 'error', reason: 'ASSISTANT_PRIVACY_CHANGED' });
        expect(seen).toHaveLength(1);
      },
      { studentData: true },
    );
  });

  it('tool-call arguments written with names are withheld from the provider once student data is off (D-161)', async () => {
    let chatId = '';
    await withAssistant(
      async () => {
        script(fake, [() => ({ text: 'Here it is.', calls: [{ name: 'add_student_feedback', args: { contextId: s.ctxA.id, studentId: defne.id, body: 'Defne, your reading is lovely!' } }] })]);
        const chat = await newChat();
        chatId = chat.id;
        const evs = await events(s.teacherA, (await send(s.teacherA, chat.id, 'Write Defne some feedback')).runId);
        expect(endOf(evs).end).toBe('awaiting');
        const d = await detail(s.teacherA, chat.id);
        await ok(s.teacherA.post(`${API}/chats/${chat.id}/messages/${d.messages[1].id}/calls/${d.messages[1].calls[0].id}`, { approve: false }));
        await settleRuns(env.app);
      },
      { studentData: true },
    );
    await withAssistant(async () => {
      const seen = script(fake, [() => ({ text: 'Nothing else.' })]);
      await events(s.teacherA, (await send(s.teacherA, chatId, 'Anything else?')).runId);
      const sent = sentText(seen.at(-1)!);
      expect(sent).not.toMatch(/Defne|Yıldız|lovely/u);
      expect(sent).not.toContain(defne.id);
      expect(sent).toContain('withheld');
    });
  });

  it('a change whose free text holds a pseudonym is refused; the card shows text exactly as it is written', async () => {
    await withAssistant(async () => {
      let alias = '';
      const seen = script(fake, [
        rosterTurn,
        (body) => {
          const first = lastToolResult(body).students[0];
          alias = first.id;
          return { calls: [{ name: 'add_student_feedback', args: { contextId: s.ctxA.id, studentId: alias, body: `Well done ${first.fullName}, great reading!` } }] };
        },
        () => ({ calls: [{ name: 'add_student_feedback', args: { contextId: s.ctxA.id, studentId: alias, body: '  Well done, great reading!  ' } }] }),
        () => ({ text: 'Done.' }),
      ]);
      const chat = await newChat();
      const evs = await events(s.teacherA, (await send(s.teacherA, chat.id, 'Praise the first student')).runId);
      expect(endOf(evs).end).toBe('awaiting');
      expect(alias).toMatch(/^student-\d+$/u);
      expect(sentText(seen[2]!)).toContain('stand-in name');
      const d = await detail(s.teacherA, chat.id);
      const calls = d.messages.flatMap((m: any) => m.calls);
      const refused = calls.find((c: any) => c.state === 'refused');
      expect(refused).toMatchObject({ tool: 'add_student_feedback', changes: [] });
      const pending = calls.find((c: any) => c.state === 'pending');
      // Who it is for (with the real name, from the id), and the text exactly as it will be stored.
      expect(pending.target).toMatch(/^3-A English · (Defne Yıldız|Emre Kılıç)$/u);
      const body = pending.changes.find((l: any) => l.key === 'body');
      expect(body).toEqual({ key: 'body', kind: 'text', value: 'Well done, great reading!', optionKey: null, items: [] });
      expect(pending.changes.map((l: any) => l.key)).toEqual(['body']);
      const msg = d.messages.find((m: any) => m.calls.some((c: any) => c.id === pending.id));
      await ok(s.teacherA.post(`${API}/chats/${chat.id}/messages/${msg.id}/calls/${pending.id}`, { approve: true }));
      await settleRuns(env.app);
      const stored = env.db.select().from(teacherFeedback).all().at(-1)!;
      expect(stored.body).toBe(body.value);
      expect(stored.body).not.toMatch(/Student \d/u);
    });
  });

  it('two calls with one id in a reply get their own ids; a Yes runs exactly the call it is on', async () => {
    await withAssistant(async () => {
      script(fake, [
        () => ({
          calls: [
            { id: 'dup', name: 'create_homework', args: { contextId: s.ctxA.id, title: 'EVIL ONE', dueOn: '2026-12-30' } },
            { id: 'dup', name: 'create_homework', args: { contextId: s.ctxA.id, title: 'Harmless', dueOn: '2026-12-30' } },
          ],
        }),
        () => ({ text: 'Done.' }),
      ]);
      const chat = await newChat();
      await events(s.teacherA, (await send(s.teacherA, chat.id, 'Two homeworks')).runId);
      const d = await detail(s.teacherA, chat.id);
      const [a, b] = d.messages[1].calls;
      expect(a.id).toBe('dup');
      expect(b.id).not.toBe('dup');
      expect(b.changes.find((l: any) => l.key === 'title').value).toBe('Harmless');
      await ok(s.teacherA.post(`${API}/chats/${chat.id}/messages/${d.messages[1].id}/calls/${b.id}`, { approve: true }));
      await settleRuns(env.app);
      expect(env.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.title, 'Harmless')).all()).toHaveLength(1);
      expect(env.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.title, 'EVIL ONE')).all()).toEqual([]);
      const after = (await detail(s.teacherA, chat.id)).messages[1].calls;
      expect(after.map((c: any) => c.state)).toEqual(['pending', 'approved']);
      // Two stored calls sharing one id (older data) are never answered.
      const m = env.db.select().from(assistantMessages).where(eq(assistantMessages.id, d.messages[1].id)).get()!;
      env.db
        .update(assistantMessages)
        .set({ toolCallsJson: m.toolCallsJson!.map((c) => ({ ...c, id: 'same', state: 'pending' as const })) })
        .where(eq(assistantMessages.id, m.id))
        .run();
      const r = await s.teacherA.post(`${API}/chats/${chat.id}/messages/${m.id}/calls/same`, { approve: true });
      expect(r.status).toBe(409);
    });
  });

  it('a bulk change shows every item (no cut), statuses by their labels; a goal card says whose goal and which', async () => {
    const hw = await ok(s.teacherA.post(`/api/teacher/contexts/${s.ctxA.id}/homework`, { title: 'Reading log', dueOn: '2026-12-29' }));
    const phone = await openLink(env, await linkUrl(s.teacherA, s.c3a.id, defne.id));
    await ok(phone.post('/api/student/goals', { subjectId: s.english.id, categoryId: READING, text: 'I will read every night.' }));
    const goal = env.db.select().from(goals).where(eq(goals.text, 'I will read every night.')).get()!;
    const others = Array.from({ length: 14 }, (_, i) => ({ studentId: `00000000-0000-7000-8000-0000000d${String(i).padStart(4, '0')}`, status: 'completed' }));
    await withAssistant(
      async () => {
        script(fake, [
          () => ({
            calls: [
              { name: 'set_homework_marks', args: { assignmentId: hw.id, changes: [...others, { studentId: defne.id, status: 'missing' }] } },
              { name: 'update_student_goal', args: { goalId: goal.id, status: 'archived' } },
            ],
          }),
        ]);
        const chat = await newChat();
        await events(s.teacherA, (await send(s.teacherA, chat.id, 'Mark the reading log')).runId);
        const [marks, g] = (await detail(s.teacherA, chat.id)).messages[1].calls;
        expect(marks.state).toBe('pending');
        expect(marks.target).toBe('3-A English · “Reading log”');
        const list = marks.changes.find((l: any) => l.key === 'changes');
        expect(list.kind).toBe('list');
        expect(list.items).toHaveLength(15);
        expect(list.items.at(-1)).toBe(`${DEFNE}: Missing`);
        expect(list.items[0]).toBe('—: Completed');
        expect(marks.changes.map((l: any) => l.key)).toEqual(['changes']);
        expect(g.state).toBe('pending');
        expect(g.target).toBe(`3-A English · ${DEFNE} · “I will read every night.”`);
        expect(g.changes).toEqual([{ key: 'status', kind: 'option', value: 'archived', optionKey: 'goals.status.archived', items: [] }]);
      },
      { studentData: true },
    );
  });

  it("a deactivated teacher's chats are deleted 30 days after the deactivation", async () => {
    const chat = await newChat(s.teacherB);
    try {
      env.db.update(users).set({ disabledAt: env.clock.now() - 29 * 86_400_000 }).where(eq(users.id, s.mehmet.id)).run();
      await purgeOldChats(env.deps);
      expect(env.db.select().from(assistantChats).where(eq(assistantChats.id, chat.id)).all()).toHaveLength(1);
      env.db.update(users).set({ disabledAt: env.clock.now() - 31 * 86_400_000 }).where(eq(users.id, s.mehmet.id)).run();
      await purgeOldChats(env.deps);
      expect(env.db.select().from(assistantChats).where(eq(assistantChats.id, chat.id)).all()).toEqual([]);
    } finally {
      env.db.update(users).set({ disabledAt: null }).where(eq(users.id, s.mehmet.id)).run();
    }
  });

  it('every tool and every argument of a change has words in English and Turkish, for teachers and administrators (D-196)', () => {
    const keysOf = (schema: any): string[] => [
      ...Object.keys(schema?.properties ?? {}),
      ...[...(schema?.anyOf ?? []), ...(schema?.oneOf ?? [])].flatMap(keysOf),
    ];
    const missing: string[] = [];
    const has = (key: string) => key in en && key in tr;
    for (const t of [...assistantTools('teacher'), ...assistantTools('admin')]) {
      if (!has(`assistantChat.tool.${t.name}`)) missing.push(`assistantChat.tool.${t.name}`);
      if (t.readOnly) continue;
      for (const k of keysOf(inputJsonSchema(t))) if (k !== 'opId' && k !== 'batchId' && !has(`assistantChat.arg.${k}`)) missing.push(`assistantChat.arg.${k} (${t.name})`);
    }
    expect(missing).toEqual([]);
  });
});
