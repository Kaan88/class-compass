/** Clean colourful classroom theme (THM-2): a cheerful star, books and a board. One definition fills every slot. */
import { FADE_IN } from '../motion.ts';
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
  sounds: {
    // The soft tone of S5 (D-048).
    timerEnd: [{ freq: 660, at: 0, dur: 900, type: 'sine', gain: 0.15 }],
    celebrate: [
      { freq: 784, at: 0, dur: 180, type: 'sine', gain: 0.1 },
      { freq: 988, at: 140, dur: 180, type: 'sine', gain: 0.1 },
      { freq: 1175, at: 280, dur: 400, type: 'sine', gain: 0.08 },
    ],
  },
};
