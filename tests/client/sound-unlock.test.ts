/**
 * S14a sound fixes (D-145): the WebAudio unlock stays armed until the context really runs (the owner's
 * test server played only the speech-based time's up: every WebAudio cue was silent), it is armed
 * again when the browser suspends or interrupts the context, a refused resume() never counts as
 * unlocked, the status store tells the chip and the Sound check what is wrong, and the loudness chain
 * is modelled so a tap is clearly audible without clipping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compressedPeakDb,
  compressorCurveDb,
  compressorMakeupDb,
  installSoundUnlock,
  LOUDNESS,
  outputPeakDb,
  softCeiling,
  soundStatus,
  SoundManager,
  UNLOCK_EVENTS,
  volumeGain,
  type AudioContextLike,
} from '../../src/client/themes/soundManager.ts';
import { makeSoundPack } from '../../src/client/themes/soundPack.ts';
import { softCeilingCurve } from '../../src/shared/themePackage/limits.ts';

interface Param {
  value: number;
  setValueAtTime: (v: number) => void;
  setTargetAtTime: (v: number) => void;
  exponentialRampToValueAtTime: () => void;
  cancelScheduledValues: () => void;
}
const param = (v = 1): Param => {
  const p: Param = {
    value: v,
    setValueAtTime: (x) => void (p.value = x),
    setTargetAtTime: (x) => void (p.value = x),
    exponentialRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  };
  return p;
};

/** A fake context whose resume() answers from a script: 'reject' first, then 'resolve' (like Safari before a real gesture). */
function scriptedContext(script: Array<'reject' | 'resolve'>) {
  const log = { resumes: 0, silentPrimers: 0, compressor: null as null | Record<string, Param>, connections: [] as string[] };
  const node = (name: string) => ({ name, connect: (n: { name?: string }) => (log.connections.push(`${name}->${n?.name ?? 'out'}`), n) });
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'suspended' as string,
    destination: { name: 'destination' },
    onstatechange: null as null | (() => void),
    resume: () => {
      log.resumes++;
      const step = script.shift() ?? 'resolve';
      if (step === 'reject') return Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
      return Promise.resolve().then(() => {
        ctx.state = 'running';
        ctx.onstatechange?.();
      });
    },
    createGain: () => ({ ...node('gain'), gain: param(1) }),
    createDynamicsCompressor: () => {
      const c = { threshold: param(0), knee: param(30), ratio: param(12), attack: param(0), release: param(0) };
      log.compressor = c;
      return { ...node('compressor'), ...c };
    },
    createOscillator: () => ({ ...node('osc'), type: 'sine', frequency: param(440), start: () => undefined, stop: () => undefined }),
    createBiquadFilter: () => ({ ...node('filter'), type: 'bandpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => {
      if (len === 1) log.silentPrimers++;
      const data = new Float32Array(len);
      return { duration: len / 48000, getChannelData: () => data };
    },
    createBufferSource: () => ({ ...node('source'), buffer: null, start: () => undefined, stop: () => undefined }),
    decodeAudioData: () => Promise.resolve({ duration: 1 }),
  };
  /** The browser changes the state by itself (Safari: a phone call, the lock screen). */
  const setState = (s: string) => {
    ctx.state = s;
    ctx.onstatechange?.();
  };
  return { ctx: ctx as unknown as AudioContextLike, log, setState };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('unlock (D-145)', () => {
  let target: EventTarget;
  let doc: EventTarget & { visibilityState: string };
  let uninstall: () => void = () => undefined;
  beforeEach(() => {
    target = new EventTarget();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  });
  afterEach(() => uninstall());

  it('listens to every gesture event a browser counts (pointerdown, pointerup, touchend, click, keydown)', () => {
    expect([...UNLOCK_EVENTS].sort()).toEqual(['click', 'keydown', 'pointerdown', 'pointerup', 'touchend']);
  });

  it('keeps the listeners until the context runs: a refused resume() is not "unlocked", the next gesture tries again', async () => {
    const f = scriptedContext(['reject', 'resolve']);
    const m = new SoundManager(() => f.ctx, () => 0);
    uninstall = installSoundUnlock(m, target, doc);
    expect(m.audioState()).toBe('locked');

    target.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(f.log.resumes).toBe(1);
    expect(m.unlocked).toBe(false);
    expect(m.status()).toBe('locked');
    expect(f.log.silentPrimers).toBe(1); // WebKit: a 1-sample silent buffer inside the gesture

    target.dispatchEvent(new Event('click'));
    await flush();
    expect(f.log.resumes).toBe(2);
    expect(m.unlocked).toBe(true);
    expect(m.status()).toBe('running');

    // Running: the listeners are gone, so later taps cost nothing.
    target.dispatchEvent(new Event('pointerup'));
    target.dispatchEvent(new Event('keydown'));
    await flush();
    expect(f.log.resumes).toBe(2);
  });

  it('arms again when the browser suspends or interrupts the context, and when the page is shown again', async () => {
    const f = scriptedContext(['resolve', 'reject', 'resolve', 'resolve']);
    const m = new SoundManager(() => f.ctx, () => 0);
    uninstall = installSoundUnlock(m, target, doc);
    target.dispatchEvent(new Event('touchend'));
    await flush();
    expect(m.status()).toBe('running');

    f.setState('interrupted'); // Safari: a call or another app took the audio
    expect(m.status()).toBe('locked');
    // Coming back to the tab: a resume without a gesture is tried (it may be refused) …
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(f.log.resumes).toBe(2);
    expect(m.unlocked).toBe(false);
    // … and the next tap unlocks again.
    target.dispatchEvent(new Event('keydown'));
    await flush();
    expect(m.unlocked).toBe(true);

    f.setState('suspended');
    target.dispatchEvent(new Event('pageshow')); // back/forward cache
    await flush();
    expect(m.unlocked).toBe(true);
  });

  it('asks Safari to treat the page as media playback (the silent switch does not mute the class)', () => {
    const f = scriptedContext(['resolve']);
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });
    try {
      new SoundManager(() => f.ctx, () => 0).unlock();
      expect(session.type).toBe('playback');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without WebAudio the status is "unavailable" and nothing is armed', () => {
    const m = new SoundManager(() => null, () => 0);
    uninstall = installSoundUnlock(m, target, doc);
    target.dispatchEvent(new Event('pointerdown'));
    expect(m.status()).toBe('unavailable');
    expect(m.play(makeSoundPack({ root: 440, wave: 'sine' }).tap, 1)).toBe(false);
  });
});

