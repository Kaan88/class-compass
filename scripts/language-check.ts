/**
 * `npm run check:language -- <code> [--root <dir>]` (S26c, D-191): is a scaffolded language ready to offer?
 *
 * `npm run new:language` writes every key of a new language as the English text with a
 * `// TODO(<code>): translate` mark on its line, and every guide with a `<!-- TODO(<code>): translate -->`
 * line. A language is ready when no mark is left, every dictionary file and guide exists (areas and guides
 * added after the scaffold need their own), and every translation keeps the English `{placeholders}`.
 * Only then may `ready: true` be set in `src/shared/languages.ts`; `tests/scripts/languages.test.ts` runs this
 * check for every ready language that is not English or Turkish. See docs/EXTENDING.md → "Add a language".
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The languages every dictionary is written in first (no marks to check). */
export const BASE_LANGUAGES = ['en', 'tr'] as const;
/** ISO 639 codes: two or three lower-case letters. JavaScript keywords cannot name the dictionary export. */
export const LANGUAGE_CODE = /^[a-z]{2,3}$/u;
const KEYWORDS = new Set(['do', 'if', 'in', 'for', 'let', 'new', 'try', 'var']);
export const isLanguageCode = (code: string): boolean => LANGUAGE_CODE.test(code) && !KEYWORDS.has(code);

export const todoMark = (code: string) => `TODO(${code}): translate`;

/** Where a language's files live, relative to the project root. */
export const languagePaths = (code: string) => ({
  main: `src/shared/i18n/${code}.ts`,
  staff: `src/shared/i18n/areas/staff/${code}.ts`,
  area: (area: string) => `src/shared/i18n/areas/${code}/${area}.ts`,
  guide: (name: string) => `docs/guides/${code}/${name}`,
});

/** The area dictionaries besides the staff one, from the type list in `areas/keys.ts` (S19a, D-179). */
export function areaNames(root: string): string[] {
  const keys = readFileSync(join(root, 'src/shared/i18n/areas/keys.ts'), 'utf8');
  return [...keys.matchAll(/import\('\.\/([A-Za-z0-9]+)\.ts'\)\.en/gu)].map((m) => m[1]!).filter((a) => a !== 'staff');
}

/** The English guides (`docs/guides/en/*.md`); none when the folder is missing (a partial project copy). */
export function guideNames(root: string): string[] {
  const dir = join(root, 'docs/guides/en');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
}

type Dict = Record<string, string>;
/** Imports a dictionary module of `root` afresh (a query string defeats the module cache after an edit). */
async function importDict(root: string, rel: string, name: string): Promise<Dict> {
  const url = `${pathToFileURL(join(root, rel)).href}?v=${Date.now()}-${Math.random()}`;
  const mod = (await import(url)) as Record<string, unknown>;
  const dict = mod[name];
  if (!dict || typeof dict !== 'object') throw new Error(`${rel} does not export ${name}`);
  return dict as Dict;
}

/** The English text of every dictionary: main, staff and each area. */
export async function englishDictionaries(root: string): Promise<{ main: Dict; staff: Dict; areas: Record<string, Dict> }> {
  const areas: Record<string, Dict> = {};
  for (const area of areaNames(root)) areas[area] = await importDict(root, `src/shared/i18n/areas/${area}.ts`, 'en');
  return { main: await importDict(root, 'src/shared/i18n/en.ts', 'en'), staff: await importDict(root, 'src/shared/i18n/areas/staff/en.ts', 'en'), areas };
}

export interface LanguageReport {
  code: string;
  /** Dictionary files and guides that do not exist yet. */
  missing: string[];
  /** Keys still marked untranslated, as `file: key`. */
  untranslated: string[];
  /** Guides still marked untranslated. */
  untranslatedGuides: string[];
  /** Keys whose `{placeholders}` differ from the English text, as `file: key`. */
  placeholders: string[];
  ready: boolean;
}

const placeholdersOf = (s: string) => [...s.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]!).sort().join(',');

/** Checks one language (never English or Turkish) in the project at `root`. */
export async function languageReport(root: string, code: string): Promise<LanguageReport> {
  if (!isLanguageCode(code)) throw new Error(`"${code}" is not a language code (two or three lower-case letters)`);
  if ((BASE_LANGUAGES as readonly string[]).includes(code)) throw new Error(`${code} is a base language; its keys are checked by tests/client/lint-rules.test.ts`);
  const paths = languagePaths(code);
  const english = await englishDictionaries(root);
  const report: LanguageReport = { code, missing: [], untranslated: [], untranslatedGuides: [], placeholders: [], ready: false };
  const mark = todoMark(code);
  const dicts: Array<[rel: string, en: Dict]> = [[paths.main, english.main], [paths.staff, english.staff], ...Object.entries(english.areas).map(([a, d]) => [paths.area(a), d] as [string, Dict])];
  for (const [rel, en] of dicts) {
    if (!existsSync(join(root, rel))) {
      report.missing.push(rel);
      continue;
    }
    for (const line of readFileSync(join(root, rel), 'utf8').split('\n')) {
      if (!line.includes(mark)) continue;
      report.untranslated.push(`${rel}: ${/^\s*'((?:[^'\\]|\\.)+)'\s*:/u.exec(line)?.[1] ?? line.trim()}`);
    }
    const own = await importDict(root, rel, code);
    for (const [key, text] of Object.entries(en)) if (typeof own[key] === 'string' && placeholdersOf(own[key]) !== placeholdersOf(text)) report.placeholders.push(`${rel}: ${key}`);
  }
  for (const name of guideNames(root)) {
    const rel = paths.guide(name);
    if (!existsSync(join(root, rel))) report.missing.push(rel);
    else if (readFileSync(join(root, rel), 'utf8').includes(mark)) report.untranslatedGuides.push(rel);
  }
  report.ready = report.missing.length + report.untranslated.length + report.untranslatedGuides.length + report.placeholders.length === 0;
  return report;
}

/** One line per finding, for the command line and test messages. */
export function formatReport(r: LanguageReport): string {
  if (r.ready) return `${r.code}: ready (every key and guide translated)`;
  const part = (title: string, items: string[]) => (items.length ? [`${title} (${items.length}):`, ...items.slice(0, 20).map((x) => `  ${x}`), ...(items.length > 20 ? [`  … and ${items.length - 20} more`] : [])] : []);
  return [
    `${r.code}: not ready`,
    ...part('missing files', r.missing),
    ...part('keys still in English (TODO)', r.untranslated),
    ...part('guides still in English (TODO)', r.untranslatedGuides),
    ...part('placeholders differ from English', r.placeholders),
  ].join('\n');
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at >= 0 ? resolve(args[at + 1] ?? '.') : process.cwd();
  const code = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root');
  if (!code) {
    console.error('Usage: npm run check:language -- <code> [--root <dir>]');
    process.exitCode = 1;
  } else {
    try {
      const report = await languageReport(root, code);
      console.log(formatReport(report));
      if (!report.ready) process.exitCode = 1;
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }
}
