/**
 * Sound pack generator (S13b, D-110; shared since S14g, D-158): builds every classroom cue from a few
 * musical parameters, so a theme gets a complete, consistent pack with one call and can override
 * single cues. All sounds are synthesized (WebAudio oscillators and filtered noise): no audio files,
 * nothing copyrighted (docs/ASSETS.md). Cues are short; only the celebration cues pass one second.
 * `soundPackProblems` checks a pack against `SOUND_LIMITS` (built-in theme tests and the package
 * validator use the same function).
 */
import { outputPeakDb, SOUND_LIMITS } from './limits.ts';
import { SOUND_EVENTS, type SoundEvent, type SoundSpec, type ThemeSoundPack, type ToneNote } from './tokens.ts';

export const SOUND_WAVES = ['sine', 'triangle', 'square'] as const;
export const SOUND_SCALES = ['major', 'pentatonic'] as const;

export interface SoundPackOptions {
  /** Root note in Hz (e.g. 523 = C5). */
  root: number;
  /** Main voice. */
  wave: (typeof SOUND_WAVES)[number];
  /** Peak gain of the main voice (0.05..0.2); everything else is scaled from it. */
  gain?: number;
  /** 'major' (bright) or 'pentatonic' (playful, no clashes). */
  scale?: (typeof SOUND_SCALES)[number];
  /** Speed factor: >1 is snappier, <1 calmer. */
  tempo?: number;
}

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11, 12], pentatonic: [0, 2, 4, 7, 9, 12, 14, 16] } as const;

/** The frequency `step` scale degrees above the root (wraps into higher octaves). */
export function degree(root: number, step: number, scale: 'major' | 'pentatonic' = 'major'): number {
  const s = SCALES[scale];
  const octave = Math.floor(step / (s.length - 1));
  const idx = ((step % (s.length - 1)) + (s.length - 1)) % (s.length - 1);
  return Math.round(root * 2 ** (octave + s[idx]! / 12));
}

export function makeSoundPack(opts: SoundPackOptions, overrides: Partial<ThemeSoundPack> = {}): ThemeSoundPack {
  const g = Math.min(0.2, Math.max(0.05, opts.gain ?? 0.1));
  const k = 1 / Math.max(0.5, Math.min(2, opts.tempo ?? 1));
  const sc = opts.scale ?? 'major';
  const w = opts.wave;
  const n = (step: number, at: number, dur: number, gain = g, type: ToneNote['type'] = w): ToneNote => ({ freq: degree(opts.root, step, sc), at: Math.round(at * k), dur: Math.round(dur * k), type, gain });
  const noise = (freq: number, at: number, dur: number, gain: number): ToneNote => ({ freq, at: Math.round(at * k), dur: Math.round(dur * k), type: 'noise', gain });

  const arpeggio = (steps: number[], gap: number, dur: number, gain = g) => steps.map((s, i) => n(s, i * gap, dur, gain));
  const claps: ToneNote[] = [];
  // An irregular round of applause: many short noise bursts at slightly different pitches.
  for (let i = 0; i < 18; i++) claps.push(noise(1400 + ((i * 337) % 900), i * 85 + ((i * 53) % 40), 45, g * 1.4));
  const roll: ToneNote[] = [];
  for (let i = 0; i < 24; i++) roll.push(noise(260 + (i % 3) * 40, i * 55, 60, g * (0.6 + (i / 24) * 0.9)));
  const pops: ToneNote[] = [];
  for (let i = 0; i < 5; i++) {
    pops.push({ freq: degree(opts.root, 2 + i, sc), to: degree(opts.root, 9 + i, sc), at: Math.round(i * 380 * k), dur: Math.round(260 * k), type: 'sine', gain: g * 0.5 });
    pops.push(noise(3000, i * 380 + 260, 180, g * 0.9));
  }

  const pack: ThemeSoundPack = {
    tap: [n(4, 0, 70, g * 0.6)],
    pointAwarded: [n(4, 0, 90, g * 0.7), n(7, 70, 140, g * 0.7)],
    undo: [{ ...n(4, 0, 160, g * 0.6), to: degree(opts.root, 0, sc) }],
    stageChange: arpeggio([0, 2, 4], 110, 220, g * 0.8),
    timeUp: [n(0, 0, 420), n(4, 360, 420), n(7, 720, 700)],
    thresholdReached: [n(7, 0, 260), n(4, 220, 260), n(7, 440, 480)],
    assistantCheck: [n(2, 0, 90, g * 0.7), n(5, 80, 180, g * 0.7)],
    groupShuffle: [...arpeggio([0, 3, 1, 4, 2, 5], 60, 80, g * 0.6), n(7, 380, 220, g * 0.8)],
    secretDrumroll: roll,
    secretReveal: [n(5, 0, 120, g * 0.8), n(9, 100, 300, g * 0.9)],
    fanfare: [n(0, 0, 160), n(4, 150, 160), n(7, 300, 160), n(9, 450, 600), n(4, 450, 600, g * 0.6), n(7, 450, 600, g * 0.5)],
    clapping: claps,
    fireworks: pops,
    // Reduced-motion stand-in for the loud sequences (celebration, reveal show): one quiet two-note chime.
    softChime: [n(4, 0, 260, g * 0.5, 'sine'), n(7, 180, 420, g * 0.45, 'sine')],
    // S14a (D-145): the lesson begins (rising, welcoming) and ends (falling, settling).
    lessonStart: arpeggio([0, 2, 4, 7], 120, 260, g * 0.85),
    lessonEnd: [n(7, 0, 220, g * 0.8), n(4, 180, 220, g * 0.8), n(2, 360, 220, g * 0.75), n(0, 540, 480, g * 0.75)],
    // "Ready, go": two quick notes when the timer starts.
    timerStart: [n(4, 0, 90, g * 0.7), n(7, 110, 170, g * 0.75)],
    // A student moved to another group: one short slide upwards (S14c wires it).
    groupMove: [{ ...n(2, 0, 120, g * 0.6), to: degree(opts.root, 5, sc) }],
    // An achievement given in class without the full celebration: a bright sparkle.
    achievementGiven: [n(4, 0, 120, g * 0.8), n(7, 100, 120, g * 0.8), n(9, 200, 380, g * 0.85)],
    // "Test sound" in the Display popover and class settings: three clear notes at tap loudness.
    soundTest: arpeggio([0, 4, 7], 160, 240, g),
  };
  return { ...pack, ...overrides };
}

