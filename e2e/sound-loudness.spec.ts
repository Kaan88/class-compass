/**
 * The loudness model against the real chain (S21a, D-173; THM-5, D-145): the SoundManager's own code
 * runs in Chromium on an OfflineAudioContext, so every cue goes through the browser's real
 * DynamicsCompressor, makeup gain and soft ceiling, and the rendered samples are compared with the
 * model `outputPeakDb(playedPeak(cue), volume)`. Every event of every built-in theme, of the Snow Day
 * example and of every sound style at volume 80 and 100 (S21a review: both sides of the model):
 * - a tap, on a chain built for it (the first sound of a page) and on a settled one, peaks within
 *   0.35 dB of the model (a very short tap under it) and between −12 and −6 dBFS (the S17b review
 *   measured 7 dB under on a new chain);
 * - no cue plays more than 0.75 dB over the model (the compressor's attack on the threshold) or more
 *   than `UNDER` dB under it (tone cues 1.6 dB, cues with noise 0.5 dB): a cue that drifts quieter is
 *   caught too;
 * - the same cues rendered without the soft ceiling (the signal before it) stay within 0.75 dB over
 *   `compressedPeakDb(playedPeak(cue))` and under 0 dBFS, so the ceiling is not what keeps them in line;
 * - the loudest packs the parameters allow (gain 0.2, volume 100): before the ceiling at most 1.25 dB
 *   over the model and under 0 dBFS; they sit a little into the ceiling's knee (−3 dBFS), which bends
 *   them exactly by `softCeiling`; chords of notes at the gain cap go over 0 dBFS before the ceiling
 *   and come out bent by `softCeiling`, under −1 dBFS.
 * The modules are served from the repository with their types stripped (node:module), so the test
 * plays exactly the code the client bundles. The numbers are attached to the report. No server data.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, normalize, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { THEME_LIST } from '../src/client/themes/registry.ts';
import { SOUND_PRIORITY } from '../src/client/themes/soundManager.ts';
import { compressedPeakDb, LOUDNESS, outputPeakDb, softCeiling, SOUND_LIMITS } from '../src/shared/themePackage/limits.ts';
import { makeSoundPack, playedPeak, soundPackProblems } from '../src/shared/themePackage/sound.ts';
import { SOUND_EVENTS, SOUND_STYLES, type SoundEvent, type SoundSpec, type ThemeSoundPack } from '../src/shared/themePackage/tokens.ts';

const ROOT = join(import.meta.dirname, '..');
const ORIGIN = 'http://sound-render.test';

/** Serves the page and the repository's TypeScript modules (types stripped) on a made-up origin. */
async function openRenderer(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>render</title>' });
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(join(ROOT, 'src') + sep) || !file.endsWith('.ts')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/javascript', body: stripTypeScriptTypes(readFileSync(file, 'utf8')) });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async () => {
    const url = '/src/client/themes/soundManager.ts';
    const mod = (await import(url)) as typeof import('../src/client/themes/soundManager.ts');
    // Room for the settle time of a new chain, the lead of a settled one and the compressor's release.
    const spare = mod.LOUDNESS.settleMs + 600 + 500;
    (window as unknown as { renderCue: unknown }).renderCue = async (spec: unknown[], priority: number, volume: number, settleFirst: boolean, offsetMs: number, ceiling: boolean) => {
      const rate = 48000;
      const notes = spec as Array<{ at: number; dur: number }>;
      const ms = Math.max(...notes.map((n) => n.at + n.dur)) + offsetMs + spare;
      const ctx = new OfflineAudioContext(1, Math.ceil((rate * ms) / 1000), rate);
      // Without the ceiling: the same context without `createWaveShaper`, so the SoundManager connects
      // the makeup gain straight to the speakers and the samples are the signal before the ceiling.
      const target = ctx as unknown as Record<string | symbol, unknown>;
      const bare = new Proxy(target, {
        get: (t, k) => (k === 'createWaveShaper' ? undefined : typeof t[k] === 'function' ? (t[k] as (...a: unknown[]) => unknown).bind(t) : t[k]),
        set: (t, k, v) => {
          t[k] = v;
          return true;
        },
      });
      const m = new mod.SoundManager(() => (ceiling ? ctx : bare) as never, () => 0, undefined, () => true);
      m.setVolume(volume);
      // A chain that has run for a while (`settleFirst`), or the very first sound of a new chain.
      const lead = settleFirst ? 600 : 0;
      m.play(notes.map((n) => ({ ...n, at: n.at + lead + offsetMs })) as never, priority, null);
      const data = (await ctx.startRendering()).getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
      return 20 * Math.log10(peak);
    };
  });
}

