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
import { ILLUSTRATIONS, MASCOT_POSES, MOTIONS, SOUNDS } from '../../src/client/themes/types.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
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

  it('classes.theme validates against the shared key list', () => {
    for (const k of THEME_KEYS) expect(Theme.safeParse(k).success).toBe(true);
    expect(Theme.safeParse('neon').success).toBe(false);
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
    expect(def.decoOpacity).toBeLessThanOrEqual(0.6);
    expect(def.patternOpacity).toBeLessThanOrEqual(0.15);
  });

  it('motion: each animation plays once, briefly, with an opacity-only reduced variant and no flashing', () => {
    const css = allThemesCss();
    for (const m of MOTIONS) {
      const { full, reduced } = def.motion[m];
      for (const a of [full, reduced]) {
        expect(a.durationMs).toBeGreaterThanOrEqual(150);
        expect(a.durationMs).toBeLessThanOrEqual(1500);
        expect(a.keyframes).not.toMatch(/infinite/);
      }
      expect(reduced.keyframes).not.toMatch(/transform|translate|scale|rotate/);
      expect(reduced.keyframes).toMatch(/opacity/);
      // No flashing (WCAG 2.3.1): opacity may change direction at most once.
      const opacities = [...full.keyframes.matchAll(/opacity:\s*([\d.]+)/g)].map((x) => Number(x[1]));
      let turns = 0;
      for (let i = 2; i < opacities.length; i++) if (Math.sign(opacities[i]! - opacities[i - 1]!) * Math.sign(opacities[i - 1]! - opacities[i - 2]!) < 0) turns++;
      expect(turns).toBeLessThanOrEqual(1);
      expect(css).toContain(`@keyframes ${animationName(def.key, m, false)}`);
      expect(css).toContain(`@keyframes ${animationName(def.key, m, true)}`);
    }
  });

  it('sounds are optional, short and gentle', () => {
    if (def.sounds === null) return;
    for (const s of SOUNDS) {
      const spec = def.sounds[s];
      expect(spec.length).toBeGreaterThan(0);
      expect(soundLength(spec)).toBeLessThanOrEqual(1500);
      for (const n of spec) {
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.3);
        expect(n.freq).toBeGreaterThanOrEqual(150);
        expect(n.freq).toBeLessThanOrEqual(2000);
      }
    }
  });

  it('typography, shape and icon slots are sane (system fonts only, readable weights)', () => {
    const t = def.typography;
    for (const stack of [t.body, t.display]) expect(stack).toMatch(/(sans-serif|serif|system-ui|monospace)\s*$/);
    for (const w of [t.weightBody, t.weightStrong, t.weightHeading, t.weightDisplay]) {
      expect(w).toBeGreaterThanOrEqual(400);
      expect(w).toBeLessThanOrEqual(900);
    }
    expect(def.icons.strokeWidth).toBeGreaterThanOrEqual(1.5);
    expect(def.icons.strokeWidth).toBeLessThanOrEqual(3);
    for (const v of [def.shape.borderWidth, def.shape.borderWidthStrong]) expect(v).toMatch(/^\d+(\.\d+)?px$/);
  });
});
