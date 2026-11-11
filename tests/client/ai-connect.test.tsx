// @vitest-environment jsdom
/**
 * "Connect an AI app" (S19c, D-181): the guided setup on Profile → AI tools. The teacher chooses an app
 * and sees numbered steps with the school's exact address (from the server), the method, copy
 * buttons, the Claude Code commands (sign-in, token, Cloudflare Access service token), a friendly
 * "ask your administrator" when AI tools are off or the app's return host is not allowed, and "Check
 * connection" with the last tool call. Fictional data only; no network.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiToolsSetup } from '../../src/shared/contracts/mcp.ts';
import { en, tr } from '../../src/shared/i18n/areas/aiConnect.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import type { Me } from '../../src/client/lib/session.ts';

const calls = vi.hoisted(() => ({ next: null as unknown }));
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: vi.fn(async () => calls.next),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: unknown }) => children,
}));

const { AI_SETUP_KEY, claudeCodeCommands, ConnectAiApp } = await import('../../src/client/routes/AiConnect.tsx');

afterEach(cleanup);

const URL = 'https://school.example.org/mcp';
const teacher = { id: 'u1', role: 'teacher', locale: 'en', signInMethod: 'password' } as unknown as Me;
const admin = { ...teacher, role: 'admin' } as unknown as Me;
const setup = (over: Partial<AiToolsSetup> = {}, chatgptAllowed = false): AiToolsSetup => ({
  enabled: true,
  studentDataAllowed: false,
  url: URL,
  apps: [
    { app: 'chatgpt', returnHost: 'chatgpt.com', returnHostAllowed: chatgptAllowed, lastToolCall: null, lastSeenAt: null },
    { app: 'claude', returnHost: 'claude.ai', returnHostAllowed: true, lastToolCall: null, lastSeenAt: null },
    { app: 'claude-code', returnHost: 'claude.ai', returnHostAllowed: true, lastToolCall: null, lastSeenAt: null },
    { app: 'other', returnHost: null, returnHostAllowed: true, lastToolCall: null, lastSeenAt: null },
  ],
  ...over,
});

function mount(data: AiToolsSetup, me: Me = teacher, locale: 'en' | 'tr' = 'en', onMakeToken = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(AI_SETUP_KEY, data);
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </QueryClientProvider>
  );
  return render(wrap(<ConnectAiApp me={me} onMakeToken={onMakeToken} />));
}

const radio = (app: string) => within(screen.getByTestId(`ai-app-${app}`)).getByRole('radio') as HTMLInputElement;

describe('Connect an AI app (S19c, D-181)', () => {
  it('builds the Claude Code commands from the school address, with placeholders only', () => {
    const c = claudeCodeCommands(URL);
    expect(c.signIn).toBe(`claude mcp add --transport http class-compass ${URL}`);
    expect(c.token).toBe(`${c.signIn} --header "Authorization: Bearer <your token>"`);
    expect(c.access).toContain('--header "CF-Access-Client-Id: <id>" --header "CF-Access-Client-Secret: <secret>"');
    expect(c.access).toContain('Authorization: Bearer <your token>');
  });

  it('ChatGPT: numbered steps with the exact address; a teacher is asked to go to the administrator while chatgpt.com is not allowed', () => {
    mount(setup());
    expect(screen.getByRole('heading', { name: en['aiConnect.title'] })).toBeTruthy();
    expect(radio('chatgpt').checked).toBe(true);
    const panel = screen.getByTestId('ai-panel');
    expect(panel.dataset.app).toBe('chatgpt');
    expect(within(panel).getByTestId('ai-copy-url-text').textContent).toBe(URL);
    expect(within(panel).getByTestId('ai-method').textContent).toContain(en['aiConnect.method.oauth']);
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5 + 3); // the steps and the diagram
    expect(screen.getByTestId('ai-host-blocked').textContent).toBe(en['aiConnect.hostBlockedTeacher'].replace('{app}', 'ChatGPT').replace('{host}', 'chatgpt.com'));
  });

  it('no host warning once the administrator allowed chatgpt.com, and none for other clients', () => {
    mount(setup({}, true));
    expect(screen.queryByTestId('ai-host-blocked')).toBeNull();
    fireEvent.click(radio('other'));
    expect(screen.queryByTestId('ai-host-blocked')).toBeNull();
    expect(screen.getByTestId('ai-copy-url-text').textContent).toBe(URL);
  });

  it('Claude Code: sign-in and token commands with copy buttons; Make a token opens the token dialog', () => {
    const make = vi.fn();
    mount(setup(), teacher, 'en', make);
    fireEvent.click(radio('claude-code'));
    const c = claudeCodeCommands(URL);
    expect(screen.getByTestId('ai-copy-signin-text').textContent).toBe(c.signIn);
    expect(screen.getByTestId('ai-copy-token-cmd-text').textContent).toBe(c.token);
    expect(screen.getByTestId('ai-copy-access-text').textContent).toBe(c.access);
    expect(screen.getByRole('button', { name: en['aiConnect.copySignInCommand'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: en['aiConnect.copyAccessCommand'] })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en['aiConnect.makeToken'] }));
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('Check connection shows the last tool call from that app, or says there is none yet', async () => {
    mount(setup());
    fireEvent.click(radio('claude'));
    calls.next = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['aiConnect.check'] }));
    });
    expect(screen.getByTestId('ai-check-result').textContent).toBe(en['aiConnect.noCall'].replace('{app}', 'Claude'));
    const at = Date.UTC(2026, 10, 11, 9, 30);
    const withCall = setup();
    withCall.apps[1] = { ...withCall.apps[1]!, lastToolCall: { at, tool: 'list_my_classes', via: 'connection', name: 'Claude', live: true }, lastSeenAt: at };
    calls.next = withCall;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['aiConnect.check'] }));
    });
    const result = screen.getByTestId('ai-check-result');
    expect(result.dataset.state).toBe('ok');
    expect(result.textContent).toContain('Last tool call from Claude: list_my_classes');
    expect(result.textContent).toContain('connected app "Claude"');
  });

  it('AI tools off: teachers are asked to go to their administrator, with what the administrator does', () => {
    mount(setup({ enabled: false }));
    expect(screen.getByTestId('ai-off').textContent).toContain(en['aiConnect.offTeacher']);
    expect(screen.getByText(en['aiConnect.offStep1'])).toBeTruthy();
    expect(screen.queryByTestId('ai-panel')).toBeNull();
    cleanup();
    mount(setup({ enabled: false }), admin);
    expect(screen.getByTestId('ai-off').textContent).toContain(en['aiConnect.offAdmin']);
    expect(screen.getByText(en['aiConnect.openChecklist'])).toBeTruthy();
  });

  it('Turkish: the same page in Turkish', () => {
    mount(setup(), teacher, 'tr');
    expect(screen.getByRole('heading', { name: tr['aiConnect.title'] })).toBeTruthy();
    expect(screen.getByText(tr['aiConnect.chatgpt.step3'])).toBeTruthy();
    expect(screen.getByRole('button', { name: tr['aiConnect.check'] })).toBeTruthy();
  });
});
