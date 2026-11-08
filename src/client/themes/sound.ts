/**
 * Theme sounds (THM-5): tiny cues synthesized with WebAudio, so no audio files (and no copyrighted
 * audio) are shipped. Since S13b everything goes through the SoundManager (volume, mute, unlock,
 * priorities); this file keeps the small helpers older code imports.
 */
import { sounds } from './soundManager.ts';
import type { SoundSpec } from './types.ts';

export { soundLength } from './soundPack.ts';

/** Plays a cue at normal priority (the caller has checked `soundsAllowed`). */
export function playTones(spec: SoundSpec, priority = 2): boolean {
  return sounds.play(spec, priority);
}
