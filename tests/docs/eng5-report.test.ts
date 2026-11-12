/**
 * ENG-5 integration report (D-199): the report exists, is linked from ROADMAP, OPERATIONS and AGENTS.md,
 * every relative link in it resolves, and it carries no IP address (only hostnames already in the docs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '../..');
const reportPath = path.join(repo, 'docs/ENG-5-integration-report.md');
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('ENG-5 integration report (D-199)', () => {
  it('exists and is linked from ROADMAP, OPERATIONS and AGENTS.md', () => {
    expect(fs.existsSync(reportPath)).toBe(true);
    for (const doc of ['docs/ROADMAP.md', 'docs/OPERATIONS.md', 'AGENTS.md']) {
      expect(read(path.join(repo, doc)), doc).toContain('docs/ENG-5-integration-report.md');
    }
  });

  it('every relative link resolves', () => {
    const text = read(reportPath);
    const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? '');
    for (const target of targets.filter((t) => !/^[a-z]+:/i.test(t) && !t.startsWith('#'))) {
      const file = target.split('#')[0] ?? '';
      expect(fs.existsSync(path.resolve(path.dirname(reportPath), file)), target).toBe(true);
    }
  });

  it('contains no IP address', () => {
    expect(read(reportPath)).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  });
});
