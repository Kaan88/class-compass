/**
 * Sign in with Google (S31, D-208): teachers, and administrators once they have no password.
 * - `GoogleSignIn`: the button on the sign-in page, always with the warning about shared computers
 *   (a Google sign-in leaves the Google account open in that browser). On a browser that has been a
 *   classroom display the button is held back behind that warning; "It is my own computer" shows it.
 * - `GoogleReturnPage` (`/signin-google`): where Google sends the browser back. The code and state are
 *   removed from the address bar at once and used by one POST.
 */
import { useEffect, useRef, useState } from 'react';
import * as Auth from '../../shared/contracts/auth.ts';
import googleMark from '../assets/google-g.svg?url';
import { call } from '../lib/api.ts';
import { isClassroomDevice } from '../lib/classroomDevice.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { AccountChooser, type AccountChoice } from './AccountChooser.tsx';
import { AuthCard } from './AuthCard.tsx';
import { LinkDeadEnd, useSignedIn } from './SignIn.tsx';

export function GoogleSignIn() {
  const { t } = useI18n();
  const [held, setHeld] = useState(isClassroomDevice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (held) {
    return (
      <div className="cc-stack" data-testid="google-signin">
        <Alert kind="warning">{t('google.classroomDevice')}</Alert>
        <Button variant="ghost" onPress={() => setHeld(false)}>
          {t('google.ownComputer')}
        </Button>
      </div>
    );
  }
  return (
    <div className="cc-stack" data-testid="google-signin">
      <Button
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await call(Auth.startGoogleSignIn, {});
            window.location.assign(r.authorizeUrl);
          } catch (err) {
            setError(errorText(t, err));
            setBusy(false);
          }
        }}
      >
        {/* Google's own mark, a picture file: the button's text is its name. */}
        <img className="cc-google__icon" src={googleMark} alt="" />
        {t('google.signIn')}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
      <Alert kind="warning">{t('google.sharedWarning')}</Alert>
    </div>
  );
}

export function GoogleReturnPage({ state, code, denied }: { state: string | undefined; code: string | undefined; denied: boolean }) {
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
      setError(t(denied ? 'google.cancelled' : 'error.GOOGLE_SIGNIN_FAILED'));
      return;
    }
    call(Auth.completeGoogleSignIn, { state, code }).then(
      (r) => ('choose' in r ? setChoices(r.choose) : signedIn(r)),
      (err: unknown) => setError(errorText(t, err)),
    );
    // Once per arrival: the values came from the address that was just cleared.
  }, []);
  return (
    <AuthCard title={t('google.title')}>
      {error ? (
        <>
          <Alert>{error}</Alert>
          <LinkDeadEnd to="email-link" label={t('signin.emailMe')} />
        </>
      ) : choices ? (
        <AccountChooser
          accounts={choices}
          endpoint={Auth.chooseGoogleAccount}
          onError={(err) => {
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
