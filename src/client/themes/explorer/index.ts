/** Explorer / adventure theme (THM-2): maps, compass, warm paper. One definition fills every slot. */
import { presetMotion } from '../motion.ts';
import { themeSounds } from '../soundPack.ts';
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
    celebrate: presetMotion('celebrate', { preset: 'hop', durationMs: 900, easing: 'ease-in-out' }),
    // Slides in from the side like a map being unrolled.
    threshold: presetMotion('threshold', { preset: 'slideIn', durationMs: 600, easing: 'ease-out' }),
  },
  // Brass-like triangle fanfares in C major, like reaching a summit.
  ...themeSounds({ root: 523, wave: 'triangle', scale: 'major', gain: 0.11 }, {
    timeUp: [
      { freq: 523, at: 0, dur: 450, type: 'triangle', gain: 0.12 },
      { freq: 659, at: 380, dur: 600, type: 'triangle', gain: 0.1 },
      { freq: 784, at: 760, dur: 700, type: 'triangle', gain: 0.1 },
    ],
  }),
  celebration: { colors: ['accent', 'deco-1', 'deco-2', 'deco-3', 'success'] },
};
