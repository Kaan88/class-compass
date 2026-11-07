import { useSyncExternalStore } from 'react';

/**
 * PIN-4: after a PIN unlock the teacher menu must be shown before any sensitive page. The lock screen
 * sets this flag before unlocking; sensitive areas keep showing the lock screen until the teacher
 * menu has mounted (which clears the flag). This also stops a deep-linked page from flashing while
 * the router moves to the menu.
 */
let pending = false;
const listeners = new Set<() => void>();

export function setMenuFirst(v: boolean) {
  if (pending === v) return;
  pending = v;
  listeners.forEach((l) => l());
}

export const isMenuFirstPending = () => pending;

export function useMenuFirstPending(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => pending,
    () => pending,
  );
}
