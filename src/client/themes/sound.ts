/**
 * Theme sounds (THM-5): tiny tones synthesized with WebAudio, so no audio files (and no copyrighted
 * audio) are shipped. A sound plays only when the caller has checked `soundsAllowed(display)` (class
 * switch AND device switch); it is short and gentle, and nothing repeats.
 */
import type { SoundSpec } from './types.ts';

/** Total length of a sound in ms. */
export const soundLength = (s: SoundSpec) => Math.max(0, ...s.map((n) => n.at + n.dur));

export function playTones(spec: SoundSpec): void {
  if (typeof window === 'undefined' || spec.length === 0) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const t0 = ctx.currentTime + 0.02;
    for (const n of spec) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t0 + n.at / 1000;
      const end = start + n.dur / 1000;
      osc.type = n.type;
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.min(0.3, n.gain), start + Math.min(0.05, n.dur / 4000));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.05);
    }
    setTimeout(() => void ctx.close(), soundLength(spec) + 300);
  } catch {
    /* audio unavailable: the visual signal is enough */
  }
}
