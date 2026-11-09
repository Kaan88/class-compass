// @vitest-environment jsdom
/**
 * Built-in theme example packages (S16b, D-164): docs/examples/<key>.theme.json is exactly the package
 * Admin → Themes → Export downloads for each built-in theme (`packageFromDefinition`, key `<key>-copy`,
 * "(copy)" names), and every example passes `validateThemePackage`. The MCP server serves these files
 * as resources and export_theme returns them for built-in keys.
 *
 * `npm run docs:theme-examples` runs this file with CC_WRITE_THEME_EXAMPLES=1 to (re)write the files;
 * otherwise it fails when a built-in theme changed and the files were not regenerated. It runs under
 * jsdom because the client theme definitions carry TSX art.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageFromDefinition } from '../../src/client/themes/custom.tsx';
import { THEMES } from '../../src/client/themes/registry.ts';
import { translate } from '../../src/shared/i18n/index.ts';
import { THEME_KEYS } from '../../src/shared/themes.ts';
import { validateThemePackage } from '../../src/shared/themePackage/validate.ts';

const EXAMPLES = join(import.meta.dirname, '..', '..', 'docs', 'examples');
const lf = (s: string) => s.replace(/\r\n/gu, '\n');

/** The same key and names as the admin page's Export button (src/client/routes/admin/Themes.tsx). */
function render(key: (typeof THEME_KEYS)[number]): string {
  const pkg = packageFromDefinition(THEMES[key], { key: `${key}-copy`, copyOf: (l, name) => translate(l, 'themes.export.copyName', { name }) });
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

describe('built-in theme examples (D-164)', () => {
  it('docs/examples/<key>.theme.json is current for every built-in theme (run npm run docs:theme-examples)', () => {
    for (const key of THEME_KEYS) {
      const file = join(EXAMPLES, `${key}.theme.json`);
      const want = render(key);
      if (process.env.CC_WRITE_THEME_EXAMPLES === '1') writeFileSync(file, want);
      expect(lf(readFileSync(file, 'utf8')), key).toBe(want);
    }
  });

  it('every example package passes validateThemePackage', () => {
    const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.theme.json'));
    expect(files.length).toBeGreaterThanOrEqual(THEME_KEYS.length + 1);
    for (const f of files) {
      const { report } = validateThemePackage(readFileSync(join(EXAMPLES, f), 'utf8'));
      expect(report.errors, f).toEqual([]);
    }
  });
});