/** Total length of a cue in ms. */
export const soundLength = (s: SoundSpec) => Math.max(0, ...s.map((x) => x.at + x.dur));

/** Sum of the gains of the notes sounding together at the loudest moment of a cue. */
export function loudestMoment(spec: SoundSpec): number {
  const cap = (n: ToneNote) => Math.min(SOUND_LIMITS.noteGainCap, n.gain);
  return Math.max(0, ...spec.map((a) => spec.filter((b) => b.at <= a.at && b.at + b.dur > a.at).reduce((sum, n) => sum + cap(n), 0)));
}

export type SoundProblemKind = 'missing' | 'tooLong' | 'gain' | 'frequency' | 'tapTooQuiet' | 'tapTooLoud' | 'clips' | 'tooManyNotes';
export interface SoundProblem {
  event: SoundEvent;
  kind: SoundProblemKind;
  /** The measured value (ms, gain, Hz or dBFS) and the limit it broke. */
  value: number;
  limit: number;
}

/**
 * Every way a pack breaks SOUND_LIMITS (empty = fine): one cue per event, cue length, note gain,
 * tone and noise frequency, a tap at volume 80 between −12 and −6 dBFS, nothing at 0 dBFS at 100.
 */
export function soundPackProblems(pack: Partial<ThemeSoundPack>): SoundProblem[] {
  const out: SoundProblem[] = [];
  const L = SOUND_LIMITS;
  for (const event of SOUND_EVENTS) {
    const spec = pack[event];
    if (!spec || spec.length === 0) {
      out.push({ event, kind: 'missing', value: 0, limit: 1 });
      continue;
    }
    if (spec.length > L.maxNotesPerCue) out.push({ event, kind: 'tooManyNotes', value: spec.length, limit: L.maxNotesPerCue });
    const maxMs = L.longEvents.includes(event) ? L.longCueMaxMs : L.shortCueMaxMs;
    const len = soundLength(spec);
    if (len > maxMs) out.push({ event, kind: 'tooLong', value: len, limit: maxMs });
    for (const n of spec) {
      if (!(n.gain > 0 && n.gain <= L.noteGainCap)) out.push({ event, kind: 'gain', value: n.gain, limit: L.noteGainCap });
      const maxHz = n.type === 'noise' ? L.noiseMaxHz : L.toneMaxHz;
      const checks: Array<[number, number]> = [[n.freq, maxHz], ...(n.to === undefined ? [] : [[n.to, Math.max(maxHz, L.glideMaxHz)] as [number, number]])];
      for (const [f, max] of checks) {
        if (f < L.toneMinHz) out.push({ event, kind: 'frequency', value: f, limit: L.toneMinHz });
        else if (f > max) out.push({ event, kind: 'frequency', value: f, limit: max });
      }
    }
    const db = outputPeakDb(loudestMoment(spec), 100);
    if (db >= L.clipDbAt100) out.push({ event, kind: 'clips', value: Math.round(db * 10) / 10, limit: L.clipDbAt100 });
  }
  const tap = pack.tap;
  if (tap && tap.length > 0) {
    const peak = Math.max(...tap.map((n) => Math.min(L.noteGainCap, n.gain)));
    const db = Math.round(outputPeakDb(peak, 80) * 10) / 10;
    const [lo, hi] = L.tapPeakDbAt80;
    if (db < lo) out.push({ event: 'tap', kind: 'tapTooQuiet', value: db, limit: lo });
    else if (db > hi) out.push({ event: 'tap', kind: 'tapTooLoud', value: db, limit: hi });
  }
  return out;
}
