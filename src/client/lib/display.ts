import { useSyncExternalStore } from 'react';
import type { TimeUpSound } from '../../shared/classDisplay.ts';
import { DEFAULT_THEME, THEME_KEYS, type ThemeKey } from '../../shared/themes.ts';

/** Theme keys come from the shared registry list (D-070); definitions live in src/client/themes. */
export type ThemeName = ThemeKey;
export const THEMES: readonly ThemeName[] = THEME_KEYS;

/**
 * Display settings applied to <html> (THM-2..6):
 * - theme: the active class's theme in the classroom; the default theme (DEFAULT_THEME) elsewhere
 * - animations / sounds: the class switches (admin/teacher) AND this device's own switch
 * - textScale: the signed-in teacher's preference (percent)
 */
export interface DisplayState {
  theme: ThemeName;
  classAnimations: boolean;
  classSounds: boolean;
  deviceSounds: boolean;
  /** Class sound volume 0..100 (S13b). */
  soundVolume: number;
  /** Time's-up announcement of the class and whether its teacher has a clip (S13b, D-107). */
  timeUpSound: TimeUpSound;
  timeUpClip: boolean;
  textScale: number;
  locale: 'en' | 'tr';
}

const SOUND_KEY = 'cc.deviceSounds';
function readDeviceSounds(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

let state: DisplayState = { theme: DEFAULT_THEME, classAnimations: true, classSounds: true, deviceSounds: true, soundVolume: 80, timeUpSound: 'voice', timeUpClip: false, textScale: 100, locale: 'en' };
let initialised = false;
const listeners = new Set<() => void>();

function apply() {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.dataset.theme = state.theme;
  html.dataset.motion = state.classAnimations ? 'on' : 'off';
  html.dataset.sounds = state.classSounds && state.deviceSounds ? 'on' : 'off';
  html.lang = state.locale;
  html.style.setProperty('--cc-text-scale', String(Math.min(200, Math.max(80, state.textScale)) / 100));
  // For layout rules that only change at a large text size (the admin top bar on a phone, S14i).
  html.dataset.text = state.textScale >= 150 ? 'large' : 'normal';
}

export function setDisplay(patch: Partial<DisplayState>) {
  if (!initialised) {
    initialised = true;
    state = { ...state, deviceSounds: readDeviceSounds() };
  }
  state = { ...state, ...patch };
  if ('deviceSounds' in patch) {
    try {
      localStorage.setItem(SOUND_KEY, patch.deviceSounds ? 'on' : 'off');
    } catch {
      /* private mode: per-session only */
    }
  }
  apply();
  listeners.forEach((l) => l());
}

export const getDisplay = () => state;

/** Called after every display change (the theme loader fetches an imported theme the page needs, S14g). */
export function subscribeDisplay(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function useDisplay(): DisplayState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

/** Whether animations may run now: class switch on AND the OS does not ask for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(fn: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(REDUCED_QUERY);
  mq.addEventListener?.('change', fn);
  return () => mq.removeEventListener?.('change', fn);
}
/**
 * `prefersReducedMotion()` that re-renders the component when the OS setting changes while the page
 * is open. Use it where JavaScript keeps something moving (the theme's ambient layer, S17a review);
 * CSS motion follows the media query by itself.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}
export const motionAllowed = (d: DisplayState) => d.classAnimations && !prefersReducedMotion();
export const soundsAllowed = (d: DisplayState) => d.classSounds && d.deviceSounds;
