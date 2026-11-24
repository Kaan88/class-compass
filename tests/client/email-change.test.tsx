// @vitest-environment jsdom
/**
 * S35 (D-214): "Email address" in Profile (ACC-2). It shows the account's address, asks for the
 * current password (or a fresh sign-in) and the new address, then the code emailed to the new address;
 * without email on the server it says that the administrator changes addresses. The address comes from
 * the PIN-gated `ownEmail`, which also brings the code form back after a reload; Profile draws the
 * section only once the sign-in info has arrived. Also the line for an
 * account that has no password yet (invited, signed in through the operator's sign-in server), and the
 * administrator's own row in Admin → Accounts → Edit. Fictional data only.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../src/shared/contracts/auth.ts';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { en, tr } from '../messages.ts';

const calls: Array<{ path: string; input: Record<string, unknown> }> = [];
let answer: (path: string, input: Record<string, unknown>) => unknown = () => ({ ok: true });
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: vi.fn(async (ep: { path: string }, input: Record<string, unknown>) => {
    calls.push({ path: ep.path, input });
    return answer(ep.path, input);
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  Link: ({ children }: { children: ReactNode }) => children,
}));

const { ApiError } = await import('../../src/client/lib/api.ts');
const { EmailChangeSection, OWN_EMAIL } = await import('../../src/client/routes/EmailChange.tsx');
const { ProfilePage } = await import('../../src/client/routes/teacher/Teacher.tsx');
const { UsersPage } = await import('../../src/client/routes/admin/Users.tsx');
const { I18nProvider } = await import('../../src/client/lib/i18n.tsx');
const { ME_KEY } = await import('../../src/client/lib/session.ts');

const ME: Me = {
  kind: 'user',
  id: 'fictional-teacher',
  displayName: 'Deniz Öğretmen',
  role: 'teacher',
  locale: 'en',
  textScale: 100,
  density: 'normal',
  mustChangePassword: false,
  hasPin: true,
  signInMethod: 'password',
  hasEmail: true,
  passwordNotSet: false,
  reauthFresh: false,
  classroomMode: false,
  pinUnlockedUntil: null,
  pinUnlocked: true,
};

const OWN = { email: 'deniz@school.example', pendingTo: null };
const SIGN_IN_INFO = { emailResetEnabled: true, emailLinkEnabled: true, passwordsOff: false, googleSignInEnabled: false, passkeysEnabled: false, sso: null, defaultLocale: 'en' };

function qcWith(me: Me, data: Array<[readonly unknown[], unknown]> = [], own: unknown = OWN) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  qc.setQueryData(ME_KEY, me);
  if (own) qc.setQueryData(OWN_EMAIL, own);
  for (const [k, v] of data) qc.setQueryData(k, v);
  return qc;
}
const wrap = (node: ReactNode, qc: QueryClient, locale: Locale = 'en') => (
  <QueryClientProvider client={qc}>
    <I18nProvider locale={locale}>{node}</I18nProvider>
  </QueryClientProvider>
);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  calls.length = 0;
  answer = () => ({ ok: true });
});

describe('Profile → Email address (S35, D-214)', () => {
  it('shows the address, sends the code to the new one with the current password, then changes it with the code', async () => {
    answer = (path) => (path === '/api/auth/email' ? { email: 'deniz.new@school.example', pendingTo: null } : path.endsWith('/confirm') ? ME : { ok: true });
    render(wrap(<EmailChangeSection me={ME} emailEnabled />, qcWith(ME)));
    expect(screen.getByText(en['profile.emailCurrent'].replace('{email}', 'deniz@school.example'))).toBeTruthy();
    type(en['password.current'], 'correct-horse-battery');
    type(en['profile.emailNew'], ' Deniz.New@School.example ');
    fireEvent.click(button(en['profile.emailSendCode']));
    await screen.findByText(en['profile.emailCodeSent'].replace('{email}', 'deniz.new@school.example'));
    expect(calls[0]).toEqual({ path: '/api/auth/email/start', input: { currentPassword: 'correct-horse-battery', email: 'deniz.new@school.example' } });

    expect(button(en['profile.emailConfirm']).disabled).toBe(true);
    type(en['signin.code'], '12a34 56');
    fireEvent.click(button(en['profile.emailConfirm']));
    await screen.findByText(en['profile.emailChanged'].replace('{email}', 'deniz.new@school.example'));
    expect(calls.find((c) => c.path === '/api/auth/email/confirm')!.input).toEqual({ code: '123456' });
  });

  it('shows the reason when the code is wrong, and the step stays open', async () => {
    answer = (path) => {
      if (path.endsWith('/confirm')) throw new ApiError(401, 'UNAUTHENTICATED', 'Wrong or expired code', { reason: 'SIGNIN_CODE_INVALID', attemptsLeft: 4 });
      return { ok: true };
    };
    render(wrap(<EmailChangeSection me={ME} emailEnabled />, qcWith(ME)));
    type(en['password.current'], 'correct-horse-battery');
    type(en['profile.emailNew'], 'deniz.new@school.example');
    fireEvent.click(button(en['profile.emailSendCode']));
    await screen.findByLabelText(en['signin.code'], { exact: false });
    type(en['signin.code'], '000000');
    fireEvent.click(button(en['profile.emailConfirm']));
    await screen.findByText(en['error.SIGNIN_CODE_INVALID']);
    expect(button(en['profile.emailConfirm'])).toBeTruthy();
  });

  it('an email-link account needs a fresh sign-in instead of a password', async () => {
    const byEmail = { ...ME, signInMethod: 'email_link' as const };
    render(wrap(<EmailChangeSection me={byEmail} emailEnabled />, qcWith(byEmail)));
    expect(screen.queryByLabelText(en['password.current'], { exact: false })).toBeNull();
    expect(screen.getByText(en['error.REAUTH_REQUIRED'])).toBeTruthy();
    expect(button(en['profile.emailSendCode']).disabled).toBe(true);
    cleanup();
    const fresh = { ...byEmail, reauthFresh: true };
    render(wrap(<EmailChangeSection me={fresh} emailEnabled />, qcWith(fresh)));
    type(en['profile.emailNew'], 'deniz.new@school.example');
    fireEvent.click(button(en['profile.emailSendCode']));
    await waitFor(() => expect(calls[0]?.input).toEqual({ email: 'deniz.new@school.example' }));
  });

  it('without email on the server it says the administrator changes addresses, in both languages', () => {
    for (const [locale, dict] of [['en', en], ['tr', tr]] as const) {
      render(wrap(<EmailChangeSection me={{ ...ME, hasEmail: false }} emailEnabled={false} />, qcWith(ME, [], { email: null, pendingTo: null }), locale));
      expect(screen.getByText(dict['profile.emailNoSmtp'])).toBeTruthy();
      expect(screen.getByText(dict['profile.emailNone'])).toBeTruthy();
      expect(screen.queryByRole('button', { name: dict['profile.emailSendCode'] })).toBeNull();
      cleanup();
    }
  });

  it('after a reload the code form comes back; the success line shows the real new address, not the masked one (S35 review)', async () => {
    answer = (path) => (path === '/api/auth/email' ? { email: 'deniz.new@school.example', pendingTo: null } : path.endsWith('/confirm') ? ME : { ok: true });
    render(wrap(<EmailChangeSection me={ME} emailEnabled />, qcWith(ME, [], { email: 'deniz@school.example', pendingTo: 'd***@school.example' })));
    expect(screen.getByText(en['profile.emailCodeSent'].replace('{email}', 'd***@school.example'))).toBeTruthy();
    type(en['signin.code'], '123456');
    fireEvent.click(button(en['profile.emailConfirm']));
    await screen.findByText(en['profile.emailChanged'].replace('{email}', 'deniz.new@school.example'));
    expect(calls.map((c) => c.path).slice(0, 2)).toEqual(['/api/auth/email/confirm', '/api/auth/email']);
    expect(document.body.textContent).not.toContain('d***@');
  });

  it('Cancel ends the pending change on the server, then shows the start form', async () => {
    render(wrap(<EmailChangeSection me={ME} emailEnabled />, qcWith(ME, [], { email: 'deniz@school.example', pendingTo: 'd***@school.example' })));
    fireEvent.click(button(en['common.cancel']));
    expect(await screen.findByRole('button', { name: en['profile.emailSendCode'] })).toBeTruthy();
    expect(calls).toEqual([{ path: '/api/auth/email/cancel', input: {} }]);
  });

  it('when Cancel fails the code form stays', async () => {
    answer = () => {
      throw new ApiError(423, 'LOCKED', 'Locked', { reason: 'PIN_REQUIRED' });
    };
    render(wrap(<EmailChangeSection me={ME} emailEnabled />, qcWith(ME, [], { email: 'deniz@school.example', pendingTo: 'd***@school.example' })));
    fireEvent.click(button(en['common.cancel']));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(button(en['profile.emailConfirm'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['profile.emailSendCode'] })).toBeNull();
  });

  it('draws nothing until the address has loaded', () => {
    render(wrap(<EmailChangeSection me={ME} emailEnabled />, qcWith(ME, [], null)));
    expect(screen.queryByTestId('email-change')).toBeNull();
  });

  it('Profile draws no "email is not set up" while the sign-in info loads (S35 review)', () => {
    render(wrap(<ProfilePage />, qcWith(ME)));
    expect(screen.queryByText(en['profile.emailNoSmtp'])).toBeNull();
    expect(screen.queryByTestId('email-change')).toBeNull();
    cleanup();
    render(wrap(<ProfilePage />, qcWith(ME, [[['public', 'reset-available'], SIGN_IN_INFO]])));
    expect(screen.getByTestId('email-change')).toBeTruthy();
  });
});

describe('Profile: an account without a password yet (S35)', () => {
  it('tells the person to open the invite link, and offers no password form', () => {
    for (const [locale, dict] of [['en', en], ['tr', tr]] as const) {
      const pending = { ...ME, role: 'admin' as const, locale, passwordNotSet: true };
      render(wrap(<ProfilePage />, qcWith(pending, [[['public', 'reset-available'], SIGN_IN_INFO]]), locale));
      expect(screen.getByText(dict['profile.passwordNotSet'])).toBeTruthy();
      expect(screen.queryByText(dict['password.changeTitle'])).toBeNull();
      expect(screen.queryByRole('button', { name: dict['profile.emailSendCode'] })).toBeNull();
      cleanup();
    }
    render(wrap(<ProfilePage />, qcWith(ME, [[['public', 'reset-available'], SIGN_IN_INFO]])));
    expect(screen.queryByText(en['profile.passwordNotSet'])).toBeNull();
    expect(screen.getByTestId('email-change')).toBeTruthy();
  });
});

describe('Admin → Accounts → Edit: the own address (S35, D-214)', () => {
  const row = (id: string, displayName: string, email: string | null) => ({
    id,
    login: id,
    displayName,
    email,
    role: 'admin',
    active: true,
    hasPin: true,
    mustChangePassword: false,
    locale: 'en',
    createdAt: 0,
    signInMethod: 'password',
    emailVerified: true,
    invitePending: false,
    inviteExpiresAt: null,
    googleLinked: false,
    passkeys: 0,
  });
  it('shows the own address as text with the way to Profile, and sends no address for the own row', async () => {
    const admin = { ...ME, id: 'u-admin', role: 'admin' as const, displayName: 'Demo Admin' };
    answer = (_path, input) => input;
    const users = [row('u-admin', 'Demo Admin', 'admin@school.example'), row('u-t', 'Deniz Öğretmen', 'deniz@school.example')];
    const qc = qcWith(admin, [
      [['sensitive', 'admin', 'users'], { users }],
      [['sensitive', 'admin', 'sign-in-policy'], { passwordsOff: false, emailReady: true, accountsWithPassword: 2, accountsWithoutEmail: [], ownEmail: 'admin@school.example' }],
    ]);
    render(wrap(<UsersPage />, qc));
    const edits = screen.getAllByRole('button', { name: en['common.edit'] });
    fireEvent.click(edits[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en['users.ownEmailInProfile']);
    expect(dialog.textContent).toContain('admin@school.example');
    expect(dialog.querySelector('input[type="email"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['common.save'] }));
    await waitFor(() => expect(calls.at(-1)?.input).toEqual({ userId: 'u-admin', displayName: 'Demo Admin', locale: 'en' }));
  });
});
