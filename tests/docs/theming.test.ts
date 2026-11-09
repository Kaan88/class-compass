/**
 * Theming docs cannot drift (S14g, D-158, D-159): the token table and the limits in docs/THEMING.md
 * and docs/theme-package.schema.json are exactly what `npm run docs:theming` writes from the code;
 * every colour token is documented; the AI guidelines exist and point at the right files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtinColors, renderSchema, renderThemingMd, SCHEMA_JSON, THEMING_MD } from '../../scripts/theme-docs.ts';
import { COLOR_TOKENS, TOKEN_DOCS } from '../../src/shared/themePackage/tokens.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const lf = (s: string) => s.replace(/\r\n/gu, '\n');

describe('generated theming docs', () => {
  it('docs/THEMING.md has the current token table and limits (run npm run docs:theming)', async () => {
    const md = lf(readFileSync(THEMING_MD, 'utf8'));
    expect(md).toBe(renderThemingMd(md, await builtinColors()));
    for (const t of COLOR_TOKENS) expect(md, t).toContain(`| \`${t}\` |`);
  });

  it('docs/theme-package.schema.json is the current package schema (run npm run docs:theming)', () => {
    expect(lf(readFileSync(SCHEMA_JSON, 'utf8'))).toBe(renderSchema());
  });

  it('every colour token says what it is for', () => {
    for (const t of COLOR_TOKENS) expect(TOKEN_DOCS[t].use.length, t).toBeGreaterThan(10);
  });
});

describe('AI guidelines (D-159)', () => {
  it('AGENTS.md maps the project, its rules, commands and docs; CLAUDE.md includes it', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    for (const s of ['npm run check', 'npm run build', 'docs/CONVENTIONS.md', 'docs/EXTENDING.md', 'docs/THEMING.md', 'docs/DECISIONS.md', 'docs/ROADMAP.md', 'Co-Authored-By', 'git add -A']) expect(agents, s).toContain(s);
    expect(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')).toMatch(/^@AGENTS\.md$/mu);
    // Every repository path AGENTS.md names in backticks exists.
    const paths = [...agents.matchAll(/`((?:src|docs|scripts|tests|e2e|drizzle|deploy)\/[^`*<>\s]+)`/gu)].map((m) => m[1]!.replace(/[.,:;]$/u, ''));
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });

  it('THEMING.md says the MCP theme tools come with S14h and links the worked example', () => {
    const md = readFileSync(THEMING_MD, 'utf8');
    expect(md).toContain('MCP theme tools arrive with S14h');
    expect(md).toContain('examples/ocean.theme.json');
    expect(existsSync(join(ROOT, 'docs', 'examples', 'ocean.theme.json'))).toBe(true);
  });
});
