/**
 * Language of the pages shown before sign-in (/login, /reset-password, /signin-link, the invite
 * page's error state). Before sign-in the account and its language are unknown, so the language is
 * chosen per device: the English | Türkçe switch on the sign-in card (remembered in localStorage),
 * otherwise a browser set to Turkish, otherwise the school's default language for new accounts
 * (D-025). Signed-in pages always use the account's own language (UX-4); this never changes it.
 */
import { useSyncExternalStore } from 'react';
import type { Locale } from '../../shared/i18n/index.ts';

const KEY = 'cc.signinLocale';
const listeners = new Set<() => void>();
let chosen: Locale | null | undefined;

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' || v === 'tr' ? v : null;
  } catch {
    return null;
  }
}

/** The language this device chose on the sign-in card, or null when it never chose one. */
export function storedSignedOutLocale(): Locale | null {
  if (chosen === undefined) chosen = readStored();
  return chosen;
}

/** Remembers the device's choice (for this visit only when storage is blocked). */
export function chooseSignedOutLocale(locale: Locale): void {
  chosen = locale;
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    /* private mode: this visit only */
  }
  for (const l of listeners) l();
}

function browserPrefersTurkish(): boolean {
  if (typeof navigator === 'undefined') return false;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return /^tr\b/iu.test(langs[0] ?? '');
}

/** Device choice, then a Turkish browser, then the school default (when known), then English. */
export function signedOutLocale(schoolDefault: Locale | undefined): Locale {
  return storedSignedOutLocale() ?? (browserPrefersTurkish() ? 'tr' : (schoolDefault ?? 'en'));
}

/** Re-renders when the device's choice changes. */
export function useStoredSignedOutLocale(): Locale | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    storedSignedOutLocale,
    storedSignedOutLocale,
  );
}

/** Tests only: forget the cached choice. */
export function resetSignedOutLocaleForTests(): void {
  chosen = undefined;
}
