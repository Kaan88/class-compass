/**
 * PIN unlock with the server's lockout rules (PIN-2, D-032), shared by the teacher-area lock screen
 * and the classroom "Customise layout" PIN dialog (S14b, D-148). It sends the PIN, and on a refusal
 * shows how many tries are left, counts down a lockout from the RELATIVE wait the server sends (a
 * classroom PC with a wrong clock neither re-enables the pad early nor keeps it disabled) and warns
 * before the session would be signed out.
 */
import { useEffect, useState } from 'react';
import * as Auth from '../../shared/contracts/auth.ts';
import { ApiError, call } from './api.ts';
import { errorText } from './errors.ts';
import { useI18n } from './i18n.tsx';

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export interface PinUnlockOptions {
  /** Runs just before the PIN is sent (the lock screen marks "menu first", PIN-4). */
  before?: () => void;
  /** After a successful unlock. */
  onUnlocked: () => void | Promise<void>;
  /** After a refused PIN (the lock screen clears "menu first" again). */
  onRefused?: () => void;
}

export function usePinUnlock({ before, onUnlocked, onRefused }: PinUnlockOptions) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [signOutWarning, setSignOutWarning] = useState<number | null>(null);
  const secondsLeft = useCountdown(lockedUntil);
  const lockedOut = secondsLeft > 0;

  async function unlock(pin: string) {
    setBusy(true);
    setError(null);
    try {
      before?.();
      await call(Auth.unlockPin, { pin });
      setLockedUntil(null);
      setSignOutWarning(null);
      await onUnlocked();
    } catch (err) {
      onRefused?.();
      const details = (err instanceof ApiError ? err.details : undefined) as
        | { reason?: string; retryAfterMs?: number; triesBeforePause?: number; attemptsBeforeSignOut?: number }
        | undefined;
      // From the first pause on, warn how many wrong PINs remain before the session is signed out.
      const beforeSignOut = typeof details?.attemptsBeforeSignOut === 'number' ? details.attemptsBeforeSignOut : null;
      if (err instanceof ApiError && err.code === 'PIN_LOCKED_OUT') {
        setLockedUntil(Date.now() + Math.max(0, Number(details?.retryAfterMs ?? 0)));
        setSignOutWarning(beforeSignOut);
        // The countdown message is shown while the pause lasts; nothing stale remains after it.
        setError(null);
      } else if (details?.reason === 'WRONG_PIN') {
        const left = Number(details.triesBeforePause ?? 0);
        setError(left > 0 ? `${t('pin.wrong')} ${t('pin.triesLeft', { count: left })}` : t('pin.wrong'));
        setSignOutWarning(left > 0 ? null : beforeSignOut);
      } else {
        setError(errorText(t, err));
      }
    } finally {
      setBusy(false);
    }
  }

  const padError = lockedOut ? `${t('pin.lockedOut')} ${t('pin.tryAgainIn', { time: mmss(secondsLeft) })}` : error;
  return { unlock, busy, lockedOut, padError, signOutWarning };
}
