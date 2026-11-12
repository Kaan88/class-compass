/**
 * Per-device classroom preferences (S13a): the language a class is shown in when its second language
 * is on (D-099), remembered per device and class; without a second language the class's main language
 * is always used. Browser storage only holds conveniences; an empty or blocked storage falls back to
 * the defaults.
 *
 * The Compact / Normal / Large card size of D-103 (`cc.density.<userId>`) was removed in S27c (D-195):
 * the board sizes the cards itself (D-177). A value stored by an older version is never read again.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from '../../shared/i18n/index.ts';
import { displayLocale, type ClassLanguage } from '../../shared/classLanguage.ts';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const memory = new Map<string, string>();
function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: kept for this tab only */
  }
  emit();
}
const get = (key: string) => memory.get(key) ?? read(key);

const langKey = (classId: string) => `cc.classLang.${classId}`;

/** The locale the classroom shows this class in (main language unless the second one was picked here). */
export function useClassLocale(classId: string | null, lang: ClassLanguage | null): [Locale | null, (l: Locale) => void] {
  const stored = useSyncExternalStore(subscribe, () => (classId ? get(langKey(classId)) : null), () => null);
  const set = useCallback((l: Locale) => (classId ? write(langKey(classId), l) : undefined), [classId]);
  if (!classId || !lang) return [null, set];
  const wanted = stored === 'en' || stored === 'tr' ? stored : null;
  return [displayLocale(lang, wanted), set];
}