const render = (page: Page, spec: SoundSpec, priority: number, volume: number, settled = true, offsetMs = 0, ceiling = true) =>
  page.evaluate(([s, p, v, f, o, c]) => (window as unknown as { renderCue: (...a: unknown[]) => Promise<number> }).renderCue(s, p, v, f, o, c), [spec, priority, volume, settled, offsetMs, ceiling] as const);

/** The louder of two renders a fraction of a sample apart: the samples land on different points of the wave. */
const renderPeak = async (page: Page, spec: SoundSpec, priority: number, volume: number, ceiling = true) =>
  Math.max(await render(page, spec, priority, volume, true, 0, ceiling), await render(page, spec, priority, volume, true, 0.0071, ceiling));

/** Over the model: the compressor's attack on the threshold (D-173; 0.65 dB measured). */
const OVER = 0.75;
/** Over the model for the loudest packs the parameters allow, at volume 100 (1.0 dB measured). */
const LOUD_OVER = 1.25;
/**
 * Under the model: tone cues 1.6 dB (a 44 ms square tap's attack shaves 1.4 dB; notes whose tails
 * overlap reach the sum of their levels only where the waves line up); cues with noise 0.5 dB (the
 * model plays the noise samples themselves: 0.1 dB measured).
 */
const UNDER = (spec: SoundSpec) => (spec.some((n) => n.type === 'noise') ? 0.5 : 1.6);

const snow = JSON.parse(readFileSync(join(ROOT, 'docs', 'examples', 'peppermint-snow-day.theme.json'), 'utf8')) as { sounds: Parameters<typeof makeSoundPack>[0] & { overrides?: Partial<ThemeSoundPack> } };
const { overrides: snowOverrides, ...snowParams } = snow.sounds;

/** The packs a class can hear: the built-in themes, the Snow Day example and every style. */
const PACKS: Array<[string, ThemeSoundPack]> = [
  ...THEME_LIST.map((t): [string, ThemeSoundPack] => [t.key, t.sounds!]),
  ['peppermint-snow-day', makeSoundPack(snowParams, snowOverrides ?? {})],
  ...SOUND_STYLES.map((style): [string, ThemeSoundPack] => [`${style} (sine, gain 0.1)`, makeSoundPack({ root: 523, wave: 'sine', style, gain: 0.1 })]),
  ['tones (square, low root, gain 0.12)', makeSoundPack({ root: 160, wave: 'square', gain: 0.12, tempo: 1.6 })],
];

