/**
 * The interface languages (S26c, D-191). English and Turkish are complete; `npm run new:language -- <code>
 * <native name>` adds a language here with `ready: false`, next to its dictionaries (every key in English,
 * marked `TODO(<code>)`) and a guide folder (docs/EXTENDING.md → "Add a language").
 *
 * A language that is not ready is not a `Locale`: no contract accepts it (`Locale` in
 * `contracts/auth.ts` and `contracts/school.ts` is built from `LOCALES`), so nobody can choose it. Setting
 * `ready: true` is checked: `tests/scripts/languages.test.ts` fails while a key or a guide is still
 * marked (`npm run check:language -- <code>` lists them), and the type checker then asks for every place
 * that holds one entry per locale (plural rules, dictionaries, pickers).
 *
 * Interface languages are not class languages: the labels teachers type (counter names, goal
 * categories …) are stored as `{ en, tr }` (`pickText`, `LangFields`), so a class's main and second
 * language stay English or Turkish (`BASE_LOCALES`, `shared/classLanguage.ts`) until a decision and a
 * migration change that (EXTENDING → "Add a language").
 */
export interface LanguageInfo {
  /** The language's own name, as its speakers write it (shown in language pickers). */
  nativeName: string;
  /** Offered to users. Only true when every key and guide is translated (see above). */
  ready: boolean;
}

export const LANGUAGES = {
  en: { nativeName: 'English', ready: true },
  tr: { nativeName: 'Türkçe', ready: true },
  // new:language adds languages above this line
} as const satisfies Record<string, LanguageInfo>;

/** Every language in the list, ready or not. */
export type LanguageCode = keyof typeof LANGUAGES;
/** The languages users can choose: those marked ready. */
export type Locale = { [K in LanguageCode]: (typeof LANGUAGES)[K]['ready'] extends true ? K : never }[LanguageCode];

const isReady = (code: LanguageCode): code is Locale => LANGUAGES[code].ready;
/** The ready languages, in list order (a tuple type, so `z.enum(LOCALES)` works). */
export const LOCALES = (Object.keys(LANGUAGES) as LanguageCode[]).filter(isReady) as unknown as readonly [Locale, ...Locale[]];

/** The languages every dictionary is written in first and that teacher-typed labels (`{ en, tr }`) have. */
export const BASE_LOCALES = ['en', 'tr'] as const;
