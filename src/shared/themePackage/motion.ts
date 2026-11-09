/**
 * Theme motions as named presets (S14g, D-158). A theme package never carries CSS: it names a preset,
 * a duration and an easing, and the keyframes come from this file. The built-in themes use the same
 * presets, so exporting a built-in theme gives an exact package. Every animation plays once; the
 * reduced-motion variant only fades in (no movement, no flashing; THM-5).
 */
import type { MotionName } from './tokens.ts';

/** One CSS animation that plays exactly once (THM-5: no repeated flashing). */
export interface Animation {
  /** Keyframe body, e.g. `0% { transform: … } 100% { … }`. Emitted as `@keyframes cc-<theme>-<motion>[-reduced]`. */
  keyframes: string;
  durationMs: number;
  easing: string;
}

/** The reduced-motion variant shared by all themes: a single short fade-in. */
export const FADE_IN: Animation = { keyframes: '0% { opacity: 0; } 100% { opacity: 1; }', durationMs: 400, easing: 'ease-out' };

/** Timing functions a theme may use (plain CSS keywords). */
export const EASINGS = ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'] as const;
export type Easing = (typeof EASINGS)[number];

/**
 * Keyframes of each preset, per motion. `celebrate` plays on the mascot and illustrations when a class
 * celebrates; `threshold` when the class counter bar fills.
 */
export const MOTION_PRESETS = {
  celebrate: {
    /** A hop with a little wobble, like reaching the top of a hill (Explorer). */
    hop: '0% { transform: translateY(0) rotate(0); } 35% { transform: translateY(-8%) rotate(-4deg); } 70% { transform: translateY(0) rotate(3deg); } 100% { transform: none; }',
    /** A soft squash-and-bounce (Animals). */
    squash: '0% { transform: none; } 30% { transform: scale(1.05, 0.95); } 60% { transform: translateY(-8%); } 100% { transform: none; }',
    /** A small pop with a twist (Classroom). */
    pop: '0% { transform: scale(0.92) rotate(-6deg); } 60% { transform: scale(1.04) rotate(3deg); } 100% { transform: none; }',
    /** A gentle side-to-side sway, like a boat on a calm sea. */
    sway: '0% { transform: rotate(0); } 30% { transform: rotate(-5deg); } 65% { transform: rotate(4deg); } 100% { transform: none; }',
    /** Grows in from slightly smaller. */
    grow: '0% { transform: scale(0.85); opacity: 0; } 100% { transform: none; opacity: 1; }',
  },
  threshold: {
    /** Slides in from the side like a map being unrolled (Explorer). */
    slideIn: '0% { transform: translateX(-6%); opacity: 0; } 100% { transform: none; opacity: 1; }',
    /** Peeks up from below (Animals). */
    rise: '0% { transform: translateY(8%); opacity: 0; } 100% { transform: none; opacity: 1; }',
    /** Settles down from above (Classroom). */
    settle: '0% { transform: translateY(-6%); opacity: 0; } 100% { transform: none; opacity: 1; }',
    /** Grows in from slightly smaller. */
    grow: '0% { transform: scale(0.9); opacity: 0; } 100% { transform: none; opacity: 1; }',
    /** Fades in only (the calmest choice). */
    fade: '0% { opacity: 0; } 100% { opacity: 1; }',
  },
} as const satisfies Record<MotionName, Record<string, string>>;

export type MotionPreset<M extends MotionName> = keyof (typeof MOTION_PRESETS)[M];
export const motionPresetNames = <M extends MotionName>(m: M) => Object.keys(MOTION_PRESETS[m]) as Array<MotionPreset<M>>;

export interface MotionChoice<M extends MotionName = MotionName> {
  preset: MotionPreset<M>;
  durationMs: number;
  easing: Easing;
}

/** The full and reduced animations of a preset choice. */
export function presetMotion<M extends MotionName>(motion: M, choice: MotionChoice<M>): { full: Animation; reduced: Animation } {
  const keyframes = (MOTION_PRESETS[motion] as Record<string, string>)[choice.preset as string];
  if (keyframes === undefined) throw new Error(`Unknown ${motion} preset ${String(choice.preset)}`);
  return { full: { keyframes, durationMs: choice.durationMs, easing: choice.easing }, reduced: FADE_IN };
}

/** Which preset these keyframes are (export of a theme), or null. */
export function presetOf(motion: MotionName, keyframes: string): string | null {
  const hit = Object.entries(MOTION_PRESETS[motion]).find(([, kf]) => kf === keyframes);
  return hit ? hit[0] : null;
}

/** How often the opacity changes direction in keyframes (no flashing: at most once, MOTION_LIMITS). */
export function opacityTurns(keyframes: string): number {
  const opacities = [...keyframes.matchAll(/opacity:\s*([\d.]+)/g)].map((x) => Number(x[1]));
  let turns = 0;
  for (let i = 2; i < opacities.length; i++) if (Math.sign(opacities[i]! - opacities[i - 1]!) * Math.sign(opacities[i - 1]! - opacities[i - 2]!) < 0) turns++;
  return turns;
}
