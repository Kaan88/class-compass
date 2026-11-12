/**
 * Single-owner tables (CONVENTIONS; audit finding 3): only `avatars/pictures.ts` reads or writes
 * `avatar_pictures` (S24, D-184) and only `school/closures.ts` reads or writes `school_closures`
 * (S25b, D-186). Other modules ask the owner's exported helpers. The generic erasure, exports and the
 * import revert may name a table as a string; none may use its Drizzle table object.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../../src/server');
const OWNERS: Record<string, string> = {
  avatarPictures: 'modules/avatars/pictures.ts',
  schoolClosures: 'modules/school/closures.ts',
};

function serverFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? serverFiles(p) : /\.tsx?$/u.test(e.name) ? [p] : [];
  });
}

describe('single-owner tables (audit finding 3: avatar_pictures and school_closures are read only by their owners)', () => {
  it('no server file other than the owner (and the schema) imports the table object', () => {
    const offenders: string[] = [];
    for (const file of serverFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (rel === 'db/schema.ts') continue;
      const text = fs.readFileSync(file, 'utf8');
      // The names a file imports from the schema (multi-line import lists included).
      const imported = [...text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'[^']*db\/schema\.ts'/gu)].flatMap((m) => m[1]!.split(',').map((n) => n.trim().replace(/^type\s+/u, '')));
      for (const [table, owner] of Object.entries(OWNERS)) if (rel !== owner && imported.includes(table)) offenders.push(`${rel} uses ${table}`);
    }
    expect(offenders).toEqual([]);
  });
});
