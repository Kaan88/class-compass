/** Explorer / adventure: warm map paper, compass teal, rust trail markers. Colour literals live only here. */
import { baseAvatar, baseIcons, baseShape, baseTypography, themeColors } from '../base.ts';
import type { ThemeAvatar, ThemeIcons, ThemeShape, ThemeTypography } from '../types.ts';

export const colors = themeColors({
  bg: '#f4efe3',
  surface: '#fffaf0',
  'surface-2': '#efe4cc',
  border: '#cdbf9f',
  'border-strong': '#5b5140',
  'text-muted': '#4f4a3d',
  accent: '#1f6f5c',
  'accent-strong': '#175646',
  'accent-soft': '#d7ece5',
  focus: '#a8480f',
  'icon-accent': '#a8480f',
  'level-0': '#efe4cc',
  'level-edge-0': '#cdbf9f',
  'deco-1': '#1f6f5c',
  'deco-2': '#c8642c',
  'deco-3': '#cdbf9f',
  pattern: '#8a6d3b',
  'mascot-body': '#1f6f5c',
  'mascot-belly': '#fffaf0',
  'mascot-accent': '#c8642c',
  'mascot-cheek': '#e2557a',
  'art-sky': '#e3efe9',
  'art-ground': '#e6d6b0',
  'art-light': '#fff3cf',
});

export const typography: ThemeTypography = {
  ...baseTypography,
  display: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  weightHeading: 800,
  weightDisplay: 850,
  trackingDisplay: '0.01em',
};

export const shape: ThemeShape = {
  ...baseShape,
  radius: '0.85rem',
  radiusSm: '0.5rem',
  // Paper cards: a crisp bottom edge plus a soft shadow.
  shadow: '0 2px 0 var(--cc-shadow-color), 0 6px 14px var(--cc-shadow-color)',
};

export const avatar: ThemeAvatar = { ...baseAvatar, saturation: 50, lightness: 36 };
export const icons: ThemeIcons = { ...baseIcons, strokeWidth: 2.4 };
