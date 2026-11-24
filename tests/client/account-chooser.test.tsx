// @vitest-environment jsdom
/**
 * S36 (D-216): the return pages of Google and of the operator's sign-in server, when the proven
 * address belongs to more than one account: a chooser with one big button per account (name and role
 * in words), in English and Turkish; a choice signs that account in, a choice that no longer works
 * shows the usual error with the way back. Fictional names only.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { ME_KEY } from '../../src/client/lib/session.ts';
import { en, tr } from '../messages.ts';

const navigate = vi.fn(() => Promise.resolve());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => children,
}));

const { GoogleReturnPage } = await import('../../src/client/routes/GoogleSignIn.tsx');
const { SsoReturnPage } = await import('../../src/client/routes/SsoSignIn.tsx');

const choose = [
  { id: 'u-teacher', displayName: 'Deniz Yıldız', role: 'teacher' },
  { id: 'u-admin', displayName: 'Deniz Yıldız', role: 'admin' },
];
const me = { kind: 'user', id: 'u-admin', displayName: 'Deniz Yıldız', role: 'admin', locale: 'en', signInMethod: 'email_link' };

const PAGES = [
  { name: 'Google', provider: 'google', Page: GoogleReturnPage, failed: 'error.GOOGLE_SIGNIN_FAILED' },
  { name: 'the sign-in server', provider: 'sso', Page: SsoReturnPage, failed: 'error.SSO_SIGNIN_FAILED' },
] as const;

type Answer = { status: number; body: unknown } | 'network';
/** A fake server: the completion answers the list; the choices answer `chosen` in turn (a Me, an error, or no network). */
function server(...chosen: Answer[]) {
  const sent: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const r = url.endsWith('/complete') ? { status: 200, body: { choose } } : chosen.shift()!;
    if (r === 'network') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  return sent;
}
const refusal = (status: number, code: string, reason?: string) => ({ status, body: { error: { code, message: 'x', details: reason ? { reason } : undefined } } });

function show(node: ReactNode, locale: Locale = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  qc.setQueryData(ME_KEY, null);
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  localStorage.clear();
  navigate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(PAGES)('the account chooser after $name (S36, D-216)', ({ provider, Page, failed }) => {
  it.each(['en', 'tr'] as const)('offers one big button per account with its name and role (%s); a choice signs that account in', async (locale) => {
    const m = locale === 'en' ? en : tr;
    const sent = server({ status: 200, body: me });
    history.replaceState(null, '', `/signin-${provider}?state=fictional-state-0000000000&code=fictional-code`);
    const qc = show(<Page state="fictional-state-0000000000" code="fictional-code" denied={false} />, locale);
    await waitFor(() => expect(screen.getByText(m['signin.chooseAccount'])).toBeTruthy());
    expect(window.location.search).toBe('');
    const group = screen.getByRole('group', { name: m['signin.chooseAccount'] });
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    // The role in words, not by colour: the same name twice, told apart by "Teacher" / "Administrator".
    expect(buttons.map((b) => b.textContent)).toEqual([`Deniz Yıldız${m['role.teacher']}`, `Deniz Yıldız${m['role.admin']}`]);
    expect(screen.getByRole('button', { name: `Deniz Yıldız, ${m['role.admin']}` })).toBe(buttons[1]);
    for (const b of buttons) expect(b.className).toContain('cc-btn--big');

    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(sent.map((x) => x.url)).toEqual([`/api/auth/${provider}/complete`, `/api/auth/${provider}/choose`]);
    expect(sent[1]!.body).toEqual({ userId: 'u-admin' });
    expect(qc.getQueryData(ME_KEY)).toMatchObject({ id: 'u-admin' });
  });

  it('a choice that no longer works (too late, used) shows the usual error and the way back', async () => {
    server({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: failed.slice('error.'.length) } } } });
    show(<Page state="fictional-state-0000000000" code="fictional-code" denied={false} />);
    await waitFor(() => expect(screen.getByText(en['signin.chooseAccount'])).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Deniz Yıldız, ${en['role.teacher']}` }));
    await waitFor(() => expect(screen.getByText(en[failed])).toBeTruthy());
    expect(screen.queryByTestId('account-chooser')).toBeNull();
    expect(document.body.textContent).toContain(en['auth.backToSignIn']);
    expect(document.body.textContent).toContain(en['signin.emailMe']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('takes the focus to the question when the list replaces "Loading…"', async () => {
    server();
    show(<Page state="fictional-state-0000000000" code="fictional-code" denied={false} />, 'tr');
    await waitFor(() => expect(screen.getByText(tr['signin.chooseAccount'])).toBeTruthy());
    const prompt = screen.getByText(tr['signin.chooseAccount']);
    expect(document.activeElement).toBe(prompt);
    expect(prompt.getAttribute('tabindex')).toBe('-1');
  });

  it('a rate limit, no network or an account that can no longer be chosen keep the list: the error above it, the buttons usable', async () => {
    const sent = server(refusal(429, 'RATE_LIMITED'), 'network', refusal(401, 'UNAUTHENTICATED', `${provider.toUpperCase()}_NO_ACCOUNT`), { status: 200, body: me });
    show(<Page state="fictional-state-0000000000" code="fictional-code" denied={false} />);
    await waitFor(() => expect(screen.getByText(en['signin.chooseAccount'])).toBeTruthy());
    const teacher = () => screen.getByRole('button', { name: `Deniz Yıldız, ${en['role.teacher']}` }) as HTMLButtonElement;
    const adminButton = () => screen.getByRole('button', { name: `Deniz Yıldız, ${en['role.admin']}` }) as HTMLButtonElement;

    fireEvent.click(teacher());
    await waitFor(() => expect(screen.getByText(en['error.RATE_LIMITED'])).toBeTruthy());
    expect(screen.getByTestId('account-chooser')).toBeTruthy();
    expect(teacher().disabled).toBe(false);
    // The error stands above the buttons, inside the chooser.
    const alert = screen.getByText(en['error.RATE_LIMITED']);
    expect(alert.compareDocumentPosition(teacher()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(teacher());
    await waitFor(() => expect(screen.queryByText(en['error.RATE_LIMITED'])).toBeNull());
    await waitFor(() => expect(teacher().disabled).toBe(false));
    expect(screen.getByTestId('account-chooser').querySelector('[role="alert"], .cc-alert')).toBeTruthy();

    fireEvent.click(teacher());
    await waitFor(() => expect(screen.getByText(en[`error.${provider.toUpperCase()}_NO_ACCOUNT` as keyof typeof en])).toBeTruthy());
    expect(adminButton().disabled).toBe(false);

    fireEvent.click(adminButton());
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(sent.filter((x) => x.url.endsWith('/choose'))).toHaveLength(4);
  });
});
