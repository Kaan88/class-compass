/**
 * The student page size budget (S14d, D-151): `scripts/student-budget.ts` adds up the gzip size of
 * what `student.html` loads before it renders (entry, module preloads, stylesheets; not lazy chunks)
 * and fails the build when the page or its entry is over budget.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { checkBudget, serverOnlyLeftovers, STUDENT_BUDGET, studentFiles } from '../../scripts/student-budget.ts';
import { stripMcpExposures } from '../../scripts/stripMcp.ts';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function fakeDist(entryBytes: number) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-budget-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  // Random bytes do not compress, so the gzip size is about the file size.
  fs.writeFileSync(path.join(dir, 'assets', 'student-x.js'), randomBytes(entryBytes));
  fs.writeFileSync(path.join(dir, 'assets', 'vendor-x.js'), 'export const a = 1;'.repeat(50));
  fs.writeFileSync(path.join(dir, 'assets', 'app-x.css'), 'body{color:red}'.repeat(50));
  fs.writeFileSync(path.join(dir, 'assets', 'Help-lazy.js'), 'x'.repeat(10));
  fs.writeFileSync(
    path.join(dir, 'student.html'),
    '<!doctype html><html><head><script type="module" crossorigin src="/assets/student-x.js"></script>' +
      '<link rel="modulepreload" crossorigin href="/assets/vendor-x.js"><link rel="stylesheet" crossorigin href="/assets/app-x.css"></head><body></body></html>',
  );
}

describe('student page size budget (D-151)', () => {
  it('counts the entry, the module preloads and the stylesheets, not lazy chunks', () => {
    fakeDist(2000);
    const files = studentFiles(dir);
    expect(files.map((f) => [f.path, f.entry])).toEqual([
      ['/assets/student-x.js', true],
      ['/assets/vendor-x.js', false],
      ['/assets/app-x.css', false],
    ]);
    expect(checkBudget(files)).toEqual([]);
  });

  it('fails when the entry or the whole page is over budget', () => {
    fakeDist(STUDENT_BUDGET.entry + 5000);
    expect(checkBudget(studentFiles(dir)).join(' ')).toMatch(/student entry \d+ B gzip is over the budget/u);
    expect(checkBudget(studentFiles(dir), { total: 100, entry: 1_000_000 }).join(' ')).toMatch(/student page total/u);
    expect(checkBudget([])).toEqual(['student.html loads no entry script']);
  });
});

describe('AI tool metadata stays out of the client bundles (S14i, D-151, D-160)', () => {
  const contractsDir = path.join(import.meta.dirname, '..', '..', 'src', 'shared', 'contracts');
  const syntaxErrors = (code: string) =>
    (ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } }).diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));

  it('strips every mcp exposure from the real contract files and leaves valid TypeScript with the same lines', () => {
    let exposures = 0;
    for (const file of fs.readdirSync(contractsDir).filter((f) => f.endsWith('.ts'))) {
      const code = fs.readFileSync(path.join(contractsDir, file), 'utf8');
      const tools = (code.match(/^\s*mcp:\s*\{/gmu) ?? []).length;
      exposures += tools;
      const out = stripMcpExposures(code);
      expect(out.match(/^\s*mcp:\s*\{/gmu), file).toBeNull();
      expect(out.split('\n').length, `${file} keeps its line numbers`).toBe(code.split('\n').length);
      if (tools > 0) expect(syntaxErrors(out), file).toEqual([]);
      else expect(out).toBe(code);
    }
    expect(exposures).toBeGreaterThan(20);
  });

  it('handles nested braces, strings with braces and quotes, templates and comments', () => {
    const src = [
      'export const a = endpoint({',
      "  path: '/x',",
      "  mcp: { scope: 'goals:read', tool: 't', readOnly: true, cost: 2, description: 'A } and a \\' quote, \"{\" too' },",
      '});',
      'export const b = endpoint({ path: `/y`, mcp: { tool: `u${1 + [{}].length}`, // note }',
      '  description: "two" /* } */ }, output: z.object({}) });',
      ' * mcp: { in a comment line } stays',
    ].join('\n');
    const out = stripMcpExposures(src);
    expect(out).not.toMatch(/tool:/u);
    expect(out).toContain("path: '/x',");
    expect(out).toContain('output: z.object({}) });');
    expect(out).toContain(' * mcp: { in a comment line } stays');
    expect(out.split('\n')).toHaveLength(7);
    expect(() => stripMcpExposures('x({ mcp: { tool: "t" ')).toThrow(/unterminated/u);
  });

  it('the budget check reports a loaded file that still carries the metadata', () => {
    fakeDist(2000);
    fs.writeFileSync(path.join(dir, 'assets', 'vendor-x.js'), 'const e=S({path:`/api/x`,mcp:{scope:`goals:read`,tool:`x`,readOnly:!0,description:`d`}});');
    expect(serverOnlyLeftovers(dir, studentFiles(dir))).toEqual([expect.stringContaining('/assets/vendor-x.js carries AI tool metadata')]);
    fs.writeFileSync(path.join(dir, 'assets', 'vendor-x.js'), 'export const a = 1;');
    expect(serverOnlyLeftovers(dir, studentFiles(dir))).toEqual([]);
  });
});
