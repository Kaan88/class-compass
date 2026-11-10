/**
 * Full screen during lessons (S18, D-167). The only place that calls the Fullscreen API.
 *
 * - `enterFullscreen()` must be called synchronously inside a press handler (browsers need a user
 *   gesture); `exitFullscreen()` needs none. Both do nothing where the API is missing or switched off
 *   (`document.fullscreenEnabled` false, e.g. iPhone) and swallow failures: a refused full screen is
 *   never an error the class sees.
 * - The whole document goes full screen, so dialogs, the PIN lock, celebrations and toasts keep
 *   working. Esc always leaves (browser behaviour); nothing here blocks it.
 */
import { useSyncExternalStore } from 'react';

const doc = (): Document | null => (typeof document === 'undefined' ? null : document);

/** The browser offers full screen for this page. */
export function fullscreenSupported(): boolean {
  const d = doc();
  return Boolean(d && d.fullscreenEnabled === true && typeof d.documentElement?.requestFullscreen === 'function');
}

export function isFullscreen(): boolean {
  return Boolean(doc()?.fullscreenElement);
}

/** Asks for full screen (call inside the press handler). Never throws. */
export function enterFullscreen(): void {
  const d = doc();
  if (!d || !fullscreenSupported() || d.fullscreenElement) return;
  try {
    void d.documentElement.requestFullscreen().catch(() => undefined);
  } catch {
    /* refused: stay in the window */
  }
}

/** Leaves full screen when the page is in it. Never throws. */
export function exitFullscreen(): void {
  const d = doc();
  if (!d || !d.fullscreenElement || typeof d.exitFullscreen !== 'function') return;
  try {
    void d.exitFullscreen().catch(() => undefined);
  } catch {
    /* already left */
  }
}

function subscribe(onChange: () => void) {
  const d = doc();
  d?.addEventListener('fullscreenchange', onChange);
  return () => d?.removeEventListener('fullscreenchange', onChange);
}

/** Whether the page is in full screen now, following `fullscreenchange` (Esc included). */
export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribe, isFullscreen, () => false);
}
