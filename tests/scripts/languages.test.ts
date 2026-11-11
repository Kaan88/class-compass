/**
 * The interface language list (S26c, D-191): a language added with `npm run new:language` is offered only
 * when it is marked ready, and it may be marked ready only when `npm run check:language` passes (no key or
 * guide still marked untranslated, every file there, the English placeholders kept).
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLanguageCode } from '../../scripts/language-check.ts';
import { Locale as AuthLocale } from '../../src/shared/contracts/auth.ts';
import { Locale as SchoolLocale } from '../../src/shared/contracts/school.ts';
import { BASE_LOCALES, LANGUAGES, LOCALES, type LanguageCode } from '../../src/shared/languages.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const codes = Object.keys(LANGUAGES) as LanguageCode[];

describe('interface languages (S26c, D-191)', () => {
  it('English and Turkish are the base languages and ready; LOCALES holds exactly the ready languages', () => {
    for (const base of BASE_LOCALES) expect(LANGUAGES[base].ready, base).toBe(true);
    expect([...LOCALES]).toEqual(codes.filter((c) => LANGUAGES[c].ready));
    for (const c of codes) expect(isLanguageCode(c), c).toBe(true);
  });

  it('the contracts accept only ready languages', () => {
    for (const schema of [AuthLocale, SchoolLocale]) {
      for (const l of LOCALES) expect(schema.safeParse(l).success, l).toBe(true);
      for (const c of codes.filter((x) => !LANGUAGES[x].ready)) expect(schema.safeParse(c).success, c).toBe(false);
      expect(schema.safeParse('xx').success).toBe(false);
    }
  });

  it('every ready language besides English and Turkish passes `npm run check:language`', () => {
    for (const code of codes.filter((c) => LANGUAGES[c].ready && !(BASE_LOCALES as readonly string[]).includes(c))) {
      const out = (() => {
        try {
          return execFileSync(process.execPath, [join(ROOT, 'scripts', 'language-check.ts'), code, '--root', ROOT], { encoding: 'utf8', stdio: 'pipe' });
        } catch (err) {
          return String((err as { stdout?: string }).stdout ?? err);
        }
      })();
      expect(out, `${code} is marked ready in src/shared/languages.ts but is not translated yet`).toContain(`${code}: ready`);
    }
  });
});
