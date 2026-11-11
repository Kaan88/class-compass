/**
 * Theme authoring over MCP (S16b, D-164): the example packages are resources, Markdown resources carry
 * classcompass:// links instead of dead repository links, export_theme returns built-in themes for
 * teachers and administrators (the same package as Admin → Themes → Export), preview_theme gives the
 * contrast table, the resolved colours and the art fallback, and the server instructions point at the
 * guide. Fictional data only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkDocs, resourceUriOf } from '../../src/server/modules/mcp/resources.ts';
import { THEME_KEYS } from '../../src/shared/themes.ts';
import { CONTRAST_PAIRS } from '../../src/shared/themePackage/contrast.ts';
import { COLOR_TOKENS } from '../../src/shared/themePackage/tokens.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { Mcp, makeToken, setAi } from '../mcp-helpers.ts';
import { buildSchool, type School } from '../school-fixture.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const example = (key: string) => JSON.parse(readFileSync(join(ROOT, 'docs', 'examples', `${key}.theme.json`), 'utf8')) as Record<string, any>;

let env: TestEnv;
let school: School;
let teacher: Mcp;
let admin: Mcp;
beforeAll(async () => {
  env = await makeEnv();
  school = await buildSchool(env);
  await setAi(school.admin, { mcpEnabled: true });
  teacher = new Mcp(env, (await makeToken(school.teacherA, { scopes: ['classes:read'] })).secret);
  admin = new Mcp(env, (await makeToken(school.admin, { scopes: ['school:read', 'themes:write'] })).secret);
  await teacher.init();
  await admin.init();
});
afterAll(async () => env.app.close());

describe('theme examples as resources (D-164)', () => {
  it('lists and reads every docs/examples package', async () => {
    const list = (await teacher.rpc('resources/list')).result.resources as Array<{ uri: string; mimeType: string }>;
    for (const key of ['ocean', ...THEME_KEYS]) {
      const uri = `classcompass://themes/examples/${key}`;
      expect(list.find((r) => r.uri === uri)?.mimeType, uri).toBe('application/json');
      const read = (await teacher.rpc('resources/read', { uri })).result.contents[0];
      expect(JSON.parse(read.text)).toEqual(example(key));
    }
  });

  it('serves THEMING.md with links rewritten to resources; the file in git keeps its relative links', async () => {
    const text = (await teacher.rpc('resources/read', { uri: 'classcompass://docs/theming' })).result.contents[0].text as string;
    expect(text).toContain('](classcompass://themes/examples/ocean)');
    expect(text).toContain('](classcompass://themes/package-schema)');
    expect(text).not.toMatch(/\]\((?:examples\/|theme-package\.schema\.json|\.\.\/AGENTS\.md|EXTENDING\.md)/u);
    expect(text).toContain('(repository file AGENTS.md, not available here)');
    expect(text).toContain('(repository file docs/EXTENDING.md, not available here)');
    const file = readFileSync(join(ROOT, 'docs', 'THEMING.md'), 'utf8');
    expect(file).toContain('](examples/ocean.theme.json)');
  });

  it('rewrites links between guides and turns pictures into text', async () => {
    const text = (await teacher.rpc('resources/read', { uri: 'classcompass://guides/en/admin' })).result.contents[0].text as string;
    expect(text).toContain('](classcompass://guides/en/ai-tools)');
    expect(text).not.toMatch(/!\[[^\]]*\]\(/u);
    expect(text).toMatch(/\(picture "[^"]*": repository file docs\/guides\/img\/en\/admin-home\.png\)/u);
  });

  it('linkDocs keeps absolute links and anchors, and maps only documents that are resources', () => {
    expect(linkDocs('[a](https://example.org/x) [b](#top) [c](admin.md#themes) [d](nope.md)', 'guides/en/x.md')).toBe(
      '[a](https://example.org/x) [b](#top) [c](classcompass://guides/en/admin#themes) d (repository file docs/guides/en/nope.md, not available here)',
    );
    expect(resourceUriOf('examples/ocean.theme.json')).toBe('classcompass://themes/examples/ocean');
    expect(resourceUriOf('examples/missing.theme.json')).toBeNull();
  });
});

describe('export_theme of a built-in theme (D-164)', () => {
  it('teachers and administrators get the same package as Admin → Themes → Export', async () => {
    for (const c of [teacher, admin]) {
      for (const key of THEME_KEYS) {
        const r = await c.call('export_theme', { key });
        expect(r.isError, r.text).toBe(false);
        expect(r.data.package).toEqual(example(key));
        expect(r.data.package.key).toBe(`${key}-copy`);
        expect(r.data.note).toContain('own key');
      }
    }
  });

  it('an unknown key is still not found', async () => {
    const r = await teacher.call('export_theme', { key: 'no-such-theme' });
    expect(r.isError).toBe(true);
  });
});

describe('preview_theme (D-164)', () => {
  it('gives every contrast pair, the resolved colours with their source and the art fallback', async () => {
    const pkg = example('ocean');
    delete pkg.colors.accent;
    const r = await teacher.call('preview_theme', { package: pkg });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.report.ok).toBe(false);
    expect(r.data.base).toBe(pkg.base);
    expect(r.data.colors).toHaveLength(COLOR_TOKENS.length);
    const accent = r.data.colors.find((c: { token: string }) => c.token === 'accent');
    expect(accent).toEqual({ token: 'accent', value: example(pkg.base).colors.accent, source: 'base' });
    expect(r.data.colors.find((c: { token: string }) => c.token === 'print-ink').source).toBe('fixed');
    expect(r.data.contrast).toHaveLength(CONTRAST_PAIRS.length);
    for (const p of r.data.contrast) expect(p.pass).toBe(p.ratio >= p.min);
    expect(r.data.art.mascot.every((m: { source: string }) => m.source === (pkg.art?.mascot ? 'package' : 'base'))).toBe(true);
    expect(r.data.art.illustrations).toHaveLength(6);
  });

  it('a built-in example passes every pair and takes all art from its base', async () => {
    const r = await teacher.call('preview_theme', { package: JSON.stringify(example('explorer')) });
    expect(r.data.report.ok).toBe(true);
    expect(r.data.contrast.every((p: { pass: boolean }) => p.pass)).toBe(true);
    expect(r.data.art.decoration).toBe('base');
    expect(r.data.avatars.big.pass && r.data.avatars.small.pass).toBe(true);
  });

  it('shows an avatar-only contrast failure that the pair table cannot (review fix)', async () => {
    const pkg = example('explorer');
    pkg.avatar = { saturation: 20, lightness: 92, lightnessSmall: 92 };
    const r = await teacher.call('preview_theme', { package: pkg });
    expect(r.data.report.ok).toBe(false);
    expect(r.data.report.errors.some((e: { path: string }) => e.path.startsWith('avatar'))).toBe(true);
    expect(r.data.contrast.every((p: { pass: boolean }) => p.pass)).toBe(true);
    expect(r.data.avatars.small.pass).toBe(false);
    expect(r.data.avatars.small.ratio).toBeLessThan(r.data.avatars.small.min);
  });
});

describe('theme engine fields over MCP (S17a, D-166)', () => {
  it('theme_schema exposes scene, frame, ambient and sets with their presets', async () => {
    const r = await teacher.call('theme_schema', {});
    expect(r.isError, r.text).toBe(false);
    const props = r.data.schema.properties as Record<string, any>;
    for (const k of ['scene', 'frame', 'ambient', 'sets']) expect(props[k], k).toBeDefined();
    const text = JSON.stringify(props);
    for (const preset of ['snowDrift', 'scallop', 'torn', 'candyStripe', 'garland', 'lights', 'stitched', 'pencil', 'holly', 'compass', 'leaf', 'snowfall', 'leaves', 'snowflake', 'ornament', 'shield', 'bottomStrip'])
      expect(text, preset).toContain(`"${preset}"`);
    expect(r.data.schema.required).not.toContain('scene');
  });

  it('validate_theme accepts the Snow Day example and reports its scene', async () => {
    const r = await teacher.call('validate_theme', { package: example('peppermint-snow-day') });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.report.ok).toBe(true);
    expect(r.data.report.stats).toMatchObject({ sceneLayers: 3 });
    expect(r.data.report.stats.sceneNodes).toBeGreaterThan(0);
  });

  it('validate_theme rejects unknown presets, raw colours and over-limit scenes', async () => {
    const bad = (patch: (p: Record<string, any>) => void) => {
      const p = example('peppermint-snow-day');
      patch(p);
      return p;
    };
    const cases: Array<[string, Record<string, any>]> = [
      ['frame.edge', bad((p) => (p.frame.edge = 'icicles'))],
      ['frame.trimColors', bad((p) => (p.frame.trimColors = ['#ff0000', 'surface']))],
      ['frame.snowColor', bad((p) => (p.frame.snowColor = 'red;}body{color:red'))],
      ['ambient.preset', bad((p) => (p.ambient.preset = 'confetti'))],
      ['ambient.density', bad((p) => (p.ambient.density = 500))],
      ['sets.avatarFamiliesFirst', bad((p) => (p.sets.avatarFamiliesFirst = ['dragons']))],
      ['scene.layers', bad((p) => (p.scene.layers = [...p.scene.layers, p.scene.layers[0]]))],
      ['scene.layers.0.viewBox', bad((p) => (p.scene.layers[0].viewBox = '0 0 -5 10'))],
    ];
    for (const [path, pkg] of cases) {
      const r = await teacher.call('validate_theme', { package: pkg });
      expect(r.data.report.ok, path).toBe(false);
      expect(r.data.report.errors.map((e: { path: string }) => e.path).some((p: string) => p.startsWith(path)), `${path}: ${JSON.stringify(r.data.report.errors)}`).toBe(true);
    }
    const svg = await teacher.call('validate_theme', { package: bad((p) => (p.scene.layers[1].art = "<rect x='0' y='0' width='10' height='10' style='fill:red'/>")) });
    expect(svg.data.report.errors[0]).toMatchObject({ code: 'SVG', path: 'scene.layers.1.art' });
  });

  // S21a (D-173): avatar eyes and mouths on every avatar colour and skin tone.
  it('validate_theme reports avatar faces lost on a dark body; preview_theme shows the worst body', async () => {
    const pkg = example('ocean');
    pkg.colors['avatar-white'] = '#8a90a0';
    pkg.colors['avatar-navy'] = '#4a5aa0';
    const r = await teacher.call('validate_theme', { package: pkg });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.report.ok).toBe(false);
    expect(r.data.report.errors).toContainEqual(
      expect.objectContaining({ code: 'CONTRAST', path: 'colors.avatar-ink', params: expect.objectContaining({ fg: 'avatar-ink', or: 'avatar-white', bg: 'avatar-navy', min: 3 }) }),
    );
    const p = await teacher.call('preview_theme', { package: pkg });
    // A mid-grey rim also loses mid skin tones; the worst one is among the reported bodies.
    expect(p.data.avatars.features.worstBody).toMatchObject({ min: 3, pass: false });
    expect(r.data.report.errors.map((e: { params?: { bg?: string } }) => e.params?.bg)).toContain(p.data.avatars.features.worstBody.body);
    expect(p.data.avatars.features.inkOnRim.pass).toBe(true);
    const fine = await teacher.call('preview_theme', { package: example('ocean') });
    expect(fine.data.avatars.features.worstBody.pass).toBe(true);
    expect(fine.data.avatars.features.inkOnRim.pass).toBe(true);
  });

  it('preview_theme fills in the engine defaults and the derived scene-scrim', async () => {
    const pkg = example('peppermint-snow-day');
    delete pkg.colors['scene-scrim'];
    pkg.frame = { edge: 'scallop' };
    const r = await teacher.call('preview_theme', { package: pkg });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.report.ok).toBe(true);
    expect(r.data.report.warnings.map((w: { code: string }) => w.code)).toContain('SCRIM_DEFAULT');
    expect(r.data.colors.find((c: { token: string }) => c.token === 'scene-scrim')).toEqual({ token: 'scene-scrim', value: pkg.colors.surface, source: 'derived' });
    expect(r.data.engine.frame).toEqual({
      edge: 'scallop',
      trim: 'none',
      corners: 'none',
      apply: ['boardBoxes', 'studentCards', 'topBar'],
      trimOn: ['routine', 'core.timer'],
      snowColor: 'surface',
      trimColors: ['accent', 'surface'],
      cornerColors: ['border'],
    });
    expect(r.data.engine.scene.layers).toHaveLength(3);
    expect(r.data.engine.scene.layers.every((l: { elements: number | null }) => typeof l.elements === 'number')).toBe(true);
    expect(r.data.engine.ambient).toMatchObject({ preset: 'snowfall', speed: 'slow' });
    expect(r.data.engine.sets).toMatchObject({ achievementFrame: 'snowflake', mascotFrom: null });
    const plain = await teacher.call('preview_theme', { package: example('ocean') });
    expect(plain.data.engine).toEqual({ scene: null, frame: null, ambient: null, sets: null });
  });

  // S17b (D-168): sound styles over MCP.
  it('theme_schema lists the sound styles; validate_theme accepts each and rejects an unknown one', async () => {
    const r = await teacher.call('theme_schema', {});
    const sounds = (r.data.schema.properties as Record<string, any>).sounds;
    const style = (sounds.anyOf?.find((x: { type?: string }) => x.type === 'object') ?? sounds).properties.style;
    expect(style.enum).toEqual(['tones', 'bells', 'marimba', 'chimes', 'musicBox']);
    expect(String(style.description)).toContain('musicBox');
    for (const s of ['tones', 'bells', 'marimba', 'chimes', 'musicBox']) {
      const pkg = example('ocean');
      pkg.sounds.style = s;
      const ok = await teacher.call('validate_theme', { package: pkg });
      expect(ok.data.report.ok, s).toBe(true);
    }
    const pkg = example('ocean');
    pkg.sounds.style = 'kazoo';
    const bad = await teacher.call('validate_theme', { package: pkg });
    expect(bad.data.report.ok).toBe(false);
    expect(bad.data.report.errors.map((e: { path: string }) => e.path)).toContain('sounds.style');
  });

  it('preview_theme names the sound style; the Snow Day example rings bells, the built-ins their own styles', async () => {
    expect((await teacher.call('preview_theme', { package: example('peppermint-snow-day') })).data.soundStyle).toBe('bells');
    expect((await teacher.call('preview_theme', { package: example('ocean') })).data.soundStyle).toBe('tones');
    const expected = { explorer: 'marimba', animals: 'musicBox', classroom: 'chimes' } as const;
    for (const key of THEME_KEYS) {
      const back = await teacher.call('export_theme', { key });
      expect(back.data.package.sounds.style, key).toBe(expected[key]);
    }
  });

  it('import_theme_draft keeps the new fields (administrators)', async () => {
    const pkg = example('peppermint-snow-day');
    pkg.key = 'mcp-snow-draft';
    const r = await admin.call('import_theme_draft', { package: pkg });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.status).toBe('draft');
    const back = await admin.call('export_theme', { key: 'mcp-snow-draft' });
    expect(back.data.package.scene.layers).toHaveLength(3);
    expect(back.data.package.frame).toEqual(pkg.frame);
  });
});

describe('server instructions (D-164)', () => {
  it('tell the agent where theme work starts', async () => {
    const c = new Mcp(env, (await makeToken(school.teacherA, { scopes: ['classes:read'], name: 'Instr' })).secret);
    const init = await c.init();
    expect(init.instructions).toContain('classcompass://docs/theming');
    expect(init.instructions).toContain('validate_theme');
    expect(init.instructions).toContain('import_theme_draft');
  });
});
