// @vitest-environment jsdom
/**
 * Theme engine (S17a, D-166; THM-2, THM-3, THM-5, UX-6): scenes, frames, ambient and sets.
 * - schema and validator for the new fields; old packages (ocean) load unchanged;
 * - scene art goes through the same sanitiser with the scene limits (fuzzed), frame colours are token
 *   names only (no CSS or SVG injection through them);
 * - a package becomes a definition with scene, frame, ambient and sets and exports back;
 * - one mascot everywhere: base illustrations draw the package's mascot; `mascotFrom`;
 * - frames render as decorative overlays only where the theme asks (edge only on student cards);
 * - the ambient layer animates only with full motion and draws one still frame otherwise;
 * - the avatar picker order and the achievement frame.
 * Fictional data only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadgeArt } from '../../src/client/achievements/icons.tsx';
import { setDisplay } from '../../src/client/lib/display.ts';
import { makeParticles, particleCount, startAmbient, stepParticles, ThemeAmbient } from '../../src/client/themes/Ambient.tsx';
import { definitionFromPackage, packageFromDefinition, previewKey, registerThemePackage } from '../../src/client/themes/custom.tsx';
import { ThemeIllustration, ThemeProvider } from '../../src/client/themes/index.tsx';
import { removeCustomTheme, THEMES } from '../../src/client/themes/registry.ts';
import { sceneLayers, ThemeScene } from '../../src/client/themes/Scene.tsx';
import { FrameOverlay } from '../../src/client/ui/Frame.tsx';
import { CREATURE_FAMILY_KEYS, describeAvatar, READY_MADE } from '../../src/shared/avatars.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvatarPanel } from '../../src/client/student/AvatarPanel.tsx';
import { orderByFamilies, orderFamilies, resolveFrame, scenePreserveAspectRatio, TRIM_COLORS } from '../../src/shared/themePackage/engine.ts';
import { SCENE_LIMITS } from '../../src/shared/themePackage/limits.ts';
import { ThemePackage } from '../../src/shared/themePackage/schema.ts';
import { packageColors, parseSceneSvg, validateThemePackage } from '../../src/shared/themePackage/validate.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (key: string) => readFileSync(join(ROOT, 'docs', 'examples', `${key}.theme.json`), 'utf8');
const SNOW = read('peppermint-snow-day');
const OCEAN = read('ocean');
const snow = () => JSON.parse(SNOW) as Record<string, any>;
const inTheme = (theme: string, child: ReactElement) => createElement(ThemeProvider, { theme, children: child });
const ocean = () => JSON.parse(OCEAN) as Record<string, any>;

const KEYS = ['peppermint-snow-day', previewKey('peppermint-snow-day'), 'snow-test', 'ocean', 'borrowed'];
afterEach(() => {
  cleanup();
  for (const k of KEYS) removeCustomTheme(k);
  setDisplay({ theme: 'classroom', classAnimations: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('package fields scene, frame, ambient, sets (S17a, D-166)', () => {
  it('the Snow Day example package is valid and complete (test keeps it valid)', () => {
    const { report, pkg } = validateThemePackage(SNOW);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(pkg?.scene?.layers).toHaveLength(3);
    expect(pkg?.scene).toMatchObject({ smallScreens: 'bottomStrip' });
    expect(pkg?.scene?.layers.every((l) => l.fit === 'cover' && l.anchor === 'bottom')).toBe(true);
    expect(pkg?.frame).toMatchObject({ edge: 'snowDrift', trim: 'candyStripe', trimOn: ['routine', 'core.timer'], corners: 'frost' });
    expect(pkg?.ambient).toMatchObject({ preset: 'snowfall', speed: 'slow', size: 'mixed' });
    expect(pkg?.ambient?.density).toBeGreaterThanOrEqual(50);
    expect(pkg?.ambient?.density).toBeLessThanOrEqual(70);
    expect(pkg?.sets?.achievementFrame).toBe('snowflake');
    expect(report.stats.sceneLayers).toBe(3);
  });

  it('old packages load unchanged: ocean has none of the new fields and still validates and builds', () => {
    const { report } = validateThemePackage(OCEAN);
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.code)).toEqual(['ART_FROM_BASE']);
    const def = definitionFromPackage(ocean(), 'enabled')!;
    expect(def.scene).toBeUndefined();
    expect(def.frame).toBeUndefined();
    expect(def.ambient).toBeUndefined();
    expect(def.sets).toBeUndefined();
    // The optional scene-scrim follows the package's own surface, never the base theme.
    expect(def.colors['scene-scrim']).toBe(ocean().colors.surface);
    expect(packageColors(ocean() as never)['scene-scrim']).toBe(ocean().colors.surface);
  });

  it('every field is checked: presets, ranges, token names, box keys, families, layer count and viewBox', () => {
    const bad: Array<[string, (p: Record<string, any>) => void]> = [
      ['frame.edge', (p) => (p.frame.edge = 'icicles')],
      ['frame.trim', (p) => (p.frame.trim = 'tinsel')],
      ['frame.corners', (p) => (p.frame.corners = 'bow')],
      ['frame.apply', (p) => (p.frame.apply = ['sidebar'])],
      ['frame.trimOn', (p) => (p.frame.trimOn = ['clock'])],
      ['frame.trimColors', (p) => (p.frame.trimColors = ['accent'])],
      ['frame.cornerColors', (p) => (p.frame.cornerColors = [])],
      ['frame.extra', (p) => (p.frame.extra = 1)],
      ['ambient.speed', (p) => (p.ambient.speed = 'warp')],
      ['ambient.density', (p) => (p.ambient.density = 5)],
      ['ambient.color', (p) => (p.ambient.color = '#ffffff')],
      ['sets.achievementFrame', (p) => (p.sets.achievementFrame = 'crown')],
      ['sets.mascotFrom', (p) => (p.sets.mascotFrom = 'ocean')],
      ['scene.opacity', (p) => (p.scene.opacity = 0.1)],
      ['scene.smallScreens', (p) => (p.scene.smallScreens = 'tiny')],
      ['scene.layers.0.maxHeightVh', (p) => (p.scene.layers[0].maxHeightVh = 10)],
      ['scene.layers.0.fit', (p) => (p.scene.layers[0].fit = 'stretch')],
      ['scene.layers.0.viewBox', (p) => (p.scene.layers[0].viewBox = '10 10 1920 1080')],
      ['scene.layers', (p) => (p.scene.layers = [])],
    ];
    for (const [path, change] of bad) {
      const p = snow();
      change(p);
      const { report } = validateThemePackage(p);
      expect(report.ok, path).toBe(false);
      expect(
        report.errors.some((e) => e.code === 'SCHEMA' && (e.path === path || e.path.startsWith(`${path}.`) || (path.endsWith('.extra') && e.path === 'frame'))),
        `${path}: ${JSON.stringify(report.errors)}`,
      ).toBe(true);
    }
  });

  it('no CSS or SVG injection through frame tokens: only colour token names are accepted', () => {
    for (const value of ['red', '#ff0000', 'var(--cc-text)', 'accent;}body{display:none', 'url(x)', 'accent)', '--cc-accent', 'expression(1)']) {
      for (const field of ['snowColor', 'trimColors', 'cornerColors'] as const) {
        const p = snow();
        p.frame[field] = field === 'snowColor' ? value : [value, 'surface'];
        expect(ThemePackage.safeParse(p).success, `${field}=${value}`).toBe(false);
      }
    }
    // What passes is drawn as var(--cc-<token>) and nothing else.
    const def = definitionFromPackage({ ...snow(), key: 'snow-test' }, 'preview')!;
    const html = renderToStaticMarkup(inTheme('peppermint-snow-day', createElement('div')));
    expect(html).not.toContain('style=');
    for (const t of [def.frame!.snowColor, ...def.frame!.trimColors, ...def.frame!.cornerColors]) expect(t).toMatch(/^[a-z0-9-]+$/u);
  });

  it('the scene-scrim is contrast-checked against text (7:1) and noted when left out', () => {
    const p = snow();
    p.colors['scene-scrim'] = '#5a6a7a';
    const r = validateThemePackage(p).report;
    expect(r.errors.find((e) => e.code === 'CONTRAST')).toMatchObject({ path: 'colors.text', params: { bg: 'scene-scrim', min: 7 } });
    const q = snow();
    delete q.colors['scene-scrim'];
    const w = validateThemePackage(q).report;
    expect(w.ok).toBe(true);
    expect(w.warnings.map((x) => x.code)).toContain('SCRIM_DEFAULT');
  });
});

describe('scene art: the same sanitiser with the scene limits', () => {
  const rect = (i: number) => `<rect x='${i % 99}' width='4' height='4'/>`;
  it('accepts more than one ordinary picture but stops at the scene limits', () => {
    const many = Array.from({ length: 1000 }, (_, i) => rect(i)).join('');
    expect(parseSceneSvg(many).ok).toBe(true);
    const tooMany = Array.from({ length: SCENE_LIMITS.svgMaxNodes + 1 }, (_, i) => rect(i)).join('');
    expect(parseSceneSvg(tooMany)).toMatchObject({ ok: false, error: { reason: expect.stringMatching(/tooManyNodes|tooLarge/u) } });
    const big = `<path d='M0 0 ${'L1 1 '.repeat(14_000)}'/>`;
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(SCENE_LIMITS.svgMaxBytes);
    expect(parseSceneSvg(big)).toMatchObject({ ok: false, error: { reason: 'tooLarge' } });
    const p = snow();
    p.scene.layers[0].art = tooMany.slice(0, 61_000);
    expect(validateThemePackage(p).report.ok).toBe(false);
  });

  it('refuses known injection payloads in a layer', () => {
    for (const payload of [
      "<script>alert(1)</script>",
      "<rect width='1' height='1' style='fill:red'/>",
      "<rect width='1' height='1' fill='url(#a)'/>",
      "<image href='https://example.org/x.png'/>",
      "<g onload='alert(1)'><rect width='1' height='1'/></g>",
      "<foreignObject><div/></foreignObject>",
      "<rect width='1' height='1' fill='#ff0000'/>",
      "<!-- x --><rect width='1' height='1'/>",
    ]) {
      expect(parseSceneSvg(payload).ok, payload).toBe(false);
      const p = snow();
      p.scene.layers[2].art = payload;
      expect(validateThemePackage(p).report.errors[0], payload).toMatchObject({ code: 'SVG', path: 'scene.layers.2.art' });
    }
  });

  it('fuzz: random input never throws and never lets markup, styles or URLs through', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        const r = parseSceneSvg(s);
        if (r.ok) {
          const text = JSON.stringify(r.nodes);
          expect(text).not.toMatch(/script|style|url\(|href|on[a-z]+=/iu);
        }
      }),
      { numRuns: 400 },
    );
    fc.assert(
      fc.property(fc.constantFrom('rect', 'path', 'g', 'circle', 'script', 'style', 'image'), fc.constantFrom('fill', 'style', 'onclick', 'href', 'd', 'x'), fc.string({ maxLength: 40 }), (tag, attr, value) => {
        const r = parseSceneSvg(`<${tag} ${attr}='${value.replace(/'/gu, '')}'/>`);
        if (r.ok) expect(['rect', 'path', 'g', 'circle']).toContain(tag);
      }),
      { numRuns: 400 },
    );
  });
});

describe('definitions: a package with the new fields (S17a)', () => {
  it('maps scene, frame (defaults filled in), ambient and sets, and exports them back', () => {
    const def = definitionFromPackage(snow(), 'enabled')!;
    expect(def.scene?.layers).toHaveLength(3);
    expect(def.scene?.smallScreens).toBe('bottomStrip');
    expect(def.frame).toEqual(resolveFrame(snow().frame));
    expect(def.frame?.trimColors).toEqual(TRIM_COLORS.candyStripe);
    expect(def.ambient).toMatchObject({ preset: 'snowfall', density: snow().ambient.density });
    expect(def.sets).toMatchObject({ achievementFrame: 'snowflake', avatarFamiliesFirst: snow().sets.avatarFamiliesFirst });
    const exported = packageFromDefinition(def, { key: 'snow-copy', copyOf: (_l, n) => `${n} 2`.slice(0, 40) });
    expect(exported.frame).toEqual({ ...def.frame });
    expect(exported.ambient).toEqual(def.ambient);
    expect(exported.sets).toEqual(def.sets);
    expect(exported.scene).toBeUndefined(); // a scene is art: it stays with its theme
    expect(validateThemePackage({ ...exported, art: snow().art }).report.errors).toEqual([]);
  });

  it('every built-in theme stays as it was in S17a (no scene, frame, ambient or sets yet)', () => {
    for (const def of Object.values(THEMES)) {
      expect(def.scene, def.key).toBeUndefined();
      expect(def.frame, def.key).toBeUndefined();
      expect(def.ambient, def.key).toBeUndefined();
      expect(def.sets, def.key).toBeUndefined();
    }
  });

  it('sets.mascotFrom picks the built-in mascot of a package without mascot art', () => {
    const p = ocean();
    p.key = 'borrowed';
    delete p.art.mascot;
    p.sets = { achievementFrame: 'classic', avatarFamiliesFirst: [], mascotFrom: 'explorer' };
    const def = definitionFromPackage(p, 'enabled')!;
    expect(def.Mascot).toBe(THEMES.explorer.Mascot);
    const q = ocean();
    delete q.art.mascot;
    expect(definitionFromPackage(q, 'enabled')!.Mascot).toBe(THEMES[q.base as 'classroom'].Mascot);
    const own = snow();
    own.sets.mascotFrom = 'explorer';
    expect(validateThemePackage(own).report.warnings.map((w) => w.code)).toContain('MASCOT_FROM_UNUSED');
  });
});

describe('one mascot everywhere (mascot context)', () => {
  it('a package that keeps base illustrations shows its own mascot in them', () => {
    // Snow Day draws its own illustrations; a copy without them keeps the base (animals) pictures.
    const p = snow();
    p.key = 'snow-test';
    delete p.art.illustrations;
    registerThemePackage(p, 'enabled');
    const ownMascot = definitionFromPackage(p, 'enabled')!;
    const mascotMarkup = renderToStaticMarkup(createElement('svg', null, createElement(ownMascot.Mascot, { pose: 'idle' })));
    const baseMascot = renderToStaticMarkup(createElement('svg', null, createElement(THEMES.animals.Mascot, { pose: 'idle' })));
    const html = renderToStaticMarkup(inTheme('snow-test', createElement(ThemeIllustration, { name: 'emptyState' })));
    const inner = (s: string) => s.replace(/^<svg>|<\/svg>$/gu, '');
    expect(html).toContain(inner(mascotMarkup));
    expect(html).not.toContain(inner(baseMascot));
    // The built-in theme itself still shows its own mascot.
    const builtin = renderToStaticMarkup(inTheme('animals', createElement(ThemeIllustration, { name: 'emptyState' })));
    expect(builtin).toContain(inner(baseMascot));
  });
});

describe('frames (FrameOverlay)', () => {
  beforeEach(() => {
    registerThemePackage(snow(), 'enabled');
  });
  const overlay = (theme: string, props: Parameters<typeof FrameOverlay>[0]) =>
    renderToStaticMarkup(inTheme(theme, createElement('article', null, createElement(FrameOverlay, props))));

  it('draws nothing for a theme without a frame', () => {
    expect(overlay('classroom', { surface: 'boardBoxes', boxKey: 'routine' })).not.toContain('cc-frame');
  });

  it('student cards get the edge only; boxes in trimOn get the trim; corners on boxes; everything aria-hidden', () => {
    const card = overlay('peppermint-snow-day', { surface: 'studentCards' });
    expect(card).toContain('cc-frame__edge--drift');
    expect(card).not.toContain('cc-frame__corner');
    expect(card).not.toContain('cc-frame__ring');
    const routine = overlay('peppermint-snow-day', { surface: 'boardBoxes', boxKey: 'routine' });
    expect(routine).toContain('cc-frame__ring--candy');
    expect(routine).toContain('cc-frame__corner--bottom-left');
    const counters = overlay('peppermint-snow-day', { surface: 'boardBoxes', boxKey: 'counters' });
    expect(counters).not.toContain('cc-frame__ring');
    expect(overlay('peppermint-snow-day', { surface: 'dialogs' })).toBe('<div data-theme="peppermint-snow-day"><article></article></div>');
    const doc = new DOMParser().parseFromString(routine, 'text/html');
    for (const el of doc.querySelectorAll('.cc-frame')) expect(el.getAttribute('aria-hidden')).toBe('true');
    // Colours only as tokens.
    expect(routine).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/iu);
    expect(routine).toContain('var(--cc-art-ground)');
  });

  it('every edge, trim and corner preset renders (S17b uses them for the built-in themes)', () => {
    const presets = { edge: ['snowDrift', 'scallop', 'torn'], trim: ['candyStripe', 'garland', 'lights', 'frost', 'stitched', 'pencil'], corners: ['frost', 'holly', 'star', 'compass', 'leaf'] } as const;
    const seen = new Set<string>();
    for (const edge of presets.edge)
      for (const trim of presets.trim)
        for (const corners of presets.corners) {
          const p = snow();
          p.key = 'snow-test';
          p.frame = { edge, trim, corners, apply: ['boardBoxes', 'topBar', 'dock', 'dialogs'] };
          registerThemePackage(p, 'enabled');
          const html = overlay('snow-test', { surface: 'boardBoxes', boxKey: 'routine' });
          expect(html, `${edge}/${trim}/${corners}`).toContain('cc-frame__edge');
          for (const m of html.matchAll(/cc-frame__([a-z-]+)/gu)) seen.add(m[1]!);
          expect(overlay('snow-test', { surface: 'topBar' })).toContain('cc-frame__edge--bottom');
        }
    for (const part of ['edge--drift', 'edge--scallop', 'edge--torn', 'ring--candy', 'ring--frost', 'stitch', 'swag', 'swag--lights', 'pencil', 'corner--bottom-left', 'corner--top-left', 'corner--top-right', 'corner--wide'])
      expect(seen, part).toContain(part);
  });
});

describe('scene (ThemeScene)', () => {
  beforeEach(() => {
    registerThemePackage(snow(), 'enabled');
  });
  it('maps fit and anchor to preserveAspectRatio', () => {
    expect(scenePreserveAspectRatio('cover', 'bottom')).toBe('xMidYMax slice');
    expect(scenePreserveAspectRatio('contain', 'top-left')).toBe('xMinYMin meet');
    expect(scenePreserveAspectRatio('width', 'bottom-right')).toBe('xMaxYMax slice');
    expect(scenePreserveAspectRatio('height', 'center')).toBe('xMidYMid slice');
  });

  it('draws every layer on a large screen, only the last as a strip on a phone (bottomStrip), none when hidden', () => {
    const def = definitionFromPackage(snow(), 'enabled')!;
    expect(sceneLayers(def, false).map((l) => l.strip)).toEqual([false, false, false]);
    expect(sceneLayers(def, true)).toEqual([{ layer: def.scene!.layers[2], strip: true }]);
    expect(sceneLayers({ scene: { ...def.scene!, smallScreens: 'hidden' } }, true)).toEqual([]);
    expect(sceneLayers({ scene: { ...def.scene!, smallScreens: 'full' } }, true)).toHaveLength(3);
    const { container } = render(inTheme('peppermint-snow-day', createElement(ThemeScene, { contained: true })));
    const scene = container.querySelector('[data-testid="theme-scene"]')!;
    expect(scene.getAttribute('aria-hidden')).toBe('true');
    expect(scene.querySelectorAll('svg.cc-scene__layer')).toHaveLength(3);
    expect(scene.querySelector('svg')!.getAttribute('preserveAspectRatio')).toBe('xMidYMax slice');
  });

  it('marks <html data-scene> only while the document theme has a scene', () => {
    setDisplay({ theme: 'peppermint-snow-day' });
    const { unmount } = render(createElement(ThemeScene, { documentFlag: true }));
    expect(document.documentElement.hasAttribute('data-scene')).toBe(true);
    act(() => setDisplay({ theme: 'classroom' }));
    expect(document.documentElement.hasAttribute('data-scene')).toBe(false);
    unmount();
  });
});

describe('ambient (ThemeAmbient): full motion only, else one still frame', () => {
  const fakeCtx = () => ({ setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 });
  beforeEach(() => {
    registerThemePackage(snow(), 'enabled');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { ...fakeCtx(), canvas: this } as never;
    });
  });
  const reduce = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));

  it('runs with full motion and stops with the class switch off or reduced motion', () => {
    reduce(false);
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    setDisplay({ theme: 'peppermint-snow-day', classAnimations: true });
    const a = render(createElement(ThemeAmbient));
    const canvas = a.container.querySelector('canvas')!;
    expect(canvas.dataset.mode).toBe('full');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(raf).toHaveBeenCalled();
    expect(canvas.dataset.running).toBe('true');
    a.unmount();

    raf.mockClear();
    act(() => setDisplay({ classAnimations: false }));
    const b = render(createElement(ThemeAmbient));
    expect(b.container.querySelector('canvas')!.dataset.mode).toBe('still');
    expect(b.container.querySelector('canvas')!.dataset.running).toBe('false');
    expect(raf).not.toHaveBeenCalled();
    b.unmount();

    reduce(true);
    act(() => setDisplay({ classAnimations: true }));
    const c = render(createElement(ThemeAmbient));
    expect(c.container.querySelector('canvas')!.dataset.mode).toBe('still');
    expect(raf).not.toHaveBeenCalled();
  });

  it('a still frame draws once; nothing for a theme without ambient', () => {
    const canvas = document.createElement('canvas');
    const ctx = { ...fakeCtx(), canvas };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => ctx as never);
    Object.defineProperty(canvas, 'clientWidth', { value: 1536 });
    Object.defineProperty(canvas, 'clientHeight', { value: 703 });
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const stop = startAmbient(canvas, snow().ambient, 'still');
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.arc.mock.calls.length).toBe(particleCount(snow().ambient, 1536, 703));
    expect(raf).not.toHaveBeenCalled();
    stop();
    setDisplay({ theme: 'classroom' });
    expect(render(createElement(ThemeAmbient)).container.querySelector('canvas')).toBeNull();
  });

  it('sizes in device pixels and scales the particle count with the screen', () => {
    vi.stubGlobal('devicePixelRatio', 1.25);
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1536 });
    Object.defineProperty(canvas, 'clientHeight', { value: 703 });
    startAmbient(canvas, snow().ambient, 'still')();
    expect([canvas.width, canvas.height]).toEqual([1920, 879]);
    expect(particleCount({ density: 60 }, 1920, 1080)).toBe(60);
    expect(particleCount({ density: 60 }, 3840, 2160)).toBe(60);
    expect(particleCount({ density: 60 }, 375, 812)).toBeLessThan(10);
    const ps = makeParticles(snow().ambient, 100, 100, 1);
    stepParticles(ps, snow().ambient, 30, 100, 100);
    for (const p of ps) expect(p.y).toBeLessThanOrEqual(100 + p.r);
  });
});

describe('sets: avatar order and achievement frames', () => {
  it('avatarFamiliesFirst only reorders: every family and every ready-made avatar stays', () => {
    expect(orderFamilies(CREATURE_FAMILY_KEYS, ['mythical', 'animals']).slice(0, 2)).toEqual(['mythical', 'animals']);
    expect([...orderFamilies(CREATURE_FAMILY_KEYS, ['mythical'])].sort()).toEqual([...CREATURE_FAMILY_KEYS].sort());
    expect(orderFamilies(CREATURE_FAMILY_KEYS, undefined)).toEqual([...CREATURE_FAMILY_KEYS]);
    const ordered = orderByFamilies(READY_MADE, ['sea', 'robots']);
    expect(ordered).toHaveLength(READY_MADE.length);
    expect(new Set(ordered)).toEqual(new Set(READY_MADE));
    const firstFamilies = ordered.slice(0, 24).map((a) => a.family);
    expect(firstFamilies.slice(0, 12).every((f) => f === 'sea')).toBe(true);
    expect(firstFamilies.slice(12, 24).every((f) => f === 'robots')).toBe(true);
    expect(orderByFamilies(READY_MADE, [])).toEqual([...READY_MADE]);
  });

  it('the avatar picker shows the theme families first (ready-made list and the family choice); the saved avatar stays', async () => {
    registerThemePackage(snow(), 'enabled');
    const generated = { ...READY_MADE[0]! };
    const saved = READY_MADE.find((a) => a.family === 'robots')!;
    const info = { spec: saved, generated, locked: false, fallback: 'generated' as const, earned: [] };
    const qc = new QueryClient();
    const { container, getByTestId } = render(
      createElement(QueryClientProvider, { client: qc, children: inTheme('peppermint-snow-day', createElement(AvatarPanel, { info, name: 'Ada' })) }),
    );
    await act(async () => getByTestId('avatar-change').click());
    const first = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="avatar-ready"]')].slice(0, 24).map((b) => b.getAttribute('aria-label') ?? '');
    const expected = orderByFamilies(READY_MADE, snow().sets.avatarFamiliesFirst).slice(0, 24).map((s) => describeAvatar(s, 'en'));
    expect(first).toEqual(expected);
    expect(orderByFamilies(READY_MADE, snow().sets.avatarFamiliesFirst)[0]!.family).toBe(snow().sets.avatarFamiliesFirst[0]);
    // The current (saved) avatar is still the robot: a theme never changes it.
    expect(container.querySelector('[data-testid="student-avatar"] svg[role="img"]')?.getAttribute('aria-label')).toBe(describeAvatar(saved, 'en'));
    await act(async () => getByTestId('avatar-tab-make').click());
    await act(async () => getByTestId('avatar-type-creature').click());
    const family = container.querySelector<HTMLSelectElement>('#avatar-part-family');
    expect([...(family?.options ?? [])].slice(0, 2).map((o) => o.value)).toEqual(snow().sets.avatarFamiliesFirst);
    expect(family?.options.length).toBe(CREATURE_FAMILY_KEYS.length);
  });

  it('the achievement frame surrounds the tier shape; the tier keeps its shape and token', () => {
    registerThemePackage(snow(), 'enabled');
    const plain = renderToStaticMarkup(inTheme('classroom', createElement(BadgeArt, { icon: 'star', tier: 'gold' })));
    expect(plain).toContain('viewBox="0 0 48 48"');
    expect(plain).toContain('data-frame="classic"');
    const framed = renderToStaticMarkup(inTheme('peppermint-snow-day', createElement(BadgeArt, { icon: 'star', tier: 'gold' })));
    expect(framed).toContain('data-frame="snowflake"');
    expect(framed).toContain('data-tier="gold"');
    expect(framed).toContain('viewBox="-9 -9 66 66"');
    expect((framed.match(/var\(--cc-badge-gold\)/gu) ?? []).length).toBeGreaterThanOrEqual(2);
    const tierGroup = plain.slice(plain.indexOf('<g fill='), plain.indexOf('</g>') + 4);
    expect(tierGroup).toContain('var(--cc-badge-gold)');
    expect(framed).toContain(tierGroup);
    for (const frame of ['ornament', 'star', 'shield'] as const) {
      const p = snow();
      p.key = 'snow-test';
      p.sets.achievementFrame = frame;
      registerThemePackage(p, 'enabled');
      const html = renderToStaticMarkup(inTheme('snow-test', createElement(BadgeArt, { icon: 'star', tier: 'bronze' })));
      expect(html, frame).toContain(`data-frame="${frame}"`);
      expect(html, frame).toContain('<circle cx="24" cy="24" r="21"');
    }
  });
});
