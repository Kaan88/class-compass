// @vitest-environment jsdom
/**
 * Usability fixes in the sign-in pages and Help (November crawl, D-142; UX-3/UX-4): sign-in pages
 * in English or Turkish per device (school default / browser language otherwise), expired links
 * that lead somewhere, the invite's username on its own, the email-link confirmation naming the
 * typed address, Help in one language with a folded guide list on phones, full-size guide pictures
 * and list markers inside guides. Fictional data only.
 */
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { ME_KEY } from '../../src/client/lib/session.ts';
import { chooseSignedOutLocale, resetSignedOutLocaleForTests, signedOutLocale, storedSignedOutLocale } from '../../src/client/lib/signedOutLocale.ts';

const search: { current: Record<string, unknown> } = { current: {} };
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useSearch: () => search.current,
  Link: ({ children, to, search: s, className, ...rest }: { children: ReactNode; to: string; search?: Record<string, unknown>; className?: string }) => {
    const q = new URLSearchParams(Object.entries(s ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')).toString();
    return (
      <a href={`${to}${q ? `?${q}` : ''}`} className={className} {...rest}>
        {children}
      </a>
    );
  },
}));

const { AuthCard } = await import('../../src/client/routes/AuthCard.tsx');
const { SignInLinkPage, useFragmentToken, EmailLinkRequest } = await import('../../src/client/routes/SignIn.tsx');
const { ResetPasswordPage } = await import('../../src/client/routes/Auth.tsx');
const { HelpPage } = await import('../../src/client/help/HelpPage.tsx');

function client(me: unknown = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(ME_KEY, me);
  return qc;
}
const wrap = (node: ReactNode, locale: Locale = 'en', qc = client()) => (
  <QueryClientProvider client={qc}>
    <I18nProvider locale={locale}>{node}</I18nProvider>
  </QueryClientProvider>
);

function stubLanguages(langs: string[]) {
  vi.stubGlobal('navigator', { ...navigator, language: langs[0], languages: langs });
}

