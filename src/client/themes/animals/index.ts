/** Friendly animal mascots theme (THM-2): a fox cub, leaves and paw prints. One definition fills every slot. */
import { presetMotion } from '../motion.ts';
import { themeSounds } from '../soundPack.ts';
import type { ThemeDefinition } from '../types.ts';
import { AnimalDecoration, animalIllustrations, AnimalMascot, AnimalPattern } from './art.tsx';
import { avatar, colors, icons, shape, typography } from './tokens.ts';

export const animalsTheme: ThemeDefinition = {
  key: 'animals',
  labelKey: 'theme.animals',
  descriptionKey: 'theme.animals.description',
  mascotNameKey: 'theme.animals.mascot',
  colors,
  typography,
  shape,
  avatar,
  icons,
  decoOpacity: 0.2,
  patternOpacity: 0.06,
  Mascot: AnimalMascot,
  Decoration: AnimalDecoration,
  Pattern: AnimalPattern,
  patternSize: 90,
  illustrations: animalIllustrations,
  motion: {
    // A soft squash-and-bounce.
    celebrate: presetMotion('celebrate', { preset: 'squash', durationMs: 1000, easing: 'ease-in-out' }),
    // Peeks up from behind a leaf.
    threshold: presetMotion('threshold', { preset: 'rise', durationMs: 700, easing: 'ease-out' }),
  },
  // Bouncy pentatonic sine chirps, a little faster: birdsong in the zoo.
  ...themeSounds({ root: 587, wave: 'sine', scale: 'pentatonic', gain: 0.11, tempo: 1.2 }),
  celebration: { colors: ['accent', 'deco-1', 'deco-2', 'deco-3', 'warning'] },
};