test.describe('loudness model against the rendered chain (D-173)', () => {
  test.setTimeout(300_000);

  test('every cue of every theme and style plays as the model says, before and after the ceiling', async ({ page }, info) => {
    await openRenderer(page);
    const rows: string[] = ['pack | event | volume | model dBFS | rendered dBFS | difference | before the ceiling: model | rendered'];
    let worstOver = -Infinity;
    let worstUnder = Infinity;
    for (const [name, pack] of PACKS) {
      expect(soundPackProblems(pack), name).toEqual([]);
      for (const event of SOUND_EVENTS) {
        const spec = pack[event];
        const priority = SOUND_PRIORITY[event as SoundEvent];
        for (const volume of [80, 100]) {
          const peak = playedPeak(spec);
          const model = outputPeakDb(peak, volume);
          const out = await renderPeak(page, spec, priority, volume);
          const preModel = compressedPeakDb(peak, volume);
          const pre = await renderPeak(page, spec, priority, volume, false);
          rows.push(`${name} | ${event} | ${volume} | ${model.toFixed(2)} | ${out.toFixed(2)} | ${(out - model).toFixed(2)} | ${preModel.toFixed(2)} | ${pre.toFixed(2)}`);
          worstOver = Math.max(worstOver, out - model);
          worstUnder = Math.min(worstUnder, out - model);
          const what = `${name} ${event} at ${volume}: ${out.toFixed(2)} vs model ${model.toFixed(2)}`;
          expect(out, what).toBeLessThanOrEqual(model + OVER);
          expect(out, what).toBeGreaterThanOrEqual(model - UNDER(spec));
          expect(pre, `${what}, before the ceiling ${pre.toFixed(2)} vs ${preModel.toFixed(2)}`).toBeLessThanOrEqual(preModel + OVER);
          expect(pre, `${what}, before the ceiling`).toBeLessThan(0);
        }
      }
    }
    rows.push(`worst over the model: ${worstOver.toFixed(2)} dB, worst under: ${(-worstUnder).toFixed(2)} dB`);
    await info.attach('rendered-loudness.txt', { body: rows.join('\n'), contentType: 'text/plain' });
  });

  test('a tap is as loud as the model on a new chain: within 0.35 dB and between −12 and −6 dBFS at volume 80', async ({ page }, info) => {
    await openRenderer(page);
    const rows: string[] = [];
    const [lo, hi] = SOUND_LIMITS.tapPeakDbAt80;
    for (const [name, pack] of PACKS) {
      const model = outputPeakDb(playedPeak(pack.tap), 80);
      const first = await render(page, pack.tap, SOUND_PRIORITY.tap, 80, false);
      const later = await render(page, pack.tap, SOUND_PRIORITY.tap, 80, true);
      rows.push(`${name}: model ${model.toFixed(2)}, first sound ${first.toFixed(2)}, settled ${later.toFixed(2)}`);
      // The fast square tap is 44 ms long: its attack (a quarter of the note) shaves the peak, so the
      // model is an upper bound there (about 1.4 dB over); every other tap is 70 ms or longer.
      const under = name.startsWith('tones (square') ? 1.6 : 0.35;
      for (const out of [first, later]) {
        expect(out, `${name}: ${out.toFixed(2)} vs ${model.toFixed(2)}`).toBeLessThanOrEqual(model + 0.35);
        expect(out, `${name}: ${out.toFixed(2)} vs ${model.toFixed(2)}`).toBeGreaterThanOrEqual(model - under);
        expect(out, name).toBeGreaterThanOrEqual(lo);
        expect(out, name).toBeLessThanOrEqual(hi);
      }
    }
    await info.attach('rendered-taps.txt', { body: rows.join('\n'), contentType: 'text/plain' });
  });

  test('the loudest packs and chords at the gain cap: as the model says before the ceiling, bent by it after', async ({ page }, info) => {
    await openRenderer(page);
    const rows: string[] = ['case | before the ceiling: model | rendered | after: softCeiling(rendered) | rendered'];
    /** The ceiling is a fixed curve: what comes out is `softCeiling` of what went in (curve interpolation: 0.1 dB). */
    const check = (what: string, pre: number, out: number) => {
      const bent = 20 * Math.log10(softCeiling(10 ** (pre / 20)));
      expect(Math.abs(out - bent), `${what}: ${out.toFixed(2)} vs softCeiling ${bent.toFixed(2)}`).toBeLessThanOrEqual(0.1);
      expect(out, what).toBeLessThan(LOUDNESS.ceilingDb);
      return bent;
    };
    for (const style of SOUND_STYLES) {
      const pack = makeSoundPack({ root: 523, wave: 'sine', style, gain: 0.2 });
      // Its taps are too loud for a class (the validator says so); every cue passes the clip check.
      expect(soundPackProblems(pack).filter((p) => p.kind === 'clips'), style).toEqual([]);
      for (const event of ['fanfare', 'timeUp', 'secretDrumroll', 'lessonStart', 'soundTest', 'tap'] as const) {
        const spec = pack[event];
        const preModel = compressedPeakDb(playedPeak(spec), 100);
        const pre = await renderPeak(page, spec, SOUND_PRIORITY[event], 100, false);
        const out = await renderPeak(page, spec, SOUND_PRIORITY[event], 100);
        const what = `${style} gain 0.2 ${event}`;
        // A valid pack is in line with the model before the ceiling, and under 0 dBFS there.
        expect(pre, `${what}: ${pre.toFixed(2)} vs ${preModel.toFixed(2)}`).toBeLessThanOrEqual(preModel + LOUD_OVER);
        expect(pre, what).toBeLessThan(0);
        rows.push(`${what} | ${preModel.toFixed(2)} | ${pre.toFixed(2)} | ${check(what, pre, out).toFixed(2)} | ${out.toFixed(2)}`);
      }
    }
    for (const voice of [undefined, 'musicBox', 'bells'] as const) {
      for (const count of [3, 5, 10]) {
        const chord: SoundSpec = Array.from({ length: count }, (_, i) => ({ freq: [392, 440, 523, 587, 659, 698, 784, 880, 1046, 1318][i]!, at: 0, dur: 400, type: 'sine' as const, gain: SOUND_LIMITS.noteGainCap, ...(voice ? { voice } : {}) }));
        const what = `${voice ?? 'plain'} chord of ${count} at the gain cap`;
        const pre = await render(page, chord, 4, 100, false, 0, false);
        const out = await render(page, chord, 4, 100, false);
        rows.push(`${what} | ${compressedPeakDb(playedPeak(chord), 100).toFixed(2)} | ${pre.toFixed(2)} | ${check(what, pre, out).toFixed(2)} | ${out.toFixed(2)}`);
      }
    }
    await info.attach('rendered-ceiling.txt', { body: rows.join('\n'), contentType: 'text/plain' });
  });
});