beforeEach(() => {
  localStorage.clear();
  resetSignedOutLocaleForTests();
  search.current = {};
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sign-in pages language before sign-in (UX-3, UX-4, D-142)', () => {
  it('follows the device choice, then a Turkish browser, then the school default, then English', () => {
    stubLanguages(['en-GB', 'en']);
    expect(signedOutLocale(undefined)).toBe('en');
    expect(signedOutLocale('tr')).toBe('tr');
    stubLanguages(['tr-TR', 'en']);
    expect(signedOutLocale('en')).toBe('tr');
    chooseSignedOutLocale('en');
    expect(signedOutLocale('tr')).toBe('en');
    expect(localStorage.getItem('cc.signinLocale')).toBe('en');
    resetSignedOutLocaleForTests();
    expect(storedSignedOutLocale()).toBe('en');
  });

  it('still works when storage is blocked (this visit only)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    stubLanguages(['en-GB']);
    expect(signedOutLocale(undefined)).toBe('en');
    chooseSignedOutLocale('tr');
    expect(signedOutLocale(undefined)).toBe('tr');
  });

  it('the sign-in card offers English | Türkçe signed out, and nothing to a signed-in account', () => {
    render(wrap(<AuthCard title="Sign in">x</AuthCard>));
    const group = screen.getByTestId('auth-language');
    const tr = group.querySelector('button[lang="tr"]') as HTMLButtonElement;
    expect(tr.textContent).toBe('Türkçe');
    expect(group.querySelector('button[lang="en"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tr);
    expect(storedSignedOutLocale()).toBe('tr');
    cleanup();
    render(wrap(<AuthCard title="Change password">x</AuthCard>, 'en', client({ id: 'u1', locale: 'en' })));
    expect(screen.queryByTestId('auth-language')).toBeNull();
    cleanup();
    render(wrap(<AuthCard title="Welcome" languageSwitch={false}>x</AuthCard>));
    expect(screen.queryByTestId('auth-language')).toBeNull();
  });
});

describe('expired links lead somewhere (D-142)', () => {
  it('an invalid sign-in link offers a new link and the sign-in page', () => {
    render(wrap(<SignInLinkPage />));
    expect(screen.getByText(/does not work any more/u)).toBeTruthy();
    const again = screen.getByText('Email me a new sign-in link').closest('a')!;
    expect(again.getAttribute('href')).toBe('/login?mode=email-link');
    expect(again.className).toContain('cc-btn--big');
    expect(screen.getByText('Back to sign-in').closest('a')!.getAttribute('href')).toBe('/login');
  });

  it('a reset page without a token offers a new reset link (in Turkish too)', () => {
    render(wrap(<ResetPasswordPage />, 'tr'));
    expect(screen.getByText('Yeni bir sıfırlama bağlantısı iste').closest('a')!.getAttribute('href')).toBe('/login?mode=forgot');
    expect(screen.getByText('Giriş sayfasına dön')).toBeTruthy();
  });

  it('a second link opened in the same tab replaces the first token and leaves the address bar clean', async () => {
    let seen = '';
    function Probe() {
      seen = useFragmentToken();
      return null;
    }
    history.replaceState(null, '', '/invite#token=first-fictional');
    render(<Probe />);
    expect(seen).toBe('first-fictional');
    expect(window.location.hash).toBe('');
    act(() => {
      history.replaceState(null, '', '/invite#token=second-fictional');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(seen).toBe('second-fictional'));
    expect(window.location.hash).toBe('');
  });
});

describe('email-link confirmation (D-142)', () => {
  it('repeats the typed address and lets the teacher type another one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ requestId: '0190f0f0-0000-7000-8000-000000000001' }), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    render(wrap(<EmailLinkRequest onBack={() => undefined} />));
    fireEvent.change(screen.getByLabelText(/Email/u), { target: { value: 'deniz.ornek@school.example' } });
    fireEvent.click(screen.getByText('Send the link'));
    await waitFor(() => expect(screen.getByText(/deniz\.ornek@school\.example/u)).toBeTruthy());
    fireEvent.click(screen.getByText('Use a different email'));
    expect(screen.getByText('Send the link')).toBeTruthy();
  });
});

describe('Help in one language, folded on phones (D-142)', () => {
  function stubWidth(narrow: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: narrow && q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
  }

  it('lists the guides in the language of the guide being read', async () => {
    stubWidth(false);
    search.current = { guide: 'teacher', lang: 'tr' };
    render(wrap(<HelpPage />, 'en', client({ id: 'u1', role: 'teacher', locale: 'en' })));
    expect(screen.getByText('Hızlı başlangıç: öğretmenler')).toBeTruthy();
    expect(screen.queryByText('Quick start: teachers')).toBeNull();
    expect(screen.queryByTestId('help-toc-fold')).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-testid="guide"] ol')).not.toBeNull());
    // Every screenshot opens full size in a new tab.
    const fig = document.querySelector('.cc-guide__figure a')!;
    expect(fig.getAttribute('target')).toBe('_blank');
    expect(fig.querySelector('img')).not.toBeNull();
  });

  it('folds the guide list into one line on a phone', () => {
    stubWidth(true);
    search.current = { guide: 'teacher', lang: 'en' };
    render(wrap(<HelpPage />, 'en', client({ id: 'u1', role: 'teacher', locale: 'en' })));
    const fold = screen.getByTestId('help-toc-fold') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')?.textContent).toContain('Teacher guide');
  });

  it('guides keep their numbers and bullets (Tailwind preflight removes them) and catalog panels never widen the page', () => {
    const css = readFileSync('src/client/styles/app.css', 'utf8');
    expect(css).toMatch(/\.cc-guide ol \{\s*list-style: decimal;/u);
    expect(css).toMatch(/\.cc-guide ul \{\s*list-style: disc;/u);
    expect(css).toMatch(/\.cc-catalog-panel \{[^}]*overflow: clip;/u);
  });
});
