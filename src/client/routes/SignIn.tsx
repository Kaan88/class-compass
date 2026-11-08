/**
 * Account invites and email-link sign-in (S13b, D-108).
 * - /invite#token=…: the invited person chooses a password or email sign-in links (teachers only;
 *   shown but disabled with the reason when email is not set up). The page uses the account's language.
 * - /signin-link#token=…: the email link lands here; nothing happens until "Sign in" is pressed (a POST),
 *   so mail scanners that open links cannot use them up.
 * - The 6-digit code from the same email works on the device that asked (bound to its request).
 * - Profile: switching method needs re-authentication (password + emailed code, or a fresh email sign-in).
 * Tokens live in the URL fragment and are removed from the address bar at once.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import * as Auth from '../../shared/contracts/auth.ts';
import { ApiError, call } from '../lib/api.ts';
import { setDisplay } from '../lib/display.ts';
import { errorText, reasonOf } from '../lib/errors.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { getOutbox } from '../lib/outbox-client.ts';
import { freshMe, ME_KEY, type Me } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { TextField } from '../ui/Fields.tsx';
import { AuthCard } from './AuthCard.tsx';
import { homeFor } from './guards.ts';

/** Reads `#token=…` once and clears it from the address bar and history. */
function useFragmentToken(): string {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}

function useSignedIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async (me: Me) => {
    qc.setQueryData(ME_KEY, me);
    void getOutbox().resume(me.id);
    await navigate({ to: homeFor(me) });
  };
}

/** Code entry for an email sign-in request made on this device. */
export function EmailCodeForm({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await signedIn(await call(Auth.completeEmailCode, { requestId, code: code.trim() }));
        } catch (err) {
          const left = err instanceof ApiError ? (err.details as { attemptsLeft?: number } | undefined)?.attemptsLeft : undefined;
          setError(typeof left === 'number' && left > 0 ? t('signin.codeWrong', { count: left }) : err instanceof ApiError && err.code === 'RATE_LIMITED' ? t('auth.tooMany') : t('error.SIGNIN_CODE_INVALID'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField label={t('signin.code')} description={t('signin.codeHint')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} isRequired value={code} onChange={(v) => setCode(v.replace(/\D/gu, ''))} />
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" variant="primary" isDisabled={busy || code.length !== 6}>
        {t('auth.signIn')}
      </Button>
    </form>
  );
}

/** Login page panel: "Email me a sign-in link". The answer is the same whether the address is known or not. */
export function EmailLinkRequest({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title={t('signin.emailTitle')}>
      {requestId ? (
        <>
          <Alert kind="success">{t('signin.emailSent')}</Alert>
          <EmailCodeForm requestId={requestId} />
        </>
      ) : (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              setRequestId((await call(Auth.requestEmailLink, { email })).requestId);
            } catch (err) {
              setError(err instanceof ApiError && err.code === 'RATE_LIMITED' ? t('auth.tooMany') : errorText(t, err));
            }
          }}
        >
          <p className="cc-muted">{t('signin.emailExplain')}</p>
          <TextField label={t('auth.email')} type="email" autoComplete="email" isRequired value={email} onChange={setEmail} autoFocus />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" variant="primary">
            {t('signin.sendLink')}
          </Button>
        </form>
      )}
      <Button variant="ghost" onPress={onBack}>
        {t('common.back')}
      </Button>
    </AuthCard>
  );
}

/** Where the emailed link lands. Pressing the button (a POST) signs in; opening the page does nothing. */
export function SignInLinkPage() {
  const { t } = useI18n();
  const token = useFragmentToken();
  const signedIn = useSignedIn();
  const [error, setError] = useState<string | null>(token ? null : t('error.SIGNIN_LINK_INVALID'));
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t('signin.linkTitle')}>
      {error ? (
        <Alert>{error}</Alert>
      ) : (
        <>
          <p>{t('signin.linkExplain')}</p>
          <Button
            variant="primary"
            size="big"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await signedIn(await call(Auth.completeEmailLink, { token }));
              } catch (err) {
                setError(err instanceof ApiError && err.status === 401 ? t('error.SIGNIN_LINK_INVALID') : errorText(t, err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('auth.signIn')}
          </Button>
        </>
      )}
    </AuthCard>
  );
}

/** The invite page, shown in the invited account's interface language. */
export function InvitePage() {
  const token = useFragmentToken();
  const info = useQuery({ queryKey: ['public', 'invite', token], queryFn: () => call(Auth.inspectInvite, { token }), enabled: token.length > 0, retry: false, staleTime: Infinity });
  const locale = info.data?.locale ?? null;
  useEffect(() => {
    if (locale) setDisplay({ locale });
  }, [locale]);
  if (!locale || !info.data) return <InviteState loading={info.isLoading && token.length > 0} />;
  return (
    <I18nProvider locale={locale}>
      <InviteForm token={token} info={info.data} />
    </I18nProvider>
  );
}

function InviteState({ loading }: { loading: boolean }) {
  const { t } = useI18n();
  return <AuthCard title={t('invite.title')}>{loading ? <p className="cc-muted">{t('common.loading')}</p> : <Alert>{t('error.INVITE_INVALID')}</Alert>}</AuthCard>;
}

