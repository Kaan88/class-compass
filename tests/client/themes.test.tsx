/**
 * Theme registry (SX, D-070): every registered theme fills every slot, passes the WCAG contrast pairs
 * (AA body text, AAA for classroom text on page and cards, 3:1 for UI), keeps motion gentle and
 * one-shot with an opacity-only reduced variant, keeps sounds short and quiet, and is translated.
 * These tests iterate the registry, so a new theme is checked without editing them.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AAA, contrast, contrastFailures } from '../../src/client/themes/contrast.ts';
import { allThemesCss, animationName } from '../../src/client/themes/css.ts';
import { THEME_LIST, THEMES } from '../../src/client/themes/registry.ts';
import { soundLength } from '../../src/client/themes/sound.ts';
import { NOTE_GAIN_CAP, outputPeakDb } from '../../src/client/themes/soundManager.ts';
import { ART_LIMITS, MOTION_LIMITS, SOUND_LIMITS, STYLE_LIMITS } from '../../src/shared/themePackage/limits.ts';
import { opacityTurns } from '../../src/shared/themePackage/motion.ts';
import { soundPackProblems } from '../../src/shared/themePackage/sound.ts';
import { ILLUSTRATIONS, MASCOT_POSES, MOTIONS, SOUND_EVENTS } from '../../src/client/themes/types.ts';
import { en, tr } from '../messages.ts';
import { DEFAULT_THEME, THEME_KEYS, isThemeKey } from '../../src/shared/themes.ts';
import { Theme } from '../../src/shared/contracts/school.ts';

const THEMES_DIR = join(import.meta.dirname, '..', '..', 'src', 'client', 'themes');
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b(?![^"]*\))|\b(?:rgba?|hsla?)\(/;
const svg = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement('svg', null, el));

describe('theme registry', () => {
  it('registers exactly the shared theme keys, in order, each under its own key and folder', () => {
    expect(THEME_LIST.map((d) => d.key)).toEqual([...THEME_KEYS]);
    for (const k of THEME_KEYS) {
      expect(THEMES[k].key).toBe(k);
      for (const f of ['index.ts', 'tokens.ts', 'art.tsx']) expect(existsSync(join(THEMES_DIR, k, f)), `${k}/${f}`).toBe(true);
    }
    expect(isThemeKey(DEFAULT_THEME)).toBe(true);
  });

  it('classes.theme accepts every built-in key and theme slugs only (S14g, D-158: usability is checked by the server)', () => {
    for (const k of THEME_KEYS) expect(Theme.safeParse(k).success).toBe(true);
    expect(Theme.safeParse('ocean').success).toBe(true);
    for (const bad of ['Neon', 'a', 'x--y', "x'] {", 'neon;', '-neon', 'a'.repeat(33)]) expect(Theme.safeParse(bad).success, bad).toBe(false);
  });

  it('every theme name, description and mascot name exists in en and tr', () => {
    for (const d of THEME_LIST) {
      for (const k of [d.labelKey, d.descriptionKey, d.mascotNameKey]) {
        expect(en[k as keyof typeof en], `en ${k}`).toBeTruthy();
        expect(tr[k as keyof typeof tr], `tr ${k}`).toBeTruthy();
      }
    }
  });
});

describe.each(THEME_LIST.map((d) => [d.key, d] as const))('theme %s', (_key, def) => {
  it('passes every WCAG contrast pair (AA body text, AAA classroom text, 3:1 UI) and the avatar hue sweep', () => {
    expect(contrastFailures(def.colors, def.avatar)).toEqual([]);
    expect(contrast(def.colors.text, def.colors.bg)).toBeGreaterThanOrEqual(AAA);
  });

  it('fills every illustration and mascot pose with token-coloured SVG; poses are distinct', () => {
    for (const name of ILLUSTRATIONS) {
      const html = svg(createElement(def.illustrations[name]));
      expect(html.length, name).toBeGreaterThan(30);
      expect(RAW_COLOUR.test(html), `${name} uses a raw colour`).toBe(false);
    }
    const poses = MASCOT_POSES.map((pose) => svg(createElement(def.Mascot, { pose })));
    for (const html of poses) expect(RAW_COLOUR.test(html)).toBe(false);
    expect(new Set(poses).size).toBe(MASCOT_POSES.length);
    for (const C of [def.Decoration, def.Pattern]) expect(RAW_COLOUR.test(svg(createElement(C)))).toBe(false);
    expect(def.patternSize).toBeGreaterThan(0);
    expect(def.decoOpacity).toBeLessThanOrEqual(ART_LIMITS.decoOpacityMax);
    expect(def.patternOpacity).toBeLessThanOrEqual(ART_LIMITS.patternOpacityMax);
  });

  it('motion: each animation plays once, briefly, with an opacity-only reduced variant and no flashing', () => {
    const css = allThemesCss();
    for (const m of MOTIONS) {
      const { full, reduced } = def.motion[m];
      for (const a of [full, reduced]) {
        expect(a.durationMs).toBeGreaterThanOrEqual(MOTION_LIMITS.minMs);
        expect(a.durationMs).toBeLessThanOrEqual(MOTION_LIMITS.maxMs);
        expect(a.keyframes).not.toMatch(/infinite/);
      }
      expect(reduced.keyframes).not.toMatch(/transform|translate|scale|rotate/);
      expect(reduced.keyframes).toMatch(/opacity/);
      // No flashing (WCAG 2.3.1): opacity may change direction at most once.
      expect(opacityTurns(full.keyframes)).toBeLessThanOrEqual(MOTION_LIMITS.maxOpacityTurns);
      expect(css).toContain(`@keyframes ${animationName(def.key, m, false)}`);
      expect(css).toContain(`@keyframes ${animationName(def.key, m, true)}`);
    }
  });

  it('sounds are optional, complete (one cue per classroom event), short and gentle (S13b)', () => {
    if (def.sounds === null) return;
    const L = SOUND_LIMITS;
    for (const s of SOUND_EVENTS) {
      const spec = def.sounds[s];
      expect(spec.length, s).toBeGreaterThan(0);
      expect(soundLength(spec), s).toBeLessThanOrEqual(L.longEvents.includes(s) ? L.longCueMaxMs : L.shortCueMaxMs);
      for (const n of spec) {
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(L.noteGainCap);
        expect(n.freq).toBeGreaterThanOrEqual(L.toneMinHz);
        expect(n.freq).toBeLessThanOrEqual(n.type === 'noise' ? L.noiseMaxHz : L.toneMaxHz);
      }
    }
    // The theme package validator uses the same check (S14g, D-158).
    expect(soundPackProblems(def.sounds)).toEqual([]);
    // Firework colours are theme tokens (THM-3: no raw colours in components).
    expect(def.celebration.colors.length).toBeGreaterThanOrEqual(2);
    for (const c of def.celebration.colors) expect(def.colors[c]).toMatch(/^#[0-9a-f]{6}$/iu);
  });

  it('is clearly audible but never clips (S14a, D-145): a tap at volume 80 peaks between −12 and −6 dBFS', () => {
    if (def.sounds === null) return;
    const tapPeak = Math.max(...def.sounds.tap.map((n) => Math.min(NOTE_GAIN_CAP, n.gain)));
    const db = outputPeakDb(tapPeak, 80);
    expect(db).toBeGreaterThanOrEqual(-12);
    expect(db).toBeLessThanOrEqual(-6);
    // The loudest moment of any cue (notes that overlap add up) stays under 0 dBFS at full volume.
    for (const e of SOUND_EVENTS) {
      const spec = def.sounds[e];
      const loudest = Math.max(...spec.map((a) => spec.filter((b) => b.at <= a.at && b.at + b.dur > a.at).reduce((sum, n) => sum + Math.min(NOTE_GAIN_CAP, n.gain), 0)));
      expect(outputPeakDb(loudest, 100), e).toBeLessThan(0);
    }
  });

  it('every sound event has a name in en and tr (catalogue buttons, Sound check)', () => {
    for (const e of SOUND_EVENTS) {
      expect(en[`sound.${e}` as keyof typeof en], `en sound.${e}`).toBeTruthy();
      expect(tr[`sound.${e}` as keyof typeof tr], `tr sound.${e}`).toBeTruthy();
    }
  });

  it('typography, shape and icon slots are sane (system fonts only, readable weights)', () => {
    const t = def.typography;
    for (const stack of [t.body, t.display]) expect(stack).toMatch(/(sans-serif|serif|system-ui|monospace)\s*$/);
    for (const w of [t.weightBody, t.weightStrong, t.weightHeading, t.weightDisplay]) {
      expect(w).toBeGreaterThanOrEqual(STYLE_LIMITS.weight[0]);
      expect(w).toBeLessThanOrEqual(STYLE_LIMITS.weight[1]);
    }
    expect(def.icons.strokeWidth).toBeGreaterThanOrEqual(STYLE_LIMITS.iconStroke[0]);
    expect(def.icons.strokeWidth).toBeLessThanOrEqual(STYLE_LIMITS.iconStroke[1]);
    for (const v of [def.shape.borderWidth, def.shape.borderWidthStrong]) expect(v).toMatch(/^\d+(\.\d+)?px$/);
  });
});
