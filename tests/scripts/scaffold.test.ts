/**
 * Scaffolding scripts (SX): `new:module` and `new:theme` run against a temporary copy of the project
 * (src, tsconfig and package.json, node_modules linked), the result must typecheck, and the copy is deleted. The
 * planners are also checked in memory: a dry run writes nothing, existing keys are refused, and
 * every registry edit lands where expected.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
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
    const tr = byPath.get('src/shared/i18n/tr.ts')!.content;
    for (const k of ['module.demoWidget', 'demoWidget.title', 'theme.demoTheme', 'theme.demoTheme.description', 'theme.demoTheme.mascot']) {
      expect(byPath.get('src/shared/i18n/en.ts')!.content).toContain(`'${k}':`);
      expect(tr).toContain(`'${k}':`);
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

  it('generates a module and a theme that typecheck with the rest of the project', () => {
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
    ])
      expect(existsSync(join(tmp, f)), f).toBe(true);
    // Running again refuses instead of overwriting.
    expect(() => execFileSync(process.execPath, [join(ROOT, 'scripts', 'new-theme.ts'), 'demoTheme', '--root', tmp], { stdio: 'pipe' })).toThrow();

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
});
