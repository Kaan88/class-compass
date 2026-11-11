/**
 * Theme limits (S14g, D-158): one source for the built-in theme tests, the theme package validator
 * (server, admin preview, MCP) and docs/THEMING.md, which quotes these numbers. Moved out of
 * `tests/client/themes.test.tsx` and `client/themes/soundManager.ts` (which re-exports the loudness
 * model). Loosening a limit is a decision (DECISIONS.md), not a quick fix.
 */
import type { SoundEvent } from './tokens.ts';

/** Sound cues (S13b D-110, S14a D-145). */
export const SOUND_LIMITS = {
  /** Loudest single note a pack may ask for (the SoundManager caps it too). */
  noteGainCap: 0.3,
  /** A normal cue is at most this long (ms). */
  shortCueMaxMs: 1200,
  /** Celebration, reveal and time's-up cues may be longer (ms). */
  longCueMaxMs: 2500,
  longEvents: ['secretDrumroll', 'clapping', 'fireworks', 'fanfare', 'timeUp'] as readonly SoundEvent[],
  /** Tone frequencies (Hz). */
  toneMinHz: 150,
  toneMaxHz: 2500,
  /** Centre of a noise band (Hz). */
  noiseMaxHz: 5000,
  /** Where a glide (`to`) may end (Hz): a short sweep may pass the tone limit (firework whistles). */
  glideMaxHz: 3000,
  /** Most notes in one cue (a package override). */
  maxNotesPerCue: 64,
  /**
   * Instrument styles (S17b, D-168): the highest partial a styled note may sound (Hz). Partials above
   * it are left out, so a high note simply has fewer overtones.
   */
  partialMaxHz: 8000,
  /** A tap at class volume 80 must peak between these levels (dBFS) at the speakers. */
  tapPeakDbAt80: [-12, -6] as const,
  /** No cue may reach this level (dBFS) at class volume 100 (notes that overlap add up). */
  clipDbAt100: 0,
} as const;

/** Sound pack parameters of `makeSoundPack` (and of a theme package). */
export const SOUND_PARAM_LIMITS = {
  rootHz: [150, 1000] as const,
  gain: [0.05, 0.2] as const,
  tempo: [0.5, 2] as const,
} as const;

/** One-shot theme motions (THM-5). */
export const MOTION_LIMITS = {
  minMs: 150,
  maxMs: 1500,
  /** Opacity may change direction at most this often in a full animation (WCAG 2.3.1, no flashing). */
  maxOpacityTurns: 1,
} as const;

/** Art and its subtlety. */
export const ART_LIMITS = {
  decoOpacityMax: 0.6,
  patternOpacityMax: 0.15,
  patternSize: [8, 400] as const,
  /** One SVG picture (a pose, an illustration, the decoration or the pattern tile). */
  svgMaxNodes: 400,
  svgMaxBytes: 20 * 1024,
  svgMaxDepth: 12,
} as const;

/**
 * Scenes (S17a, D-166): viewport-scale art behind the app, checked by the same sanitiser with larger
 * per-layer limits (a village with trees and cottages needs more than a 100×100 mascot).
 */
export const SCENE_LIMITS = {
  layers: [1, 3] as const,
  svgMaxBytes: 60 * 1024,
  svgMaxNodes: 1500,
  svgMaxDepth: 12,
  opacity: [0.3, 1] as const,
  maxHeightVh: [20, 100] as const,
} as const;

/** Frames (S17a): colours are token names; trims take 2–3, corners 1–3. */
export const FRAME_LIMITS = {
  trimColors: [2, 3] as const,
  cornerColors: [1, 3] as const,
} as const;

/** Ambient animation (S17a): particle count, frame rate cap. */
export const AMBIENT_LIMITS = {
  density: [10, 150] as const,
  maxFps: 30,
} as const;

/** Sets (S17a): how many avatar families a theme may put first. */
export const SETS_LIMITS = {
  avatarFamiliesFirst: [0, 4] as const,
} as const;

/** Typography, shape, avatar and icon numbers. */
export const STYLE_LIMITS = {
  weight: [400, 900] as const,
  /** Letter-spacing in em. */
  trackingEm: [-0.05, 0.1] as const,
  radiusRem: [0, 2] as const,
  radiusSmRem: [0, 1.5] as const,
  borderPx: [1, 4] as const,
  borderStrongPx: [1, 6] as const,
  iconStroke: [1.5, 3] as const,
  avatarSaturation: [0, 100] as const,
  avatarLightness: [10, 90] as const,
} as const;

/** The package as a whole. */
export const PACKAGE_LIMITS = {
  maxBytes: 512 * 1024,
  nameMax: 40,
  descriptionMax: 160,
  /** Imported themes kept by one school (drafts, enabled and disabled). */
  maxCustomThemes: 30,
  celebrationColors: [2, 8] as const,
} as const;

