/**
 * "Email address" in Profile (S35, D-214), for teachers and administrators. Shows the account's address
 * and changes it in two steps: re-authentication (the current password, or a fresh sign-in for accounts
 * without one) and the new address, then the 6-digit code that was emailed to the NEW address. Only the
 * code changes the address; the person's other devices are signed out. Without email on the server the
 * section says that the administrator changes addresses.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Auth from '../../shared/contracts/auth.ts';
import { call } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { freshMe, ME_KEY, type Me } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { TextField } from '../ui/Fields.tsx';

export function EmailChangeSection({ me, emailEnabled }: { me: Me; emailEnabled: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  // Email-link accounts have no password: a fresh sign-in (15 minutes) is the re-authentication (D-108).
  const byPassword = me.signInMethod === 'password';
  const canReauth = byPassword || me.reauthFresh;
  return (
    <section className="cc-card cc-stack" aria-labelledby="email-title" data-testid="email-change">
      <h2 id="email-title" className="cc-h2">
        {t('profile.emailTitle')}
      </h2>
      <p>{me.email ? t('profile.emailCurrent', { email: me.email }) : t('profile.emailNone')}</p>
      {changed ? <Alert kind="success">{t('profile.emailChanged', { email: changed })}</Alert> : null}
      {!emailEnabled ? (
        <p className="cc-muted">{t('profile.emailNoSmtp')}</p>
      ) : me.invitePending ? null : sentTo ? (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const fresh = await call(Auth.confirmEmailChange, { code });
              qc.setQueryData(ME_KEY, fresh);
              setChanged(sentTo);
              setSentTo(null);
              setCode('');
              setAddress('');
              await freshMe(qc);
            } catch (err) {
              setError(errorText(t, err));
            }
          }}
        >
          <Alert kind="success">{t('profile.emailCodeSent', { email: sentTo })}</Alert>
          <TextField label={t('signin.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} isRequired value={code} onChange={(v) => setCode(v.replace(/\D/gu, ''))} />
          {error ? <Alert>{error}</Alert> : null}
          <div className="cc-row">
            <Button type="submit" variant="primary" isDisabled={code.length !== 6}>
              {t('profile.emailConfirm')}
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                setSentTo(null);
                setCode('');
                setError(null);
              }}
            >
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
            setChanged(null);
            const email = address.trim().toLowerCase();
            try {
              await call(Auth.startEmailChange, byPassword ? { currentPassword: password, email } : { email });
              setPassword('');
              setSentTo(email);
            } catch (err) {
              setError(errorText(t, err));
            }
          }}
        >
          <p className="cc-muted">{t('profile.emailExplain')}</p>
          {byPassword ? (
            <TextField label={t('password.current')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
          ) : me.reauthFresh ? null : (
            <Alert kind="warning">{t('error.REAUTH_REQUIRED')}</Alert>
          )}
          <TextField label={t('profile.emailNew')} type="email" autoComplete="email" isRequired value={address} onChange={setAddress} />
          {error ? <Alert>{error}</Alert> : null}
          <div>
            <Button type="submit" variant="primary" isDisabled={!canReauth}>
              {t('profile.emailSendCode')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
