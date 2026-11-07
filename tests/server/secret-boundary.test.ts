/**
 * Secrecy boundary (SEC-3, D-064): only the Secret Students module may read `secret_selections`
 * (and with it the chosen students' ids before the reveal). Every other source file is scanned for
 * the table object or its SQL name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ALLOWED = [path.join('src', 'server', 'modules', 'secret') + path.sep, path.join('src', 'server', 'db', 'schema.ts')];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

describe('secret selections boundary (SEC-3)', () => {
  it('no file outside src/server/modules/secret touches secret_selections', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src'))
      .map((f) => path.relative(ROOT, f))
      .filter((rel) => !ALLOWED.some((a) => rel === a || rel.startsWith(a)))
      .filter((rel) => /secretSelections|secret_selections/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the client never imports server code at all (so it cannot reach the table)', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src', 'client')).filter((f) => /from ['"][./]*\/server\//.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
