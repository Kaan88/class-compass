// @vitest-environment jsdom
/**
 * The Assistant page on screen (S19b, D-180): the reason it cannot be used, the privacy line, a streamed
 * answer read from Server-Sent Events (events outside the contract's allow-list are dropped), "looked at"
 * lines, the change card whose Yes sends only Yes (never a tool or arguments), Copy on answers with the
 * note that nothing is ever sent from the app, a failed answer shown as words without provider text,
 * the administrator's section, and the Turkish strings. Fictional data only.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';

const calls: Array<{ path: string; method: string; input: any }> = [];
let answers: Record<string, unknown> = {};
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: (ep: { path: string; method: string }, input: unknown) => {
    calls.push({ path: ep.path, method: ep.method, input });
    const a = answers[`${ep.method} ${ep.path}`];
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(typeof a === 'function' ? a(input) : (a ?? { ok: true }));
  },
}));
const navigations: unknown[] = [];
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => (to: unknown) => {
    navigations.push(to);
    return Promise.resolve();
  },
  Link: ({ children }: { children: ReactNode }) => <a href="#x">{children}</a>,
}));

const { I18nProvider } = await import('../../src/client/lib/i18n.tsx');
const { ME_KEY } = await import('../../src/client/lib/session.ts');
const { default: AssistantChatPage, readRun, failureText } = await import('../../src/client/modules/assistantChat/AssistantChatPage.tsx');
const { AssistantChatAdminSection } = await import('../../src/client/routes/admin/AssistantChatAdmin.tsx');
const { assistantChatClientManifest } = await import('../../src/client/modules/assistantChat/manifest.tsx');
const { en, tr } = await import('../../src/shared/i18n/areas/assistantChat.ts');
const { translate } = await import('../../src/shared/i18n/index.ts');

const CHAT = '00000000-0000-7000-8000-0000000000a1';
const USER_MSG = '00000000-0000-7000-8000-0000000000b1';
const BOT_MSG = '00000000-0000-7000-8000-0000000000b2';
const RUN = '00000000-0000-7000-8000-0000000000c1';
const status = (over: Record<string, unknown> = {}) => ({
  available: true,
  unavailable: null,
  studentNames: false,
  connections: [{ id: 'conn-1', name: 'School model', type: 'openai', scope: 'school', models: [{ name: 'fake-chat', tools: true }] }],
  defaultConnectionId: 'conn-1',
  defaultModel: 'fake-chat',
  retentionDays: 365,
  ...over,
});
const summary = { id: CHAT, title: 'Homework for 3-A', createdAt: 1, lastMessageAt: 1_700_000_000_000, archived: false, connectionId: 'conn-1', model: 'fake-chat' };
const pendingCall = { id: 'call_hw', tool: 'create_homework', readOnly: false, state: 'pending', target: '3-A English', changes: [
    { key: 'title', kind: 'text', value: 'Read chapter 3', optionKey: null, items: [] },
    { key: 'dueOn', kind: 'text', value: '2026-11-13', optionKey: null, items: [] },
  ],
  failed: null,
};
const detail = (over: Record<string, unknown> = {}) => ({
  chat: summary,
  messages: [
    { id: USER_MSG, role: 'user', text: 'Set reading homework for Defne Yıldız’s class', createdAt: 1, status: 'complete', errorCode: null, calls: [] },
    {
      id: BOT_MSG,
      role: 'assistant',
      text: 'I will set it.',
      createdAt: 2,
      status: 'complete',
      errorCode: null,
      calls: [{ id: 'call_r', tool: 'class_roster', readOnly: true, state: 'auto', target: '3-A English', changes: [], failed: false }, pendingCall],
    },
  ],
  runId: null,
  compacted: false,
  ...over,
});
const me = { id: 'u1', role: 'teacher', classroomMode: false, pinUnlocked: true, locale: 'en' };

function wrap(node: ReactNode, locale: Locale = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, me);
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

/** A fetch that answers the run's event stream with these SSE blocks. */
function sse(blocks: unknown[]) {
  const body = blocks.map((b) => (typeof b === 'string' ? b : `data: ${JSON.stringify(b)}\n\n`)).join('');
  return vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
}

