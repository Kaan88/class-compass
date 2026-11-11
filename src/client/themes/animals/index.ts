/** Friendly animal mascots theme (THM-2): a fox cub, leaves and paw prints. One definition fills every slot. */
import { resolveFrame } from '../../../shared/themePackage/engine.ts';
import { presetMotion } from '../motion.ts';
import { themeSounds } from '../soundPack.ts';
import type { ThemeDefinition } from '../types.ts';
import { AnimalDecoration, animalIllustrations, AnimalMascot, AnimalPattern } from './art.tsx';
import { animalsScene } from './scene.tsx';
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
  // A music box playing bouncy pentatonic tunes, a little faster: a nursery in the meadow (S17b style).
  ...themeSounds({ root: 587, wave: 'sine', style: 'musicBox', scale: 'pentatonic', gain: 0.11, tempo: 1.2 }),
  celebration: { colors: ['accent', 'deco-1', 'deco-2', 'deco-3', 'warning'] },
  // S17b (D-168): a meadow with a burrow; no edge, a leaf garland with flowers on the routine and the
  // timer, leaf corners; slowly falling leaves; classic achievement frames; animal and sea avatars first.
  scene: animalsScene,
  frame: resolveFrame({ edge: 'none', trim: 'garland', corners: 'leaf' }),
  ambient: { preset: 'leaves', density: 22, speed: 'slow', size: 'large' },
  sets: { achievementFrame: 'classic', avatarFamiliesFirst: ['animals', 'sea'] },
};
