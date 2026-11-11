/**
 * SoundManager (S13b, D-110; unlock and loudness S14a, D-145): the one place that makes sound on the
 * classroom display.
 * - one AudioContext for the page. Browsers refuse audio before a user gesture, so the context is
 *   resumed ("unlocked") inside a gesture. The unlock listeners stay armed until the context really
 *   runs (a refused `resume()` never counts as unlocked) and are armed again when the page comes back
 *   or the browser suspends or interrupts the context (Safari). WebKit also gets a 1-sample silent
 *   buffer inside the gesture, and `navigator.audioSession.type = 'playback'` where it exists;
 * - loudness: every cue goes master (class volume on a perceptual curve) → DynamicsCompressor →
 *   makeup gain → soft ceiling → speakers, so cues are clearly audible on laptop speakers and never
 *   clip. The per-note cap stays 0.3; `outputPeakDb` models the chain and a test keeps a tap at volume
 *   80 between −12 and −6 dBFS. A new chain plays its first sound `LOUDNESS.settleMs` after it was
 *   built, once its compressor has settled (S21a, D-173; rendered in `e2e/sound-loudness.spec.ts`);
 * - class volume (0..100), class switch and device switch (THM-5);
 * - priorities: celebration and time's-up cues (4) > reveals and thresholds (3) > stage changes,
 *   shuffles, checks (2) > taps (1). A new cue ducks quieter-priority cues still playing, and a cue
 *   that starts under a louder one plays ducked; taps closer than 50 ms are merged;
 * - preloading: the noise buffer is made on unlock, and a teacher clip is fetched and decoded ahead
 *   (`preloadClip`) so time's up is not delayed by the network;
 * - a status store (`status()`, `snapshot()`, `subscribe()`) for the "Sound is off" chip and the
 *   Sound check block (`useSoundStatus()` in index.tsx).
 * Components never call WebAudio themselves: they name an event (`playThemeSound`) or use `sounds`.
 */
import type { SoundEvent, SoundSpec } from './types.ts';
import { soundLength } from './soundPack.ts';
import { notePartials } from '../../shared/themePackage/sound.ts';
import { LOUDNESS, SOUND_LIMITS, softCeilingCurve, volumeGain } from '../../shared/themePackage/limits.ts';

