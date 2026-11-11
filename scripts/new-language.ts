/**
 * `npm run new:language -- <code> <native name> [--dry-run] [--root <dir>]` (S26c, D-191): scaffolds an
 * interface language, for example `npm run new:language -- de Deutsch`.
 *
 * - `src/shared/i18n/<code>.ts` (main dictionary, `Messages`), `src/shared/i18n/areas/staff/<code>.ts`
 *   (staff dictionary, `StaffMessages`) and `src/shared/i18n/areas/<code>/<area>.ts` for every other area
 *   dictionary: every key filled with the English text and marked `// TODO(<code>): translate`. They are
 *   type-checked against the English keys, so a key added later without this language fails `npm run check`
 *   (`addMessages` in `scaffold.ts` adds new keys to scaffolded languages too, marked the same way).
 * - `src/shared/languages.ts`: the language with `ready: false`, so no contract accepts it and nobody can
 *   choose it (it is not a `Locale`).
 * - `docs/guides/<code>/`: every English guide, marked `<!-- TODO(<code>): translate -->` at the top.
 *
 * `npm run check:language -- <code>` lists what is still untranslated; set `ready: true` only when it passes
 * (`tests/scripts/languages.test.ts` enforces it). Then the type checker lists the places that hold one entry
 * per locale (EXTENDING → "Add a language"). Labels teachers type stay `{ en, tr }`: not part of this scaffold.
 */
import { resolve } from 'node:path';
import { apply, workspace, type Workspace } from './scaffold.ts';
import { areaNames, englishDictionaries, guideNames, isLanguageCode, languagePaths, todoMark } from './language-check.ts';

const USAGE = 'Usage: npm run new:language -- <code> <native name> [--dry-run] [--root <dir>]   (e.g. de Deutsch)';
const LANGUAGES_FILE = 'src/shared/languages.ts';
const LIST_ANCHOR = '  // new:language adds languages above this line';

/** A single-quoted TS string literal on one line (newlines and quotes escaped). */
export const quote = (s: string) => `'${JSON.stringify(s).slice(1, -1).replace(/\\"/gu, '"').replace(/'/gu, "\\'")}'`;

export interface EnglishText {
  main: Record<string, string>;
  staff: Record<string, string>;
  areas: Record<string, Record<string, string>>;
  /** Guide file name → English Markdown. */
  guides: Record<string, string>;
}

/** The codes `src/shared/languages.ts` lists (ready or not). */
export function listedLanguages(ws: Workspace): string[] {
  return [...ws.read(LANGUAGES_FILE).matchAll(/^ {2}([a-z]{2,3}): \{ nativeName:/gmu)].map((m) => m[1]!);
}

function dictionary(code: string, entries: Record<string, string>, head: string, typeLine: string, tail: string): string {
  const mark = todoMark(code);
  const lines = Object.entries(entries).map(([k, v]) => `  ${quote(k)}: ${quote(v)}, // ${mark}\n`);
  return `${head}${typeLine}\nexport const ${code} = {\n${lines.join('')}}${tail}\n`;
}

export function planLanguage(ws: Workspace, code: string, nativeName: string, text: EnglishText): void {
  if (!isLanguageCode(code)) throw new Error(`"${code}" is not a language code: two or three lower-case letters (ISO 639), not a JavaScript keyword`);
  const name = nativeName.trim();
  if (!name || name.length > 40 || /['\\\n]/u.test(name)) throw new Error('The native name is required: at most 40 characters, without quotes or backslashes');
  if (listedLanguages(ws).includes(code)) throw new Error(`Language "${code}" already exists in ${LANGUAGES_FILE}`);
  const paths = languagePaths(code);
  // The header names the mark without its exact text, so only key lines count as untranslated.
  const how = (what: string) =>
    `/**\n * ${name} (${code}): ${what}.\n * Scaffolded by \`npm run new:language\` (S26c, D-191): every key started as the English text, marked\n * TODO(${code}) on its line. Translate the text and delete the mark. The language is offered only after\n * \`npm run check:language -- ${code}\` passes and \`ready: true\` is set in src/shared/languages.ts\n * (docs/EXTENDING.md → "Add a language").\n */\n`;

  // 1. Dictionaries, type-checked against the English keys.
  ws.create(paths.main, dictionary(code, text.main, how('strings the student page can show (main dictionary, D-182)'), "import type { Messages } from './en.ts';\n", ' as const satisfies Messages;'));
  ws.create(paths.staff, dictionary(code, text.staff, how('strings the student page never shows (staff dictionary, D-182)'), "import type { StaffMessages } from './en.ts';\n", ' as const satisfies StaffMessages;'));
  for (const area of Object.keys(text.areas))
    ws.create(paths.area(area), dictionary(code, text.areas[area]!, how(`strings of the area dictionary \`${area}\` (D-179)`), `import type { en } from '../${area}.ts';\n`, ' as const satisfies Record<keyof typeof en, string>;'));

  // 2. The language list, not ready.
  ws.insertBefore(LANGUAGES_FILE, LIST_ANCHOR, `  ${code}: { nativeName: ${quote(name)}, ready: false },\n`);

  // 3. The guides, in English with a mark.
  for (const [file, md] of Object.entries(text.guides)) ws.create(paths.guide(file), `<!-- ${todoMark(code)} -->\n${md}`);
}

/** Reads the English text the scaffold copies (dictionaries through their modules, guides as files). */
export async function englishText(root: string): Promise<EnglishText> {
  const dicts = await englishDictionaries(root);
  const ws = workspace(root);
  const guides: Record<string, string> = {};
  for (const file of guideNames(root)) guides[file] = ws.read(`docs/guides/en/${file}`);
  if (Object.keys(dicts.areas).length !== areaNames(root).length) throw new Error('An area dictionary could not be read');
  return { ...dicts, guides };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    let root = process.cwd();
    let dryRun = false;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--dry-run') dryRun = true;
      else if (a === '--root') {
        const v = args[++i];
        if (!v) throw new Error(`--root needs a directory\n${USAGE}`);
        root = resolve(v);
      } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}\n${USAGE}`);
      else rest.push(a);
    }
    const [code, ...nameParts] = rest;
    if (!code || nameParts.length === 0) throw new Error(USAGE);
    const ws = workspace(root);
    planLanguage(ws, code, nameParts.join(' '), await englishText(root));
    console.log(apply(root, ws.changes(), dryRun));
    if (!dryRun)
      console.log(
        [
          '',
          `Language "${code}" scaffolded, not ready (not offered to anyone). Next, see docs/EXTENDING.md "Add a language":`,
          `  - translate every line marked ${todoMark(code)} in ${languagePaths(code).main}, ${languagePaths(code).staff} and src/shared/i18n/areas/${code}/, and the guides in docs/guides/${code}/`,
          `  - npm run check:language -- ${code} until it says "ready", then set ready: true in src/shared/languages.ts`,
          '  - npm run check: the type checker then lists every place that needs the new locale',
        ].join('\n'),
      );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
