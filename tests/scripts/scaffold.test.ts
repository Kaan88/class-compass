/**
 * Scaffolding scripts (SX; `new:language` since S26c, D-191): `new:language`, `new:module` and `new:theme`
 * run against a temporary copy of the project (src, the English guides, tsconfig and package.json,
 * node_modules linked), the result must typecheck, and the copy is deleted. A scaffolded language is
 * not ready until `check:language` finds no untranslated key or guide. The
 * planners are also checked in memory: a dry run writes nothing, existing keys are refused, and
 * every registry edit lands where expected.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planModule } from '../../scripts/new-module.ts';
import { planTheme } from '../../scripts/new-theme.ts';
import { humanize, parseArgs, workspace } from '../../scripts/scaffold.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const run = (script: string, args: string[]) => execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' });

describe('scaffold planning (in memory)', () => {
  it('parses arguments and rejects keys that are not camelCase', () => {
    expect(parseArgs(['fooBar', '--dry-run'], 'u')).toMatchObject({ key: 'fooBar', dryRun: true });
    expect(() => parseArgs(['Foo'], 'u')).toThrow(/camelCase/);
    expect(() => parseArgs(['foo-bar'], 'u')).toThrow(/camelCase/);
    expect(() => parseArgs([], 'usage!')).toThrow(/usage!/);
    expect(() => parseArgs(['a1', '--force'], 'u')).toThrow(/Unknown option/);
    expect(humanize('homeworkTracker')).toBe('Homework tracker');
  });

  it('refuses existing modules and themes', () => {
    expect(() => planModule(workspace(ROOT), 'counters')).toThrow(/already/);
    expect(() => planTheme(workspace(ROOT), 'animals')).toThrow(/already exists/);
  });

  it('plans module and theme edits without touching the disk', () => {
    const ws = workspace(ROOT);
    planModule(ws, 'demoWidget');
    planTheme(ws, 'demoTheme');
    const byPath = new Map(ws.changes().map((c) => [c.path, c]));
    expect(byPath.get('src/shared/modules.ts')?.content).toContain("{ key: 'demoWidget', defaultAvailability: 'disabled' },\n] as const satisfies");
    expect(byPath.get('src/shared/themes.ts')?.content).toMatch(/THEME_KEYS = \[[^\]]*'demoTheme'\] as const/);
    expect(byPath.get('src/server/modules/index.ts')?.content).toMatch(/demoWidgetManifest,\n\];/);
    expect(byPath.get('src/client/modules/index.ts')?.content).toMatch(/demoWidgetClientManifest,\n\];/);
    expect(byPath.get('src/client/themes/registry.ts')?.content).toContain('  demoTheme: demoThemeTheme,\n};');
    // The student page names modules and themes (main dictionary); the rest is staff only (S23a, D-182).
    const tr = byPath.get('src/shared/i18n/tr.ts')!.content;
    for (const k of ['module.demoWidget', 'theme.demoTheme', 'theme.demoTheme.description', 'theme.demoTheme.mascot']) {
      expect(byPath.get('src/shared/i18n/en.ts')!.content).toContain(`'${k}':`);
      expect(tr).toContain(`'${k}':`);
    }
    for (const k of ['demoWidget.title', 'demoWidget.placeholder']) {
      expect(byPath.get('src/shared/i18n/areas/staff/en.ts')!.content).toContain(`'${k}':`);
      expect(byPath.get('src/shared/i18n/areas/staff/tr.ts')!.content).toContain(`'${k}':`);
      expect(byPath.get('src/shared/i18n/en.ts')!.content).not.toContain(`'${k}':`);
    }
    const index = byPath.get('src/client/themes/demoTheme/index.ts')!.content;
    expect(index).toContain("key: 'demoTheme'");
    expect(index).toContain("labelKey: 'theme.demoTheme'");
    expect(index).not.toMatch(/\bclassroom(Theme|Illustrations)\b|Classroom(Mascot|Pattern|Decoration)/);
    expect(existsSync(join(ROOT, 'src', 'client', 'themes', 'demoTheme'))).toBe(false);
    expect(existsSync(join(ROOT, 'src', 'server', 'modules', 'demoWidget'))).toBe(false);
  });
});

describe('scaffold scripts in a temporary project copy', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cc-scaffold-'));
    cpSync(join(ROOT, 'src'), join(tmp, 'src'), { recursive: true });
    for (const f of ['tsconfig.json', 'package.json']) cpSync(join(ROOT, f), join(tmp, f));
    cpSync(join(ROOT, 'docs', 'guides', 'en'), join(tmp, 'docs', 'guides', 'en'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'), 'junction');
  });
  afterAll(() => {
    if (!tmp) return;
    if (existsSync(join(tmp, 'node_modules'))) unlinkSync(join(tmp, 'node_modules')); // the link only, never the target
    rmSync(tmp, { recursive: true, force: true });
    expect(existsSync(tmp)).toBe(false);
  });

  it('a dry run lists the changes and writes nothing', () => {
    const before = readFileSync(join(tmp, 'src', 'shared', 'modules.ts'), 'utf8');
    const out = run('new-module.ts', ['demoWidget', '--dry-run', '--root', tmp]);
    expect(out).toContain('would create src/server/modules/demoWidget/manifest.ts');
    expect(readFileSync(join(tmp, 'src', 'shared', 'modules.ts'), 'utf8')).toBe(before);
    expect(existsSync(join(tmp, 'src', 'server', 'modules', 'demoWidget'))).toBe(false);
  });

  it('generates a language, a module and a theme that typecheck with the rest of the project', () => {
    // S26c (D-191): the language first, so the module and theme scaffolds add their keys to it too.
    run('new-language.ts', ['de', 'Deutsch', '--root', tmp]);
    run('new-module.ts', ['demoWidget', '--root', tmp]);
    run('new-theme.ts', ['demoTheme', '--root', tmp]);
    for (const f of [
      'src/server/modules/demoWidget/manifest.ts',
      'src/server/modules/demoWidget/commands.ts',
      'src/client/modules/demoWidget/manifest.tsx',
      'src/client/modules/demoWidget/DemoWidgetPanel.tsx',
      'tests/server/demoWidget.test.ts',
      'src/client/themes/demoTheme/index.ts',
      'src/client/themes/demoTheme/tokens.ts',
      'src/client/themes/demoTheme/art.tsx',
      'tests/client/theme-demoTheme.test.ts',
      'src/shared/i18n/de.ts',
      'src/shared/i18n/areas/staff/de.ts',
      'src/shared/i18n/areas/de/holidays.ts',
      'docs/guides/de/student.md',
    ])
      expect(existsSync(join(tmp, f)), f).toBe(true);
    // Running again refuses instead of overwriting.
    expect(() => execFileSync(process.execPath, [join(ROOT, 'scripts', 'new-theme.ts'), 'demoTheme', '--root', tmp], { stdio: 'pipe' })).toThrow();
    expect(() => execFileSync(process.execPath, [join(ROOT, 'scripts', 'new-language.ts'), 'de', 'Deutsch', '--root', tmp], { stdio: 'pipe' })).toThrow();
    // The language is listed but not ready, and has every key in English, marked (S26c, D-191).
    expect(readFileSync(join(tmp, 'src', 'shared', 'languages.ts'), 'utf8')).toContain("  de: { nativeName: 'Deutsch', ready: false },\n  // new:language adds");
    const de = readFileSync(join(tmp, 'src', 'shared', 'i18n', 'de.ts'), 'utf8');
    expect(de).toContain("  'common.cancel': 'Cancel', // TODO(de): translate\n");
    expect(de).toContain("  'module.demoWidget': 'Demo widget', // TODO(de): translate\n"); // added later by new:module
    expect(readFileSync(join(tmp, 'src', 'shared', 'i18n', 'areas', 'staff', 'de.ts'), 'utf8')).toContain("'demoWidget.title': ");
    expect(readFileSync(join(tmp, 'docs', 'guides', 'de', 'student.md'), 'utf8')).toMatch(/^<!-- TODO\(de\): translate -->\n# /u);

    const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const result = (() => {
      try {
        execFileSync(process.execPath, [tsc, '--noEmit', '-p', join(tmp, 'tsconfig.json')], { encoding: 'utf8', stdio: 'pipe' });
        return '';
      } catch (err) {
        return String((err as { stdout?: string }).stdout ?? err);
      }
    })();
    expect(result).toBe('');
  }, 300_000);

  it('the "ready" check of a scaffolded language fails while any key or guide is untranslated (S26c, D-191)', () => {
    const check = () => {
      try {
        return { ok: true, out: execFileSync(process.execPath, [join(ROOT, 'scripts', 'language-check.ts'), 'de', '--root', tmp], { encoding: 'utf8', stdio: 'pipe' }) };
      } catch (err) {
        return { ok: false, out: String((err as { stdout?: string }).stdout ?? err) };
      }
    };
    const dictFiles = ['src/shared/i18n/de.ts', 'src/shared/i18n/areas/staff/de.ts', ...readdirSync(join(tmp, 'src/shared/i18n/areas/de')).map((f) => `src/shared/i18n/areas/de/${f}`)];
    const edit = (rel: string, fn: (s: string) => string) => writeFileSync(join(tmp, rel), fn(readFileSync(join(tmp, rel), 'utf8')));
    const first = check();
    expect(first.ok).toBe(false);
    expect(first.out).toMatch(/de: not ready\nkeys still in English \(TODO\) \(\d{4,}\):/u);
    expect(first.out).toContain('src/shared/i18n/de.ts: common.cancel');

    // Translate everything except one key: still not ready, and it names that key.
    const unmark = (line: string) => (line.startsWith("  'holidays.title':") ? line : line.replace(/ \/\/ TODO\(de\): translate$/u, ''));
    for (const rel of dictFiles) edit(rel, (s) => s.split('\n').map(unmark).join('\n'));
    for (const g of readdirSync(join(tmp, 'docs/guides/de'))) edit(`docs/guides/de/${g}`, (s) => s.replace('<!-- TODO(de): translate -->\n', ''));
    const one = check();
    expect(one.ok).toBe(false);
    expect(one.out).toContain('keys still in English (TODO) (1):\n  src/shared/i18n/areas/de/holidays.ts: holidays.title');
    expect(one.out).not.toContain('guides still in English');

    // A translation that loses a placeholder is caught too.
    edit('src/shared/i18n/areas/de/holidays.ts', (s) => s.replace(' // TODO(de): translate', ''));
    edit('src/shared/i18n/de.ts', (s) => s.replace("'student.step': 'Step {n} of {total}'", "'student.step': 'Schritt {n} von {alle}'"));
    const placeholder = check();
    expect(placeholder.ok).toBe(false);
    expect(placeholder.out).toContain('placeholders differ from English (1):\n  src/shared/i18n/de.ts: student.step');

    edit('src/shared/i18n/de.ts', (s) => s.replace('{alle}', '{total}'));
    expect(check()).toEqual({ ok: true, out: 'de: ready (every key and guide translated)\n' });
  }, 120_000);
});
