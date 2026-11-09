// @vitest-environment jsdom
/**
 * Theme packages on the client and the shared validators (S14g, D-158; THM-2..5):
 * - the SVG sanitiser: an allow-list, property-tested with random input (fast-check) and a list of
 *   known injection payloads; what it accepts renders through `SvgTree` with allow-listed props only;
 * - the package validator: schema, contrast, sound and art rules; the worked example passes;
 * - a package becomes a complete ThemeDefinition whose generated CSS cannot be injected;
 * - every built-in theme exports to a package that validates (only its key must change) and builds
 *   back to the same tokens, motions and sounds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { allThemesCss, safeValue, themeCss, themeTokens } from '../../src/client/themes/css.ts';
import { definitionFromPackage, packageFromDefinition, previewKey, registerThemePackage } from '../../src/client/themes/custom.tsx';
import { pickerThemes, removeCustomTheme, THEME_LIST, themeOf } from '../../src/client/themes/registry.ts';
import { SvgTree } from '../../src/client/themes/SvgTree.tsx';
import { MASCOT_POSES } from '../../src/client/themes/types.ts';
import { translate } from '../../src/shared/i18n/index.ts';
import { DEFAULT_THEME } from '../../src/shared/themes.ts';
import { ThemePackage } from '../../src/shared/themePackage/schema.ts';
import { parseSvg, SVG_ATTRIBUTES, SVG_ELEMENTS, svgToString, type SvgNode } from '../../src/shared/themePackage/svg.ts';
import { PACKAGE_COLOR_TOKENS } from '../../src/shared/themePackage/tokens.ts';
import { validateThemePackage } from '../../src/shared/themePackage/validate.ts';

const OCEAN = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'examples', 'ocean.theme.json'), 'utf8');
const ocean = () => JSON.parse(OCEAN) as Record<string, any>;
const render = (nodes: readonly SvgNode[]) => renderToStaticMarkup(createElement('svg', null, createElement(SvgTree, { nodes })));

afterEach(() => {
  for (const k of ['ocean', previewKey('ocean'), 'evil']) removeCustomTheme(k);
});

describe('SVG sanitiser (allow-list)', () => {
  it('accepts the allowed elements, geometry, transforms and token paints', () => {
    const r = parseSvg(
      `<g fill='var(--cc-accent)' transform='translate(2 3) rotate(10 50 50)'><path d="M0 0 L10 10 Z" stroke="currentColor" stroke-width="2"/><circle cx="5" cy="5" r="4"/><ellipse cx="1" cy="1" rx="2" ry="1"/><rect x="0" y="0" width="5" height="5" rx="1"/><line x1="0" y1="0" x2="4" y2="4"/><polyline points="0,0 1,1 2,0"/><polygon points="0 0 1 1 2 0" fill="none" opacity="0.5"/></g>`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.count).toBe(8);
  });

  it.each([
    ['<script>alert(1)</script>', 'element'],
    ['<image href="x.png"/>', 'element'],
    ['<use href="#a"/>', 'element'],
    ['<foreignObject></foreignObject>', 'element'],
    ['<text x="1">Hi</text>', 'element'],
    ['<style>*{}</style>', 'element'],
    ['<a href="javascript:alert(1)"><circle r="1"/></a>', 'element'],
    ['<svg><circle r="1"/></svg>', 'element'],
    ['<circle r="1" onload="alert(1)"/>', 'attribute'],
    ['<circle r="1" id="x"/>', 'attribute'],
    ['<circle r="1" class="x"/>', 'attribute'],
    ['<circle r="1" style="fill:red"/>', 'attribute'],
    ['<circle r="1" filter="url(#f)"/>', 'attribute'],
    ['<circle r="1" mask="url(#m)"/>', 'attribute'],
    ['<circle r="1" xlink:href="x"/>', 'attribute'],
    ['<circle r="1" fill="url(#g)"/>', 'value'],
    ['<circle r="1" fill="#ff0000"/>', 'value'],
    ['<circle r="1" fill="red"/>', 'value'],
    ['<circle r="1" fill="var(--cc-nope)"/>', 'value'],
    ['<circle r="1" fill="var(--cc-accent);background:url(x)"/>', 'value'],
    ['<circle r="1" transform="translate(1) url(x)"/>', 'value'],
    ['<path d="M0 0 L1 1 javascript"/>', 'value'],
    ['<circle r="-1"/>', 'value'],
    ['<circle r="1" opacity="2"/>', 'value'],
    ['<!-- hi --><circle r="1"/>', 'markup'],
    ['<![CDATA[x]]>', 'markup'],
    ['<?xml version="1.0"?>', 'markup'],
    ['<circle r="1" fill="&amp;"/>', 'entity'],
    ['hello', 'text'],
    ['<circle r="1">x</circle>', 'text'],
    ['<circle r="1"><circle r="2"/></circle>', 'children'],
    ['<g><circle r="1"/>', 'unclosed'],
    ['<g></circle>', 'syntax'],
    ['<circle r="1" r="2"/>', 'duplicateAttribute'],
    ['<circle r=1/>', 'syntax'],
    ['', 'empty'],
  ])('refuses %s (%s)', (src, reason) => {
    const r = parseSvg(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe(reason);
  });

  it('enforces the node, size and depth limits', () => {
    expect(parseSvg('<circle r="1"/>'.repeat(401))).toMatchObject({ ok: false, error: { reason: 'tooManyNodes' } });
    expect(parseSvg(`<path d="M0 0 ${'L1 1 '.repeat(5000)}"/>`)).toMatchObject({ ok: false, error: { reason: 'tooLarge' } });
    expect(parseSvg(`${'<g>'.repeat(13)}${'</g>'.repeat(13)}`)).toMatchObject({ ok: false, error: { reason: 'tooDeep' } });
  });

  it('never throws, and anything it accepts holds only allowed elements, attributes and characters (fast-check)', () => {
    const piece = fc.oneof(
      fc.constantFrom(...SVG_ELEMENTS, 'script', 'image', 'use', 'a', 'style', 'text'),
      fc.constantFrom(...SVG_ATTRIBUTES, 'href', 'onload', 'style', 'id', 'class', 'xlink:href'),
      fc.constantFrom('<', '>', '/>', '</', '="', "='", '"', "'", ' ', '=', 'var(--cc-accent)', 'url(', 'javascript:', '#f00', '&lt;', '<!--', 'M0 0', '1', 'translate(1 2)'),
      fc.string({ maxLength: 6 }),
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 40 }), (parts) => {
        const r = parseSvg(parts.join(''));
        if (!r.ok) return true;
        const walk = (nodes: readonly SvgNode[]): boolean =>
          nodes.every(
            (n) =>
              (SVG_ELEMENTS as readonly string[]).includes(n.tag) &&
              Object.entries(n.attrs).every(([k, v]) => SVG_ATTRIBUTES.includes(k) && /^[A-Za-z0-9 .,+\-()]*$/u.test(v) && !/url\(|javascript/iu.test(v)) &&
              walk(n.children ?? []),
          );
        const html = render(r.nodes);
        return walk(r.nodes) && !/on[a-z]+=|href|style=|<script|url\(/iu.test(html);
      }),
      { numRuns: 3000 },
    );
  });

  it('a parsed tree round-trips through its canonical text, and SvgTree draws it with React props', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 40 })), { minLength: 1, maxLength: 20 }), (circles) => {
        const src = `<g stroke-width="2">${circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--cc-deco-1)"/>`).join('')}</g>`;
        const r = parseSvg(src);
        if (!r.ok) return false;
        const again = parseSvg(svgToString(r.nodes));
        return again.ok && svgToString(again.nodes) === svgToString(r.nodes);
      }),
    );
    const r = parseSvg('<path d="M0 0 L2 2" stroke-width="2" stroke-linecap="round" fill-rule="evenodd"/>');
    expect(r.ok && render(r.nodes)).toContain('stroke-width="2"');
  });

  it('SvgTree drops anything that is not allow-listed even in a hand-made tree (defence in depth)', () => {
    const html = render([{ tag: 'script' as never, attrs: {} }, { tag: 'circle', attrs: { r: '1', onclick: 'x', href: 'y', style: 'z' } as Record<string, string> }]);
    expect(html).toBe('<svg><circle r="1"></circle></svg>');
  });
});

describe('package validator', () => {
  it('the worked example "ocean" has no errors; its pictures are counted', () => {
    const { report, pkg } = validateThemePackage(OCEAN);
    expect(report.errors).toEqual([]);
    expect(pkg?.key).toBe('ocean');
    expect(report.stats.pictures).toBe(10);
  });

  it('every colour token is required, printed colours are not part of a package, unknown fields are refused', () => {
    const p = ocean();
    delete p.colors.accent;
    expect(validateThemePackage(p).report.errors[0]).toMatchObject({ code: 'SCHEMA', path: 'colors.accent' });
    const q = ocean();
    q.colors['print-ink'] = '#ff0000';
    expect(validateThemePackage(q).report.errors[0]?.code).toBe('SCHEMA');
    expect(Object.keys(ocean().colors).sort()).toEqual([...PACKAGE_COLOR_TOKENS].sort());
  });

  it('refuses a file over 512 KB before parsing it', () => {
    const big = JSON.stringify({ ...ocean(), pad: 'x'.repeat(530 * 1024) });
    expect(validateThemePackage(big).report.errors.map((e) => e.code)).toEqual(['TOO_LARGE']);
  });

  it('a silent theme is allowed with a note', () => {
    const p = ocean();
    p.sounds = null;
    const { report } = validateThemePackage(p);
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain('SILENT');
  });

  it('every built-in theme exported as a package validates once it has its own key, and builds back to the same theme', () => {
    for (const def of THEME_LIST) {
      const pkg = packageFromDefinition(def, { key: `${def.key}-copy`, copyOf: (l, name) => translate(l, 'themes.export.copyName', { name }) });
      const { report } = validateThemePackage(JSON.stringify(pkg));
      expect(report.errors, def.key).toEqual([]);
      expect(pkg.name.tr).toContain('(kopya)');
      const back = definitionFromPackage(pkg, 'preview')!;
      expect(back.colors).toEqual(def.colors);
      expect(themeTokens(back).slice(0, 5)).toEqual(themeTokens({ ...def, key: back.key }).slice(0, 5));
      expect(themeTokens(back).map(([, v]) => v)).toEqual(themeTokens(def).map(([, v]) => v));
      expect(back.motion).toEqual(def.motion);
      expect(back.sounds).toEqual(def.sounds);
      // A built-in key is never accepted in a package.
      expect(validateThemePackage(JSON.stringify({ ...pkg, key: def.key })).report.errors.map((e) => e.code)).toContain('KEY_BUILTIN');
    }
  });
});

describe('imported themes on the client', () => {
  it('a package becomes a complete theme: tokens, art from SVG trees, base theme art where it has none', () => {
    const def = definitionFromPackage(ocean(), 'enabled')!;
    expect(def.key).toBe('ocean');
    expect(def.colors.bg).toBe('#eef6f8');
    expect(def.colors['print-ink']).toBe(themeOf(DEFAULT_THEME).colors['print-ink']);
    expect(def.custom?.labels.name.tr).toBe('Okyanus');
    const poses = MASCOT_POSES.map((pose) => renderToStaticMarkup(createElement('svg', null, createElement(def.Mascot, { pose }))));
    expect(new Set(poses).size).toBe(MASCOT_POSES.length);
    expect(poses[0]).toContain('var(--cc-mascot-body)');
    // lockScreen is not in the package: the base theme draws it.
    const base = themeOf('classroom');
    expect(def.illustrations.lockScreen).toBe(base.illustrations.lockScreen);
    expect(def.illustrations.startLesson).not.toBe(base.illustrations.startLesson);
  });

  it('registering makes it findable, listed for pickers only when enabled, and adds its CSS block; unknown keys fall back', () => {
    expect(themeOf('ocean').key).toBe(DEFAULT_THEME);
    registerThemePackage(ocean(), 'preview', previewKey('ocean'));
    expect(themeOf(previewKey('ocean')).custom?.status).toBe('preview');
    expect(pickerThemes().map((d) => d.key)).not.toContain(previewKey('ocean'));
    registerThemePackage(ocean(), 'enabled');
    expect(pickerThemes().map((d) => d.key)).toContain('ocean');
    expect(allThemesCss()).toContain(`[data-theme='ocean'] {`);
    expect(allThemesCss()).toContain('@keyframes cc-ocean-celebrate {');
  });

  it('an older package without a newer colour token still builds (the token comes from the base theme)', () => {
    const p = ocean();
    delete p.colors['badge-shine'];
    expect(ThemePackage.safeParse(p).success).toBe(false);
    expect(definitionFromPackage(p, 'enabled')?.colors['badge-shine']).toBe(themeOf('classroom').colors['badge-shine']);
  });

  it('generated CSS cannot be injected: hostile values never reach the stylesheet', () => {
    const hostile = ['red; } body { background: url(https://example.org/x) } .x {', '#fff</style><script>', 'expression(alert(1))', '@import "x"', '#fff /* x */'];
    for (const v of hostile) expect(safeValue(v), v).toBe(false);
    // A package with a hostile colour or key is refused before any CSS is made.
    expect(definitionFromPackage({ ...ocean(), colors: { ...ocean().colors, bg: 'red;}body{color:red' } }, 'enabled')).toBeNull();
    expect(definitionFromPackage({ ...ocean(), key: "x'] {" }, 'enabled')).toBeNull();
    expect(definitionFromPackage(ocean(), 'preview', "evil'] {")).toBeNull();
    // Even a definition built by hand with hostile values only emits safe declarations.
    const good = definitionFromPackage(ocean(), 'enabled')!;
    const evil = { ...good, key: 'evil', colors: { ...good.colors, bg: 'red; } body { background: url(x)' }, motion: { ...good.motion, celebrate: { ...good.motion.celebrate, full: { ...good.motion.celebrate.full, keyframes: '} body { background: url(x) } @keyframes y {' } } } };
    const css = themeCss(evil);
    expect(css).not.toMatch(/url\(|body \{/u);
    expect(css).not.toContain('--cc-bg:');
    expect(css).not.toContain('@keyframes cc-evil-celebrate {');
    expect(themeCss({ ...good, key: "x'] , body" })).toBe('');
  });
});
