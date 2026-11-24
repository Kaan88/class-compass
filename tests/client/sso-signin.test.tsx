// @vitest-environment jsdom
/**
 * S34 (D-213): the operator's own sign-in server on the sign-in page (ACC-2): one small icon-only
 * button with a name for screen readers, absent when it is not set up and on a classroom display.
 * Fictional names only.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { markClassroomDevice } from '../../src/client/lib/classroomDevice.ts';
import { ME_KEY } from '../../src/client/lib/session.ts';
import { en, tr } from '../messages.ts';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => children,
}));

const { LoginPage } = await import('../../src/client/routes/Auth.tsx');
const { SsoReturnPage } = await import('../../src/client/routes/SsoSignIn.tsx');

const INFO = ['public', 'reset-available'];
const info = { emailResetEnabled: true, emailLinkEnabled: true, passwordsOff: false, googleSignInEnabled: false, passkeysEnabled: false, sso: null, defaultLocale: 'en' };
const sso = { name: 'Demo Mail', hasIcon: true };

function page(data: Record<string, unknown>, locale: Locale = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  qc.setQueryData(ME_KEY, null);
  qc.setQueryData(INFO, data);
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>
        <LoginPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('own sign-in server on the sign-in page (S34, D-213)', () => {
  it('is an icon-only button with its name for screen readers, with and without passwords, in both languages', () => {
    for (const passwordsOff of [false, true]) {
      page({ ...info, sso, passwordsOff });
      const button = screen.getByRole('button', { name: en['sso.signIn'].replace('{name}', 'Demo Mail') });
      // No words on the button: the picture, and the name only as the accessible name and the tooltip.
      expect(button.textContent).toBe('');
      const img = button.querySelector('img')!;
      expect(img.getAttribute('src')).toBe('/api/auth/sso/icon');
      expect(img.getAttribute('alt')).toBe('');
      cleanup();
    }
    page({ ...info, sso }, 'tr');
    expect(screen.getByRole('button', { name: tr['sso.signIn'].replace('{name}', 'Demo Mail') })).toBeTruthy();
  });

  it('shows the first letter of the name when there is no icon file', () => {
    page({ ...info, sso: { name: 'demo mail', hasIcon: false } });
    const button = screen.getByRole('button', { name: en['sso.signIn'].replace('{name}', 'demo mail') });
    expect(button.querySelector('img')).toBeNull();
    expect(button.textContent).toBe('D');
  });

  it('is absent when it is not set up, and on a browser that has been a classroom display', () => {
    page(info);
    expect(screen.queryByTestId('sso-signin')).toBeNull();
    cleanup();
    markClassroomDevice();
    page({ ...info, sso });
    expect(screen.queryByTestId('sso-signin')).toBeNull();
  });

  it('the return page clears the address bar and says so when the sign-in was cancelled or incomplete', async () => {
    const show = (node: ReactNode) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
      qc.setQueryData(ME_KEY, null);
      return render(
        <QueryClientProvider client={qc}>
          <I18nProvider locale="en">{node}</I18nProvider>
        </QueryClientProvider>,
      );
    };
    history.replaceState(null, '', '/signin-sso?error=access_denied&state=fictional-state');
    show(<SsoReturnPage state="fictional-state" code={undefined} denied />);
    await waitFor(() => expect(screen.getByText(en['sso.cancelled'])).toBeTruthy());
    expect(window.location.search).toBe('');
    cleanup();
    history.replaceState(null, '', '/signin-sso?state=fictional-state');
    show(<SsoReturnPage state="fictional-state" code={undefined} denied={false} />);
    await waitFor(() => expect(screen.getByText(en['error.SSO_SIGNIN_FAILED'])).toBeTruthy());
    expect(window.location.search).toBe('');
  });
});