describe('status store (D-145)', () => {
  it('orders the reasons: no audio, class switch, device switch, volume, then locked or running', () => {
    const on = { classSounds: true, deviceSounds: true, volume: 80 };
    expect(soundStatus('running', on)).toBe('running');
    expect(soundStatus('locked', on)).toBe('locked');
    expect(soundStatus('unavailable', { ...on, classSounds: false })).toBe('unavailable');
    expect(soundStatus('running', { ...on, classSounds: false, deviceSounds: false })).toBe('mutedClass');
    expect(soundStatus('locked', { ...on, deviceSounds: false })).toBe('mutedDevice');
    expect(soundStatus('running', { ...on, volume: 0 })).toBe('volumeZero');
  });

  it('notifies subscribers and records the last cue for the Sound check', async () => {
    const f = scriptedContext(['resolve']);
    const m = new SoundManager(() => f.ctx, () => 5000);
    const seen: string[] = [];
    m.subscribe(() => seen.push(m.snapshot().contextState));
    const first = m.snapshot();
    expect(m.snapshot()).toBe(first); // stable between changes (useSyncExternalStore)
    expect(first.contextState).toBe('none');
    m.unlock();
    await flush();
    expect(m.snapshot().contextState).toBe('running');
    expect(seen.length).toBeGreaterThan(0);
    expect(m.play(makeSoundPack({ root: 440, wave: 'sine' }).soundTest, 2, 'soundTest')).toBe(true);
    expect(m.snapshot().last).toEqual({ event: 'soundTest', at: 5000, contextState: 'running' });
    m.setSwitches(true, false);
    expect(m.status()).toBe('mutedDevice');
    expect(m.snapshot().switches.deviceSounds).toBe(false);
  });
});

