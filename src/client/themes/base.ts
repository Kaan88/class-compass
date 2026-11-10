/**
 * Shared starting point of every theme (SX, D-070). Colour literals are allowed only here and in
 * `src/client/themes/<theme>/tokens.ts` (lint-enforced); everything else uses `var(--cc-*)`.
 * A theme spreads these values and overrides what makes it distinct.
 */
import { FONT_PRESETS, SHADOW_PRESETS } from '../../shared/themePackage/presets.ts';
import type { ThemeAvatar, ThemeColors, ThemeIcons, ThemeShape, ThemeTypography } from './types.ts';

/** Font stacks and shadows are named presets (S14g, D-158), shared with imported theme packages. */
export const SYSTEM_FONTS = FONT_PRESETS.system;

export const baseColors: ThemeColors = {
  bg: '#f7f8fc',
  surface: '#ffffff',
  'surface-2': '#eef1f8',
  text: '#14182b',
  'text-muted': '#4a5170',
  border: '#c9cfe0',
  'border-strong': '#4a5170',
  accent: '#2f5bd3',
  'accent-strong': '#2448ad',
  'accent-soft': '#dfe7fb',
  'accent-text': '#ffffff',
  focus: '#b25e00',
  success: '#17733f',
  'success-soft': '#dcf3e5',
  warning: '#8a5100',
  'warning-soft': '#fff1d1',
  danger: '#b3261e',
  'danger-strong': '#8c1d17',
  'danger-soft': '#fde3e1',
  'on-strong': '#ffffff',
  overlay: '#14182b8c',
  'shadow-color': '#14182b1f',
  'scene-scrim': '#ffffff',
  'display-banner-bg': '#fff1d1',
  'display-banner-text': '#14182b',
  'display-banner-border': '#8a5100',
  'level-0': '#eef1f8',
  'level-1': '#fff1d1',
  'level-2': '#ffd27a',
  'level-3': '#fde3e1',
  'level-edge-0': '#c9cfe0',
  'level-edge-1': '#8a5100',
  'level-edge-2': '#6e3f00',
  'level-edge-3': '#b3261e',
  'counter-accent': '#2f5bd3',
  'counter-accent-edge': '#2448ad',
  'counter-teal': '#1f6f5c',
  'counter-teal-edge': '#175646',
  'counter-plum': '#7a35a6',
  'counter-plum-edge': '#642b88',
  'counter-rust': '#c25a22',
  'counter-rust-edge': '#6e3f00',
  'counter-leaf': '#4f8a37',
  'counter-leaf-edge': '#17733f',
  'counter-berry': '#d6406a',
  'counter-berry-edge': '#8c1d17',
  'segment-on': '#2f5bd3',
  'segment-off': '#eef1f8',
  'avatar-text': '#ffffff',
  'icon-accent': '#2f5bd3',
  'deco-1': '#8fc3ef',
  'deco-2': '#ffd166',
  'deco-3': '#e2557a',
  pattern: '#2f5bd3',
  'mascot-body': '#2f5bd3',
  'mascot-belly': '#dfe7fb',
  'mascot-accent': '#ffd166',
  'mascot-ink': '#14182b',
  'mascot-cheek': '#e2557a',
  'art-sky': '#dcecfb',
  'art-ground': '#cfe6c4',
  'art-light': '#fff7d6',
  'avatar-red': '#d9483b',
  'avatar-orange': '#e8833a',
  'avatar-yellow': '#f2c94c',
  'avatar-green': '#4caf6a',
  'avatar-teal': '#2a9d8f',
  'avatar-blue': '#3b7dd8',
  'avatar-navy': '#2c3e7a',
  'avatar-purple': '#8a5cc2',
  'avatar-pink': '#e46aa6',
  'avatar-brown': '#8d5b3e',
  'avatar-grey': '#8a93a6',
  'avatar-mint': '#8fd6c0',
  'avatar-skin-1': '#fde3cf',
  'avatar-skin-2': '#f8d5b8',
  'avatar-skin-3': '#f1c29a',
  'avatar-skin-4': '#e8b07f',
  'avatar-skin-5': '#d99a68',
  'avatar-skin-6': '#c68652',
  'avatar-skin-7': '#b07142',
  'avatar-skin-8': '#965c35',
  'avatar-skin-9': '#7d4a2a',
  'avatar-skin-10': '#653a22',
  'avatar-skin-11': '#4f2d1b',
  'avatar-skin-12': '#3b2115',
  'avatar-hair-black': '#1f1a17',
  'avatar-hair-darkBrown': '#3e2a1f',
  'avatar-hair-brown': '#6b4428',
  'avatar-hair-auburn': '#8e3b22',
  'avatar-hair-ginger': '#c4622d',
  'avatar-hair-blonde': '#d9b45a',
  'avatar-hair-lightBlonde': '#ecd796',
  'avatar-hair-grey': '#9a9a9a',
  'avatar-hair-white': '#ececec',
  'avatar-hair-blue': '#3b6fd1',
  'avatar-hair-pink': '#e07bb0',
  'avatar-hair-purple': '#7d4fc0',
  'avatar-ink': '#1d2033',
  'avatar-outline': '#1d203340',
  'avatar-white': '#ffffff',
  'avatar-blush': '#f0807f',
  'badge-bronze': '#c07a3f',
  'badge-silver': '#a9b2c3',
  'badge-gold': '#e5b631',
  'badge-plain': '#6c8cd5',
  'badge-ink': '#1d2033',
  'badge-shine': '#ffffff',
  'print-ink': '#000000',
  'print-paper': '#ffffff',
};

/**
 * Build a theme's colours: base + overrides, with the accent-derived tokens (counter "accent" colour,
 * bar segments, icon accent) following the theme's accent unless the theme sets them itself.
 */
export function themeColors(overrides: Partial<ThemeColors>): ThemeColors {
  const c = { ...baseColors, ...overrides };
  return {
    ...c,
    'counter-accent': overrides['counter-accent'] ?? c.accent,
    'counter-accent-edge': overrides['counter-accent-edge'] ?? c['accent-strong'],
    'segment-on': overrides['segment-on'] ?? c.accent,
    'segment-off': overrides['segment-off'] ?? c['surface-2'],
    'icon-accent': overrides['icon-accent'] ?? c.accent,
    pattern: overrides.pattern ?? c.accent,
    // The panel behind headings on a scene (S17a, D-166): the card surface unless the theme sets one.
    'scene-scrim': overrides['scene-scrim'] ?? c.surface,
    // Printed QR codes scan best as pure black on white: no theme may change them (D-120).
    'print-ink': baseColors['print-ink'],
    'print-paper': baseColors['print-paper'],
  };
}

export const baseTypography: ThemeTypography = {
  body: SYSTEM_FONTS,
  display: SYSTEM_FONTS,
  weightBody: 400,
  weightStrong: 700,
  weightHeading: 750,
  weightDisplay: 800,
  trackingBody: 'normal',
  trackingDisplay: 'normal',
};

export const baseShape: ThemeShape = {
  radius: '1rem',
  radiusSm: '0.6rem',
  borderWidth: '2px',
  borderWidthStrong: '3px',
  shadow: SHADOW_PRESETS.soft,
  shadowRaised: SHADOW_PRESETS.raised,
};

export const baseAvatar: ThemeAvatar = { saturation: 55, lightness: 38, lightnessSmall: 28 };

export const baseIcons: ThemeIcons = { strokeWidth: 2.2, linecap: 'round', linejoin: 'round' };
