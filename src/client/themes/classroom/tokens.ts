/** Clean colourful classroom: crisp white boards, bright blue, sunny yellow, grape. Colour literals live only here. */
import { baseAvatar, baseIcons, baseShape, baseTypography, themeColors } from '../base.ts';
import type { ThemeAvatar, ThemeIcons, ThemeShape, ThemeTypography } from '../types.ts';

export const colors = themeColors({
  bg: '#f7f8fc',
  focus: '#b25e00',
  'icon-accent': '#6a4fc4',
  'deco-1': '#8fc3ef',
  'deco-2': '#ffd166',
  'deco-3': '#8b6fd6',
  pattern: '#2f5bd3',
  'mascot-body': '#8b6fd6',
  'mascot-belly': '#dfe7fb',
  'mascot-accent': '#ffd166',
  'art-sky': '#dcecfb',
  'art-ground': '#e8e2f8',
  'art-light': '#fff7d6',
});

export const typography: ThemeTypography = { ...baseTypography, display: "'Segoe UI', system-ui, Roboto, sans-serif", weightDisplay: 800, trackingDisplay: '-0.005em' };
export const shape: ThemeShape = { ...baseShape };
export const avatar: ThemeAvatar = { ...baseAvatar };
export const icons: ThemeIcons = { ...baseIcons };