function InviteForm({ token, info }: { token: string; info: z.infer<typeof Auth.inspectInvite.output> }) {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [method, setMethod] = useState<'password' | 'email_link'>('password');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unavailable = info.emailLinkUnavailableReason === 'NO_EMAIL' ? t('invite.noEmail') : t('invite.noSmtp');
  if (requestId) {
    return (
      <AuthCard title={t('invite.title')}>
        <Alert kind="success">{t('invite.checkEmail')}</Alert>
        <EmailCodeForm requestId={requestId} />
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('invite.title')}>
      <p>{t('invite.welcome', { name: info.displayName, login: info.login })}</p>
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (method === 'password') {
            if (pw.length < 10) return setError(t('password.rules'));
            if (pw !== pw2) return setError(t('password.mismatch'));
          }
          setBusy(true);
          try {
            const r = await call(Auth.acceptInvite, method === 'password' ? { token, method, password: pw } : { token, method });
            if (r.status === 'signed_in' && r.me) await signedIn(r.me);
            else setRequestId(r.requestId);
          } catch (err) {
            setError(errorText(t, err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="cc-choices">
          <legend className="cc-field__label">{t('invite.how')}</legend>
          <label className="cc-choice">
            <input type="radio" name="method" value="password" checked={method === 'password'} onChange={() => setMethod('password')} />
            <span>
              <strong>{t('invite.password')}</strong>
              <span className="cc-muted">{t('invite.passwordHint')}</span>
            </span>
          </label>
          {info.emailLinkAllowed ? (
            <label className="cc-choice" data-disabled={info.emailLinkAvailable ? undefined : 'true'}>
              <input type="radio" name="method" value="email_link" checked={method === 'email_link'} disabled={!info.emailLinkAvailable} onChange={() => setMethod('email_link')} />
              <span>
                <strong>{t('invite.emailLink')}</strong>
                <span className="cc-muted">{info.emailLinkAvailable ? t('invite.emailLinkHint') : unavailable}</span>
              </span>
            </label>
          ) : (
            <p className="cc-muted">{t('invite.adminPassword')}</p>
          )}
        </fieldset>
        {method === 'password' ? (
          <>
            <TextField label={t('password.new')} description={t('password.rules')} type="password" autoComplete="new-password" isRequired value={pw} onChange={setPw} />
            <TextField label={t('password.repeat')} type="password" autoComplete="new-password" isRequired value={pw2} onChange={setPw2} />
          </>
        ) : null}
        <p className="cc-muted">{t('invite.pinNext')}</p>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" variant="primary" size="big" isDisabled={busy}>
          {t('invite.accept')}
        </Button>
      </form>
    </AuthCard>
  );
}

/** Profile: how this account signs in, and switching (with re-authentication). Teachers only may use email links. */
export function SignInMethodSection({ me, emailLinkEnabled }: { me: Me; emailLinkEnabled: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = async (fresh: Me) => {
    qc.setQueryData(ME_KEY, fresh);
    setPassword('');
    setCode('');
    setPw('');
    setPw2('');
    setCodeStep(false);
    await freshMe(qc);
  };
  const fail = (err: unknown) => setError(reasonOf(err) === 'WRONG_PASSWORD' ? t('error.WRONG_PASSWORD') : errorText(t, err));
  return (
    <section className="cc-card cc-stack" aria-labelledby="method-title" data-testid="signin-method">
      <h2 id="method-title" className="cc-h2">
        {t('signin.methodTitle')}
      </h2>
      <p>{me.signInMethod === 'email_link' ? t('signin.methodIsEmail') : t('signin.methodIsPassword')}</p>
      {me.signInMethod === 'email_link' ? (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (pw.length < 10) return setError(t('password.rules'));
            if (pw !== pw2) return setError(t('password.mismatch'));
            try {
              await done(await call(Auth.switchToPassword, { newPassword: pw }));
            } catch (err) {
              fail(err);
            }
          }}
        >
          <h3 className="cc-h3">{t('signin.toPassword')}</h3>
          {me.reauthFresh ? null : <Alert kind="warning">{t('error.REAUTH_REQUIRED')}</Alert>}
          <TextField label={t('password.new')} description={t('password.rules')} type="password" autoComplete="new-password" isRequired value={pw} onChange={setPw} />
          <TextField label={t('password.repeat')} type="password" autoComplete="new-password" isRequired value={pw2} onChange={setPw2} />
          {error ? <Alert>{error}</Alert> : null}
          <div>
            <Button type="submit" variant="primary" isDisabled={!me.reauthFresh}>
              {t('signin.usePassword')}
            </Button>
          </div>
        </form>
      ) : me.role !== 'teacher' ? (
        <p className="cc-muted">{t('invite.adminPassword')}</p>
      ) : !emailLinkEnabled ? (
        <p className="cc-muted">{t('invite.noSmtp')}</p>
      ) : !me.hasEmail ? (
        <p className="cc-muted">{t('invite.noEmail')}</p>
      ) : codeStep ? (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await done(await call(Auth.confirmEmailLinkMethod, { code: code.trim() }));
            } catch (err) {
              fail(err);
            }
          }}
        >
          <Alert kind="success">{t('signin.methodCodeSent')}</Alert>
          <TextField label={t('signin.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} isRequired value={code} onChange={(v) => setCode(v.replace(/\D/gu, ''))} />
          {error ? <Alert>{error}</Alert> : null}
          <div className="cc-row">
            <Button type="submit" variant="primary" isDisabled={code.length !== 6}>
              {t('signin.useEmail')}
            </Button>
            <Button variant="ghost" onPress={() => setCodeStep(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await call(Auth.startEmailLinkMethod, { currentPassword: password });
              setPassword('');
              setCodeStep(true);
            } catch (err) {
              fail(err);
            }
          }}
        >
          <h3 className="cc-h3">{t('signin.toEmail')}</h3>
          <p className="cc-muted">{t('signin.toEmailHint')}</p>
          <TextField label={t('password.current')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
          {error ? <Alert>{error}</Alert> : null}
          <div>
            <Button type="submit">{t('signin.sendCode')}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
