/**
 * `npm run docs:theme-examples` (S16b, D-164): writes docs/examples/<key>.theme.json for every built-in
 * theme by running tests/docs/theme-examples.test.ts with CC_WRITE_THEME_EXAMPLES=1 (the theme
 * definitions carry TSX art, so the export runs under vitest/jsdom like the admin page's code).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const r = spawnSync('npx vitest run tests/docs/theme-examples.test.ts', { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, CC_WRITE_THEME_EXAMPLES: '1' } });
process.exit(r.status ?? 1);
