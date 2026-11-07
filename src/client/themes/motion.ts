/**
 * Motion building blocks for themes (THM-5). Every animation plays once; the reduced-motion variant
 * only fades in (no movement, no flashing). Themes pick or write their own `full` keyframes.
 */
import type { Animation } from './types.ts';

/** The reduced-motion variant shared by all themes: a single short fade-in. */
export const FADE_IN: Animation = { keyframes: '0% { opacity: 0; } 100% { opacity: 1; }', durationMs: 400, easing: 'ease-out' };
