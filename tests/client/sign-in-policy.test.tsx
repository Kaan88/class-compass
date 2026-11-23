// @vitest-environment jsdom
/**
 * S30 (D-207): what the screens show while the school lets teachers sign in with email links only
 * (ACC-2, ACC-12): the sign-in page points teachers to the email link, a teacher's invite offers no
 * password, the profile offers no way back, and Admin → Accounts explains the switch and why it
 * cannot be used yet. Fictional data only.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
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
const { InvitePage, SignInMethodSection } = await import('../../src/client/routes/SignIn.tsx');
const { UsersPage } = await import('../../src/client/routes/admin/Users.tsx');
const { ADMIN } = await import('../../src/client/routes/admin/Admin.tsx');

const INFO = ['public', 'reset-available'];
const teacher = { id: 'u-t', displayName: 'Ayşe Öğretmen', role: 'teacher', locale: 'en', signInMethod: 'email_link', hasEmail: true, reauthFresh: true } as unknown as Me;
const admin = { id: 'u-a', displayName: 'Demo Admin', role: 'admin', locale: 'en', signInMethod: 'password' } as unknown as Me;

function client(data: Array<[readonly unknown[], unknown]>, me: Me | null = null) {
  // Nothing is fetched: every query a page reads is seeded.
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

beforeEach(() => history.replaceState(null, '', '/'));
afterEach(cleanup);

describe('sign-in page (S30, D-207)', () => {
  it('tells teachers to use the email link while they have no password, in English and Turkish', () => {
    const info = { emailResetEnabled: true, emailLinkEnabled: true, teacherEmailLinkOnly: true, defaultLocale: 'en' };
    render(wrap(<LoginPage />, client([[INFO, info]])));
    expect(screen.getByText(en['signin.teachersUseEmail'])).toBeTruthy();
    // Administrators still type a password on the same page.
    expect(screen.getByLabelText(new RegExp(en['auth.password'], 'u'))).toBeTruthy();
    cleanup();
    render(wrap(<LoginPage />, client([[INFO, info]]), 'tr'));
    expect(screen.getByText(tr['signin.teachersUseEmail'])).toBeTruthy();
    cleanup();
    render(wrap(<LoginPage />, client([[INFO, { ...info, teacherEmailLinkOnly: false }]])));
    expect(screen.queryByText(en['signin.teachersUseEmail'])).toBeNull();
  });
});

describe('invite page (S30, D-207)', () => {
  const invite = { displayName: 'Zehra Öğretmen', login: 'zehra.teacher', role: 'teacher', locale: 'en', emailLinkAllowed: true, emailLinkAvailable: true, emailLinkUnavailableReason: null, expiresAt: 1 };
  const show = (info: Record<string, unknown>) => {
    history.replaceState(null, '', '/invite#token=fictional-invite-token-0001');
    render(wrap(<InvitePage />, client([[['public', 'invite', 'fictional-invite-token-0001'], info]])));
  };

  it('offers a teacher no password: only the explanation and the button', () => {
    show({ ...invite, passwordAllowed: false });
    expect(screen.getByText(en['invite.emailOnly'])).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('fieldset')?.hidden).toBe(true);
    expect((screen.getByRole('button', { name: en['invite.accept'] }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says why and blocks the button when the account has no email address', () => {
    show({ ...invite, passwordAllowed: false, emailLinkAvailable: false, emailLinkUnavailableReason: 'NO_EMAIL' });
    expect(screen.getAllByText(en['invite.noEmail']).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: en['invite.accept'] }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('still offers the choice when passwords are allowed', () => {
    show({ ...invite, passwordAllowed: true });
    expect(screen.queryByText(en['invite.emailOnly'])).toBeNull();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
  });
});

describe('profile (S30, D-207)', () => {
  it('offers a teacher no way back to a password while the school forbids it', () => {
    const qc = client([], teacher);
    render(wrap(<SignInMethodSection me={teacher} emailLinkEnabled teacherEmailLinkOnly />, qc));
    expect(screen.getByText(en['signin.policyEmailOnly'])).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    cleanup();
    render(wrap(<SignInMethodSection me={teacher} emailLinkEnabled />, qc));
    expect(screen.queryByText(en['signin.policyEmailOnly'])).toBeNull();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
  });
});

describe('Admin → Accounts (S30, D-207)', () => {
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
    createdAt: 1,
    ...over,
  });
  const users = { users: [row({}), row({ id: 'u-2', login: 'second.admin', displayName: 'İkinci Yönetici', role: 'admin', hasPin: false })] };
  const page = (policy: Record<string, unknown>) =>
    render(wrap(<UsersPage />, client([[[...ADMIN, 'users'], users], [[...ADMIN, 'sign-in-policy'], policy]], admin)));
  const resetButtons = () => screen.queryAllByRole('button', { name: en['users.resetPassword'] }).length;

  it('explains the switch and names the teachers who still need an address', () => {
    page({ teacherEmailLinkOnly: false, emailReady: true, teachersWithPassword: 2, teachersWithoutEmail: [{ id: 'u-9', displayName: 'Mehmet Öğretmen' }] });
    expect(screen.getByText(en['users.policyOff'])).toBeTruthy();
    expect(screen.getByText(en['users.policyMissing'].replace('{names}', 'Mehmet Öğretmen'))).toBeTruthy();
    expect((screen.getByRole('button', { name: en['users.policyTurnOn'] }) as HTMLButtonElement).disabled).toBe(true);
    expect(resetButtons()).toBe(2);
  });

  it('says that email must be set up first', () => {
    page({ teacherEmailLinkOnly: false, emailReady: false, teachersWithPassword: 2, teachersWithoutEmail: [] });
    expect(screen.getByText(en['users.policyNeedsEmail'])).toBeTruthy();
    expect((screen.getByRole('button', { name: en['users.policyTurnOn'] }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('can be switched on when everything is ready, and then offers no password reset for teachers', () => {
    page({ teacherEmailLinkOnly: false, emailReady: true, teachersWithPassword: 2, teachersWithoutEmail: [] });
    expect((screen.getByRole('button', { name: en['users.policyTurnOn'] }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    page({ teacherEmailLinkOnly: true, emailReady: true, teachersWithPassword: 0, teachersWithoutEmail: [] });
    expect(screen.getByText(en['users.policyOn'])).toBeTruthy();
    expect(screen.getByRole('button', { name: en['users.policyTurnOff'] })).toBeTruthy();
    expect(resetButtons()).toBe(1); // the administrator's row only
  });
});
