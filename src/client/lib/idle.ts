/**
 * Inactivity timer (PIN-7, client side). Calls `onIdle` once after `ms` without user input. The
 * server has its own sliding unlock window; this one relocks the screen even when no request is made.
 */
export interface IdleTimer {
  stop(): void;
  reset(): void;
}

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'] as const;

export function createIdleTimer(opts: {
  ms: number;
  onIdle: () => void;
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): IdleTimer {
  const target = opts.target ?? window;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let fired = false;
  const arm = () => {
    if (handle !== null) clearTimer(handle);
    handle = setTimer(() => {
      handle = null;
      if (fired) return;
      fired = true;
      opts.onIdle();
    }, opts.ms);
  };
  const onActivity = () => {
    if (!fired) arm();
  };
  for (const e of EVENTS) target.addEventListener(e, onActivity, { passive: true } as AddEventListenerOptions);
  arm();
  return {
    stop() {
      if (handle !== null) clearTimer(handle);
      handle = null;
      for (const e of EVENTS) target.removeEventListener(e, onActivity);
    },
    reset() {
      fired = false;
      arm();
    },
  };
}

/** Client relock after 3 minutes without input while the teacher area is open in classroom mode. */
export const CLIENT_IDLE_LOCK_MS = 3 * 60 * 1000;
