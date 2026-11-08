/** Clean colourful classroom theme (THM-2): a cheerful star, books and a board. One definition fills every slot. */
import { FADE_IN } from '../motion.ts';
import { makeSoundPack } from '../soundPack.ts';
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
    celebrate: {
      full: {
        keyframes: '0% { transform: scale(0.92) rotate(-6deg); } 60% { transform: scale(1.04) rotate(3deg); } 100% { transform: none; }',
        durationMs: 800,
        easing: 'ease-out',
      },
      reduced: FADE_IN,
    },
    // Settles down from above.
    threshold: {
      full: { keyframes: '0% { transform: translateY(-6%); opacity: 0; } 100% { transform: none; opacity: 1; }', durationMs: 500, easing: 'ease-out' },
      reduced: FADE_IN,
    },
  },
  // Calm and quiet: soft sines, slower. Time's up keeps the soft tone of S5 (D-048).
  sounds: makeSoundPack({ root: 440, wave: 'sine', scale: 'major', gain: 0.09, tempo: 0.85 }, { timeUp: [{ freq: 660, at: 0, dur: 900, type: 'sine', gain: 0.15 }, { freq: 660, at: 1100, dur: 900, type: 'sine', gain: 0.12 }] }),
  celebration: { colors: ['accent', 'success', 'deco-1', 'deco-2'] },
};
