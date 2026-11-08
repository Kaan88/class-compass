/**
 * S13b client logic: the SoundManager (volume, mute, priorities and ducking, tap merging, unlock,
 * clip preloading), the time's-up choice and its fallbacks, the quote of the day, the sound packs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planTimeUp, pickEnglishVoice } from '../../src/client/modules/lessons/timeUp.ts';
import { DUCK_LEVEL, mixFor, SOUND_PRIORITY, SoundManager, type AudioContextLike, type Voice } from '../../src/client/themes/soundManager.ts';
import { degree, makeSoundPack, soundLength } from '../../src/client/themes/soundPack.ts';
import { SOUND_EVENTS } from '../../src/client/themes/types.ts';
import { hash32, QUOTES_EN, QUOTES_TR, quoteFor } from '../../src/shared/quotes.ts';

// ---------------------------------------------------------------- a fake WebAudio context
interface FakeParam {
  value: number;
  setValueAtTime: (v: number) => void;
  setTargetAtTime: (v: number) => void;
  exponentialRampToValueAtTime: () => void;
  cancelScheduledValues: () => void;
}
function param(v = 1): FakeParam {
  const p: FakeParam = {
    value: v,
    setValueAtTime: (x) => void (p.value = x),
    setTargetAtTime: (x) => void (p.value = x),
    exponentialRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  };
  return p;
}
function fakeContext() {
  const log = { oscillators: 0, sources: 0, gains: [] as FakeParam[], resumed: 0, decoded: 0, buffers: 0 };
  const node = () => ({ connect: (n: unknown) => n });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'suspended' as AudioContextState,
    destination: {},
    resume: () => {
      log.resumed++;
      ctx.state = 'running';
      return Promise.resolve();
    },
    createGain: () => {
      const gain = param(1);
      log.gains.push(gain);
      return { ...node(), gain };
    },
    createOscillator: () => {
      log.oscillators++;
      return { ...node(), type: 'sine', frequency: param(440), start: () => undefined, stop: () => undefined };
    },
    createBiquadFilter: () => ({ ...node(), type: 'bandpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => {
      log.buffers++;
      const data = new Float32Array(len);
      return { duration: len / 8000, getChannelData: () => data };
    },
    createBufferSource: () => {
      log.sources++;
      return { ...node(), buffer: null, start: () => undefined, stop: () => undefined };
    },
    decodeAudioData: () => {
      log.decoded++;
      return Promise.resolve({ duration: 1.2 });
    },
  };
  return { ctx: ctx as unknown as AudioContextLike, log, raw: ctx };
}

const pack = makeSoundPack({ root: 523, wave: 'triangle' });

describe('SoundManager (S13b, D-110)', () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  it('creates one context lazily, unlocks (resumes) it on the first gesture and prepares the noise buffer once', () => {
    const f = fakeContext();
    const create = vi.fn(() => f.ctx);
    const m = new SoundManager(create, () => now);
    expect(create).not.toHaveBeenCalled();
    m.unlock();
    m.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(f.log.resumed).toBe(1);
    expect(f.log.buffers).toBe(1);
    expect(m.unlocked).toBe(true);
  });

  it('applies the class volume to the master gain and stays silent when muted or at 0', () => {
    const f = fakeContext();
    const m = new SoundManager(() => f.ctx, () => now);
    m.setVolume(40);
    expect(m.play(pack.tap, 1)).toBe(true);
    const master = f.log.gains[0]!;
    expect(master.value).toBeCloseTo(0.4);
    m.setVolume(150);
    expect(m.getVolume()).toBe(100);
    m.setMuted(true);
    now += 1000;
    expect(m.play(pack.fanfare, 4)).toBe(false);
    m.setMuted(false);
    m.setVolume(0);
    expect(m.isMuted()).toBe(true);
    expect(m.play(pack.fanfare, 4)).toBe(false);
  });

  it('merges taps closer than 50 ms (a double tap is one sound)', () => {
    const f = fakeContext();
    const m = new SoundManager(() => f.ctx, () => now);
    expect(m.play(pack.tap, 1)).toBe(true);
    now += 20;
    expect(m.play(pack.tap, 1)).toBe(false);
    now += 60;
    expect(m.play(pack.tap, 1)).toBe(true);
  });

  it('ducks quieter cues under a louder one, plays a quiet cue ducked under a loud one, and restores levels after', () => {
    const f = fakeContext();
    const m = new SoundManager(() => f.ctx, () => now);
    m.play(pack.stageChange, 2);
    const stageBus = f.log.gains[1]!; // [0] master, [1] the first cue's bus
    expect(stageBus.value).toBe(1);
    const gainsBefore = f.log.gains.length;
    m.play(pack.fanfare, 4);
    expect(stageBus.value).toBe(DUCK_LEVEL);
    const fanfareBus = f.log.gains[gainsBefore]!;
    expect(fanfareBus.value).toBe(1);
    now += 10;
    const tapBusIndex = f.log.gains.length;
    m.play(pack.tap, 1);
    expect(f.log.gains[tapBusIndex]!.value).toBe(DUCK_LEVEL);
    // Everything ends: nothing stays ducked.
    now += 5000;
    vi.advanceTimersByTime(5000);
    expect(fanfareBus.value).toBe(1);
  });

  it('noise cues use the buffer source path (claps, drum roll, fireworks); tones use oscillators', () => {
    const f = fakeContext();
    const m = new SoundManager(() => f.ctx, () => now);
    m.play(pack.clapping, 4);
    expect(f.log.sources).toBe(pack.clapping.length);
    expect(f.log.oscillators).toBe(0);
    now += 3000;
    m.play(pack.fanfare, 4);
    expect(f.log.oscillators).toBe(pack.fanfare.length);
  });

  it('preloads a clip once (cached), plays it, and reports failure so the caller can fall back', async () => {
    const f = fakeContext();
    const fetchClip = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
    const m = new SoundManager(() => f.ctx, () => now, fetchClip);
    await m.preloadClip('/clip');
    await m.preloadClip('/clip');
    expect(fetchClip).toHaveBeenCalledTimes(1);
    expect(f.log.decoded).toBe(1);
    expect(await m.playClip('/clip')).toBe(true);
    const failing = new SoundManager(() => f.ctx, () => now, () => Promise.reject(new Error('404')));
    expect(await failing.playClip('/missing')).toBe(false);
    m.forgetClip('/clip');
    await m.preloadClip('/clip');
    expect(fetchClip).toHaveBeenCalledTimes(2);
  });

  it('without WebAudio nothing breaks (play returns false)', () => {
    const m = new SoundManager(() => null, () => now);
    m.unlock();
    expect(m.play(pack.tap, 1)).toBe(false);
  });

  it('mixFor: the pure mixing rule', () => {
    const v = (priority: number, until: number): Voice => ({ priority, until, setLevel: () => undefined });
    expect(mixFor([], 2, 0)).toEqual({ level: 1, duck: [] });
    const loud = v(4, 100);
    const quiet = v(1, 100);
    expect(mixFor([loud], 1, 50).level).toBe(DUCK_LEVEL);
    expect(mixFor([quiet], 3, 50).duck).toEqual([quiet]);
    expect(mixFor([loud], 1, 200).level).toBe(1); // ended voices do not count
  });

  it('every sound event has a priority; celebration and time-up are on top', () => {
    for (const e of SOUND_EVENTS) expect(SOUND_PRIORITY[e]).toBeGreaterThanOrEqual(1);
    expect(SOUND_PRIORITY.timeUp).toBe(4);
    expect(SOUND_PRIORITY.fanfare).toBeGreaterThan(SOUND_PRIORITY.tap);
  });
});

describe('sound pack generator', () => {
  it('fills every event, with a gentle gain, and stays in tune with the root', () => {
    const p = makeSoundPack({ root: 440, wave: 'sine', gain: 0.5 });
    for (const e of SOUND_EVENTS) expect(p[e].length).toBeGreaterThan(0);
    expect(Math.max(...SOUND_EVENTS.flatMap((e) => p[e].map((n) => n.gain)))).toBeLessThanOrEqual(0.3);
    expect(degree(440, 0)).toBe(440);
    expect(degree(440, 7)).toBe(880);
    expect(degree(440, 2, 'pentatonic')).toBe(554);
  });
  it('tempo stretches the cues and overrides replace single cues', () => {
    const slow = makeSoundPack({ root: 440, wave: 'sine', tempo: 0.5 });
    const fast = makeSoundPack({ root: 440, wave: 'sine', tempo: 2 });
    expect(soundLength(slow.fanfare)).toBeGreaterThan(soundLength(fast.fanfare));
    const custom = makeSoundPack({ root: 440, wave: 'sine' }, { tap: [{ freq: 300, at: 0, dur: 50, type: 'sine', gain: 0.1 }] });
    expect(custom.tap).toHaveLength(1);
    expect(custom.tap[0]!.freq).toBe(300);
  });
});

describe("time's up: voice, clip, chime, off (S13b, D-107)", () => {
  const all = { sounds: true, englishVoice: true, clip: true };
  it('plays what the class chose when the device can', () => {
    expect(planTimeUp('voice', all)).toBe('voice');
    expect(planTimeUp('clip', all)).toBe('clip');
    expect(planTimeUp('chime', all)).toBe('chime');
    expect(planTimeUp('off', all)).toBe('none');
  });
  it('falls back to the chime without an English voice or without a clip', () => {
    expect(planTimeUp('voice', { ...all, englishVoice: false })).toBe('chime');
    expect(planTimeUp('clip', { ...all, clip: false })).toBe('chime');
  });
  it('is silent when the class or the device has sounds off', () => {
    for (const s of ['voice', 'clip', 'chime', 'off'] as const) expect(planTimeUp(s, { ...all, sounds: false })).toBe('none');
  });
  it('picks an English voice: en-GB first, then en-US, then any en-*, local before network', () => {
    const v = (lang: string, localService = true, name = lang) => ({ lang, localService, name });
    expect(pickEnglishVoice([v('tr-TR'), v('de-DE')])).toBeNull();
    expect(pickEnglishVoice([v('tr-TR'), v('en-AU'), v('en-US')])!.lang).toBe('en-US');
    expect(pickEnglishVoice([v('en-US'), v('en-GB', false, 'net'), v('en-GB', true, 'local')])!.name).toBe('local');
    expect(pickEnglishVoice([v('en_IN')])!.lang).toBe('en_IN');
  });
});

describe('quote of the day (S13b item 3, D-111)', () => {
  it('has at least 120 original sayings per language, no duplicates, short enough for the top bar', () => {
    for (const list of [QUOTES_EN, QUOTES_TR]) {
      expect(list.length).toBeGreaterThanOrEqual(120);
      expect(new Set(list).size).toBe(list.length);
      for (const q of list) expect(q.length).toBeLessThanOrEqual(90);
    }
  });
  it('is deterministic per class and local date, and changes between days and classes', () => {
    expect(quoteFor('class-a', '2026-11-09', 'en')).toBe(quoteFor('class-a', '2026-11-09', 'en'));
    const week = ['09', '10', '11', '12', '13', '14', '15'].map((d) => quoteFor('class-a', `2026-11-${d}`, 'en'));
    expect(new Set(week).size).toBeGreaterThan(3);
    const classes = ['a', 'b', 'c', 'd', 'e'].map((c) => quoteFor(`class-${c}`, '2026-11-09', 'en'));
    expect(new Set(classes).size).toBeGreaterThan(1);
    expect(QUOTES_TR).toContain(quoteFor('class-a', '2026-11-09', 'tr'));
    expect(hash32('abc')).toBe(0x1a47e90b);
  });
});