beforeEach(() => {
  calls.length = 0;
  navigations.length = 0;
  answers = {
    'GET /api/teacher/assistant-chat': status(),
    'GET /api/teacher/assistant-chat/chats': { chats: [summary] },
    'GET /api/teacher/assistant-chat/chats/:chatId': detail(),
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('assistant page (S19b, D-180)', () => {
  it('is a lazy "Today" page of the teacher menu with its own label in both languages', () => {
    const page = assistantChatClientManifest.teacherPages![0]!;
    expect(page).toMatchObject({ key: 'assistantChat', path: 'ai-assistant', group: 'today', labelKey: 'assistantChat.title' });
    expect(translate('en', 'assistantChat.title')).toBe('Assistant');
    expect(translate('tr', 'assistantChat.title')).toBe('Asistan');
  });

  it('explains why it cannot be used (off, AI tools off, no connection)', async () => {
    for (const [reason, text] of [
      ['OFF', 'The assistant is not switched on'],
      ['AI_TOOLS_OFF', 'AI tools are switched off at this school'],
      ['NO_CONNECTION', 'No connection to an AI provider can be used now'],
    ] as const) {
      answers['GET /api/teacher/assistant-chat'] = status({ available: false, unavailable: reason, connections: [] });
      wrap(<AssistantChatPage search={{}} />);
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByTestId('assistant-chat-list')).toBeNull();
      cleanup();
    }
  });

  it('lists chats, says what the provider sees, and opens a chat', async () => {
    wrap(<AssistantChatPage search={{}} />);
    expect((await screen.findByTestId('assistant-privacy')).textContent).toContain('the AI provider sees “Student 1”');
    fireEvent.click(await screen.findByText('Homework for 3-A'));
    expect(navigations.at(-1)).toMatchObject({ params: { page: 'ai-assistant' }, search: { chat: CHAT } });
    cleanup();
    answers['GET /api/teacher/assistant-chat'] = status({ studentNames: true });
    wrap(<AssistantChatPage search={{}} />);
    expect((await screen.findByTestId('assistant-privacy')).textContent).toContain('sees names');
  });

  it('shows "looked at" lines and a change card; Yes sends only Yes and follows the new answer', async () => {
    const fetch = sse([
      { type: 'tool', seq: 1, messageId: BOT_MSG, call: { ...pendingCall, state: 'approved', failed: false } },
      { type: 'text', seq: 2, messageId: '00000000-0000-7000-8000-0000000000b3', text: 'Done: the ' },
      // Not in the allow-list: dropped.
      { type: 'script', seq: 3, html: '<img src=x onerror=alert(1)>' },
      { type: 'text', seq: 4, messageId: '00000000-0000-7000-8000-0000000000b3', text: 'homework is set.' },
      { type: 'end', seq: 5, end: 'complete', reason: null },
    ]);
    vi.stubGlobal('fetch', fetch);
    answers['POST /api/teacher/assistant-chat/chats/:chatId/messages/:messageId/calls/:callId'] = { runId: RUN };
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    expect((await screen.findByTestId('assistant-activity')).textContent).toBe('Looked at: Class list (3-A English)');
    const card = await screen.findByTestId('assistant-change-card');
    // Words, never the tool's or the argument's identifier.
    expect(card.textContent).toContain('Change: New homework');
    expect(card.textContent).not.toContain('create_homework');
    expect(within(card).getByText('Title')).toBeTruthy();
    expect(within(card).getByText('Due on')).toBeTruthy();
    expect(card.textContent).toContain('Read chapter 3');
    expect(within(card).getByText('Should Class Compass make this change?')).toBeTruthy();
    // Delivery to parents is never from the app.
    expect(screen.getByTestId('assistant-parents-note').textContent).toContain('never sends anything to parents');
    // What the stored chat holds once the new answer is done (the page reloads it at the end of the run).
    const done = detail() as any;
    done.messages[1].calls[1] = { ...pendingCall, state: 'approved', failed: false };
    done.messages.push({ id: '00000000-0000-7000-8000-0000000000b3', role: 'assistant', text: 'Done: the homework is set.', createdAt: 3, status: 'complete', errorCode: null, calls: [] });
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = done;
    fireEvent.click(within(card).getByTestId('assistant-card-yes'));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const answer = calls.find((c) => c.path.endsWith('/calls/:callId'))!;
    expect(answer.input).toEqual({ chatId: CHAT, messageId: BOT_MSG, callId: 'call_hw', approve: true });
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(`/api/teacher/assistant-chat/runs/${RUN}/events?after=0`);
    expect(await screen.findByText('Done: the homework is set.')).toBeTruthy();
    expect((await screen.findByTestId('assistant-card-decided')).textContent).toBe('You said Yes. The change is made.');
    expect(document.body.innerHTML).not.toContain('onerror');
  });

  it('No sends approve: false', async () => {
    answers['POST /api/teacher/assistant-chat/chats/:chatId/messages/:messageId/calls/:callId'] = { runId: null };
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    fireEvent.click(await screen.findByTestId('assistant-card-no'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/calls/:callId'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/calls/:callId'))!.input).toEqual({ chatId: CHAT, messageId: BOT_MSG, callId: 'call_hw', approve: false });
  });

  it('audit finding 5: the model picker shows the default for a chat that follows it, and when the chat’s own choice can no longer be used', async () => {
    const two = status({
      connections: [
        { id: 'conn-1', name: 'School model', type: 'openai', scope: 'school', models: [{ name: 'fake-chat', tools: true }] },
        { id: 'conn-2', name: 'Second model', type: 'openai', scope: 'school', models: [{ name: 'fake-other', tools: true }] },
      ],
      defaultConnectionId: 'conn-2',
      defaultModel: 'fake-other',
    });
    answers['GET /api/teacher/assistant-chat'] = two;
    for (const chat of [
      { ...summary, connectionId: null, model: null },
      { ...summary, connectionId: 'conn-gone', model: 'gone-model' },
    ]) {
      answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({ chat });
      wrap(<AssistantChatPage search={{ chat: CHAT }} />);
      await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('conn-2|fake-other'));
      cleanup();
    }
    // A chat's own usable choice is shown as it is.
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({ chat: { ...summary, connectionId: 'conn-1', model: 'fake-chat' } });
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('conn-1|fake-chat'));
  });

  it('decided cards say what happened in words', async () => {
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({
      messages: [
        {
          id: BOT_MSG,
          role: 'assistant',
          text: '',
          createdAt: 2,
          status: 'complete',
          errorCode: null,
          calls: [
            { ...pendingCall, id: 'a', state: 'declined' },
            { ...pendingCall, id: 'b', state: 'expired' },
            { ...pendingCall, id: 'c', state: 'approved', failed: true },
            { id: 'd', tool: 'unknown', readOnly: false, state: 'refused', target: null, changes: [], failed: true },
          ],
        },
      ],
    });
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    const decided = (await screen.findAllByTestId('assistant-card-decided')).map((e) => e.textContent);
    expect(decided).toEqual(['You said No. Nothing was changed.', 'Not answered before the next message. Nothing was changed.', 'You said Yes, but the change could not be made.']);
    expect(screen.getByTestId('assistant-activity').textContent).toBe('The assistant cannot do this. Nothing was changed.');
    expect(screen.queryByTestId('assistant-card-yes')).toBeNull();
  });

  it('sends a message, streams the answer, then Copy copies it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({ messages: [] });
    answers['POST /api/teacher/assistant-chat/chats/:chatId/messages'] = { runId: RUN, messageId: USER_MSG };
    vi.stubGlobal('fetch', sse([{ type: 'text', seq: 1, messageId: BOT_MSG, text: 'Dear parents, ' }, { type: 'text', seq: 2, messageId: BOT_MSG, text: 'next week…' }, { type: 'end', seq: 3, end: 'complete', reason: null }]));
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    expect(await screen.findByTestId('assistant-suggestions')).toBeTruthy();
    fireEvent.click(screen.getByText('Draft a short, friendly note to parents about next week’s school trip.'));
    const box = screen.getByLabelText('Your message') as HTMLTextAreaElement;
    expect(box.value).toContain('note to parents');
    // After the answer the stored chat holds it (the page reloads it at the end of the run).
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({
      messages: [
        { id: USER_MSG, role: 'user', text: box.value, createdAt: 1, status: 'complete', errorCode: null, calls: [] },
        { id: BOT_MSG, role: 'assistant', text: 'Dear parents, next week…', createdAt: 2, status: 'complete', errorCode: null, calls: [] },
      ],
    });
    fireEvent.click(screen.getByTestId('assistant-send'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'))?.input).toMatchObject({ chatId: CHAT, text: expect.stringContaining('note to parents') }));
    expect(await screen.findByText('Dear parents, next week…')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('assistant-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Dear parents, next week…'));
  });

  it('a failed answer shows the failure in words, never the provider’s text', async () => {
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({
      messages: [{ id: BOT_MSG, role: 'assistant', text: 'Partly', createdAt: 2, status: 'error', errorCode: 'KEY_REJECTED', calls: [] }],
    });
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    expect((await screen.findByRole('alert')).textContent).toBe('This answer failed: The provider refused the key.');
    expect(failureText((k) => translate('en', k), 'AI_DAILY_LIMIT')).toBe('You have reached today’s message limit for this connection.');
    expect(failureText((k) => translate('en', k), 'something the provider said')).toBe(translate('en', 'common.error'));
  });

  it('readRun stops at the end event and skips blocks that are not data', async () => {
    vi.stubGlobal('fetch', sse([': heartbeat\n\n', { type: 'text', seq: 1, messageId: BOT_MSG, text: 'a' }, { type: 'end', seq: 2, end: 'awaiting', reason: null }, { type: 'text', seq: 3, messageId: BOT_MSG, text: 'late' }]));
    const seen: unknown[] = [];
    await readRun(RUN, 0, (e) => seen.push(e), new AbortController().signal);
    expect(seen).toEqual([
      { type: 'text', seq: 1, messageId: BOT_MSG, text: 'a' },
      { type: 'end', seq: 2, end: 'awaiting', reason: null },
    ]);
  });

  it('a card in Turkish: tool, arguments, choices and lists in words, every item shown; the messages list has its own name', async () => {
    const marks = Array.from({ length: 15 }, (_, i) => `Öğrenci ${i + 1}: Yapıldı`);
    const card = {
      id: 'call_m',
      tool: 'set_homework_marks',
      readOnly: false,
      state: 'pending',
      target: '3-A İngilizce · “Okuma günlüğü”',
      changes: [
        { key: 'changes', kind: 'list', value: '', optionKey: null, items: marks },
        { key: 'module', kind: 'option', value: 'homework', optionKey: 'module.homework', items: [] },
        { key: 'enabled', kind: 'flag', value: 'false', optionKey: null, items: [] },
        { key: 'goalId', kind: 'missing', value: '', optionKey: null, items: [] },
      ],
      failed: null,
    };
    answers['GET /api/teacher/assistant-chat/chats/:chatId'] = detail({
      messages: [
        { id: BOT_MSG, role: 'assistant', text: '', createdAt: 2, status: 'complete', errorCode: null, calls: [{ id: 'r', tool: 'homework_check', readOnly: true, state: 'auto', target: '3-A İngilizce', changes: [], failed: false }, card] },
      ],
    });
    wrap(<AssistantChatPage search={{ chat: CHAT }} />, 'tr');
    const c = await screen.findByTestId('assistant-change-card');
    expect(c.textContent).toContain('Değişiklik: Ödev işaretleri');
    expect(c.textContent).toContain('İlgili: 3-A İngilizce · “Okuma günlüğü”');
    expect(c.textContent).not.toMatch(/set_homework_marks|assignmentId|changes|goalId/u);
    expect(within(c).getByText('İşaretler')).toBeTruthy();
    expect(within(c).getByText('15 öğe')).toBeTruthy();
    // Every item, the last one too (nothing is cut).
    expect(within(c).getAllByRole('listitem')).toHaveLength(15);
    expect(within(c).getByText('Öğrenci 15: Yapıldı')).toBeTruthy();
    expect(within(c).getByText('Ödevler')).toBeTruthy();
    expect(c.querySelector('[data-key="enabled"] dd')?.textContent).toBe('Hayır');
    expect(c.textContent).toContain('değişiklik reddedilir');
    expect(screen.getByTestId('assistant-activity').textContent).toBe('Bakıldı: Ödev kontrolü (3-A İngilizce)');
    expect(screen.getByTestId('assistant-messages').getAttribute('aria-label')).toBe('Mesajlar');
  });

  it('Turkish', async () => {
    wrap(<AssistantChatPage search={{ chat: CHAT }} />, 'tr');
    expect(await screen.findByText('Sınıf Pusulası bu değişikliği yapsın mı?')).toBeTruthy();
    expect(screen.getByTestId('assistant-parents-note').textContent).toContain('velilere');
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });
});

