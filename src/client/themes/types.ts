/**
 * Theme definition (SX, D-070; THM-1..5). A theme is ONE TypeScript object (`src/client/themes/<key>/`)
 * that fills every slot below. Components never branch on the theme key: they use semantic CSS tokens
 * (`var(--cc-*)`, generated from `colors`, `typography`, `shape`, `icons`) and theme slots through
 * `useTheme()` / `<Mascot>` / `<ThemeIllustration>` / `<ThemeBackdrop>` (`src/client/themes/index.tsx`).
 * Meanings (icons, labels, positions, controls) are identical in every theme (THM-3): a theme only
 * changes how things look and sound, never what they mean.
 */
import type { ComponentType } from 'react';
import type { MessageKey } from '../../shared/i18n/index.ts';
import type { ThemeKey } from '../../shared/themes.ts';

/** Semantic colour tokens, emitted as `--cc-<name>`. Values are colour literals (hex). */
export const COLOR_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'accent-strong',
  'accent-soft',
  'accent-text',
  'focus',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-strong',
  'danger-soft',
  'on-strong',
  'overlay',
  'shadow-color',
  // "visible on the classroom display" banner (PIN-5)
  'display-banner-bg',
  'display-banner-text',
  'display-banner-border',
  // counter depth levels neutral → amber → deeper amber → red (CNT-6), always with numbers + words
  'level-0',
  'level-1',
  'level-2',
  'level-3',
  'level-edge-0',
  'level-edge-1',
  'level-edge-2',
  'level-edge-3',
  // counter colour keys (CNT-12): teachers pick a name, never a raw colour
  'counter-accent',
  'counter-accent-edge',
  'counter-teal',
  'counter-teal-edge',
  'counter-plum',
  'counter-plum-edge',
  'counter-rust',
  'counter-rust-edge',
  'counter-leaf',
  'counter-leaf-edge',
  'counter-berry',
  'counter-berry-edge',
  'segment-on',
  'segment-off',
  'avatar-text',
  // icon accent (menu tiles, illustrations' line work)
  'icon-accent',
  // decorations, background pattern, mascot and illustrations (always subtle)
  'deco-1',
  'deco-2',
  'deco-3',
  'pattern',
  'mascot-body',
  'mascot-belly',
  'mascot-accent',
  'mascot-ink',
  'mascot-cheek',
  'art-sky',
  'art-ground',
  'art-light',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeColors = Record<ColorToken, string>;

export interface ThemeTypography {
  /** Font stack for body text (system fonts only: nothing is downloaded, CSP font-src 'self'). */
  body: string;
  /** Font stack for headings and big classroom text. */
  display: string;
  weightBody: number;
  weightStrong: number;
  weightHeading: number;
  weightDisplay: number;
  /** CSS letter-spacing values. */
  trackingBody: string;
  trackingDisplay: string;
}

export interface ThemeShape {
  radius: string;
  radiusSm: string;
  borderWidth: string;
  borderWidthStrong: string;
  /** Elevation of cards and toasts (uses var(--cc-shadow-color)). */
  shadow: string;
  /** Elevation of dialogs and overlays. */
  shadowRaised: string;
}

/** Avatar circles: hue from the student id, saturation/lightness from the theme (CRD-1). */
export interface ThemeAvatar {
  saturation: number;
  lightness: number;
  /** Small avatars carry small initials (not large text), so they need 4.5:1: darker. */
  lightnessSmall: number;
}

export interface ThemeIcons {
  strokeWidth: number;
  linecap: 'round' | 'square' | 'butt';
  linejoin: 'round' | 'miter' | 'bevel';
}

export const MASCOT_POSES = ['idle', 'cheer', 'thinking', 'celebrate', 'sleepy'] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];

export const ILLUSTRATIONS = ['lockScreen', 'emptyState', 'threshold', 'startLesson', 'endLesson', 'celebration'] as const;
export type IllustrationName = (typeof ILLUSTRATIONS)[number];

export const MOTIONS = ['celebrate', 'threshold'] as const;
export type MotionName = (typeof MOTIONS)[number];

/** One CSS animation that plays exactly once (THM-5: no repeated flashing). */
export interface Animation {
  /** Keyframe body, e.g. `0% { transform: … } 100% { … }`. Emitted as `@keyframes cc-<theme>-<motion>[-reduced]`. */
  keyframes: string;
  durationMs: number;
  easing: string;
}
export interface MotionSpec {
  full: Animation;
  /** Used under `prefers-reduced-motion`: opacity only, no movement. */
  reduced: Animation;
}

/**
 * The theme sound pack (S13b, D-110): one short synthesized cue per classroom event. Every theme
 * fills all of them (usually with `makeSoundPack`, src/client/themes/soundPack.ts); the SoundManager
 * plays them with the class volume, priorities and ducking. Callers name the event, never a sound.
 */
export const SOUND_EVENTS = [
  'tap',
  'undo',
  'stageChange',
  'timeUp',
  'thresholdReached',
  'assistantCheck',
  'groupShuffle',
  'secretDrumroll',
  'secretReveal',
  'fanfare',
  'clapping',
  'fireworks',
  'pointAwarded',
  'softChime',
] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];
/** @deprecated name kept for older call sites: a sound is named by its event. */
export type SoundName = SoundEvent;
export const SOUNDS = SOUND_EVENTS;

/** A short synthesized note (WebAudio): no audio files are shipped. */
export interface ToneNote {
  /** Frequency in Hz (for 'noise': the centre of the band-pass filter). */
  freq: number;
  /** Optional glide: the frequency reached at the end of the note. */
  to?: number;
  /** Start offset in ms. */
  at: number;
  /** Length in ms. */
  dur: number;
  /** 'noise' is filtered white noise (claps, drum rolls, firework crackle). */
  type: 'sine' | 'triangle' | 'square' | 'noise';
  /** Peak gain 0..0.3 (gentle); scaled by the class volume. */
  gain: number;
}
export type SoundSpec = readonly ToneNote[];
export type ThemeSoundPack = Record<SoundEvent, SoundSpec>;

/** Full-screen celebration (S13b): firework colours are theme colour tokens, never raw colours in components. */
export interface ThemeCelebration {
  colors: readonly ColorToken[];
}

export interface MascotProps {
  pose: MascotPose;
}

export interface ThemeDefinition {
  key: ThemeKey;
  /** `theme.<key>` */
  labelKey: MessageKey;
  /** One-line description shown in the theme picker. */
  descriptionKey: MessageKey;
  /** Name of the mascot (i18n), used as the accessible name where the mascot is labelled. */
  mascotNameKey: MessageKey;
  colors: ThemeColors;
  typography: ThemeTypography;
  shape: ThemeShape;
  avatar: ThemeAvatar;
  icons: ThemeIcons;
  /** Opacity of the corner decoration and of the background pattern. */
  decoOpacity: number;
  patternOpacity: number;
  /** Original SVG content (no <svg> wrapper) in a 100×100 box, coloured only with var(--cc-*) tokens. */
  Mascot: ComponentType<MascotProps>;
  /** Corner decoration, 100×100 box. */
  Decoration: ComponentType;
  /** Repeating background tile (`<pattern>` content) and its size in px. */
  Pattern: ComponentType;
  patternSize: number;
  /** Illustrations, each in a 200×140 box. */
  illustrations: Record<IllustrationName, ComponentType>;
  motion: Record<MotionName, MotionSpec>;
  /** The sound pack; null keeps the theme silent (the visual signal is always there). */
  sounds: ThemeSoundPack | null;
  celebration: ThemeCelebration;
}
