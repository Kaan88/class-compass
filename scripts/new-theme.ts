/**
 * `npm run new:theme -- <key> [--dry-run] [--root <dir>]` (SX, D-070): scaffolds a theme.
 *
 * Copies the default theme folder (`src/client/themes/<default>/`: tokens, art, motion, sounds) to
 * `src/client/themes/<key>/` with renamed identifiers, adds the key to the shared THEME_KEYS (so
 * `classes.theme` accepts it) and to the client registry, adds its names to en + tr (Turkish marked
 * TODO) and a test stub. The copy fills every slot and passes the contrast and theme tests, so the
 * author changes it step by step with the tests green. See docs/EXTENDING.md "Add a theme".
 */
import { addMessages, humanize, lit, pascal, runCli, type Workspace } from './scaffold.ts';

const USAGE = 'Usage: npm run new:theme -- <camelCaseKey> [--dry-run] [--root <dir>]';
const FILES = ['tokens.ts', 'art.tsx', 'index.ts'] as const;

export function planTheme(ws: Workspace, key: string): void {
  const shared = 'src/shared/themes.ts';
  const keysLine = /export const THEME_KEYS = \[([^\]]*)\] as const;/;
  const m = keysLine.exec(ws.read(shared));
  if (!m) throw new Error(`THEME_KEYS not found in ${shared}`);
  const keys = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  if (keys.includes(key)) throw new Error(`Theme "${key}" already exists`);
  const def = /export const DEFAULT_THEME: ThemeKey = '([^']+)';/.exec(ws.read(shared))?.[1];
  if (!def) throw new Error(`DEFAULT_THEME not found in ${shared}`);
  const dir = `src/client/themes/${key}`;
  if (ws.exists(dir)) throw new Error(`${dir} already exists`);

  // 1. Shared key list (server validation of classes.theme, picker order).
  ws.replace(shared, keysLine, (_all, inner: string) => `export const THEME_KEYS = [${inner}, ${lit(key)}] as const;`);

  // 2. The theme folder, copied from the default theme with identifiers renamed.
  const P = pascal(key);
  const D = pascal(def);
  const note = `/* Scaffolded from the "${def}" theme by \`npm run new:theme\`: replace colours, typography, shape, art, motion and sounds (docs/EXTENDING.md). */\n`;
  for (const f of FILES) {
    const src = ws.read(`src/client/themes/${def}/${f}`);
    const renamed = src
      .replace(new RegExp(`\\b${D}(?=[A-Z])`, 'g'), P)
      .replace(new RegExp(`\\b${def}(?=Theme\\b|Illustrations\\b)`, 'g'), key)
      .replace(new RegExp(`'theme\\.${def}(\\.|')`, 'g'), `'theme.${key}$1`)
      .replace(new RegExp(`key: '${def}'`), `key: ${lit(key)}`);
    ws.create(`${dir}/${f}`, note + renamed);
  }

  // 3. Client registry (Record<ThemeKey, ThemeDefinition>: the typechecker insists on this line).
  const registry = 'src/client/themes/registry.ts';
  ws.insertBefore(registry, "import type { ThemeDefinition } from './types.ts';", `import { ${key}Theme } from './${key}/index.ts';\n`);
  ws.insertBefore(registry, '};', `  ${key}: ${key}Theme,\n`, 'export const THEMES');

  // 4. Names in both languages.
  const title = humanize(key);
  addMessages(ws, [
    [`theme.${key}`, title],
    [`theme.${key}.description`, `${title}: describe the look in one line.`],
    [`theme.${key}.mascot`, `${title} mascot`],
  ]);

  // 5. Test stub (the registry-wide theme tests already cover every slot of the new theme).
  ws.create(
    `tests/client/theme-${key}.test.ts`,
    `/** ${title} theme (stub from \`npm run new:theme\`). tests/client/themes.test.tsx checks every slot and contrast pair. */
import { describe, expect, it } from 'vitest';
import { contrastFailures } from '../../src/client/themes/contrast.ts';
import { THEMES } from '../../src/client/themes/registry.ts';

describe(${lit(`${key} theme`)}, () => {
  it('is registered and passes the contrast pairs', () => {
    const def = THEMES[${lit(key)}];
    expect(def.key).toBe(${lit(key)});
    expect(contrastFailures(def.colors, def.avatar)).toEqual([]);
  });

  it.todo('own art: mascot poses and illustrations differ from the ${def} theme it was copied from');
});
`,
  );
}

if (import.meta.main) {
  runCli(USAGE, planTheme, (key) =>
    [
      `Theme "${key}" scaffolded. Next, see docs/EXTENDING.md "Add a theme":`,
      `  - edit src/client/themes/${key}/tokens.ts (colours), art.tsx (mascot, illustrations), index.ts (motion, sounds)`,
      '  - translate the TODO(tr) strings in src/shared/i18n/tr.ts',
      '  - npm run check (contrast, slot and theme-lint tests), then look at /dev/catalog',
    ].join('\n'),
  );
}
