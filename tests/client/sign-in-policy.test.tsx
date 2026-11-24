// @vitest-environment jsdom
/**
 * S30 (D-207) and S31 (D-208): what the screens show while the school has switched passwords off, and
 * Sign in with Google with its warning about shared computers (ACC-2, ACC-12). Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { isClassroomDevice, markClassroomDevice } from '../../src/client/lib/classroomDevice.ts';
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
const { GoogleSignIn, GoogleReturnPage } = await import('../../src/client/routes/GoogleSignIn.tsx');
const { UsersPage } = await import('../../src/client/routes/admin/Users.tsx');
const { ADMIN } = await import('../../src/client/routes/admin/Admin.tsx');

const INFO = ['public', 'reset-available'];
const info = { emailResetEnabled: true, emailLinkEnabled: true, passwordsOff: false, googleSignInEnabled: false, defaultLocale: 'en' };
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
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sign-in page while passwords are off (S30, D-207)', () => {
  it('has no password form: only the email link, in English and Turkish', () => {
    render(wrap(<LoginPage />, client([[INFO, { ...info, passwordsOff: true }]])));
    expect(screen.getByText(en['signin.noPasswords'])).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(button(en['signin.emailMe'])).toBeTruthy();
    cleanup();
    render(wrap(<LoginPage />, client([[INFO, { ...info, passwordsOff: true }]]), 'tr'));
    expect(screen.getByText(tr['signin.noPasswords'])).toBeTruthy();
  });

  it('draws no form before it knows how the school signs in, so the password form never flashes', async () => {
    // The first answer has not arrived: a request that never finishes.
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_KEY, null);
    render(wrap(<LoginPage />, qc));
    expect(screen.getByRole('status').textContent).toBe(en['common.loading']);
    expect(document.querySelector('input')).toBeNull();
    expect(screen.queryByRole('button', { name: en['auth.signIn'] })).toBeNull();
  });

  it('stops waiting after a few seconds: a server that does not answer still gets the password form', () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', () => new Promise(() => undefined));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(ME_KEY, null);
      render(wrap(<LoginPage />, qc));
      expect(document.querySelector('input[type="password"]')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(4100);
      });
      expect(document.querySelector('input[type="password"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the password form while passwords are allowed, and when email is not set up', () => {
    render(wrap(<LoginPage />, client([[INFO, info]])));
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(screen.queryByText(en['signin.noPasswords'])).toBeNull();
    cleanup();
    render(wrap(<LoginPage />, client([[INFO, { ...info, passwordsOff: true, emailLinkEnabled: false }]])));
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
});

describe('Sign in with Google and shared computers (S31, D-208)', () => {
  it('is offered only when the server has a Google client, always with the warning in words', () => {
    render(wrap(<LoginPage />, client([[INFO, info]])));
    expect(screen.queryByTestId('google-signin')).toBeNull();
    cleanup();
    for (const passwordsOff of [false, true]) {
      render(wrap(<LoginPage />, client([[INFO, { ...info, googleSignInEnabled: true, passwordsOff }]])));
      expect(button(en['google.signIn'])).toBeTruthy();
      expect(screen.getByText(en['google.sharedWarning'])).toBeTruthy();
      cleanup();
    }
  });

  it('holds the button back on a browser that has been a classroom display, until the teacher says it is their own', () => {
    expect(isClassroomDevice()).toBe(false);
    markClassroomDevice();
    expect(isClassroomDevice()).toBe(true);
    render(wrap(<GoogleSignIn />, client([])));
    expect(screen.getByText(en['google.classroomDevice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['google.signIn'] })).toBeNull();
    fireEvent.click(button(en['google.ownComputer']));
    expect(button(en['google.signIn'])).toBeTruthy();
    expect(screen.getByText(en['google.sharedWarning'])).toBeTruthy();
    cleanup();
    render(wrap(<GoogleSignIn />, client([]), 'tr'));
    expect(screen.getByText(tr['google.classroomDevice'])).toBeTruthy();
  });

  it('counts as not marked when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    markClassroomDevice();
    expect(isClassroomDevice()).toBe(false);
  });

  it('the return page takes the code out of the address bar and says so when Google sign-in was cancelled or incomplete', async () => {
    history.replaceState(null, '', '/signin-google?error=access_denied&state=fictional-state');
    render(wrap(<GoogleReturnPage state="fictional-state" code={undefined} denied />, client([])));
    await waitFor(() => expect(screen.getByText(en['google.cancelled'])).toBeTruthy());
    expect(window.location.search).toBe('');
    cleanup();
    history.replaceState(null, '', '/signin-google?state=fictional-state');
    render(wrap(<GoogleReturnPage state="fictional-state" code={undefined} denied={false} />, client([])));
    await waitFor(() => expect(screen.getByText(en['error.GOOGLE_SIGNIN_FAILED'])).toBeTruthy());
    expect(window.location.search).toBe('');
  });
});

describe('invite page while passwords are off (S30, D-207)', () => {
  const invite = { displayName: 'Zehra Öğretmen', login: 'zehra.teacher', role: 'teacher', locale: 'en', emailLinkAllowed: true, emailLinkAvailable: true, emailLinkUnavailableReason: null, expiresAt: 1 };
  const show = (data: Record<string, unknown>) => {
    history.replaceState(null, '', '/invite#token=fictional-invite-token-0001');
    render(wrap(<InvitePage />, client([[['public', 'invite', 'fictional-invite-token-0001'], data]])));
  };

  it('offers no password, for a teacher and an administrator alike', () => {
    for (const role of ['teacher', 'admin']) {
      show({ ...invite, role, passwordAllowed: false });
      expect(screen.getByText(en['invite.emailOnly'])).toBeTruthy();
      expect(document.querySelector('input[type="password"]')).toBeNull();
      expect(document.querySelector('fieldset')?.hidden).toBe(true);
      expect(button(en['invite.accept']).disabled).toBe(false);
      cleanup();
    }
  });

  it('says why and blocks the button when the account has no email address', () => {
    show({ ...invite, passwordAllowed: false, emailLinkAvailable: false, emailLinkUnavailableReason: 'NO_EMAIL' });
    expect(screen.getAllByText(en['invite.noEmail']).length).toBeGreaterThan(0);
    expect(button(en['invite.accept']).disabled).toBe(true);
  });

  it('still offers the choice when passwords are allowed', () => {
    show({ ...invite, passwordAllowed: true });
    expect(screen.queryByText(en['invite.emailOnly'])).toBeNull();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
  });
});

describe('profile while passwords are off (S30, D-207)', () => {
  it('offers no way back to a password, to teachers and administrators', () => {
    for (const me of [teacher, { ...admin, signInMethod: 'email_link', reauthFresh: true } as unknown as Me]) {
      const qc = client([], me);
      render(wrap(<SignInMethodSection me={me} emailLinkEnabled passwordsOff />, qc));
      expect(screen.getByText(en['signin.policyEmailOnly'])).toBeTruthy();
      expect(document.querySelector('input[type="password"]')).toBeNull();
      cleanup();
      render(wrap(<SignInMethodSection me={me} emailLinkEnabled />, qc));
      expect(screen.queryByText(en['signin.policyEmailOnly'])).toBeNull();
      expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
      cleanup();
    }
  });
});

describe('Admin → Accounts: Passwords (S30, D-207)', () => {
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
    createdAt: 1,
    ...over,
  });
  const users = { users: [row({ googleLinked: true }), row({ id: 'u-2', login: 'second.admin', displayName: 'İkinci Yönetici', role: 'admin', hasPin: false })] };
  const policy = { passwordsOff: false, emailReady: true, accountsWithPassword: 3, accountsWithoutEmail: [], ownEmail: 'root@school.example' };
  const page = (p: Record<string, unknown>, google = false) =>
    render(wrap(<UsersPage />, client([[[...ADMIN, 'users'], users], [[...ADMIN, 'sign-in-policy'], p], [INFO, { ...info, googleSignInEnabled: google }]], admin)));
  const resetButtons = () => screen.queryAllByRole('button', { name: en['users.resetPassword'] }).length;

  it('names the accounts that still need an address, and asks for the administrator’s own', () => {
    page({ ...policy, accountsWithoutEmail: [{ id: 'u-9', displayName: 'Mehmet Öğretmen' }] });
    expect(screen.getByText(en['users.policyOff'])).toBeTruthy();
    expect(screen.getByText(en['users.policyMissing'].replace('{names}', 'Mehmet Öğretmen'))).toBeTruthy();
    expect(button(en['users.policyTurnOn']).disabled).toBe(true);
    expect(resetButtons()).toBe(2);
    cleanup();
    page({ ...policy, ownEmail: null });
    expect(screen.getByText(en['users.policyOwnEmail'])).toBeTruthy();
    expect(button(en['users.policyTurnOn']).disabled).toBe(true);
  });

  it('says that email must be set up first', () => {
    page({ ...policy, emailReady: false });
    expect(screen.getByText(en['users.policyNeedsEmail'])).toBeTruthy();
    expect(button(en['users.policyTurnOn']).disabled).toBe(true);
  });

  it('explains what switching off does and asks for an emailed code before the last step', async () => {
    page(policy);
    fireEvent.click(button(en['users.policyTurnOn']));
    await waitFor(() => expect(screen.getByText(en['users.policyConfirmOn'].replace('{count}', '3'))).toBeTruthy());
    expect(screen.getByText(en['users.policyConfirmMail'])).toBeTruthy();
    // Nothing can be switched yet: the only step offered is the code.
    expect(button(en['users.policySendCode'])).toBeTruthy();
    expect(screen.queryByLabelText(new RegExp(en['signin.code'], 'u'))).toBeNull();
  });

  it('while passwords are off, offers no password reset for anyone and shows who has used Google', () => {
    page({ ...policy, passwordsOff: true, accountsWithPassword: 0 }, true);
    expect(screen.getByText(en['users.policyOn'])).toBeTruthy();
    expect(screen.getByText(en['users.policyGoogle'])).toBeTruthy();
    expect(button(en['users.policyTurnOff'])).toBeTruthy();
    expect(resetButtons()).toBe(0);
    expect(screen.getAllByText(en['users.methodGoogle'])).toHaveLength(1);
  });
});
