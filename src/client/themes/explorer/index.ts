/** Explorer / adventure theme (THM-2): maps, compass, warm paper. One definition fills every slot. */
import { FADE_IN } from '../motion.ts';
import type { ThemeDefinition } from '../types.ts';
import { ExplorerDecoration, explorerIllustrations, ExplorerMascot, ExplorerPattern } from './art.tsx';
import { avatar, colors, icons, shape, typography } from './tokens.ts';

export const explorerTheme: ThemeDefinition = {
  key: 'explorer',
  labelKey: 'theme.explorer',
  descriptionKey: 'theme.explorer.description',
  mascotNameKey: 'theme.explorer.mascot',
  colors,
  typography,
  shape,
  avatar,
  icons,
  decoOpacity: 0.22,
  patternOpacity: 0.07,
  Mascot: ExplorerMascot,
  Decoration: ExplorerDecoration,
  Pattern: ExplorerPattern,
  patternSize: 80,
  illustrations: explorerIllustrations,
  motion: {
    // A hop with a little wobble, like reaching the top of a hill.
    celebrate: {
      full: {
        keyframes: '0% { transform: translateY(0) rotate(0); } 35% { transform: translateY(-8%) rotate(-4deg); } 70% { transform: translateY(0) rotate(3deg); } 100% { transform: none; }',
        durationMs: 900,
        easing: 'ease-in-out',
      },
      reduced: FADE_IN,
    },
    // Slides in from the side like a map being unrolled.
    threshold: {
      full: { keyframes: '0% { transform: translateX(-6%); opacity: 0; } 100% { transform: none; opacity: 1; }', durationMs: 600, easing: 'ease-out' },
      reduced: FADE_IN,
    },
  },
  sounds: {
    timerEnd: [
      { freq: 523, at: 0, dur: 450, type: 'triangle', gain: 0.12 },
      { freq: 659, at: 380, dur: 600, type: 'triangle', gain: 0.1 },
    ],
    celebrate: [
      { freq: 523, at: 0, dur: 220, type: 'sine', gain: 0.1 },
      { freq: 659, at: 160, dur: 220, type: 'sine', gain: 0.1 },
      { freq: 784, at: 320, dur: 420, type: 'sine', gain: 0.1 },
    ],
  },
};
