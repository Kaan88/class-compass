// @vitest-environment jsdom
/**
 * Assistant connections on screen (S19a, D-179): the admin list never shows a key; adding needs the
 * KVKK tick and sends the address rules' fields; Test shows what works in words (status region); the
 * Profile section follows the administrator's switch and offers no address-based type to teachers; the
 * return page posts state and code only after the button press and clears the address bar; the area
 * dictionary gives the Turkish text. Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
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
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a ?? { ok: true });
  },
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  Link: ({ children }: { children: ReactNode }) => <a href="#x">{children}</a>,
}));

const { I18nProvider } = await import('../../src/client/lib/i18n.tsx');
const { ME_KEY } = await import('../../src/client/lib/session.ts');
const { AiConnectionsAdminSection, OwnAiConnectionsSection, AiConnectionReturnPage, testResultText } = await import('../../src/client/routes/AiConnections.tsx');
const { translate } = await import('../../src/shared/i18n/index.ts');

const FAKE_KEY = 'sk-fake-client-test-S19A';
const conn = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'openaiCompatible',
  name: 'School server',
  scope: 'school',
  baseUrl: 'http://127.0.0.1:11434/v1',
  localNetwork: true,
  models: [
    { name: 'local-small', testedAt: 1, text: true, tools: true },
    { name: 'local-large', testedAt: null, text: null, tools: null },
  ],
  hasSecret: true,
  secretSetAt: 1,
  secretSource: 'pasted',
  monthlyTokenBudget: 200000,
  dailyMessageLimit: 40,
  enabled: true,
  status: 'ready',
  usage: { monthMessages: 12, monthInputTokens: 1000, monthOutputTokens: 500, todayMessages: 2 },
  kvkkConfirmedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const adminData = (over: Record<string, unknown> = {}) => ({ connections: [conn()], settings: { defaultConnectionId: 'c1', defaultModel: 'local-small', teacherConnectionsAllowed: false }, chatgptAvailable: false, personalConnections: 0, ...over });
const me = { id: 'u1', role: 'admin', classroomMode: false, pinUnlocked: true, locale: 'en' };

function wrap(node: ReactNode, locale: Locale = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, me);
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  answers = { 'GET /api/admin/ai-connections': adminData() };
});
afterEach(cleanup);

describe('Admin → AI tools → Assistant connections', () => {
  it('lists connections with kind, models and their test marks, limits and usage, never a key', async () => {
    wrap(<AiConnectionsAdminSection />);
    expect(await screen.findByText('School server')).toBeTruthy();
    const section = screen.getByTestId('ai-connections');
    expect(within(section).getAllByText(/tested with tools/u).length).toBeGreaterThan(0);
    expect(within(section).getAllByText(/not tested/u).length).toBeGreaterThan(0);
    expect(within(section).getAllByText(/40 messages a day per teacher/u).length).toBeGreaterThan(0);
    expect(within(section).getAllByText('Saved').length).toBeGreaterThan(0);
    expect(section.textContent).not.toContain(FAKE_KEY);
    // ChatGPT: plainly not available, with how to apply.
    expect(within(section).getByText(/OpenAI must first approve Class Compass/u)).toBeTruthy();
    expect(within(section).getByText('How the school can apply (guide)')).toBeTruthy();
  });

  it('adding needs the KVKK tick and sends the address, the local-network tick and the key once', async () => {
    answers['POST /api/admin/ai-connections'] = conn({ id: 'c2' });
    wrap(<AiConnectionsAdminSection />);
    fireEvent.click(await screen.findByTestId('ai-conn-add'));
    const dialog = await screen.findByTestId('ai-conn-dialog');
    fireEvent.change(within(dialog).getByLabelText('Kind of connection'), { target: { value: 'openaiCompatible' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/u), { target: { value: 'Ollama on the school server' } });
    fireEvent.change(within(dialog).getByLabelText(/^Address/u), { target: { value: 'http://127.0.0.1:11434/v1' } });
    fireEvent.click(within(dialog).getByLabelText(/on this server or the school’s network/u));
    fireEvent.change(within(dialog).getByLabelText(/API key/u), { target: { value: FAKE_KEY } });
    fireEvent.change(within(dialog).getByLabelText(/Models, one per line/u), { target: { value: 'llama-small\n\nqwen-tools\n' } });
    fireEvent.change(within(dialog).getByLabelText(/Monthly budget/u), { target: { value: '100 000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Tick the data processor confirmation.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(within(dialog).getByTestId('ai-conn-kvkk'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.input).toEqual({
      type: 'openaiCompatible',
      name: 'Ollama on the school server',
      models: ['llama-small', 'qwen-tools'],
      monthlyTokenBudget: 100000,
      dailyMessageLimit: null,
      apiKey: FAKE_KEY,
      baseUrl: 'http://127.0.0.1:11434/v1',
      localNetwork: true,
      kvkkConfirmed: true,
    });
  });

  it('Test reports in words what works (a status region, not colour)', async () => {
    answers['POST /api/admin/ai-connections/:connectionId/test'] = { ok: false, text: true, tools: false, failure: null, httpStatus: null, ms: 40 };
    wrap(<AiConnectionsAdminSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test local-large' }));
    const status = screen.getByTestId('ai-conn-test-result');
    await waitFor(() => expect(status.textContent).toContain('did not call the test tool'));
    expect(status.getAttribute('role')).toBe('status');
    expect(calls.find((c) => c.path.endsWith('/test'))!.input).toEqual({ connectionId: 'c1', model: 'local-large' });
  });

  it('the default lists every connection’s models; the own-connections switch is off by default', async () => {
    wrap(<AiConnectionsAdminSection />);
    const select = (await screen.findByLabelText('Connection and model the assistant uses')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['None chosen', 'School server: local-small', 'School server: local-large']);
    expect(screen.getByText('Teachers may add their own connection')).toBeTruthy();
  });
});

describe('Profile → My assistant connections', () => {
  it('while not allowed: the school default and the reason, no Add', async () => {
    answers['GET /api/teacher/ai-connections'] = { allowed: false, connections: [], schoolDefault: { name: 'School server', type: 'openaiCompatible', model: 'local-small' }, chatgptAvailable: false };
    wrap(<OwnAiConnectionsSection />);
    expect(await screen.findByText('Chosen by your school for the assistant: School server (local-small).')).toBeTruthy();
    // The chat is not built yet: the card says so instead of implying an assistant is in use.
    expect(screen.getByTestId('ai-conn-not-yet').textContent).toContain('on their Assistant page');
    expect(screen.getByText('Your school has not allowed teachers’ own connections.')).toBeTruthy();
    expect(screen.queryByTestId('ai-conn-add')).toBeNull();
  });

  it('when allowed: Add offers no address-based or unavailable kinds', async () => {
    answers['GET /api/teacher/ai-connections'] = { allowed: true, connections: [], schoolDefault: null, chatgptAvailable: false };
    wrap(<OwnAiConnectionsSection />);
    fireEvent.click(await screen.findByTestId('ai-conn-add'));
    const select = (await screen.findByLabelText('Kind of connection')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['anthropic', 'openai', 'gemini', 'openrouter']);
    expect(screen.queryByLabelText(/Monthly budget/u)).toBeNull();
  });
});

describe('the sign-in return page', () => {
  it('without state and code it says so', () => {
    wrap(<AiConnectionReturnPage />);
    expect(screen.getByText(/opened without a sign-in to finish/u)).toBeTruthy();
  });

  it('clears the address bar and posts state and code only after the button press', async () => {
    window.history.replaceState(null, '', '/ai-connections/return?state=s&code=c');
    answers['POST /api/account/ai-connections/oauth/finish'] = { connectionId: 'c1', scope: 'school', name: 'OpenRouter account' };
    wrap(<AiConnectionReturnPage state={'s'.repeat(43)} code="fake-code" />);
    expect(window.location.search).toBe('');
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Finish connecting' }));
    expect(await screen.findByText('OpenRouter account is connected.')).toBeTruthy();
    expect(calls[0]!.input).toEqual({ state: 's'.repeat(43), code: 'fake-code' });
  });
});

describe('words', () => {
  it('Turkish comes from the area dictionary', async () => {
    wrap(<AiConnectionsAdminSection />, 'tr');
    expect(await screen.findByText('Asistan bağlantıları')).toBeTruthy();
    expect(translate('tr', 'error.AI_URL_METADATA')).toContain('meta veri');
  });

  it('test results in words for every outcome', () => {
    const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
    expect(testResultText(t as never, 'm', { ok: true, text: true, tools: true, failure: null, httpStatus: null, ms: 1 })).toBe('m: text works and tools work.');
    expect(testResultText(t as never, 'm', { ok: false, text: false, tools: false, failure: 'KEY_REJECTED', httpStatus: 401, ms: 1 })).toBe('m: the test failed. The provider refused the key.');
    // Text worked and the request with tools failed (a server without tool support answers 400).
    expect(testResultText(t as never, 'm', { ok: false, text: true, tools: false, failure: 'PROVIDER_ERROR', httpStatus: 400, ms: 1 })).toBe(
      'm: text works, but the request with tools failed. The provider answered with an error. The assistant could answer but not use the app.',
    );
    expect(testResultText(t as never, 'm', { ok: false, text: false, tools: false, failure: 'OUT_OF_TOKENS', httpStatus: null, ms: 1 })).toContain('used up its answer limit');
  });

  it('the result’s status region is never display: none while empty (it must stay in the accessibility tree)', async () => {
    const css = fs.readFileSync(path.resolve('src/client/styles/app.css'), 'utf8');
    expect(css).not.toMatch(/\.cc-ai-test:empty\s*\{[^}]*display:\s*none/u);
    wrap(<AiConnectionsAdminSection />);
    const status = await screen.findByTestId('ai-conn-test-result');
    expect(status.getAttribute('role')).toBe('status');
    expect(screen.getByTestId('ai-conn-not-yet')).toBeTruthy();
  });
});
