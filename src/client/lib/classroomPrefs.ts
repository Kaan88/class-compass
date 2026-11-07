/**
 * Per-device classroom preferences (S13a):
 * - density (Compact / Normal / Large, D-103): remembered per device AND teacher, so two teachers
 *   sharing a board each keep their own; applied as `data-density` on the classroom shell, where CSS
 *   sizes the student cards, the side rail and the timer (auto-fit per screen on top of it);
 * - the language a class is shown in when its second language is on (D-099): remembered per device
 *   and class; without a second language the class's main language is always used.
 * Browser storage only holds conveniences; an empty or blocked storage falls back to the defaults.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from '../../shared/i18n/index.ts';
import { displayLocale, type ClassLanguage } from '../../shared/classLanguage.ts';

export const DENSITIES = ['compact', 'normal', 'large'] as const;
export type Density = (typeof DENSITIES)[number];

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

const densityKey = (userId: string | null | undefined) => `cc.density.${userId ?? 'anon'}`;
export const readDensity = (userId: string | null | undefined): Density => {
  const v = get(densityKey(userId));
  return (DENSITIES as readonly string[]).includes(v ?? '') ? (v as Density) : 'normal';
};

export function useDensity(userId: string | null | undefined): [Density, (d: Density) => void] {
  const value = useSyncExternalStore(subscribe, () => readDensity(userId), () => 'normal' as Density);
  const set = useCallback((d: Density) => write(densityKey(userId), d), [userId]);
  return [value, set];
}

const langKey = (classId: string) => `cc.classLang.${classId}`;

/** The locale the classroom shows this class in (main language unless the second one was picked here). */
export function useClassLocale(classId: string | null, lang: ClassLanguage | null): [Locale | null, (l: Locale) => void] {
  const stored = useSyncExternalStore(subscribe, () => (classId ? get(langKey(classId)) : null), () => null);
  const set = useCallback((l: Locale) => (classId ? write(langKey(classId), l) : undefined), [classId]);
  if (!classId || !lang) return [null, set];
  const wanted = stored === 'en' || stored === 'tr' ? stored : null;
  return [displayLocale(lang, wanted), set];
}
