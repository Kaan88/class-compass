/**
 * The split of the strings between the main dictionary and the staff dictionary (S23a, D-182; budget
 * D-151). The student page loads only the main dictionary (`src/shared/i18n/en.ts`, `tr.ts`); every
 * other entry and the server also register the staff dictionary (`src/shared/i18n/areas/staff.ts`).
 * `scripts/i18n-split.ts` finds the keys the student page can show by following its imports.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { misplacedKeys, reachableFiles, ROOT, STUDENT_ENTRY, studentKeys } from '../../scripts/i18n-split.ts';
import { en as mainEn } from '../../src/shared/i18n/en.ts';
import { en as staffEn } from '../../src/shared/i18n/areas/staff.ts';
import { hasMessage, translate } from '../../src/shared/i18n/index.ts';

const p = (...parts: string[]) => join(ROOT, ...parts);
const rel = (f: string) => relative(ROOT, f).replace(/\\/gu, '/');
const STAFF = p('src', 'shared', 'i18n', 'areas', 'staff.ts');
const OTHER_ENTRIES = [p('src', 'client', 'main.tsx'), p('src', 'client', 'scorer', 'main.tsx'), p('src', 'client', 'board', 'main.tsx')];

describe('main and staff dictionaries (S23a, D-182)', () => {
  it('the main dictionary holds exactly the keys the student page can show (run `node scripts/i18n-split.ts` to list the ones to move)', async () => {
    const { toMain, toStaff } = await misplacedKeys();
    expect(toMain, 'keys the student page shows, but they sit in areas/staff/: move them to en.ts and tr.ts').toEqual([]);
    expect(toStaff, 'keys only other pages show, but they sit in en.ts/tr.ts: move them to areas/staff/en.ts and tr.ts').toEqual([]);
  });

  it('the student page never imports the staff dictionary or another area', () => {
    const files = reachableFiles(STUDENT_ENTRY).map(rel);
    expect(files).toContain('src/client/student/StudentApp.tsx');
    expect(files.filter((f) => f.startsWith('src/shared/i18n/areas/'))).toEqual([]);
  });

  it('every other entry registers the staff dictionary with its first import', () => {
    for (const entry of OTHER_ENTRIES) {
      const first = /^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/mu.exec(readFileSync(entry, 'utf8'))?.[1];
      expect(first, rel(entry)).toMatch(/\/shared\/i18n\/areas\/staff\.ts$/u);
      expect(reachableFiles(entry), rel(entry)).toContain(STAFF);
    }
  });

  it('server code takes translate from server/lib/i18n.ts, which registers the staff dictionary', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    // A value import (not `import type`, not `type X`) of the shared i18n index bypasses the wrapper.
    const valueImport = (src: string) =>
      [...src.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'[./]+\/shared\/i18n\/index\.ts'/gmu)].some(
        (m) => !m[1] && m[2]!.split(',').some((n) => n.trim() && !n.trim().startsWith('type ')),
      );
    const offenders = walk(p('src', 'server'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith(join('lib', 'i18n.ts')))
      .filter((f) => valueImport(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
    expect(readFileSync(p('src', 'server', 'lib', 'i18n.ts'), 'utf8')).toContain("import '../../shared/i18n/areas/staff.ts';");
  });

  it('every key the teacher, admin and Super Speakers code names resolves in the dictionaries those pages load', () => {
    // MessageKey (main + every area) already makes the type checker refuse an unknown literal key; this
    // checks the loading side: a key named in an entry's code is in the main or staff dictionary, which
    // the entry registers first, or in an area dictionary the same entry imports.
    const areaFiles = readdirSync(p('src', 'shared', 'i18n', 'areas')).filter((f) => f.endsWith('.ts') && f !== 'keys.ts' && f !== 'staff.ts');
    const areas = areaFiles.map((f) => ({ file: p('src', 'shared', 'i18n', 'areas', f), keys: new Set(Object.keys(readAreaKeys(f))) }));
    // Each source file is read once (S25b: reading it again for every key of every area outgrew the timeout).
    const sources = new Map<string, string>();
    const source = (f: string) => {
      let s = sources.get(f);
      if (s === undefined) sources.set(f, (s = readFileSync(f, 'utf8')));
      return s;
    };
    for (const entry of OTHER_ENTRIES) {
      const files = reachableFiles(entry);
      for (const area of areas) {
        const used = files.filter((f) => f !== area.file && [...area.keys].some((k) => source(f).includes(`'${k}'`)));
        if (used.length) expect(files, `${rel(entry)} uses keys of ${rel(area.file)} (in ${used.map(rel).join(', ')}) but never imports it`).toContain(area.file);
      }
    }
    // With the staff dictionary registered (tests/setup.ts, like every entry), every key translates.
    for (const k of [...Object.keys(mainEn), ...Object.keys(staffEn)]) {
      expect(hasMessage(k), k).toBe(true);
      expect(translate('tr', k), k).not.toBe(k);
    }
  });

  it('studentKeys follows literals, plural forms and template heads', () => {
    const used = studentKeys(['save.offline', 'save.offline_one', 'save.offline_other', 'error.S23A_FAKE', 'module.s23aFake', 'admin.s23aFake', 'notAKey']);
    expect([...used].sort()).toEqual(['error.S23A_FAKE', 'module.s23aFake', 'save.offline', 'save.offline_one', 'save.offline_other'].sort());
  });
});

function readAreaKeys(file: string): Record<string, string> {
  // The `en` object of an area file, read from the source (importing it would register it).
  const src = readFileSync(p('src', 'shared', 'i18n', 'areas', file), 'utf8');
  const body = /export const en = \{([\s\S]*?)\n\};?/u.exec(src)?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/^\s*'([^']+)':/gmu)].map((m) => [m[1]!, '']));
}
