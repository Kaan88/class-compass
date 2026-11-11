/**
 * Avatar eyes and mouths in the theme package validator (S21a, D-173; S17c D-169; THM-3, UX-6). The
 * validator applies the same rule as the readability test of the built-in themes: the ink or its light
 * rim reaches 3:1 on every avatar colour and skin tone of the catalogue, and the ink stands out from its
 * rim. Failures are CONTRAST errors (like every other contrast pair) on `colors.avatar-ink`. Every
 * built-in theme and every example package passes. Fictional data only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_RIM } from '../../src/client/avatars/AvatarArt.tsx';
import { THEME_LIST } from '../../src/client/themes/registry.ts';
import { AVATAR_COLOURS, SKIN_TONES } from '../../src/shared/avatars.ts';
import { AVATAR_BODY_TOKENS, AVATAR_FEATURE_INK, AVATAR_FEATURE_MIN, AVATAR_FEATURE_RIM, avatarFeatureFailures, contrast, contrastFailures } from '../../src/shared/themePackage/contrast.ts';
import { COLOR_TOKENS, type ThemeColors } from '../../src/shared/themePackage/tokens.ts';
import { packageColors, validateThemePackage } from '../../src/shared/themePackage/validate.ts';

const EXAMPLES = join(import.meta.dirname, '..', '..', 'docs', 'examples');
const example = (file: string) => JSON.parse(readFileSync(join(EXAMPLES, file), 'utf8')) as Record<string, any>;
const ocean = () => example('ocean.theme.json');

describe('avatar features in the theme package validator (D-173)', () => {
  it('checks the tokens the faces are drawn with, on every catalogue colour and skin tone', () => {
    expect([AVATAR_FEATURE_INK, AVATAR_FEATURE_RIM]).toEqual([FEATURE_RIM.ink, FEATURE_RIM.token]);
    expect(AVATAR_FEATURE_MIN).toBe(3);
    expect(AVATAR_BODY_TOKENS).toEqual([...AVATAR_COLOURS.map((c) => `avatar-${c}`), ...SKIN_TONES.map((_, i) => `avatar-skin-${i + 1}`)]);
    for (const t of AVATAR_BODY_TOKENS) expect(COLOR_TOKENS, t).toContain(t);
  });

  it('every built-in theme and every docs/examples package passes, and validates without errors', () => {
    for (const def of THEME_LIST) {
      expect(avatarFeatureFailures(def.colors), def.key).toEqual([]);
      expect(contrastFailures(def.colors, def.avatar), def.key).toEqual([]);
    }
    const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.theme.json'));
    expect(files).toContain('ocean.theme.json');
    expect(files).toContain('peppermint-snow-day.theme.json');
    for (const file of files) {
      const pkg = example(file);
      expect(avatarFeatureFailures(packageColors(pkg as never)), file).toEqual([]);
      // The built-in themes' own keys are refused as package keys; everything else must pass.
      const { report } = validateThemePackage(JSON.stringify({ ...pkg, key: `copy-${pkg.key}`.slice(0, 40) }));
      expect(report.errors, file).toEqual([]);
    }
  });

  it('reports a face that is lost on a dark avatar body: a mid-grey rim leaves the dark ink without contrast on navy', () => {
    const pkg = ocean();
    pkg.colors['avatar-ink'] = '#1d2033';
    pkg.colors['avatar-white'] = '#8a90a0';
    pkg.colors['avatar-navy'] = '#4a5aa0';
    const navy = Math.max(contrast('#1d2033', '#4a5aa0'), contrast('#8a90a0', '#4a5aa0'));
    expect(navy).toBeLessThan(3);
    const { report, pkg: ok } = validateThemePackage(JSON.stringify(pkg));
    expect(ok).toBeNull();
    const err = report.errors.find((e) => e.code === 'CONTRAST' && e.params?.bg === 'avatar-navy');
    expect(err, JSON.stringify(report.errors)).toMatchObject({
      path: 'colors.avatar-ink',
      params: { fg: 'avatar-ink or avatar-white', bg: 'avatar-navy', ratio: Math.round(navy * 100) / 100, min: 3 },
    });
    expect(err!.message).toContain('avatar eyes and mouths');
    // Ink on its own rim is still fine here.
    expect(report.errors.some((e) => e.params?.bg === 'avatar-white')).toBe(false);
  });

  it('reports ink that does not stand out from its rim, and a face lost on the darkest skin tone', () => {
    const pkg = ocean();
    pkg.colors['avatar-ink'] = '#4a4f5c';
    pkg.colors['avatar-white'] = '#6e7380';
    pkg.colors['avatar-skin-12'] = '#5b3a2a';
    const { report } = validateThemePackage(pkg);
    const pairs = report.errors.filter((e) => e.code === 'CONTRAST').map((e) => `${e.path} ${String(e.params?.fg)} / ${String(e.params?.bg)}`);
    expect(pairs).toContain('colors.avatar-ink avatar-ink / avatar-white');
    expect(pairs).toContain('colors.avatar-ink avatar-ink or avatar-white / avatar-skin-12');
  });

  it('a package that only darkens one avatar colour still passes while the white rim reads on it', () => {
    const pkg = ocean();
    pkg.colors['avatar-navy'] = '#0b0f2a';
    expect(validateThemePackage(pkg).report.errors).toEqual([]);
    const colors = packageColors(pkg as never) as ThemeColors;
    expect(contrast(colors['avatar-white'], '#0b0f2a')).toBeGreaterThanOrEqual(3);
  });
});
