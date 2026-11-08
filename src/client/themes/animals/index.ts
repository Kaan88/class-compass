/** Friendly animal mascots theme (THM-2): a fox cub, leaves and paw prints. One definition fills every slot. */
import { FADE_IN } from '../motion.ts';
import { makeSoundPack } from '../soundPack.ts';
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
    celebrate: {
      full: {
        keyframes: '0% { transform: none; } 30% { transform: scale(1.05, 0.95); } 60% { transform: translateY(-8%); } 100% { transform: none; }',
        durationMs: 1000,
        easing: 'ease-in-out',
      },
      reduced: FADE_IN,
    },
    // Peeks up from behind a leaf.
    threshold: {
      full: { keyframes: '0% { transform: translateY(8%); opacity: 0; } 100% { transform: none; opacity: 1; }', durationMs: 700, easing: 'ease-out' },
      reduced: FADE_IN,
    },
  },
  // Bouncy pentatonic sine chirps, a little faster: birdsong in the zoo.
  sounds: makeSoundPack({ root: 587, wave: 'sine', scale: 'pentatonic', gain: 0.11, tempo: 1.2 }, {}),
  celebration: { colors: ['accent', 'deco-1', 'deco-2', 'deco-3', 'warning'] },
};
