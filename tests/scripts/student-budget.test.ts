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
import { checkBudget, STUDENT_BUDGET, studentFiles } from '../../scripts/student-budget.ts';

let dir: string;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

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
