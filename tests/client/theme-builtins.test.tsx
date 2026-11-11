// @vitest-environment jsdom
/**
 * Built-in themes remade and sound styles (S17b, D-168; THM-2, THM-3, THM-5, UX-6):
 * - Explorer, Animals and Classroom carry the brief's scene, frame, ambient, sets and sound style;
 * - their scenes are tokens only and within the package scene limits (same sanitiser);
 * - sound styles: app-defined partials whose gains add up to 1, every built-in and every style passes
 *   the existing sound limits, the SoundManager plays a styled note as sines that end with the note
 *   and, rendered from what it schedules, really peak at the note's gain (so the tap of every built-in
 *   and of Snow Day is within −12..−6 dBFS at volume 80), the schema accepts the five styles only;
 * - frame shapes are drawn in CSS pixels: more motifs on a wider box, never wider ones (no stretching).
 * Fictional data only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/client/themes/index.tsx';
import { THEMES } from '../../src/client/themes/registry.ts';
import { SoundManager, type AudioContextLike } from '../../src/client/themes/soundManager.ts';
import { driftPath, FrameOverlay, scallopPath, tornPaths } from '../../src/client/ui/Frame.tsx';
import { outputPeakDb, SOUND_LIMITS } from '../../src/shared/themePackage/limits.ts';
import { ThemePackage } from '../../src/shared/themePackage/schema.ts';
import { makeSoundPack, notePartials, partialsPeak, soundPackProblems, SOUND_VOICES } from '../../src/shared/themePackage/sound.ts';
import { COLOR_TOKENS, SOUND_EVENTS, SOUND_STYLES, type ToneNote } from '../../src/shared/themePackage/tokens.ts';
import { parseSceneSvg, validateThemePackage } from '../../src/shared/themePackage/validate.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const example = (key: string) => JSON.parse(readFileSync(join(ROOT, 'docs', 'examples', `${key}.theme.json`), 'utf8')) as Record<string, any>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('built-in themes remade with the engine (S17b, D-168)', () => {
  it('each built-in theme has the scene, frame, ambient, sets and sound style the brief chose', () => {
    const want = {
      explorer: { edge: 'torn', trim: 'stitched', corners: 'compass', ambient: undefined, frame: 'shield', first: ['space', 'animals'], style: 'marimba' },
      animals: { edge: 'none', trim: 'garland', corners: 'leaf', ambient: 'leaves', frame: 'classic', first: ['animals', 'sea'], style: 'musicBox' },
      classroom: { edge: 'scallop', trim: 'pencil', corners: 'star', ambient: undefined, frame: 'star', first: ['robots', 'space'], style: 'chimes' },
    } as const;
    for (const [key, w] of Object.entries(want)) {
      const def = THEMES[key as keyof typeof THEMES];
      expect(def.scene?.layers.length, key).toBeGreaterThanOrEqual(2);
      expect(def.scene?.smallScreens, key).toBe('bottomStrip');
      expect(def.frame, key).toMatchObject({ edge: w.edge, trim: w.trim, corners: w.corners, trimOn: ['routine', 'core.timer'] });
      expect(def.ambient?.preset, key).toBe(w.ambient);
      expect(def.sets, key).toMatchObject({ achievementFrame: w.frame, avatarFamiliesFirst: w.first });
      expect(def.soundParams?.style, key).toBe(w.style);
      for (const e of SOUND_EVENTS) for (const n of def.sounds![e]) expect(n.voice, `${key} ${e}`).toBe(n.type === 'noise' ? undefined : w.style);
    }
    expect(THEMES.animals.ambient).toMatchObject({ speed: 'slow' });
  });

  it('built-in scenes use colour tokens only and stay within the package scene limits', () => {
    for (const def of Object.values(THEMES)) {
      for (const [i, layer] of def.scene!.layers.entries()) {
        const markup = renderToStaticMarkup(createElement(layer.Art));
        expect(markup, `${def.key} layer ${i}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsl/iu);
        for (const m of markup.matchAll(/var\(--cc-([a-z0-9-]+)\)/gu)) expect(COLOR_TOKENS, `${def.key}: ${m[1]}`).toContain(m[1]);
        // The same sanitiser and limits as a package's scene (60 KB, 1,500 elements per layer).
        const parsed = parseSceneSvg(markup);
        expect(parsed.ok, `${def.key} layer ${i}: ${JSON.stringify(parsed)}`).toBe(true);
        expect(layer.viewBox).toBe('0 0 1920 1080');
      }
    }
  });

  it('the generated example packages carry the frame, ambient, sets and sound style (and stay valid)', () => {
    for (const key of Object.keys(THEMES)) {
      const pkg = example(key);
      expect(pkg.frame, key).toBeDefined();
      expect(pkg.sets, key).toBeDefined();
      expect(pkg.scene, key).toBeUndefined(); // a built-in scene is code; export leaves it out
      expect(validateThemePackage(pkg).report.errors, key).toEqual([]);
    }
    expect(example('animals').ambient).toMatchObject({ preset: 'leaves', speed: 'slow' });
    const snow = example('peppermint-snow-day');
    expect(snow.sounds.style).toBe('bells');
    expect(validateThemePackage(snow).report.errors).toEqual([]);
  });
});

describe('sound styles (S17b, D-168)', () => {
  it('every style is app-defined: partial gains add up to 1, decays inside the note, the fundamental first', () => {
    expect(SOUND_STYLES).toEqual(['tones', 'bells', 'marimba', 'chimes', 'musicBox']);
    for (const [style, v] of Object.entries(SOUND_VOICES)) {
      expect(v.partials.reduce((s, p) => s + p.gain, 0), style).toBeCloseTo(1, 9);
      expect(v.partials[0]!.ratio, style).toBe(1);
      for (const p of v.partials) {
        expect(p.decay, style).toBeGreaterThan(0);
        expect(p.decay, style).toBeLessThanOrEqual(1);
        expect(p.ratio, style).toBeGreaterThanOrEqual(1);
      }
      expect(v.attackMs, style).toBeLessThanOrEqual(10);
    }
  });

  it('a style voices every tone note (overrides too) and leaves noise alone; every limit still holds', () => {
    const opts = { root: 523, wave: 'triangle' as const, gain: 0.11 };
    const override = { timeUp: [{ freq: 660, at: 0, dur: 900, type: 'sine' as const, gain: 0.15 }] };
    expect(makeSoundPack(opts).tap[0]!.voice).toBeUndefined();
    for (const style of SOUND_STYLES) {
      const pack = makeSoundPack({ ...opts, style }, override);
      expect(soundPackProblems(pack), style).toEqual([]);
      expect(pack.timeUp[0]!.voice, style).toBe(style === 'tones' ? undefined : style);
      expect(pack.clapping.every((n) => n.voice === undefined), style).toBe(true);
      // The same timing and gains as plain tones: only the voice differs.
      const plain = makeSoundPack(opts, override);
      const unvoiced = (n: ToneNote) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'voice'));
      for (const e of SOUND_EVENTS) expect(pack[e].map(unvoiced), `${style} ${e}`).toEqual(plain[e]);
    }
  });

  it('partials keep their shares, peak together at the note gain and leave out overtones above the partial limit', () => {
    const low: ToneNote = { freq: 300, at: 0, dur: 400, type: 'sine', gain: 0.2, voice: 'marimba' };
    const parts = notePartials(low);
    expect(parts.map((p) => p.freq)).toEqual([300, 1200, 3000]);
    // The shares stay in proportion; one scale makes up for partials that never line up (S17b review).
    const sum = parts.reduce((s, p) => s + p.gain, 0);
    expect(sum).toBeGreaterThanOrEqual(0.2);
    for (const [i, p] of parts.entries()) expect(p.gain / sum).toBeCloseTo(SOUND_VOICES.marimba.partials[i]!.gain, 9);
    expect(partialsPeak(parts, low.dur)).toBeCloseTo(0.2, 3);
    const high = notePartials({ ...low, freq: 2000 });
    expect(high.every((p) => p.freq <= SOUND_LIMITS.partialMaxHz)).toBe(true);
    expect(partialsPeak(high, low.dur)).toBeCloseTo(0.2, 3);
    expect(notePartials({ ...low, voice: undefined })).toHaveLength(1);
    expect(notePartials({ freq: 2000, at: 0, dur: 50, type: 'noise', gain: 0.1, voice: 'bells' })).toHaveLength(1);
    // A glide moves every partial.
    expect(notePartials({ ...low, to: 400, voice: 'bells' })[1]).toMatchObject({ freq: 600, to: 800 });
  });

  it('the package schema accepts the five styles (optional) and refuses any other', () => {
    const base = example('ocean');
    expect(ThemePackage.safeParse(base).success).toBe(true);
    for (const style of SOUND_STYLES) expect(ThemePackage.safeParse({ ...base, sounds: { ...base.sounds, style } }).success, style).toBe(true);
    for (const style of ['kazoo', 'Bells', '', 3]) expect(ThemePackage.safeParse({ ...base, sounds: { ...base.sounds, style } }).success, String(style)).toBe(false);
    // A style inside a hand-made note is not package data.
    const note = { freq: 660, at: 0, dur: 300, type: 'sine', gain: 0.1, voice: 'bells' };
    expect(ThemePackage.safeParse({ ...base, sounds: { ...base.sounds, overrides: { timeUp: [note] } } }).success).toBe(false);
  });

  /*
   * A fake AudioContext that records what the real SoundManager schedules (gain envelopes, oscillator
   * frequencies, connections, start and stop), and an independent renderer of that schedule with the
   * Web Audio rules (exponential ramps between events, sines from phase 0) at 48 kHz: the tests hear
   * what the browser plays before the master chain, not what the loudness model assumes (S17b review).
   */
  type Ev = { kind: 'set' | 'exp'; v: number; t: number };
  type Param = { value: number; events: Ev[] };
  type Osc = { type: string; frequency: Param; target: unknown; start: number; stop: number };
  function recordingContext() {
    const gains: Array<{ gain: Param }> = [];
    const oscs: Osc[] = [];
    const param = (value: number) => {
      const events: Ev[] = [];
      return {
        value,
        events,
        setValueAtTime: (v: number, t: number) => void events.push({ kind: 'set', v, t }),
        exponentialRampToValueAtTime: (v: number, t: number) => void events.push({ kind: 'exp', v, t }),
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
      };
    };
    const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });
    const ctx = {
      currentTime: 0,
      sampleRate: 48000,
      state: 'running',
      destination: {},
      resume: () => Promise.resolve(),
      createGain: () => {
        const g = { ...node(), gain: param(1) };
        gains.push(g);
        return g;
      },
      createOscillator: () => {
        const rec: Osc = { type: 'sine', frequency: param(440), target: null, start: 0, stop: 0 };
        oscs.push(rec);
        return {
          ...node(),
          get type() {
            return rec.type;
          },
          set type(v: string) {
            rec.type = v;
          },
          frequency: rec.frequency,
          connect: (n: unknown) => ((rec.target = n), n),
          start: (t: number) => void (rec.start = t),
          stop: (t: number) => void (rec.stop = t),
        };
      },
      createBiquadFilter: () => ({ ...node(), frequency: param(1), Q: param(1) }),
      createDynamicsCompressor: () => ({ ...node(), threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
      createBuffer: (_c: number, len: number) => ({ duration: len / 48000, getChannelData: () => new Float32Array(len) }),
      createBufferSource: () => ({ ...node(), buffer: null, start: () => undefined, stop: () => undefined }),
      decodeAudioData: () => Promise.resolve({ duration: 1 }),
    } as unknown as AudioContextLike;
    return { ctx, gains, oscs };
  }
  /** A Web Audio parameter's value at time t from its recorded events. */
  function valueAt(p: Param, t: number): number {
    let v = p.value;
    let t0 = 0;
    for (const e of p.events) {
      if (e.t <= t) {
        v = e.v;
        t0 = e.t;
        continue;
      }
      if (e.kind === 'exp') return v * (e.v / v) ** ((t - t0) / (e.t - t0));
      break;
    }
    return v;
  }
  /** The peak of the sum of every recorded sine through its own gain (before the master chain). */
  function renderPeak(rec: ReturnType<typeof recordingContext>): number {
    const voices = rec.oscs.map((o) => ({ o, g: (o.target as { gain: Param }).gain }));
    const from = Math.min(...rec.oscs.map((o) => o.start));
    const to = Math.max(...rec.oscs.map((o) => o.stop));
    const phase = voices.map(() => 0);
    let peak = 0;
    for (let i = 0; from + i / 48000 <= to; i++) {
      const t = from + i / 48000;
      let sum = 0;
      voices.forEach(({ o, g }, k) => {
        if (t < o.start || t > o.stop) return;
        sum += valueAt(g, t) * Math.sin(phase[k]!);
        phase[k] = phase[k]! + (2 * Math.PI * valueAt(o.frequency, t)) / 48000;
      });
      peak = Math.max(peak, Math.abs(sum));
    }
    return peak;
  }
  function playAndRender(spec: readonly ToneNote[]) {
    const rec = recordingContext();
    vi.useFakeTimers();
    try {
      const m = new SoundManager(() => rec.ctx, () => 5_000_000);
      expect(m.play([...spec], 2)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    return rec;
  }
  const dB = (x: number) => 20 * Math.log10(x);

  it('the SoundManager plays a styled note as sines that end with the note and really peak at its gain', () => {
    const note: ToneNote = { freq: 523, at: 0, dur: 500, type: 'triangle', gain: 0.12, voice: 'bells' };
    const rec = playAndRender([note]);
    const voice = SOUND_VOICES.bells;
    expect(rec.oscs).toHaveLength(voice.partials.length);
    expect(rec.oscs.every((o) => o.type === 'sine')).toBe(true);
    expect(rec.oscs.map((o) => Math.round(o.frequency.events[0]!.v))).toEqual(voice.partials.map((p) => Math.round(523 * p.ratio)));
    const start = Math.min(...rec.oscs.map((o) => o.start));
    for (const o of rec.oscs) expect(o.stop).toBeLessThanOrEqual(start + 0.5 + 0.02 + 1e-9);
    expect(Math.abs(dB(renderPeak(rec) / 0.12))).toBeLessThan(0.2);
  });

  it('every style peaks at the note gain, as the loudness model assumes (S17b review: 1 to 3 dB under before)', () => {
    const notes: Array<[number, number, number | undefined]> = [
      [523, 70, undefined],
      [784, 140, undefined],
      [659, 160, 523],
      [392, 600, undefined],
    ];
    for (const style of SOUND_STYLES) {
      for (const [freq, dur, to] of notes) {
        const note: ToneNote = { freq, at: 0, dur, type: 'sine', gain: 0.1, voice: style, ...(to === undefined ? {} : { to }) };
        const off = dB(renderPeak(playAndRender([note])) / 0.1);
        // Plain tones keep their 30 ms attack (unchanged since S13b), which shaves very short notes a little.
        expect(off, `${style} ${freq} Hz ${dur} ms`).toBeGreaterThan(style === 'tones' ? -0.6 : -0.2);
        expect(off, `${style} ${freq} Hz ${dur} ms`).toBeLessThan(0.2);
      }
    }
  });

  it('the tap of every built-in theme and of Snow Day, as played, peaks between −12 and −6 dBFS at volume 80', () => {
    const snow = example('peppermint-snow-day');
    const { overrides, ...params } = snow.sounds;
    const taps: Array<[string, readonly ToneNote[]]> = [...Object.values(THEMES).map((d) => [d.key, d.sounds!.tap] as [string, readonly ToneNote[]]), ['peppermint-snow-day', makeSoundPack(params, overrides ?? {}).tap]];
    const [lo, hi] = SOUND_LIMITS.tapPeakDbAt80;
    for (const [key, tap] of taps) {
      const out = outputPeakDb(renderPeak(playAndRender(tap)), 80);
      expect(out, key).toBeGreaterThanOrEqual(lo);
      expect(out, key).toBeLessThanOrEqual(hi);
    }
  });
});

describe('frame shapes in CSS pixels (S17b engine polish)', () => {
  const bumps = (d: string) => (d.match(/ C/gu) ?? []).length - 2;
  it('a wider drift gets more bumps of about the same width, not wider ones', () => {
    for (const w of [160, 400, 900, 1536, 1800]) {
      const n = bumps(driftPath(w, 30, 46));
      const end = Math.min(30 * 0.55, w / 5);
      const width = (w - 2 * end) / n;
      expect(width, `${w}`).toBeGreaterThan(30);
      expect(width, `${w}`).toBeLessThan(70);
    }
    expect(bumps(driftPath(1800, 30, 46))).toBeGreaterThan(30);
    // Everything stays inside the box.
    for (const m of driftPath(1234, 30, 46).matchAll(/(-?[\d.]+) (-?[\d.]+)/gu)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1])).toBeLessThanOrEqual(1234);
      expect(Number(m[2])).toBeGreaterThanOrEqual(-12);
      expect(Number(m[2])).toBeLessThanOrEqual(30);
    }
  });

  it('scallops and torn teeth keep their size on any width', () => {
    for (const w of [120, 700, 1800]) {
      const arcs = (scallopPath(w, 12).match(/ a/gu) ?? []).length;
      expect(w / arcs).toBeGreaterThan(13);
      expect(w / arcs).toBeLessThan(27);
      const teeth = (tornPaths(w, 12).line.match(/ L/gu) ?? []).length;
      expect(w / teeth).toBeGreaterThan(9);
      expect(w / teeth).toBeLessThan(19);
    }
  });

  it('an edge measures its box: its viewBox is its size in CSS pixels', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1234, height: 30, top: 0, left: 0, right: 1234, bottom: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    for (const [theme, cls] of [
      ['classroom', '.cc-frame__edge--scallop'],
      ['explorer', '.cc-frame__edge--torn'],
      ['animals', '.cc-frame__swag'],
      ['classroom', '.cc-frame__pencil'],
    ] as const) {
      const { container, unmount } = render(createElement(ThemeProvider, { theme, children: createElement('div', { className: 'cc-lesson-box' }, createElement(FrameOverlay, { surface: 'boardBoxes', boxKey: 'routine' })) }));
      const svg = container.querySelector<SVGSVGElement>(`svg${cls}`)!;
      expect(svg, `${theme} ${cls}`).not.toBeNull();
      expect(svg.getAttribute('viewBox'), `${theme} ${cls}`).toBe('0 0 1234 30');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/iu);
      unmount();
    }
  });
});
