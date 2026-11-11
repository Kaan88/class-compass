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
 * The loudness chain (D-145). The compressor has a hard knee so its curve is exact; browsers add
 * their own makeup gain to a DynamicsCompressorNode (Web Audio spec: (1 / curve(0 dBFS))^0.6), which
 * `outputPeakDb` includes. Below the threshold the whole chain is about ×8.8 (+18.9 dB); a full-scale
 * input comes out near −1 dBFS, so nothing clips.
 */
export const LOUDNESS = {
  thresholdDb: -24,
  kneeDb: 0,
  ratio: 6,
  attack: 0.003,
  release: 0.25,
  makeup: 2.2,
} as const;

/** Class volume 0..100 → master gain. Squared, so the slider feels even to the ear (perceptual). */
export function volumeGain(volume: number): number {
  const v = Math.max(0, Math.min(100, volume)) / 100;
  return v * v;
}

const toDb = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

/** Static compressor curve (hard knee) in dB. */
export function compressorCurveDb(inputDb: number): number {
  return inputDb <= LOUDNESS.thresholdDb ? inputDb : LOUDNESS.thresholdDb + (inputDb - LOUDNESS.thresholdDb) / LOUDNESS.ratio;
}

/** Makeup gain the browser applies inside the DynamicsCompressorNode (Web Audio spec). */
export const compressorMakeupDb = () => -compressorCurveDb(0) * 0.6;

/**
 * Peak level in dBFS at the speakers of a cue whose notes add up to `peak` (one note: its gain, capped
 * at the note gain cap when played) at class volume `volume` (0..100), once the compressor has settled.
 */
export function outputPeakDb(peak: number, volume: number): number {
  const input = toDb(peak * volumeGain(volume));
  return compressorCurveDb(input) + compressorMakeupDb() + toDb(LOUDNESS.makeup);
}
