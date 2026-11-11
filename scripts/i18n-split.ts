/**
 * Which dictionary keys the personal student page can show (S23a, D-182).
 *
 * The student page has a gzip size budget (D-151) and loads the whole main dictionary
 * (`src/shared/i18n/en.ts` + `tr.ts`), so the main dictionary holds only the strings the student page
 * can show; every other string lives in the staff dictionary (`src/shared/i18n/areas/staff/`), which
 * every other entry (the teacher and admin app, Super Speakers, the server) registers at start.
 *
 * This finds the keys statically: it follows every import (static, re-export and dynamic `import()`,
 * never `import type`) from the student entry and collects the string literals of those files. A key
 * is used when it appears as a literal (its `_one` / `_other` plural forms follow it) or starts with
 * the fixed head of a template literal (`\`module.${key}\`` keeps every `module.…` key). That over-counts
 * (any literal equal to a key keeps it) and never under-counts a key written in the code.
 * `tests/scripts/i18n-split.test.ts` checks that the split matches.
 *
 *   node scripts/i18n-split.ts            list the keys that sit in the wrong dictionary
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STUDENT_ENTRY = join(ROOT, 'src', 'client', 'student', 'main.tsx');

/** Every source file the entry loads, eagerly or lazily (type-only imports excluded). */
export function reachableFiles(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const add = (spec: string) => {
      if (!spec.startsWith('.') || !/\.tsx?$/u.test(spec)) return;
      const target = resolve(dirname(file), spec);
      if (existsSync(target)) queue.push(target);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const typeOnly = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly));
        if (!typeOnly) add(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        add(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return [...seen].sort();
}

/** The string literals and the fixed heads of template literals in the given files. */
export function stringRefs(files: readonly string[]): { literals: Set<string>; heads: Set<string> } {
  const literals = new Set<string>();
  const heads = new Set<string>();
  for (const file of files) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node)) literals.add(node.text);
      else if (ts.isTemplateExpression(node) && node.head.text) heads.add(node.head.text);
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return { literals, heads };
}

/** The keys (of `keys`) that the student page can show. */
export function studentKeys(keys: readonly string[], entry = STUDENT_ENTRY): Set<string> {
  // The dictionaries themselves are not uses of their keys.
  const code = reachableFiles(entry).filter((f) => !/[\\/]src[\\/]shared[\\/]i18n[\\/]/u.test(f));
  const { literals, heads } = stringRefs(code);
  // A head must name at least a namespace (`module.`), so `${a}${b}` or `'.'` keeps nothing.
  const prefixes = [...heads].filter((h) => /^[\w-]+\./u.test(h));
  const used = new Set<string>();
  for (const k of keys) {
    const base = k.replace(/_(?:zero|one|two|few|many|other)$/u, '');
    if (literals.has(k) || literals.has(base) || prefixes.some((p) => k.startsWith(p))) used.add(k);
  }
  return used;
}

/** Keys in the wrong dictionary: student keys in the staff dictionary and staff keys in the main one. */
export async function misplacedKeys(): Promise<{ toMain: string[]; toStaff: string[] }> {
  const { en } = await import('../src/shared/i18n/en.ts');
  const { en: staffEn } = await import('../src/shared/i18n/areas/staff/en.ts');
  const used = studentKeys([...Object.keys(en), ...Object.keys(staffEn)]);
  return {
    toMain: Object.keys(staffEn).filter((k) => used.has(k)),
    toStaff: Object.keys(en).filter((k) => !used.has(k)),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(`/${process.argv[1].replace(/\\/gu, '/').split('/').pop()!}`);
if (isMain) {
  const files = reachableFiles(STUDENT_ENTRY);
  const { toMain, toStaff } = await misplacedKeys();
  console.log(`student page: ${files.length} source files`);
  if (process.argv.includes('--files')) for (const f of files) console.log(`  ${relative(ROOT, f)}`);
  for (const k of toMain) console.log(`move to en.ts/tr.ts (the student page shows it): ${k}`);
  for (const k of toStaff) console.log(`move to areas/staff/ (only other pages show it): ${k}`);
  if (toMain.length || toStaff.length) process.exit(1);
}