/**
 * The loudness chain (D-145, S21a D-173): master (class volume) → DynamicsCompressor → makeup gain →
 * soft ceiling → speakers. The compressor has a hard knee so its curve is exact; browsers add their own
 * makeup gain to a DynamicsCompressorNode (Web Audio spec: (1 / curve(0 dBFS))^0.6), which the model
 * includes. Below the threshold the whole chain is about ×8.8 (+18.9 dB).
 *
 * S21a (D-173), from the real chain rendered in Chromium (`e2e/sound-loudness.spec.ts`):
 * - a new compressor reaches its makeup gain only after it has run for a while (its level detector
 *   starts at zero): a cue started at once played up to 12 dB quieter (the "7 dB under" of the S17b
 *   review). The SoundManager starts nothing until `settleMs` after it built the chain;
 * - above the threshold the compressor needs its attack time to pull a sudden start down, so the first
 *   milliseconds pass over the settled curve: 1.7 dB with the old 3 ms attack, at most 0.7 dB with
 *   1 ms for packs within the limits, and up to 3 dB for chords of notes at the gain cap;
 * - the soft ceiling (a WaveShaper after the makeup gain) is linear up to `ceilingKneeDb` and never
 *   goes above `ceilingDb`, so no transient, chord or clip can reach 0 dBFS. Taps (about −9 dBFS at
 *   volume 80) never reach it.
 */
export const LOUDNESS = {
  thresholdDb: -24,
  kneeDb: 0,
  ratio: 6,
  /** Seconds. 1 ms since S21a (3 ms before): less overshoot over the settled curve. */
  attack: 0.001,
  release: 0.25,
  makeup: 2.2,
  /** The soft ceiling is linear up to this level (dBFS) … */
  ceilingKneeDb: -3,
  /** … and never reaches this level (dBFS). */
  ceilingDb: -1,
  /** The ceiling curve covers inputs up to this amplitude (+6 dBFS); anything louder sits at the ceiling. */
  ceilingRange: 2,
  /** A newly built chain plays its first sound this long after it was built (ms): the compressor settles. */
  settleMs: 300,
} as const;

/** Class volume 0..100 → master gain. Squared, so the slider feels even to the ear (perceptual). */
export function volumeGain(volume: number): number {
  const v = Math.max(0, Math.min(100, volume)) / 100;
  return v * v;
}

const toDb = (x: number) => 20 * Math.log10(Math.max(1e-9, x));
const fromDb = (db: number) => 10 ** (db / 20);

/** Static compressor curve (hard knee) in dB. */
export function compressorCurveDb(inputDb: number): number {
  return inputDb <= LOUDNESS.thresholdDb ? inputDb : LOUDNESS.thresholdDb + (inputDb - LOUDNESS.thresholdDb) / LOUDNESS.ratio;
}

/** Makeup gain the browser applies inside the DynamicsCompressorNode (Web Audio spec). */
export const compressorMakeupDb = () => -compressorCurveDb(0) * 0.6;

/**
 * The soft ceiling's transfer (S21a, D-173) for one sample value: unchanged up to the knee, then a
 * tanh bend with slope 1 at the knee that approaches the ceiling and never reaches it.
 */
export function softCeiling(x: number): number {
  const knee = fromDb(LOUDNESS.ceilingKneeDb);
  const room = fromDb(LOUDNESS.ceilingDb) - knee;
  const a = Math.abs(x);
  if (a <= knee) return x;
  return Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
}

/**
 * The WaveShaper curve of the soft ceiling: `points` samples of `softCeiling` over the inputs
 * −ceilingRange..+ceilingRange (the SoundManager scales the signal by 1 / ceilingRange in front of the
 * shaper, which reads −1..1). An odd number of points puts 0 exactly on a point, and the linear part
 * stays exact under the shaper's linear interpolation.
 */
export function softCeilingCurve(points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = softCeiling(LOUDNESS.ceilingRange * ((2 * i) / (points - 1) - 1));
  return curve;
}

/**
 * Peak level in dBFS after the compressor and its makeup gains (before the ceiling) of a cue whose
 * notes add up to `peak` at class volume `volume`, once the compressor has settled. The clip check of
 * `soundPackProblems` uses this level: a cue must stay under 0 dBFS here, so the ceiling only ever
 * catches transients, never a cue that is too loud as written.
 */
export function compressedPeakDb(peak: number, volume: number): number {
  const input = toDb(peak * volumeGain(volume));
  return compressorCurveDb(input) + compressorMakeupDb() + toDb(LOUDNESS.makeup);
}

/**
 * Peak level in dBFS at the speakers of a cue whose notes add up to `peak` (one note: its gain, capped
 * at the note gain cap when played) at class volume `volume` (0..100), once the compressor has settled:
 * `compressedPeakDb` through the soft ceiling. Rendered in Chromium (S21a): a single note within
 * 0.3 dB of it; chords and noise at or under it, except the first milliseconds over the threshold
 * (see LOUDNESS), which the ceiling bounds.
 */
export function outputPeakDb(peak: number, volume: number): number {
  return toDb(softCeiling(fromDb(compressedPeakDb(peak, volume))));
}
