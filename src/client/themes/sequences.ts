/**
 * Which sound cues the choreographed sequences play in each motion mode (S13b, D-110, review fix).
 * Pure, so the celebration layer and the Secret Student reveal share one rule and tests can check it:
 * - full motion: the whole show (reveal: a tap per countdown number, drum roll, a cue per card,
 *   fanfare; celebration: fanfare, then clapping and fireworks);
 * - reduced motion (OS setting) and animations switched off for the class: no loud cues, only one
 *   soft chime at the end. Whether any cue sounds at all is still decided by the sound switches and
 *   the class volume (SoundManager).
 */
import type { MotionMode } from './index.tsx';
import type { SoundEvent } from './types.ts';

export type RevealStep = 'countdown' | 'drumroll' | 'card' | 'end';

const FULL_REVEAL: Record<RevealStep, SoundEvent> = { countdown: 'tap', drumroll: 'secretDrumroll', card: 'secretReveal', end: 'fanfare' };

/** The cue for one step of the Secret Student reveal, or null for silence. */
export function revealCue(mode: MotionMode, step: RevealStep): SoundEvent | null {
  if (mode === 'full') return FULL_REVEAL[step];
  return step === 'end' ? 'softChime' : null;
}

/** The celebration's cues with their start offsets in ms. */
export function celebrationCues(mode: MotionMode): Array<{ event: SoundEvent; at: number }> {
  if (mode === 'full') {
    return [
      { event: 'fanfare', at: 0 },
      { event: 'clapping', at: 600 },
      { event: 'fireworks', at: 900 },
    ];
  }
  return [{ event: 'softChime', at: 0 }];
}