describe('loudness chain (D-145)', () => {
  it('wires master → compressor → makeup → speakers with the modelled settings', () => {
    const f = scriptedContext(['resolve']);
    const m = new SoundManager(() => f.ctx, () => 0);
    m.unlock();
    expect(f.log.connections.slice(0, 3)).toEqual(['gain->compressor', 'compressor->gain', 'gain->destination']);
    expect(f.log.compressor!.threshold!.value).toBe(LOUDNESS.thresholdDb);
    expect(f.log.compressor!.knee!.value).toBe(LOUDNESS.kneeDb);
    expect(f.log.compressor!.ratio!.value).toBe(LOUDNESS.ratio);
  });

  it('uses a perceptual (squared) volume curve that rises steadily from silence', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(50)).toBeCloseTo(0.25);
    for (let v = 1; v <= 100; v++) expect(volumeGain(v)).toBeGreaterThan(volumeGain(v - 1));
  });

  it('never clips: even a full-scale input leaves headroom', () => {
    expect(compressorCurveDb(-40)).toBe(-40);
    expect(compressorCurveDb(0)).toBeCloseTo(LOUDNESS.thresholdDb * (1 - 1 / LOUDNESS.ratio));
    const fullScale = compressorCurveDb(0) + compressorMakeupDb() + 20 * Math.log10(LOUDNESS.makeup);
    expect(fullScale).toBeLessThan(0);
    // Five capped notes at once at full volume stay under 0 dBFS, before the ceiling too.
    expect(compressedPeakDb(1.5, 100)).toBeLessThan(0);
    expect(outputPeakDb(1.5, 100)).toBeLessThan(LOUDNESS.ceilingDb);
  });

  it('is louder than before S14a: a default tap at volume 80 gains at least 15 dB', () => {
    const tap = makeSoundPack({ root: 523, wave: 'triangle', gain: 0.11 }).tap[0]!.gain;
    const before = 20 * Math.log10(tap * 0.8); // S13b: note → volume (linear) → speakers
    expect(outputPeakDb(tap, 80) - before).toBeGreaterThanOrEqual(15);
  });
});

