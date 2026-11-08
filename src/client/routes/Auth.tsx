/** Sign-in (password, or an emailed link for email-link accounts, D-108), email password reset (D-015) and the (forced) password change screen. */
import { useState } from 'react';
import { useNavigate, useSearch, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Auth from '../../shared/contracts/auth.ts';
import { ApiError, call } from '../lib/api.ts';
import { errorText, reasonOf } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { getOutbox } from '../lib/outbox-client.ts';
import { freshMe, ME_KEY, signOut, useMe } from '../lib/session.ts';
import { Button, buttonClass } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { TextField } from '../ui/Fields.tsx';
import { AuthCard } from './AuthCard.tsx';
import { EmailLinkRequest, LinkDeadEnd, useFragmentToken } from './SignIn.tsx';
import { homeFor, safeNext } from './guards.ts';
import { SensitiveGate } from './Lock.tsx';

export function LoginPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `?mode=forgot` / `?mode=email-link` (from an expired link's page) opens that form at once.
  const [forgot, setForgot] = useState(search.mode === 'forgot');
  const [byEmail, setByEmail] = useState(search.mode === 'email-link');
  const resetInfo = useQuery({ queryKey: ['public', 'reset-available'], queryFn: () => call(Auth.passwordResetAvailable, {}), staleTime: 60_000 });
  const back = (close: () => void) => () => {
    close();
    if (search.mode) void navigate({ to: '/login', search: { next: search.next, mode: undefined }, replace: true });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await call(Auth.login, { login, password });
      qc.setQueryData(ME_KEY, me);
      void getOutbox().resume(me.id); // only this account's queued commands are sent (ACC-9)
      const next = safeNext(search.next);
      await navigate({ to: me.mustChangePassword ? '/change-password' : (next ?? homeFor(me)) });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'RATE_LIMITED' ? t('auth.tooMany') : err instanceof ApiError && err.status === 401 ? t('auth.incorrect') : errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (forgot && resetInfo.data?.emailResetEnabled !== false) return <ForgotPassword onBack={back(() => setForgot(false))} />;
  if (byEmail && resetInfo.data?.emailLinkEnabled !== false) return <EmailLinkRequest onBack={back(() => setByEmail(false))} />;
  return (
    <AuthCard title={t('auth.signIn')}>
      <form onSubmit={submit} className="cc-stack">
        <TextField label={t('auth.login')} name="login" autoComplete="username" isRequired value={login} onChange={setLogin} autoFocus />
        <TextField label={t('auth.password')} name="password" type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" variant="primary" size="big" isDisabled={busy}>
          {t('auth.signIn')}
        </Button>
      </form>
      {resetInfo.data?.emailResetEnabled ? (
        <Button variant="ghost" onPress={() => setForgot(true)}>
          {t('auth.forgot')}
        </Button>
      ) : (
        <p className="cc-muted">{t('auth.forgotAskAdmin')}</p>
      )}
      {resetInfo.data?.emailLinkEnabled ? (
        <Button variant="ghost" onPress={() => setByEmail(true)}>
          {t('signin.emailMe')}
        </Button>
      ) : null}
    </AuthCard>
  );
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title={t('auth.resetTitle')}>
      {sent ? (
        <Alert kind="success">{t('auth.resetSent')}</Alert>
      ) : (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await call(Auth.requestPasswordReset, { email });
              setSent(true);
            } catch (err) {
              setError(errorText(t, err));
            }
          }}
        >
          <TextField label={t('auth.email')} type="email" autoComplete="email" isRequired value={email} onChange={setEmail} autoFocus />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" variant="primary" size="big">
            {t('auth.sendResetLink')}
          </Button>
        </form>
      )}
      <Button variant="ghost" onPress={onBack}>
        {t('common.back')}
      </Button>
    </AuthCard>
  );
}

/** Reset link target: the token is in the URL fragment (#token=…), so it never reaches server logs. */
export function ResetPasswordPage() {
  const { t } = useI18n();
  // Removed from the address bar and history straight away.
  const token = useFragmentToken();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <AuthCard title={t('auth.newPasswordTitle')}>
      {done ? (
        <>
          <Alert kind="success">{t('auth.resetDone')}</Alert>
          <Link to="/login" search={{ next: undefined, mode: undefined }} className={buttonClass('primary', 'big')}>
            {t('auth.signIn')}
          </Link>
        </>
      ) : !token || expired ? (
        <>
          <Alert>{t('error.RESET_TOKEN_INVALID')}</Alert>
          <LinkDeadEnd to="forgot" label={t('auth.newResetLink')} />
        </>
      ) : (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (pw !== pw2) return setError(t('password.mismatch'));
            try {
              await call(Auth.completePasswordReset, { token, newPassword: pw });
              setDone(true);
            } catch (err) {
              if (reasonOf(err) === 'RESET_TOKEN_INVALID') setExpired(true);
              else setError(errorText(t, err));
            }
          }}
        >
          <TextField label={t('password.new')} description={t('password.rules')} type="password" autoComplete="new-password" minLength={10} isRequired value={pw} onChange={setPw} />
          <TextField label={t('password.repeat')} type="password" autoComplete="new-password" isRequired value={pw2} onChange={setPw2} />
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" variant="primary" size="big">
            {t('password.save')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

/**
 * Change own password (current + new twice). Used on the profile and the forced-change screen; on
 * the forced-change card (`main`) the save button is the card's big full-width main action like
 * every other sign-in card.
 */
export function ChangePasswordForm({ onDone, main = false }: { onDone?: () => void; main?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setOk(false);
        if (pw.length < 10) return setError(t('password.rules'));
        if (pw !== pw2) return setError(t('password.mismatch'));
        try {
          await call(Auth.changePassword, { currentPassword: current, newPassword: pw });
          setCurrent('');
          setPw('');
          setPw2('');
          setOk(true);
          await freshMe(qc);
          onDone?.();
        } catch (err) {
          setError(reasonOf(err) === 'WRONG_PASSWORD' ? t('error.WRONG_PASSWORD') : errorText(t, err));
        }
      }}
    >
      <TextField label={t('password.current')} type="password" autoComplete="current-password" isRequired value={current} onChange={setCurrent} />
      <TextField label={t('password.new')} description={t('password.rules')} type="password" autoComplete="new-password" isRequired value={pw} onChange={setPw} />
      <TextField label={t('password.repeat')} type="password" autoComplete="new-password" isRequired value={pw2} onChange={setPw2} />
      {error ? <Alert>{error}</Alert> : null}
      {ok ? <Alert kind="success">{t('password.changed')}</Alert> : null}
      {main ? (
        <Button type="submit" variant="primary" size="big">
          {t('password.save')}
        </Button>
      ) : (
        <div>
          <Button type="submit" variant="primary">
            {t('password.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

/** Shown when an account must change its temporary password before doing anything else. */
export function ChangePasswordPage() {
  const { t } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <SensitiveGate>
      <AuthCard title={t('password.changeTitle')}>
        {me?.mustChangePassword ? <Alert kind="warning">{t('password.mustChange')}</Alert> : null}
        <ChangePasswordForm
          main
          onDone={async () => {
            const fresh = await freshMe(qc);
            if (fresh) await navigate({ to: homeFor(fresh) });
          }}
        />
        <Button
          variant="ghost"
          onPress={async () => {
            await signOut(qc);
            await navigate({ to: '/login', search: { next: undefined, mode: undefined } });
          }}
        >
          {t('auth.signOut')}
        </Button>
      </AuthCard>
    </SensitiveGate>
  );
}
