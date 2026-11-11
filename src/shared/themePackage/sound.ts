/**
 * Sound pack generator (S13b, D-110; shared since S14g, D-158): builds every classroom cue from a few
 * musical parameters, so a theme gets a complete, consistent pack with one call and can override
 * single cues. All sounds are synthesized (WebAudio oscillators and filtered noise): no audio files,
 * nothing copyrighted (docs/ASSETS.md). Cues are short; only the celebration cues pass one second.
 * `soundPackProblems` checks a pack against `SOUND_LIMITS` (built-in theme tests and the package
 * validator use the same function).
 */
import { outputPeakDb, SOUND_LIMITS } from './limits.ts';
import { SOUND_EVENTS, SOUND_STYLES, type SoundEvent, type SoundSpec, type SoundStyle, type ThemeSoundPack, type ToneNote } from './tokens.ts';

export const SOUND_WAVES = ['sine', 'triangle', 'square'] as const;
export const SOUND_SCALES = ['major', 'pentatonic'] as const;

// ---------------------------------------------------------------- instrument styles (S17b, D-168)
/**
 * One partial of a styled voice: a sine at `ratio` × the note's frequency, `gain` its share of the
 * note's peak, `decay` how much of the note it lasts (0..1; it fades out exponentially by then).
 */
export interface VoicePartial {
  ratio: number;
  gain: number;
  decay: number;
}
export interface VoiceSpec {
  /** Time to the peak (ms, at most a quarter of the note). */
  attackMs: number;
  /**
   * The shares add up to 1. Inharmonic partials with their own envelopes never line up, so their sum
   * peaks lower than that; `notePartials` scales them so the sum really peaks at the note's gain.
   */
  partials: readonly VoicePartial[];
}

/**
 * The app-defined instrument styles. Only data: the SoundManager plays each partial as a sine with its
 * own envelope inside the note's length, so every cue length, note gain and loudness limit is unchanged.
 * - bells: bright, slightly inharmonic overtones (2.76, 4.07, 5.4) that ring out;
 * - marimba: a warm wooden fundamental with the 4th harmonic of a tuned bar, quick to fade;
 * - chimes: airy, a soft attack and a slow shimmer (a fundamental and a slightly detuned twin);
 * - musicBox: a plucked comb tine, very fast attack, short bright overtones.
 */
export const SOUND_VOICES: Record<Exclude<SoundStyle, 'tones'>, VoiceSpec> = {
  bells: {
    attackMs: 2,
    partials: [
      { ratio: 1, gain: 0.45, decay: 1 },
      { ratio: 2, gain: 0.2, decay: 0.85 },
      { ratio: 2.76, gain: 0.17, decay: 0.6 },
      { ratio: 4.07, gain: 0.1, decay: 0.45 },
      { ratio: 5.4, gain: 0.08, decay: 0.3 },
    ],
  },
  marimba: {
    attackMs: 3,
    partials: [
      { ratio: 1, gain: 0.72, decay: 0.85 },
      { ratio: 4, gain: 0.2, decay: 0.25 },
      { ratio: 10, gain: 0.08, decay: 0.06 },
    ],
  },
  chimes: {
    attackMs: 6,
    partials: [
      { ratio: 1, gain: 0.4, decay: 1 },
      { ratio: 1.0045, gain: 0.12, decay: 1 },
      { ratio: 2.76, gain: 0.22, decay: 0.7 },
      { ratio: 5.4, gain: 0.16, decay: 0.45 },
      { ratio: 8.93, gain: 0.1, decay: 0.3 },
    ],
  },
  musicBox: {
    attackMs: 1,
    partials: [
      { ratio: 1, gain: 0.6, decay: 0.7 },
      { ratio: 2, gain: 0.12, decay: 0.45 },
      { ratio: 3, gain: 0.1, decay: 0.3 },
      { ratio: 6, gain: 0.1, decay: 0.12 },
      { ratio: 7.2, gain: 0.08, decay: 0.04 },
    ],
  },
};

export const isSoundStyle = (v: unknown): v is SoundStyle => typeof v === 'string' && (SOUND_STYLES as readonly string[]).includes(v);

export interface NotePartial {
  freq: number;
  to?: number;
  gain: number;
  decay: number;
  attackMs: number;
}

/** Sample rate of the peak simulation (the classroom PCs and iPads run at 44.1 or 48 kHz). */
const PEAK_RATE = 48_000;
/** The floor every envelope starts from and falls back to (an exponential ramp cannot reach 0). */
const ENV_FLOOR = 0.0001;

/**
 * The real peak of the summed partials of a note `dur` ms long, played exactly as the SoundManager
 * schedules them: each a sine starting at phase 0, its gain ramping exponentially from 0.0001 to its
 * peak over `min(attack, dur / 4)` and back to 0.0001 by `min(dur, max(10 ms, dur × decay))`, its
 * frequency gliding exponentially to `to` over the whole note. Sampled at 48 kHz; it stops once the
 * envelopes together can no longer beat the peak found so far (they only fall after the attacks).
 */
