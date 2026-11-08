/**
 * SoundManager (S13b, D-110): the one place that makes sound on the classroom display.
 * - one AudioContext for the page, created and resumed on the first tap or key press ("unlock"):
 *   browsers refuse audio before a user gesture, so nothing is lost by waiting for it;
 * - class volume (0..100) on a master gain, and mute (class switch AND device switch, THM-5);
 * - priorities: celebration and time's-up cues (4) > reveals and thresholds (3) > stage changes,
 *   shuffles, checks (2) > taps (1). A new cue ducks quieter-priority cues still playing, and a cue
 *   that starts under a louder one plays ducked; taps closer than 50 ms are merged;
 * - preloading: the noise buffer is made on unlock, and a teacher clip is fetched and decoded ahead
 *   (`preloadClip`) so time's up is not delayed by the network.
 * Components never call WebAudio themselves: they name an event (`playThemeSound`) or use `sounds`.
 */
import type { SoundEvent, SoundSpec } from './types.ts';
import { soundLength } from './soundPack.ts';

export const SOUND_PRIORITY: Record<SoundEvent, number> = {
  tap: 1,
  pointAwarded: 1,
  undo: 1,
  softChime: 2,
  assistantCheck: 2,
  groupShuffle: 2,
  stageChange: 2,
  secretReveal: 3,
  secretDrumroll: 3,
  thresholdReached: 3,
  timeUp: 4,
  fanfare: 4,
  clapping: 4,
  fireworks: 4,
};
/** Level of a ducked cue (relative to its own gain). */
export const DUCK_LEVEL = 0.3;
const TAP_MERGE_MS = 50;

export interface Voice {
  priority: number;
  until: number;
  setLevel: (level: number) => void;
}

/** Pure mixing rule (tested): the level of a new cue and which playing voices it ducks. */
export function mixFor(active: readonly Voice[], priority: number, now: number): { level: number; duck: Voice[] } {
  const live = active.filter((v) => v.until > now);
  return { level: live.some((v) => v.priority > priority) ? DUCK_LEVEL : 1, duck: live.filter((v) => v.priority < priority) };
}

/** The part of the WebAudio API the manager uses (a fake in tests). */
export type AudioContextLike = Pick<AudioContext, 'currentTime' | 'state' | 'resume' | 'createOscillator' | 'createGain' | 'createBiquadFilter' | 'createBuffer' | 'createBufferSource' | 'decodeAudioData' | 'destination' | 'sampleRate'>;

