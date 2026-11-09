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
import type { Animation } from '../../shared/themePackage/motion.ts';
import type { ThemePackageSounds } from '../../shared/themePackage/schema.ts';
import { SOUND_EVENTS, type ColorToken, type IllustrationName, type MascotPose, type MotionName, type SoundEvent, type ThemeColors, type ThemeSoundPack } from '../../shared/themePackage/tokens.ts';

/*
 * The theme vocabulary (colour tokens, poses, illustrations, motions, sound events and notes) lives in
 * `src/shared/themePackage/tokens.ts` since S14g (D-158), so the theme package validator on the server
 * uses the same lists. It is re-exported here for every existing import.
 */
export {
  COLOR_TOKENS,
  ILLUSTRATIONS,
  MASCOT_POSES,
  MOTIONS,
  SOUND_EVENTS,
  type ColorToken,
  type IllustrationName,
  type MascotPose,
  type MotionName,
  type SoundEvent,
  type SoundSpec,
  type ThemeColors,
  type ThemeSoundPack,
  type ToneNote,
} from '../../shared/themePackage/tokens.ts';
export type { Animation } from '../../shared/themePackage/motion.ts';

/** @deprecated name kept for older call sites: a sound is named by its event. */
export type SoundName = SoundEvent;
export const SOUNDS = SOUND_EVENTS;

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

export interface MotionSpec {
  full: Animation;
  /** Used under `prefers-reduced-motion`: opacity only, no movement. */
  reduced: Animation;
}

/** Full-screen celebration (S13b): firework colours are theme colour tokens, never raw colours in components. */
export interface ThemeCelebration {
  colors: readonly ColorToken[];
}

export interface MascotProps {
  pose: MascotPose;
}

/** Names of an imported theme (S14g, D-158): its own text in both languages instead of i18n keys. */
export interface ThemeLabels {
  name: { en: string; tr: string };
  description: { en: string; tr: string };
  mascot: { en: string; tr: string };
}

export interface ThemeDefinition {
  /** A built-in key (`THEME_KEYS`) or the slug of an imported theme package. */
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
  /** The `makeSoundPack` parameters the pack was made from (S14g: exported into theme packages). */
  soundParams?: ThemePackageSounds | null;
  celebration: ThemeCelebration;
  /**
   * Set for an imported theme package (S14g): where it came from and its own names. Built-in themes
   * leave it out. Components never branch on it (use `useThemeLabels`).
   */
  custom?: { base: ThemeKey; labels: ThemeLabels; status: 'draft' | 'enabled' | 'disabled' | 'preview' };
}