describe('administrator section (S19b, D-180)', () => {
  it('cannot switch on without a ready connection; shows numbers only', async () => {
    answers['GET /api/admin/assistant-chat'] = { enabled: false, retentionDays: 365, aiToolsEnabled: false, readyConnections: 0, chats: 3, teachers: 2 };
    wrap(<AssistantChatAdminSection />);
    expect(await screen.findByText('Add a school connection above and test it first.')).toBeTruthy();
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('assistant-admin-counts').textContent).toContain('Chats now: 3, by 2 accounts');
  });

  it('switches on and changes the retention', async () => {
    answers['GET /api/admin/assistant-chat'] = { enabled: true, retentionDays: 365, aiToolsEnabled: false, readyConnections: 1, chats: 0, teachers: 0 };
    answers['PUT /api/admin/assistant-chat'] = { enabled: true, retentionDays: 180, aiToolsEnabled: false, readyConnections: 1, chats: 0, teachers: 0 };
    wrap(<AssistantChatAdminSection />);
    expect(await screen.findByText('The AI tools switch below is off, so teachers cannot use the chat yet.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Delete a chat after its last message'), { target: { value: '180' } });
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.input).toEqual({ retentionDays: 180 }));
    expect(screen.getByRole('option', { name: '365 days (one school year)' })).toBeTruthy();
  });
});