function defaultContext(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export class SoundManager {
  private ctx: AudioContextLike | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private lastTap = -Infinity;
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  private volume = 0.8;
  private muted = false;
  unlocked = false;

  private readonly createContext: () => AudioContextLike | null;
  private readonly clock: () => number;
  private readonly fetchClip: (url: string) => Promise<ArrayBuffer>;

  constructor(
    createContext: () => AudioContextLike | null = defaultContext,
    clock: () => number = () => Date.now(),
    fetchClip: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
  ) {
    this.createContext = createContext;
    this.clock = clock;
    this.fetchClip = fetchClip;
  }

  /** Class volume 0..100. */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(100, v)) / 100;
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  }
  getVolume() {
    return Math.round(this.volume * 100);
  }
  setMuted(m: boolean) {
    this.muted = m;
  }
  isMuted() {
    return this.muted || this.volume === 0;
  }

  private context(): AudioContextLike | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = this.createContext();
    } catch {
      this.ctx = null;
    }
    if (!this.ctx) return null;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Called on the first user gesture: creates/resumes the context and prepares the noise buffer. */
  unlock() {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    this.unlocked = true;
    this.noiseBuffer();
  }

  private noiseBuffer(): AudioBuffer | null {
    if (this.noise || !this.ctx) return this.noise;
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic pseudo-random noise (no Math.random: the same sound every time).
    let x = 12345;
    for (let i = 0; i < len; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (x / 0x3fffffff - 1) * 0.8;
    }
    this.noise = buf;
    return buf;
  }

  /** Plays a cue at a priority. Returns false when muted, merged or audio is unavailable. */
  play(spec: SoundSpec, priority = 2): boolean {
    if (this.isMuted() || spec.length === 0) return false;
    const now = this.clock();
    if (priority <= 1) {
      if (now - this.lastTap < TAP_MERGE_MS) return false;
      this.lastTap = now;
    }
    const ctx = this.context();
    if (!ctx || !this.master) return false;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const { level, duck } = mixFor(this.voices, priority, now);
    for (const v of duck) v.setLevel(DUCK_LEVEL);
    try {
      const bus = ctx.createGain();
      bus.gain.value = level;
      bus.connect(this.master);
      const t0 = ctx.currentTime + 0.02;
      for (const note of spec) this.schedule(ctx, bus, note, t0);
      const until = now + soundLength(spec) + 50;
      const voice: Voice = {
        priority,
        until,
        setLevel: (l) => {
          bus.gain.cancelScheduledValues(ctx.currentTime);
          bus.gain.setTargetAtTime(l, ctx.currentTime, 0.05);
        },
      };
      this.voices = [...this.voices.filter((v) => v.until > now), voice];
      setTimeout(() => this.release(voice), until - now);
      return true;
    } catch {
      return false;
    }
  }

  /** When a louder cue ends, ducked voices come back up. */
  private release(voice: Voice) {
    const now = this.clock();
    this.voices = this.voices.filter((v) => v !== voice && v.until > now);
    const top = Math.max(0, ...this.voices.map((v) => v.priority));
    for (const v of this.voices) if (v.priority >= top) v.setLevel(1);
  }

  /** Ducks everything playing for `ms` (speech and clips cannot share the master gain). */
  duckFor(ms: number) {
    const now = this.clock();
    for (const v of this.voices) if (v.until > now) v.setLevel(DUCK_LEVEL);
    setTimeout(() => {
      for (const v of this.voices) v.setLevel(1);
    }, ms);
  }

  private schedule(ctx: AudioContextLike, out: GainNode, n: SoundSpec[number], t0: number) {
    const start = t0 + n.at / 1000;
    const end = start + n.dur / 1000;
    const gain = ctx.createGain();
    const peak = Math.min(0.3, Math.max(0.0002, n.gain));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.03, n.dur / 4000));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(out);
    if (n.type === 'noise') {
      const buf = this.noiseBuffer();
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = n.freq;
      filter.Q.value = 1.2;
      src.connect(filter).connect(gain);
      src.start(start, 0, Math.min(0.5, n.dur / 1000 + 0.05));
      src.stop(end + 0.05);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = n.type;
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
    osc.connect(gain);
    osc.start(start);
    osc.stop(end + 0.05);
  }

  /** Fetches and decodes a clip ahead of time (cached per URL). */
  preloadClip(url: string): Promise<AudioBuffer | null> {
    const cached = this.clips.get(url);
    if (cached) return cached;
    const p = (async () => {
      const ctx = this.context();
      if (!ctx) return null;
      try {
        return await ctx.decodeAudioData(await this.fetchClip(url));
      } catch {
        this.clips.delete(url);
        return null;
      }
    })();
    this.clips.set(url, p);
    return p;
  }
  forgetClip(url: string) {
    this.clips.delete(url);
  }

  /** Plays a preloaded (or freshly fetched) clip at top priority. Resolves false when it cannot play. */
  async playClip(url: string): Promise<boolean> {
    if (this.isMuted()) return false;
    const buf = await this.preloadClip(url);
    const ctx = this.ctx;
    if (!buf || !ctx || !this.master) return false;
    try {
      this.duckFor(buf.duration * 1000);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start(ctx.currentTime + 0.02);
      return true;
    } catch {
      return false;
    }
  }
}

/** The page's sound manager. */
export const sounds = new SoundManager();

let installed = false;
/** Unlocks audio on the first tap, click or key press (browsers' autoplay rule). */
export function installSoundUnlock() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const unlock = () => {
    sounds.unlock();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}
