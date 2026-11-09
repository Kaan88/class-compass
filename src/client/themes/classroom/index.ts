/** Clean colourful classroom theme (THM-2): a cheerful star, books and a board. One definition fills every slot. */
import { presetMotion } from '../motion.ts';
import { themeSounds } from '../soundPack.ts';
import type { ThemeDefinition } from '../types.ts';
import { ClassroomDecoration, classroomIllustrations, ClassroomMascot, ClassroomPattern } from './art.tsx';
import { avatar, colors, icons, shape, typography } from './tokens.ts';

export const classroomTheme: ThemeDefinition = {
  key: 'classroom',
  labelKey: 'theme.classroom',
  descriptionKey: 'theme.classroom.description',
  mascotNameKey: 'theme.classroom.mascot',
  colors,
  typography,
  shape,
  avatar,
  icons,
  decoOpacity: 0.4,
  patternOpacity: 0.08,
  Mascot: ClassroomMascot,
  Decoration: ClassroomDecoration,
  Pattern: ClassroomPattern,
  patternSize: 40,
  illustrations: classroomIllustrations,
  motion: {
    // A small pop with a twist.
    celebrate: presetMotion('celebrate', { preset: 'pop', durationMs: 800, easing: 'ease-out' }),
    // Settles down from above.
    threshold: presetMotion('threshold', { preset: 'settle', durationMs: 500, easing: 'ease-out' }),
  },
  // Calm and quiet: soft sines, slower. Time's up keeps the soft tone of S5 (D-048).
  ...themeSounds({ root: 440, wave: 'sine', scale: 'major', gain: 0.09, tempo: 0.85 }, { timeUp: [{ freq: 660, at: 0, dur: 900, type: 'sine', gain: 0.15 }, { freq: 660, at: 1100, dur: 900, type: 'sine', gain: 0.12 }] }),
  celebration: { colors: ['accent', 'success', 'deco-1', 'deco-2'] },
};
