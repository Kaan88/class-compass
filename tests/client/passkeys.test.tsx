// @vitest-environment jsdom
/**
 * S33 (D-210): the passkey screens (ACC-2). The sign-in button appears only where passkeys can work;
 * Profile lists the account's passkeys and holds "Add a passkey" back on a browser that has been a
 * classroom display; Admin → Accounts shows how many an account has. Fictional data only.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { markClassroomDevice } from '../../src/client/lib/classroomDevice.ts';
import { ME_KEY, type Me } from '../../src/client/lib/session.ts';
import { en, tr } from '../messages.ts';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => children,
}));

const { LoginPage } = await import('../../src/client/routes/Auth.tsx');
const { PasskeyOffer, PasskeysSection } = await import('../../src/client/routes/Passkeys.tsx');
const { UsersPage } = await import('../../src/client/routes/admin/Users.tsx');
const { ADMIN } = await import('../../src/client/routes/admin/Admin.tsx');

const INFO = ['public', 'reset-available'];
const info = { emailResetEnabled: true, emailLinkEnabled: true, passwordsOff: false, googleSignInEnabled: false, passkeysEnabled: true, defaultLocale: 'en' };
const LIST = ['sensitive', 'account', 'passkeys'];
const teacher = { id: 'u-t', displayName: 'Ayşe Öğretmen', role: 'teacher', locale: 'en', signInMethod: 'password', hasEmail: true, reauthFresh: false } as unknown as Me;
const admin = { id: 'u-a', displayName: 'Demo Admin', role: 'admin', locale: 'en', signInMethod: 'password' } as unknown as Me;

function client(data: Array<[readonly unknown[], unknown]>, me: Me | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  qc.setQueryData(ME_KEY, me);
  for (const [key, value] of data) qc.setQueryData(key, value);
  return qc;
}
const wrap = (node: ReactNode, qc: QueryClient, locale: Locale = 'en') => (
  <QueryClientProvider client={qc}>
    <I18nProvider locale={locale}>{node}</I18nProvider>
  </QueryClientProvider>
);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
/** A browser that knows WebAuthn (jsdom does not). */
const withWebAuthn = () => vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sign-in page (S33, D-210)', () => {
  it('offers "Sign in with a passkey" where passkeys can work, with and without passwords', () => {
    withWebAuthn();
    for (const passwordsOff of [false, true]) {
      render(wrap(<LoginPage />, client([[INFO, { ...info, passwordsOff }]])));
      expect(button(en['passkey.signIn'])).toBeTruthy();
      cleanup();
    }
    render(wrap(<LoginPage />, client([[INFO, info]]), 'tr'));
    expect(button(tr['passkey.signIn'])).toBeTruthy();
  });

  it('does not offer it on an address where passkeys cannot work, or in a browser without them', () => {
    withWebAuthn();
    render(wrap(<LoginPage />, client([[INFO, { ...info, passkeysEnabled: false }]])));
    expect(screen.queryByTestId('passkey-signin')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    render(wrap(<LoginPage />, client([[INFO, info]])));
    expect(screen.queryByTestId('passkey-signin')).toBeNull();
  });
});

