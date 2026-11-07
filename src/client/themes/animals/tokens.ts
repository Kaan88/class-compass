/** Friendly animal mascots: soft leaf greens, berry plum accent, fox orange. Colour literals live only here. */
import { baseAvatar, baseIcons, baseShape, baseTypography, themeColors } from '../base.ts';
import type { ThemeAvatar, ThemeIcons, ThemeShape, ThemeTypography } from '../types.ts';

export const colors = themeColors({
  bg: '#f2f7ef',
  surface: '#ffffff',
  'surface-2': '#e3f0dc',
  border: '#c4d8b8',
  'border-strong': '#47604a',
  'text-muted': '#45574a',
  accent: '#7a35a6',
  'accent-strong': '#642b88',
  'accent-soft': '#efe2f7',
  focus: '#b0470c',
  'icon-accent': '#3f7a2c',
  'level-0': '#e3f0dc',
  'level-edge-0': '#c4d8b8',
  'deco-1': '#5f9b45',
  'deco-2': '#ef8a3c',
  'deco-3': '#7a35a6',
  pattern: '#5f9b45',
  'mascot-body': '#ef8a3c',
  'mascot-belly': '#ffe6d1',
  'mascot-accent': '#5f9b45',
  'mascot-cheek': '#e2557a',
  'art-sky': '#e6f2fb',
  'art-ground': '#cfe6c4',
  'art-light': '#fff4d6',
});

export const typography: ThemeTypography = {
  ...baseTypography,
  display: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', system-ui, sans-serif",
  weightHeading: 700,
  weightDisplay: 800,
  trackingDisplay: '0.015em',
};

export const shape: ThemeShape = {
  ...baseShape,
  radius: '1.35rem',
  radiusSm: '0.85rem',
  shadow: '0 4px 16px var(--cc-shadow-color)',
  shadowRaised: '0 14px 36px var(--cc-shadow-color)',
};

export const avatar: ThemeAvatar = { ...baseAvatar, saturation: 52, lightness: 37 };
export const icons: ThemeIcons = { ...baseIcons, strokeWidth: 2.5 };