export function partialsPeak(parts: readonly NotePartial[], dur: number): number {
  const T = dur / 1000;
  const env = parts.map((p) => {
    const ta = Math.min(p.attackMs / 1000, T / 4);
    const te = Math.min(T, Math.max(0.01, (dur * p.decay) / 1000));
    return { ...p, ta, te };
  });
  const lastAttack = Math.max(0, ...env.map((e) => e.ta));
  const level = (e: (typeof env)[number], t: number) => {
    if (t <= e.ta) return e.ta <= 0 ? e.gain : ENV_FLOOR * (e.gain / ENV_FLOOR) ** (t / e.ta);
    if (t >= e.te) return ENV_FLOOR;
    return e.gain * (ENV_FLOOR / e.gain) ** ((t - e.ta) / (e.te - e.ta));
  };
  const phase = env.map(() => 0);
  let peak = 0;
  const steps = Math.ceil(T * PEAK_RATE);
  for (let i = 0; i <= steps; i++) {
    const t = i / PEAK_RATE;
    let sum = 0;
    let bound = 0;
    for (let k = 0; k < env.length; k++) {
      const e = env[k]!;
      const g = Math.max(0, level(e, t));
      bound += g;
      sum += g * Math.sin(phase[k]!);
      const f = e.to === undefined ? e.freq : e.freq * (e.to / e.freq) ** (t / T);
      phase[k] = phase[k]! + (2 * Math.PI * f) / PEAK_RATE;
    }
    peak = Math.max(peak, Math.abs(sum));
    if (t > lastAttack && bound <= peak) break;
  }
  return peak;
}

/** Scale factors per (style, frequency, glide, length), so a cue is simulated once. */
const styleScale = new Map<string, number>();

/**
 * The partials a note sounds with (one plain partial for `tones` and noise): frequencies and glide
 * targets in Hz, partials above `partialMaxHz` left out, gains scaled so the summed partials really
 * peak at the note's gain (S17b review: the inharmonic partials never line up, so plain shares of the
 * gain came out 1 to 3 dB under the loudness model). So `outputPeakDb`, the tap's lower and upper
 * limits and the clip check stay true for every style.
 */
export function notePartials(n: ToneNote): NotePartial[] {
  const plain = { freq: n.freq, ...(n.to === undefined ? {} : { to: n.to }), gain: n.gain, decay: 1, attackMs: 30 };
  if (n.type === 'noise' || !n.voice || n.voice === 'tones') return [plain];
  const v = SOUND_VOICES[n.voice];
  if (!v) return [plain];
  const top = Math.max(n.freq, n.to ?? 0);
  const shares = v.partials
    .filter((p) => p.ratio * top <= SOUND_LIMITS.partialMaxHz || p.ratio === 1)
    .map((p) => ({ freq: n.freq * p.ratio, ...(n.to === undefined ? {} : { to: n.to * p.ratio }), gain: n.gain * p.gain, decay: p.decay, attackMs: v.attackMs }));
  if (!(n.gain > 0) || !(n.dur > 0)) return shares;
  const key = `${n.voice}|${n.freq}|${n.to ?? ''}|${n.dur}|${n.gain}`;
  let scale = styleScale.get(key);
  if (scale === undefined) {
    // Twice: the envelopes ramp from a fixed floor, so a louder partial's curve differs a little.
    scale = 1;
    for (let i = 0; i < 2; i++) {
      const peak = partialsPeak(shares.map((p) => ({ ...p, gain: p.gain * scale! })), n.dur);
      if (peak > 0) scale = scale * (n.gain / peak);
    }
    // At most ×4 (+12 dB): a guard; the styles need about ×1.1 to ×1.5.
    scale = Math.min(4, scale);
    if (styleScale.size > 2000) styleScale.clear();
    styleScale.set(key, scale);
  }
  return shares.map((p) => ({ ...p, gain: p.gain * scale }));
}

export interface SoundPackOptions {
  /** Root note in Hz (e.g. 523 = C5). */
  root: number;
  /** Main voice of the plain `tones` style. */
  wave: (typeof SOUND_WAVES)[number];
  /** Instrument style of every tone note (S17b): `tones` (default), bells, marimba, chimes, musicBox. */
  style?: SoundStyle;
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
  const all: ThemeSoundPack = { ...pack, ...overrides };
  // S17b (D-168): every tone note (the theme's own overrides too) is played in the theme's style.
  const style = opts.style ?? 'tones';
  if (style === 'tones') return all;
  const voiced = (spec: SoundSpec): SoundSpec => spec.map((x) => (x.type === 'noise' ? x : { ...x, voice: style }));
  return Object.fromEntries(SOUND_EVENTS.map((e) => [e, voiced(all[e])])) as Record<SoundEvent, SoundSpec>;
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