export const SOUND_PRIORITY: Record<SoundEvent, number> = {
  tap: 1,
  pointAwarded: 1,
  undo: 1,
  groupMove: 1,
  softChime: 2,
  assistantCheck: 2,
  groupShuffle: 2,
  stageChange: 2,
  timerStart: 2,
  soundTest: 2,
  lessonStart: 3,
  lessonEnd: 3,
  achievementGiven: 3,
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
/** Loudest single note a pack may ask for (themes test and `schedule`). */
export const NOTE_GAIN_CAP = SOUND_LIMITS.noteGainCap;

/*
 * The loudness chain (D-145) and its model (`outputPeakDb`) live in the shared theme limits since
 * S14g (D-158), so the theme package validator checks a package's loudness with the same numbers.
 */
export { compressedPeakDb, compressorCurveDb, compressorMakeupDb, LOUDNESS, outputPeakDb, softCeiling, volumeGain } from '../../shared/themePackage/limits.ts';

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
export type AudioContextLike = Pick<
  AudioContext,
  'currentTime' | 'resume' | 'createOscillator' | 'createGain' | 'createBiquadFilter' | 'createBuffer' | 'createBufferSource' | 'decodeAudioData' | 'destination' | 'sampleRate'
> & {
  /** Safari also reports 'interrupted' (a call, another app, the lock screen). */
  readonly state: AudioContextState | 'interrupted';
  onstatechange?: ((this: BaseAudioContext, ev: Event) => unknown) | null;
  createDynamicsCompressor?: () => DynamicsCompressorNode;
  createWaveShaper?: () => WaveShaperNode;
};

/** Whether audio can play here at all (`unavailable`), is waiting for a gesture (`locked`) or runs. */
export type AudioState = 'unavailable' | 'locked' | 'running';
/** What the teacher needs to know about sound on this screen (the chip and the Sound check). */
export type SoundStatus = 'running' | 'locked' | 'unavailable' | 'mutedClass' | 'mutedDevice' | 'volumeZero';
export const SOUND_STATUSES: readonly SoundStatus[] = ['running', 'locked', 'unavailable', 'mutedClass', 'mutedDevice', 'volumeZero'];

export interface SoundSwitches {
  classSounds: boolean;
  deviceSounds: boolean;
  volume: number;
}

/** Pure rule (tested): no audio beats every switch; then the class switch, the device switch, the volume. */
export function soundStatus(audio: AudioState, sw: SoundSwitches): SoundStatus {
  if (audio === 'unavailable') return 'unavailable';
  if (!sw.classSounds) return 'mutedClass';
  if (!sw.deviceSounds) return 'mutedDevice';
  if (sw.volume <= 0) return 'volumeZero';
  return audio;
}

/** Immutable snapshot for `useSyncExternalStore` (a new object only when something changed). */
export interface SoundSnapshot {
  audio: AudioState;
  /** The AudioContext's own state ('none' before it exists). */
  contextState: string;
  sampleRate: number | null;
  /** The last cue the manager scheduled, with the context state at that moment. */
  last: { event: SoundEvent | 'clip' | null; at: number; contextState: string } | null;
  switches: SoundSwitches;
}

function hasWebAudio(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

function defaultContext(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** Safari 16.4+: play WebAudio as media, so the iPhone/iPad silent switch does not mute the class. */
function preferPlaybackSession() {
  try {
    const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { audioSession?: { type: string } });
    if (nav?.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
  } catch {
    /* not supported */
  }
}

export class SoundManager {
  private ctx: AudioContextLike | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Context time (s) from which the chain may sound: built + `LOUDNESS.settleMs` (S21a, D-173). */
  private readyAt = 0;
  private voices: Voice[] = [];
  private lastTap = -Infinity;
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  private volume = 80;
  private classSounds = true;
  private deviceSounds = true;
  private failed = false;
  private last: SoundSnapshot['last'] = null;
  private snap: SoundSnapshot | null = null;
  private listeners = new Set<() => void>();

  private readonly createContext: () => AudioContextLike | null;
  private readonly clock: () => number;
  private readonly fetchClip: (url: string) => Promise<ArrayBuffer>;
  private readonly canCreate: () => boolean;

  constructor(
    createContext: () => AudioContextLike | null = defaultContext,
    clock: () => number = () => Date.now(),
    fetchClip: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
    canCreate: () => boolean = createContext === defaultContext ? hasWebAudio : () => true,
  ) {
    this.createContext = createContext;
    this.clock = clock;
    this.fetchClip = fetchClip;
    this.canCreate = canCreate;
  }

  // ------------------------------------------------------------ switches and status

  /** Class volume 0..100. */
  setVolume(v: number) {
    const next = Math.max(0, Math.min(100, v));
    if (next === this.volume) return;
    this.volume = next;
    if (this.master && this.ctx) this.master.gain.setValueAtTime(volumeGain(this.volume), this.ctx.currentTime);
    this.notify();
  }
  getVolume() {
    return Math.round(this.volume);
  }
  /** The class switch and this device's switch (THM-5). */
  setSwitches(classSounds: boolean, deviceSounds: boolean) {
    if (classSounds === this.classSounds && deviceSounds === this.deviceSounds) return;
    this.classSounds = classSounds;
    this.deviceSounds = deviceSounds;
    this.notify();
  }
  isMuted() {
    return !this.classSounds || !this.deviceSounds || this.volume === 0;
  }

  /** Can the context play now? A context that only exists is not enough: it must be running. */
  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  audioState(): AudioState {
    if (this.failed || (!this.ctx && !this.canCreate())) return 'unavailable';
    return this.ctx?.state === 'running' ? 'running' : 'locked';
  }

  status(): SoundStatus {
    return soundStatus(this.audioState(), { classSounds: this.classSounds, deviceSounds: this.deviceSounds, volume: this.volume });
  }

  snapshot = (): SoundSnapshot => {
    if (!this.snap) {
      this.snap = {
        audio: this.audioState(),
        contextState: this.ctx ? String(this.ctx.state) : 'none',
        sampleRate: this.ctx ? this.ctx.sampleRate : null,
        last: this.last,
        switches: { classSounds: this.classSounds, deviceSounds: this.deviceSounds, volume: this.volume },
      };
    }
    return this.snap;
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private notify() {
    this.snap = null;
    for (const fn of [...this.listeners]) fn();
  }

  // ------------------------------------------------------------ context and unlock

  private context(): AudioContextLike | null {
    if (this.ctx) return this.ctx;
    if (this.failed) return null;
    try {
      this.ctx = this.createContext();
    } catch {
      this.ctx = null;
    }
    if (!this.ctx) {
      this.failed = true;
      this.notify();
      return null;
    }
    const ctx = this.ctx;
    try {
      ctx.onstatechange = () => this.notify();
    } catch {
      /* read-only in a fake */
    }
    this.master = ctx.createGain();
    this.master.gain.value = volumeGain(this.volume);
    const makeup = ctx.createGain();
    makeup.gain.value = LOUDNESS.makeup;
    const comp = typeof ctx.createDynamicsCompressor === 'function' ? ctx.createDynamicsCompressor() : null;
    if (comp) {
      comp.threshold.value = LOUDNESS.thresholdDb;
      comp.knee.value = LOUDNESS.kneeDb;
      comp.ratio.value = LOUDNESS.ratio;
      comp.attack.value = LOUDNESS.attack;
      comp.release.value = LOUDNESS.release;
      this.master.connect(comp);
      comp.connect(makeup);
    } else {
      this.master.connect(makeup);
    }
    // S21a (D-173): a soft ceiling after the makeup gain, so the compressor's attack transients (and
    // loud clips) can never reach 0 dBFS. Taps and ordinary cues stay in its linear part.
    const shaper = typeof ctx.createWaveShaper === 'function' ? ctx.createWaveShaper() : null;
    if (shaper) {
      const scale = ctx.createGain();
      scale.gain.value = 1 / LOUDNESS.ceilingRange;
      shaper.curve = softCeilingCurve();
      shaper.oversample = 'none';
      makeup.connect(scale);
      scale.connect(shaper);
      shaper.connect(ctx.destination);
    } else {
      makeup.connect(ctx.destination);
    }
    // A new compressor reaches its makeup gain only after it has run for a while: nothing sounds before.
    this.readyAt = ctx.currentTime + LOUDNESS.settleMs / 1000;
    this.notify();
    return ctx;
  }

  /**
   * Called inside a user gesture: creates/resumes the context, plays a 1-sample silent buffer (WebKit
   * starts output only for a sound started in a gesture) and prepares the noise buffer. It is safe to
   * call on every gesture; `unlocked` becomes true only once the context reports 'running'.
   */
  unlock() {
    const ctx = this.context();
    if (!ctx) return;
    preferPlaybackSession();
    if (ctx.state !== 'running') {
      try {
        const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* nothing to prime */
      }
      try {
        void ctx.resume().then(
          () => this.notify(),
          () => this.notify(),
        );
      } catch {
        /* an old WebKit throws instead of rejecting */
      }
    }
    this.noiseBuffer();
    this.notify();
  }

  /** Without a gesture (the page became visible again): a browser that remembers the gesture lets it resume. */
  resumeQuietly() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || String(ctx.state) === 'closed') return;
    try {
      void ctx.resume().then(
        () => this.notify(),
        () => this.notify(),
      );
    } catch {
      /* stays locked until the next gesture */
    }
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

  // ------------------------------------------------------------ playing

  /** Plays a cue at a priority. Returns false when muted, merged or audio is unavailable. */
  play(spec: SoundSpec, priority = 2, event: SoundEvent | null = null): boolean {
    if (this.isMuted() || spec.length === 0) return false;
    const now = this.clock();
    if (priority <= 1) {
      if (now - this.lastTap < TAP_MERGE_MS) return false;
      this.lastTap = now;
    }
    const ctx = this.context();
    if (!ctx || !this.master) return false;
    if (ctx.state !== 'running') this.resumeQuietly();
    const { level, duck } = mixFor(this.voices, priority, now);
    for (const v of duck) v.setLevel(DUCK_LEVEL);
    try {
      const bus = ctx.createGain();
      bus.gain.value = level;
      bus.connect(this.master);
      const t0 = this.startTime(ctx);
      for (const note of spec) this.schedule(ctx, bus, note, t0);
      const until = now + (t0 - ctx.currentTime) * 1000 + soundLength(spec) + 50;
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
      this.last = { event, at: now, contextState: String(ctx.state) };
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  /** When a cue scheduled now starts: 20 ms ahead, and never before the chain has settled (D-173). */
  private startTime(ctx: AudioContextLike): number {
    return Math.max(ctx.currentTime + 0.02, this.readyAt);
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
    const peak = Math.min(NOTE_GAIN_CAP, Math.max(0.0002, n.gain));
    if (n.type !== 'noise' && n.voice && n.voice !== 'tones') {
      // An instrument style (S17b, D-168): one sine per partial, each with its own attack and decay,
      // all inside the note. The partials' gains add up to the note's peak, so the loudness model and
      // every limit hold (nothing sounds after the note's end).
      for (const p of notePartials(n)) {
        const pg = ctx.createGain();
        const ppeak = Math.max(0.0002, p.gain * (peak / Math.max(n.gain, 0.0002)));
        const pend = Math.min(end, start + Math.max(0.01, (n.dur * p.decay) / 1000));
        pg.gain.value = 0.0001;
        pg.gain.setValueAtTime(0.0001, start);
        pg.gain.exponentialRampToValueAtTime(ppeak, start + Math.min(p.attackMs / 1000, n.dur / 4000));
        pg.gain.exponentialRampToValueAtTime(0.0001, pend);
        pg.connect(out);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        // The starting value too (S21a, D-173): Chromium reads a frequency set only by an event at the
        // note's start once per 128-sample block, so the first block played every partial at 440 Hz,
        // in phase, and a styled note peaked up to 2.7 dB over its gain.
        osc.frequency.value = p.freq;
        osc.frequency.setValueAtTime(p.freq, start);
        if (p.to) osc.frequency.exponentialRampToValueAtTime(p.to, end);
        osc.connect(pg);
        osc.start(start);
        osc.stop(pend + 0.02);
      }
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
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
    osc.frequency.value = n.freq;
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
      const t0 = this.startTime(ctx);
      this.duckFor((t0 - ctx.currentTime) * 1000 + buf.duration * 1000);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start(t0);
      this.last = { event: 'clip', at: this.clock(), contextState: String(ctx.state) };
      this.notify();
      return true;
    } catch {
      return false;
    }
  }
}

/** The page's sound manager. */
export const sounds = new SoundManager();

/** Events that count as a user gesture for audio in at least one browser (Safari needs the later ones). */
export const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

const installedOn = new Map<object, () => void>();
/** Marks a control whose own press unlocks audio (see `installSoundUnlock`). */
export const SELF_UNLOCK_ATTR = 'data-unlocks-sound';

/**
 * Unlocks audio on a tap, click or key press (browsers' autoplay rule). The listeners stay armed until
 * the context runs, and are armed again whenever it stops running (suspended, Safari's 'interrupted')
 * or the page is shown again (tab switch, back/forward cache). Returns an uninstall function (tests).
 */
export function installSoundUnlock(
  manager: SoundManager = sounds,
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window,
  doc: (Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState?: string }) | null = typeof document === 'undefined' ? null : document,
): () => void {
  if (!target) return () => undefined;
  if (installedOn.has(target)) return installedOn.get(target)!;
  let armed = false;
  const onGesture = (e: Event) => {
    // A control that unlocks audio itself (the "Turn sound on" chip) finishes its own press first:
    // unlocking on its pointerdown would remove it before its click arrives.
    const el = e.target as { closest?: (sel: string) => unknown } | null;
    if (typeof el?.closest === 'function' && el.closest(`[${SELF_UNLOCK_ATTR}]`)) return;
    manager.unlock();
    sync();
  };
  const arm = () => {
    if (armed) return;
    armed = true;
    for (const e of UNLOCK_EVENTS) target.addEventListener(e, onGesture, { capture: true, passive: true });
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const e of UNLOCK_EVENTS) target.removeEventListener(e, onGesture, { capture: true });
  };
  const sync = () => {
    const state = manager.audioState();
    if (state === 'running' || state === 'unavailable') disarm();
    else arm();
  };
  const onShow = () => {
    if (doc?.visibilityState === 'hidden') return;
    manager.resumeQuietly();
    sync();
  };
  arm();
  const unsubscribe = manager.subscribe(sync);
  doc?.addEventListener('visibilitychange', onShow);
  target.addEventListener('pageshow', onShow);
  const uninstall = () => {
    disarm();
    unsubscribe();
    doc?.removeEventListener('visibilitychange', onShow);
    target.removeEventListener('pageshow', onShow);
    installedOn.delete(target);
  };
  installedOn.set(target, uninstall);
  return uninstall;
}
