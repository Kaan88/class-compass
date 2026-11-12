/**
 * Shared code the personal student page does not need stays out of it (S26c, D-191; budget D-151,
 * D-182). Follows the imports of the student entry: what it never uses must not be reachable at all,
 * and what only a writing screen or an imported theme needs must be behind a lazy `import()`.
 * Measured with `npm run build` and `npm run size:student`: 368.6 → 345.1 kB gzip (entry 21.3 → 10.2 kB).
 */
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reachableFiles, ROOT, STUDENT_ENTRY } from '../../scripts/i18n-split.ts';

const rel = (f: string) => relative(ROOT, f).replace(/\\/gu, '/');

describe('student page imports (S26c, D-191)', () => {
  const all = reachableFiles(STUDENT_ENTRY).map(rel);
  const eager = reachableFiles(STUDENT_ENTRY, { lazy: false }).map(rel);

  it('never loads the AI tools vocabulary or the theme package checks', () => {
    expect(all).toContain('src/shared/contracts/define.ts');
    expect(all).toContain('src/shared/pii.ts'); // the personal-data marks every contract uses
    for (const f of ['src/shared/mcp.ts', 'src/shared/contracts/mcp.ts', 'src/shared/themePackage/validate.ts', 'src/shared/themePackage/contrast.ts', 'src/shared/themePackage/index.ts'])
      expect(all, f).not.toContain(f);
  });

  it('loads the imported-theme code and the writing screens only when they are needed', () => {
    expect(eager).toContain('src/client/themes/customLoader.ts');
    expect(eager).toContain('src/client/student/screens/MyGoals.tsx');
    for (const f of [
      'src/client/themes/custom.tsx',
      'src/shared/themePackage/schema.ts',
      'src/shared/themePackage/svg.ts',
      'src/client/student/screens/NewGoal.tsx',
      'src/client/student/screens/HowIsItGoing.tsx',
      'src/client/student/screens/ShowMyWork.tsx',
      'src/client/student/screens/GoalAddWork.tsx', // My goals' "Add my work" (S27b, D-194)
      'src/client/modules/goals/EvidenceAdder.tsx',
      'src/client/student/SentenceStarters.tsx',
      'src/client/student/common.tsx',
      'src/shared/text/textQuality.ts',
      // The large word lists (S28b, D-198): behind their own import(), loaded only when the small lists miss a word.
      'src/shared/text/largeWords.ts',
      'src/shared/text/wordsLargeEn.ts',
      'src/shared/text/wordsLargeTr.ts',
    ]) {
      expect(eager, f).not.toContain(f);
      expect(all, f).toContain(f);
    }
  });

  it('the writing screens load the large word lists only with their own import() (S28b, D-198)', () => {
    const writing = reachableFiles(join(ROOT, 'src', 'client', 'student', 'common.tsx'), { lazy: false }).map(rel);
    expect(writing).toContain('src/shared/text/textQuality.ts');
    for (const f of ['src/shared/text/largeWords.ts', 'src/shared/text/wordsLargeEn.ts', 'src/shared/text/wordsLargeTr.ts']) expect(writing, f).not.toContain(f);
  });
});