/** A context that records the nodes, values and start times the SoundManager asks for (S21a). */
function chainContext() {
  const log = { nodes: [] as Array<Record<string, any>>, starts: [] as number[], edges: [] as string[] };
  const node = (kind: string, extra: Record<string, any> = {}) => {
    const n: Record<string, any> = {
      kind,
      ...extra,
      connect: (to: Record<string, any>) => (log.edges.push(`${kind}->${to?.kind ?? 'destination'}`), to),
      start: (t: number) => void log.starts.push(t),
      stop: () => undefined,
    };
    log.nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: { kind: 'destination' },
    resume: () => Promise.resolve(),
    createGain: () => node('gain', { gain: param(1) }),
    createDynamicsCompressor: () => node('compressor', { threshold: param(0), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }),
    createWaveShaper: () => node('shaper', { curve: null, oversample: '4x' }),
    // Automation events leave `value` alone here (as in a browser): only an assignment changes it.
    createOscillator: () => node('osc', { type: 'sine', frequency: { ...param(440), setValueAtTime: () => undefined } }),
    createBiquadFilter: () => node('filter', { frequency: param(350), Q: param(1) }),
    createBuffer: (_c: number, len: number) => ({ duration: len / 48000, getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => node('source', { buffer: null }),
    decodeAudioData: () => Promise.resolve({ duration: 1 }),
  };
  return { ctx, log };
}

describe('rendered loudness check (S21a, D-173)', () => {
  it('wires master → compressor → makeup → ceiling → speakers, with a 1 ms attack and a soft ceiling', () => {
    const { ctx, log } = chainContext();
    const m = new SoundManager(() => ctx as unknown as AudioContextLike, () => 0);
    m.unlock();
    expect(log.edges.slice(0, 5)).toEqual(['gain->compressor', 'compressor->gain', 'gain->gain', 'gain->shaper', 'shaper->destination']);
    const comp = log.nodes.find((n) => n.kind === 'compressor')!;
    expect(comp.attack.value).toBe(0.001);
    expect(LOUDNESS.attack).toBe(0.001);
    const shaper = log.nodes.find((n) => n.kind === 'shaper')!;
    expect(shaper.oversample).toBe('none');
    expect(shaper.curve).toEqual(softCeilingCurve());
    // The gain in front of the shaper maps ±ceilingRange onto the shaper's −1..1.
    expect(log.nodes.filter((n) => n.kind === 'gain').map((n) => n.gain.value)).toContain(1 / LOUDNESS.ceilingRange);
  });

  it('the soft ceiling is exact below its knee, smooth and rising above it, and never reaches −1 dBFS', () => {
    const knee = 10 ** (LOUDNESS.ceilingKneeDb / 20);
    const ceiling = 10 ** (LOUDNESS.ceilingDb / 20);
    for (const x of [0, 0.01, 0.1, 0.35, knee]) {
      expect(softCeiling(x)).toBe(x);
      expect(softCeiling(-x)).toBe(-x);
    }
    let last = 0;
    for (let x = 0; x <= 4; x += 0.001) {
      const y = softCeiling(x);
      expect(y).toBeGreaterThanOrEqual(last);
      expect(y).toBeLessThan(ceiling);
      last = y;
    }
    const curve = softCeilingCurve();
    expect(curve.length % 2).toBe(1);
    expect(curve[(curve.length - 1) / 2]).toBe(0);
    expect(Math.max(...curve)).toBeLessThan(ceiling);
    expect(curve[curve.length - 1]).toBeCloseTo(-curve[0]!, 9);
    // A tap at volume 80 (about −9 dBFS) is below the knee: the ceiling leaves it alone.
    expect(outputPeakDb(0.06, 80)).toBeCloseTo(compressedPeakDb(0.06, 80), 9);
    expect(outputPeakDb(0.42, 100)).toBeLessThan(compressedPeakDb(0.42, 100));
  });

  it('a new chain plays its first sound once its compressor has settled; later cues start at once', () => {
    const { ctx, log } = chainContext();
    let now = 1000;
    const m = new SoundManager(() => ctx as unknown as AudioContextLike, () => now);
    const tap = makeSoundPack({ root: 523, wave: 'sine' }).tap;
    expect(m.play(tap, 2)).toBe(true);
    expect(Math.min(...log.starts)).toBeCloseTo(LOUDNESS.settleMs / 1000, 9);
    log.starts.length = 0;
    ctx.currentTime = 2;
    now += 2000;
    expect(m.play(tap, 2)).toBe(true);
    expect(Math.min(...log.starts)).toBeCloseTo(2.02, 9);
  });

  it('every oscillator starts at its own frequency (Chromium read 440 Hz for the first 128 samples before)', () => {
    const { ctx, log } = chainContext();
    const m = new SoundManager(() => ctx as unknown as AudioContextLike, () => 0);
    const pack = makeSoundPack({ root: 523, wave: 'sine', style: 'musicBox' });
    const plain = makeSoundPack({ root: 523, wave: 'triangle' });
    expect(m.play([...pack.achievementGiven, ...plain.timerStart], 3)).toBe(true);
    const oscs = log.nodes.filter((n) => n.kind === 'osc');
    expect(oscs.length).toBeGreaterThan(5);
    for (const o of oscs) expect(o.frequency.value).not.toBe(440);
  });
});
