/**
 * S36 (D-216): after Google or the operator's sign-in server proved an address that belongs to more
 * than one account the person may be (one person's teacher and administrator accounts, D-108), the
 * return page asks which one. One big button per account with its name and its role in words; pressing
 * one signs that account in (the proof is in a short-lived cookie the server set with the list).
 *
 * When the list appears in place of "Loading…" the question takes the focus, so a screen reader reads
 * it and Tab goes on to the buttons. An error that leaves the cookie (a rate limit, the network, an
 * account that can no longer be chosen) is shown above the list and the buttons stay; only the "did not
 * work, try again" kind (`failedReason`: the cookie is gone) ends the list, through `onFailed`.
 */
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type * as Auth from '../../shared/contracts/auth.ts';
import { ApiError, call } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { useSignedIn } from './SignIn.tsx';

export type AccountChoice = z.infer<typeof Auth.ChooseAccount>['choose'][number];

const reasonOf = (err: unknown): unknown => (err instanceof ApiError ? (err.details as { reason?: unknown } | undefined)?.reason : undefined);

export function AccountChooser({
  accounts,
  endpoint,
  failedReason,
  onFailed,
}: {
  accounts: AccountChoice[];
  /** `chooseGoogleAccount` or `chooseSsoAccount` (the same shape). */
  endpoint: typeof Auth.chooseGoogleAccount | typeof Auth.chooseSsoAccount;
  /** The reason that means the list's cookie is gone (`GOOGLE_SIGNIN_FAILED` / `SSO_SIGNIN_FAILED`). */
  failedReason: string;
  onFailed: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = useRef<HTMLParagraphElement>(null);
  // After React has drawn the list: the question takes the focus from the "Loading…" that was there.
  useEffect(() => prompt.current?.focus(), []);
  return (
    <div className="cc-stack" role="group" aria-labelledby="cc-account-chooser" data-testid="account-chooser">
      <p id="cc-account-chooser" ref={prompt} tabIndex={-1}>
        {t('signin.chooseAccount')}
      </p>
      {error ? <Alert>{error}</Alert> : null}
      {accounts.map((a) => {
        const role = t(a.role === 'admin' ? 'role.admin' : 'role.teacher');
        return (
          <Button
            key={a.id}
            size="big"
            className="cc-account-choice"
            // Read as "name, role": the two lines would otherwise run together.
            aria-label={t('signin.chooseAccount.option', { name: a.displayName, role })}
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await signedIn(await call(endpoint, { userId: a.id }));
              } catch (err) {
                setBusy(false);
                if (reasonOf(err) === failedReason) onFailed(err);
                else setError(errorText(t, err));
              }
            }}
          >
            <span className="cc-account-choice__name">{a.displayName}</span>
            <span className="cc-account-choice__role">{role}</span>
          </Button>
        );
      })}
    </div>
  );
}
