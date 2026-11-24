/**
 * Passkeys (S33, D-210).
 * - `PasskeySignIn`: the button on the sign-in page. No username: the browser offers the passkeys it
 *   holds for this site, also one on the person's phone (the browser shows a QR code for that), which
 *   is the way to use a passkey on the classroom computer without saving anything on it.
 * - `PasskeysSection`: Profile. The account's passkeys, removing one, and adding one after
 *   re-authentication. On a browser that has been a classroom display, adding is held back behind the
 *   reason: a passkey saved there would let anyone who can unlock that computer sign in.
 * The WebAuthn browser library is loaded only when a passkey is used.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import * as Auth from '../../shared/contracts/auth.ts';
import { call } from '../lib/api.ts';
import { isClassroomDevice } from '../lib/classroomDevice.ts';
import { errorText, reasonOf } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import type { Me } from '../lib/session.ts';
import { showToast } from '../lib/toast.ts';
import { Button } from '../ui/Button.tsx';
import { DialogActions, Modal } from '../ui/Dialog.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { TextField } from '../ui/Fields.tsx';
import { useSignedIn } from './SignIn.tsx';

type Passkey = z.infer<typeof Auth.Passkey>;
const PASSKEYS = ['sensitive', 'account', 'passkeys'];

/** The browser can use passkeys at all (also false in a page that is not a secure context). */
export const passkeysSupported = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

const OFFER = ['sensitive', 'account', 'passkey-offer'];
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const snoozeKey = (userId: string) => `cc.passkeyOffer.later.${userId}`;

/** "Not now" on this device: the offer stays away for a month. Storage may be blocked: then it is not remembered. */
function snoozed(userId: string): boolean {
  try {
    const at = Number(localStorage.getItem(snoozeKey(userId)));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}
function snooze(userId: string) {
  try {
    localStorage.setItem(snoozeKey(userId), String(Date.now()));
  } catch {
    /* storage blocked */
  }
}

/** One passkey from start to finish: the server's options, the browser's dialog, the answer back. */
async function addPasskey(input: { currentPassword?: string; name?: string }) {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const started = await call(Auth.startPasskeyRegistration, input.currentPassword ? { currentPassword: input.currentPassword } : {});
  const response = await startRegistration({
    optionsJSON: started.options as never,
  });
  return call(Auth.finishPasskeyRegistration, {
    response: response as unknown as Record<string, unknown>,
    ...(input.name ? { name: input.name } : {}),
  });
}

/** What to tell the person when adding did not work. */
function addErrorText(t: ReturnType<typeof useI18n>['t'], err: unknown): string {
  // A passkey of this account that is already on the device: the browser refuses with InvalidStateError.
  const exists = err instanceof Error && err.name === 'InvalidStateError';
  return cancelled(err) ? t('passkey.cancelled') : exists ? t('error.PASSKEY_EXISTS') : reasonOf(err) === 'WRONG_PASSWORD' ? t('error.WRONG_PASSWORD') : errorText(t, err);
}

/** The person closed the browser's passkey dialog, or it timed out: not an error worth a red box. */
const cancelled = (err: unknown) => err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');

export function PasskeySignIn() {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!passkeysSupported()) return null;
  return (
    <div className="cc-stack" data-testid="passkey-signin">
      <Button
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const { startAuthentication } = await import('@simplewebauthn/browser');
            const started = await call(Auth.startPasskeySignIn, {});
            const response = await startAuthentication({
              optionsJSON: started.options as never,
            });
            await signedIn(
              await call(Auth.finishPasskeySignIn, {
                response: response as unknown as Record<string, unknown>,
              }),
            );
          } catch (err) {
            setError(cancelled(err) ? t('passkey.cancelled') : errorText(t, err));
            setBusy(false);
          }
        }}
      >
        {t('passkey.signIn')}
      </Button>
      {error ? <Alert kind="warning">{error}</Alert> : null}
    </div>
  );
}

