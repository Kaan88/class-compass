/**
 * The loudness model against the real chain (S21a, D-173; THM-5, D-145): the SoundManager's own code
 * runs in Chromium on an OfflineAudioContext, so every cue goes through the browser's real
 * DynamicsCompressor, makeup gain and soft ceiling, and the rendered samples are compared with
 * `outputPeakDb`. Every event of every built-in theme, of the Snow Day example and of every sound style
 * at volume 80 and 100:
 * - a tap, on a chain built for it (the first sound of a page) and on a settled one, peaks within
 *   0.35 dB of the model (a very short tap under it) and between −12 and −6 dBFS (the S17b review
 *   measured 7 dB under on a new chain);
 * - no cue plays more than 0.75 dB over the model (the compressor's attack on the threshold);
 * - nothing reaches the ceiling (−1 dBFS), not even the loudest packs the parameters allow or chords of
 *   notes at the gain cap.
 * The modules are served from the repository with their types stripped (node:module), so the test
 * plays exactly the code the client bundles. The numbers are attached to the report. No server data.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, normalize, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { THEME_LIST } from '../src/client/themes/registry.ts';
import { SOUND_PRIORITY } from '../src/client/themes/soundManager.ts';
import { LOUDNESS, outputPeakDb, SOUND_LIMITS } from '../src/shared/themePackage/limits.ts';
import { loudestMoment, makeSoundPack, soundPackProblems } from '../src/shared/themePackage/sound.ts';
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
    (window as unknown as { renderCue: unknown }).renderCue = async (spec: unknown[], priority: number, volume: number, settleFirst: boolean, offsetMs: number) => {
      const rate = 48000;
      const notes = spec as Array<{ at: number; dur: number }>;
      const ms = Math.max(...notes.map((n) => n.at + n.dur)) + offsetMs + spare;
      const ctx = new OfflineAudioContext(1, Math.ceil((rate * ms) / 1000), rate);
      const m = new mod.SoundManager(() => ctx as never, () => 0, undefined, () => true);
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

const render = (page: Page, spec: SoundSpec, priority: number, volume: number, settled = true, offsetMs = 0) =>
  page.evaluate(([s, p, v, f, o]) => (window as unknown as { renderCue: (...a: unknown[]) => Promise<number> }).renderCue(s, p, v, f, o), [spec, priority, volume, settled, offsetMs] as const);

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
  test.setTimeout(240_000);

  test('every cue of every theme and style plays as the model says, and never reaches the ceiling', async ({ page }, info) => {
    await openRenderer(page);
    const rows: string[] = ['pack | event | volume | model dBFS | rendered dBFS | difference'];
    let worstOver = -Infinity;
    for (const [name, pack] of PACKS) {
      expect(soundPackProblems(pack), name).toEqual([]);
      for (const event of SOUND_EVENTS) {
        const spec = pack[event];
        for (const volume of [80, 100]) {
          const model = outputPeakDb(loudestMoment(spec), volume);
          // Two start offsets a fraction of a sample apart: the samples land on different points of the wave.
          const out = Math.max(await render(page, spec, SOUND_PRIORITY[event as SoundEvent], volume), await render(page, spec, SOUND_PRIORITY[event as SoundEvent], volume, true, 0.0071));
          rows.push(`${name} | ${event} | ${volume} | ${model.toFixed(2)} | ${out.toFixed(2)} | ${(out - model).toFixed(2)}`);
          worstOver = Math.max(worstOver, out - model);
          expect(out, `${name} ${event} at ${volume}: ${out.toFixed(2)} vs model ${model.toFixed(2)}`).toBeLessThanOrEqual(model + 0.75);
          expect(out, `${name} ${event} at ${volume}`).toBeLessThan(LOUDNESS.ceilingDb);
        }
      }
    }
    rows.push(`worst over the model: ${worstOver.toFixed(2)} dB`);
    await info.attach('rendered-loudness.txt', { body: rows.join('\n'), contentType: 'text/plain' });
  });

  test('a tap is as loud as the model on a new chain: within 0.35 dB and between −12 and −6 dBFS at volume 80', async ({ page }, info) => {
    await openRenderer(page);
    const rows: string[] = [];
    const [lo, hi] = SOUND_LIMITS.tapPeakDbAt80;
    for (const [name, pack] of PACKS) {
      const model = outputPeakDb(loudestMoment(pack.tap), 80);
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

  test('the loudest packs and chords at the gain cap stay under the ceiling at volume 100', async ({ page }) => {
    await openRenderer(page);
    for (const style of SOUND_STYLES) {
      const pack = makeSoundPack({ root: 523, wave: 'sine', style, gain: 0.2 });
      for (const event of ['fanfare', 'timeUp', 'soundTest', 'tap'] as const) {
        const out = await render(page, pack[event], SOUND_PRIORITY[event], 100);
        expect(out, `${style} gain 0.2 ${event}`).toBeLessThan(LOUDNESS.ceilingDb);
      }
    }
    for (const voice of [undefined, 'musicBox', 'bells'] as const) {
      for (const count of [3, 5, 10]) {
        const chord: SoundSpec = Array.from({ length: count }, (_, i) => ({ freq: [392, 440, 523, 587, 659, 698, 784, 880, 1046, 1318][i]!, at: 0, dur: 400, type: 'sine' as const, gain: SOUND_LIMITS.noteGainCap, ...(voice ? { voice } : {}) }));
        const out = await render(page, chord, 4, 100, false);
        expect(out, `${voice ?? 'plain'} chord of ${count}`).toBeLessThan(LOUDNESS.ceilingDb);
      }
    }
  });
});
