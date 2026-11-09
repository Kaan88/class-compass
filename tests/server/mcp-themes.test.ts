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
