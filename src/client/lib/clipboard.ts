import { useSyncExternalStore } from 'react';

/**
 * Copying text (usability audit 2026-11). The Clipboard API exists only in a secure context, so on a
 * plain-HTTP school network (`http://192.168.x.y`) `navigator.clipboard` is missing. `copyText`
 * then falls back to `document.execCommand('copy')` on a hidden text area, and when that fails too
 * the caller shows the text with `showManualCopy`, so there is always something to select by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && (typeof window === 'undefined' || window.isSecureContext !== false)) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused or no focus: try the old way below.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    active?.focus?.();
  }
}

/** The text the teacher copies by hand when the browser could not copy it (null = nothing shown). */
export interface ManualCopy {
  title: string;
  label: string;
  text: string;
}
let current: ManualCopy | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showManualCopy(m: ManualCopy) {
  current = m;
  emit();
}

/** Closed by the dialog, and when the teacher area locks or the user signs out (like sensitive toasts). */
export function clearManualCopy() {
  if (!current) return;
  current = null;
  emit();
}

export function useManualCopy(): ManualCopy | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
}
