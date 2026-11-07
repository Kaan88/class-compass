/**
 * Presentation-safe teacher area (PIN-1..9, client side; the server enforces with 423).
 * - SensitiveGate wraps every sensitive layout. While the session is in classroom mode and locked it
 *   renders ONLY the neutral LockScreen: no sensitive component mounts and no sensitive query runs.
 * - After unlocking, the teacher menu is shown first (PIN-4) and a persistent banner says the area is
 *   visible on the classroom display (PIN-5). Inactivity relocks (PIN-7).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Auth from '../../shared/contracts/auth.ts';
import { ApiError, call } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { createIdleTimer, CLIENT_IDLE_LOCK_MS } from '../lib/idle.ts';
import { setMenuFirst, useMenuFirstPending } from '../lib/menuFirst.ts';
import { isLocked, lockNow, useMe } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { DisplayBanner } from '../ui/Layout.tsx';
import { PinPad } from '../ui/PinPad.tsx';

const FREE_PIN_FAILURES = 5;

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Neutral lock screen: app name, lock icon, PIN pad. Nothing about the page behind it (PIN-2/3). */
export function LockScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const router = useRouter();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const secondsLeft = useCountdown(lockedUntil);
  const lockedOut = secondsLeft > 0;

  async function unlock(pin: string) {
    setBusy(true);
    setError(null);
    try {
      setMenuFirst(true); // PIN-4: the menu comes first, whatever URL was requested
      await call(Auth.unlockPin, { pin });
      setLockedUntil(null);
      await navigate({ to: '/teacher' });
      await router.invalidate();
    } catch (err) {
      setMenuFirst(false);
      if (err instanceof ApiError && err.code === 'PIN_LOCKED_OUT') {
        const retryAt = (err.details as { retryAt?: number } | undefined)?.retryAt;
        // Server time → local countdown length (avoids clock skew between devices).
        setLockedUntil(Date.now() + Math.max(0, (retryAt ?? 0) - Date.now()));
        setError(t('pin.lockedOut'));
      } else if (err instanceof ApiError && (err.details as { reason?: string } | undefined)?.reason === 'WRONG_PIN') {
        const failures = Number((err.details as { failures?: number }).failures ?? 0);
        const left = FREE_PIN_FAILURES - failures;
        setError(left > 0 ? `${t('pin.wrong')} ${t('pin.triesLeft', { count: left })}` : t('pin.wrong'));
      } else {
        setError(errorText(t, err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cc-lock" data-testid="lock-screen">
      <svg className="cc-lock__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
      <p className="cc-muted" style={{ margin: 0, fontWeight: 700 }}>
        {t('app.name')}
      </p>
      <h1 className="cc-h1">{t('pin.title')}</h1>
      <PinPad onSubmit={unlock} busy={busy} disabled={lockedOut} error={lockedOut ? `${t('pin.lockedOut')} ${t('pin.tryAgainIn', { time: mmss(secondsLeft) })}` : error} />
      {me?.classroomMode ? (
        <Button size="big" onPress={() => void navigate({ to: '/classroom' })}>
          {t('teacher.backToClassroom')}
        </Button>
      ) : null}
    </main>
  );
}

/** Relocks after CLIENT_IDLE_LOCK_MS without input (classroom mode only). */
function IdleRelock() {
  const qc = useQueryClient();
  useEffect(() => {
    const timer = createIdleTimer({ ms: CLIENT_IDLE_LOCK_MS, onIdle: () => void lockNow(qc) });
    return () => timer.stop();
  }, [qc]);
  return null;
}

export function SensitiveGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const menuFirst = useMenuFirstPending();
  if (!me) return null;
  // Lock first, before any role check (D-020): every sensitive URL looks the same while locked.
  if (isLocked(me)) return <LockScreen />;
  if (menuFirst && pathname !== '/teacher') return <LockScreen />;
  return (
    <>
      {me.classroomMode ? (
        <>
          <DisplayBanner onLock={() => void lockNow(qc)} onClassroom={() => void navigate({ to: '/classroom' })} />
          <IdleRelock />
        </>
      ) : null}
      {children}
    </>
  );
}