export function PasskeysSection({ me }: { me: Me }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: PASSKEYS,
    queryFn: () => call(Auth.listPasskeys, {}),
  });
  const [held, setHeld] = useState(isClassroomDevice);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const byPassword = me.signInMethod === 'password';
  const when = (ms: number) =>
    new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', {
      dateStyle: 'medium',
    }).format(ms);
  const refresh = () => qc.invalidateQueries({ queryKey: PASSKEYS });
  const items = list.data?.passkeys ?? [];
  return (
    <section className="cc-card cc-stack" aria-labelledby="passkeys-title" data-testid="passkeys">
      <h2 id="passkeys-title" className="cc-h2">
        {t('passkey.title')}
      </h2>
      <p className="cc-muted">{t('passkey.explain')}</p>
      {items.length === 0 ? (
        <p>{list.isLoading ? t('common.loading') : t('passkey.none')}</p>
      ) : (
        <ul className="cc-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((p) => (
            <li key={p.id} className="cc-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div className="cc-muted">
                  {p.lastUsedAt ? t('passkey.lastUsed', { when: when(p.lastUsedAt) }) : t('passkey.neverUsed')}
                  {p.backedUp ? ` · ${t('passkey.synced')}` : ''}
                </div>
              </div>
              <Button size="small" onPress={() => setRemoving(p)}>
                {t('passkey.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!passkeysSupported() ? (
        <p className="cc-muted">{t('passkey.unsupported')}</p>
      ) : held ? (
        <>
          <Alert kind="warning">{t('passkey.classroomDevice')}</Alert>
          <div>
            <Button variant="ghost" onPress={() => setHeld(false)}>
              {t('passkey.ownComputer')}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="cc-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await addPasskey({
                ...(byPassword ? { currentPassword: password } : {}),
                ...(name.trim() ? { name: name.trim() } : {}),
              });
              setName('');
              setPassword('');
              await refresh();
              void qc.invalidateQueries({ queryKey: OFFER });
              showToast({ message: t('passkey.added'), kind: 'success' });
            } catch (err) {
              setError(addErrorText(t, err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="cc-h3">{t('passkey.add')}</h3>
          <Alert kind="warning">{t('passkey.sharedWarning')}</Alert>
          <TextField label={t('passkey.name')} description={t('passkey.nameHint')} value={name} onChange={setName} maxLength={60} />
          {byPassword ? (
            <TextField label={t('password.current')} type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
          ) : me.reauthFresh ? null : (
            <Alert kind="warning">{t('error.REAUTH_REQUIRED')}</Alert>
          )}
          {error ? <Alert>{error}</Alert> : null}
          <div>
            <Button type="submit" variant="primary" isDisabled={busy || (!byPassword && !me.reauthFresh)}>
              {t('passkey.add')}
            </Button>
          </div>
        </form>
      )}
      <Modal isOpen={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} title={t('passkey.remove')}>
        <p>{t('passkey.removeExplain', { name: removing?.name ?? '' })}</p>
        <DialogActions>
          <Button onPress={() => setRemoving(null)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onPress={async () => {
              const p = removing!;
              try {
                await call(Auth.removePasskey, { passkeyId: p.id });
                await refresh();
                showToast({ message: t('passkey.removed'), kind: 'success' });
              } catch (err) {
                showToast({ message: errorText(t, err), kind: 'error' });
              }
              setRemoving(null);
            }}
          >
            {t('passkey.remove')}
          </Button>
        </DialogActions>
      </Modal>
    </section>
  );
}

/**
 * The offer after a sign-in (S33, D-210): a teacher or administrator who just signed in by email or
 * Google and has no passkey sees one card in their area, because nobody finds Profile on their own.
 * The session is fresh, so adding needs no further confirmation. It stays silent on a classroom display,
 * in a browser without passkeys, after "Not now" on this device (a month) and after "Don't ask again"
 * (the account, everywhere).
 */
export function PasskeyOffer({ me }: { me: Me }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const usable = passkeysSupported() && !isClassroomDevice() && !snoozed(me.id);
  const offer = useQuery({
    queryKey: OFFER,
    queryFn: () => call(Auth.passkeyOffer, {}),
    enabled: usable && me.reauthFresh,
    staleTime: 60_000,
  });
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!usable || hidden || !offer.data?.offer) return null;
  const gone = () => {
    setHidden(true);
    qc.setQueryData(OFFER, { offer: false });
  };
  return (
    // Its own page gutter: the card sits above whichever page of the area is open.
    <div className="cc-page" style={{ paddingBottom: 0 }}>
      <section className="cc-card cc-stack" aria-labelledby="passkey-offer-title" data-testid="passkey-offer">
        <h2 id="passkey-offer-title" className="cc-h2">
          {t('passkey.offerTitle')}
        </h2>
        <p>{t('passkey.offerText')}</p>
        {error ? <Alert kind="warning">{error}</Alert> : null}
        <div className="cc-row">
          <Button
            variant="primary"
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await addPasskey({});
                void qc.invalidateQueries({ queryKey: PASSKEYS });
                showToast({ message: t('passkey.added'), kind: 'success' });
                gone();
              } catch (err) {
                setError(addErrorText(t, err));
                setBusy(false);
              }
            }}
          >
            {t('passkey.add')}
          </Button>
          <Button
            onPress={() => {
              snooze(me.id);
              gone();
            }}
          >
            {t('passkey.offerLater')}
          </Button>
          <Button
            variant="ghost"
            onPress={() => {
              gone();
              void call(Auth.dismissPasskeyOffer, {}).catch(() => snooze(me.id));
            }}
          >
            {t('passkey.offerNever')}
          </Button>
        </div>
      </section>
    </div>
  );
}
