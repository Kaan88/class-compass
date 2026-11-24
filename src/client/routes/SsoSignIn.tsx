/**
 * The operator's own sign-in server (S34, D-213).
 * - `SsoSignIn`: a small icon-only button in the corner of the sign-in card. It is one person's or one
 *   organisation's way in, not something every teacher needs, so it does not take a row of the page;
 *   it still has a name for screen readers and a tooltip, and a full-size touch target. Without an icon
 *   file it shows the first letter of its name. Like Google sign-in it would leave an account open in
 *   the browser, so it is not shown on a browser that has been a classroom display.
 * - `SsoReturnPage` (`/signin-sso`): where the provider sends the browser back. The code and state are
 *   removed from the address bar at once and used by one POST.
 */
import { useEffect, useRef, useState } from 'react';
import * as Auth from '../../shared/contracts/auth.ts';
import { call } from '../lib/api.ts';
import { isClassroomDevice } from '../lib/classroomDevice.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { AccountChooser, type AccountChoice } from './AccountChooser.tsx';
import { AuthCard } from './AuthCard.tsx';
import { LinkDeadEnd, useSignedIn } from './SignIn.tsx';

export function SsoSignIn({ sso }: { sso: { name: string; hasIcon: boolean } }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isClassroomDevice()) return null;
  const label = t('sso.signIn', { name: sso.name });
  return (
    <div className="cc-sso" data-testid="sso-signin">
      {error ? <Alert kind="warning">{error}</Alert> : null}
      <Button
        variant="ghost"
        className="cc-sso__button"
        aria-label={label}
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await call(Auth.startSsoSignIn, {});
            window.location.assign(r.authorizeUrl);
          } catch (err) {
            setError(errorText(t, err));
            setBusy(false);
          }
        }}
      >
        {/* The name is on the button itself (aria-label); the picture and the tooltip are for the eye. */}
        <span title={label} aria-hidden="true">
          {sso.hasIcon ? <img className="cc-sso__icon" src={Auth.ssoIcon.path} alt="" /> : <span className="cc-sso__letter">{sso.name.trim().charAt(0).toLocaleUpperCase()}</span>}
        </span>
      </Button>
    </div>
  );
}

export function SsoReturnPage({ state, code, denied }: { state: string | undefined; code: string | undefined; denied: boolean }) {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [error, setError] = useState<string | null>(null);
  // Several accounts with the proven address (D-216): the person chooses one.
  const [choices, setChoices] = useState<AccountChoice[] | null>(null);
  // The code works once: one request, also when React runs the effect twice in development.
  const sent = useRef(false);
  useEffect(() => {
    if (window.location.search) history.replaceState(null, '', window.location.pathname);
    if (sent.current) return;
    sent.current = true;
    if (denied || !state || !code) {
      setError(t(denied ? 'sso.cancelled' : 'error.SSO_SIGNIN_FAILED'));
      return;
    }
    call(Auth.completeSsoSignIn, { state, code }).then(
      (r) => ('choose' in r ? setChoices(r.choose) : signedIn(r)),
      (err: unknown) => setError(errorText(t, err)),
    );
    // Once per arrival: the values came from the address that was just cleared.
  }, []);
  return (
    <AuthCard title={t('sso.title')}>
      {error ? (
        <>
          <Alert>{error}</Alert>
          <LinkDeadEnd to="email-link" label={t('signin.emailMe')} />
        </>
      ) : choices ? (
        <AccountChooser
          accounts={choices}
          endpoint={Auth.chooseSsoAccount}
          failedReason="SSO_SIGNIN_FAILED"
          onFailed={(err) => {
            setChoices(null);
            setError(errorText(t, err));
          }}
        />
      ) : (
        <p className="cc-muted">{t('common.loading')}</p>
      )}
    </AuthCard>
  );
}
