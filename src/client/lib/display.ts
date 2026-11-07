import { useSyncExternalStore } from 'react';

export type ThemeName = 'explorer' | 'animals' | 'classroom';
export const THEMES: readonly ThemeName[] = ['explorer', 'animals', 'classroom'];

/**
 * Display settings applied to <html> (THM-2..6):
 * - theme: the active class's theme in the classroom; the neutral "classroom" theme elsewhere
 * - animations / sounds: the class switches (admin/teacher) AND this device's own switch
 * - textScale: the signed-in teacher's preference (percent)
 */
export interface DisplayState {
  theme: ThemeName;
  classAnimations: boolean;
  classSounds: boolean;
  deviceSounds: boolean;
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

let state: DisplayState = { theme: 'classroom', classAnimations: true, classSounds: true, deviceSounds: true, textScale: 100, locale: 'en' };
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
export const motionAllowed = (d: DisplayState) => d.classAnimations && !prefersReducedMotion();
export const soundsAllowed = (d: DisplayState) => d.classSounds && d.deviceSounds;