describe('Profile → Passkeys (S33, D-210)', () => {
  const one = { passkeys: [{ id: 'p1', name: 'My phone', createdAt: 1_800_000_000_000, lastUsedAt: null, backedUp: true }] };

  it('lists the passkeys, and adding one asks for the password and warns about shared devices', () => {
    withWebAuthn();
    render(wrap(<PasskeysSection me={teacher} />, client([[LIST, one]], teacher)));
    expect(screen.getByText('My phone')).toBeTruthy();
    expect(screen.getByText(new RegExp(en['passkey.neverUsed'], 'u'))).toBeTruthy();
    expect(screen.getByText(new RegExp(en['passkey.synced'], 'u'))).toBeTruthy();
    expect(screen.getByText(en['passkey.sharedWarning'])).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(button(en['passkey.add']).disabled).toBe(false);
  });

  it('an account without a password needs a fresh sign-in first', () => {
    withWebAuthn();
    const byEmail = { ...teacher, signInMethod: 'email_link' } as unknown as Me;
    render(wrap(<PasskeysSection me={byEmail} />, client([[LIST, { passkeys: [] }]], byEmail)));
    expect(screen.getByText(en['passkey.none'])).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(en['error.REAUTH_REQUIRED'])).toBeTruthy();
    expect(button(en['passkey.add']).disabled).toBe(true);
    cleanup();
    const fresh = { ...byEmail, reauthFresh: true } as unknown as Me;
    render(wrap(<PasskeysSection me={fresh} />, client([[LIST, { passkeys: [] }]], fresh)));
    expect(button(en['passkey.add']).disabled).toBe(false);
  });

  it('holds "Add a passkey" back on a browser that has been a classroom display', () => {
    withWebAuthn();
    markClassroomDevice();
    render(wrap(<PasskeysSection me={teacher} />, client([[LIST, one]], teacher)));
    expect(screen.getByText(en['passkey.classroomDevice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['passkey.add'] })).toBeNull();
    // The list and removing stay available.
    expect(button(en['passkey.remove'])).toBeTruthy();
    fireEvent.click(button(en['passkey.ownComputer']));
    expect(button(en['passkey.add'])).toBeTruthy();
    cleanup();
    render(wrap(<PasskeysSection me={teacher} />, client([[LIST, one]], teacher), 'tr'));
    expect(screen.getByText(tr['passkey.classroomDevice'])).toBeTruthy();
  });

  it('says so when the browser cannot use passkeys', () => {
    render(wrap(<PasskeysSection me={teacher} />, client([[LIST, one]], teacher)));
    expect(screen.getByText(en['passkey.unsupported'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['passkey.add'] })).toBeNull();
  });
});

describe('Admin → Accounts (S33, D-210)', () => {
  it('shows how many passkeys an account has and offers to remove them, not for the administrator’s own row', () => {
    const row = (over: Record<string, unknown>) => ({
      id: 'u-1',
      login: 'ayse.teacher',
      displayName: 'Ayşe Öğretmen',
      email: 'ayse@school.example',
      role: 'teacher',
      active: true,
      hasPin: true,
      mustChangePassword: false,
      locale: 'en',
      signInMethod: 'password',
      emailVerified: true,
      invitePending: false,
      inviteExpiresAt: null,
      googleLinked: false,
      passkeys: 0,
      createdAt: 1,
      ...over,
    });
    const users = { users: [row({ passkeys: 2 }), row({ id: 'u-2', login: 'mehmet.teacher', displayName: 'Mehmet Öğretmen' }), row({ id: 'u-a', login: 'demo.admin', displayName: 'Demo Admin', role: 'admin', passkeys: 1 })] };
    const policy = { passwordsOff: false, emailReady: true, accountsWithPassword: 3, accountsWithoutEmail: [], ownEmail: 'root@school.example' };
    render(wrap(<UsersPage />, client([[[...ADMIN, 'users'], users], [[...ADMIN, 'sign-in-policy'], policy], [INFO, info]], admin)));
    expect(screen.getByText(en['users.passkeys'].replace('{count}', '2'))).toBeTruthy();
    expect(screen.getByText(en['users.passkeys'].replace('{count}', '1'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: en['users.removePasskeys'] })).toHaveLength(1);
  });
});

describe('the offer after a sign-in (S33, D-210)', () => {
  const OFFER = ['sensitive', 'account', 'passkey-offer'];
  const fresh = { ...teacher, signInMethod: 'email_link', reauthFresh: true } as unknown as Me;
  const show = (me: Me = fresh, offer = true, locale: Locale = 'en') => render(wrap(<PasskeyOffer me={me} />, client([[OFFER, { offer }]], me), locale));

  it('offers a passkey after an email sign-in, with the warning about whose device it is', () => {
    withWebAuthn();
    show();
    expect(screen.getByText(en['passkey.offerTitle'])).toBeTruthy();
    expect(screen.getByText(en['passkey.offerText'])).toBeTruthy();
    expect(button(en['passkey.add'])).toBeTruthy();
    expect(button(en['passkey.offerNever'])).toBeTruthy();
    cleanup();
    show(fresh, true, 'tr');
    expect(screen.getByText(tr['passkey.offerTitle'])).toBeTruthy();
  });

  it('stays silent when the server says no, on a classroom display, and in a browser without passkeys', () => {
    withWebAuthn();
    show(fresh, false);
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    cleanup();
    markClassroomDevice();
    show();
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    show();
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
  });

  it('"Not now" hides it on this device for this account, not for another one', () => {
    withWebAuthn();
    show();
    fireEvent.click(button(en['passkey.offerLater']));
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    cleanup();
    show();
    expect(screen.queryByTestId('passkey-offer')).toBeNull();
    cleanup();
    show({ ...fresh, id: 'u-other' } as unknown as Me);
    expect(screen.getByTestId('passkey-offer')).toBeTruthy();
  });
});

