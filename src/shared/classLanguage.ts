/**
 * Per-class language mode (S13a, D-099). Two class settings give four modes:
 * English only (default) · Turkish only · English main + Turkish · Turkish main + English.
 * Everything class-facing (classroom display, the class's student pages, label editors of the class's
 * contexts) follows it. A teacher's own interface language stays a personal preference (UX-4).
 * Label data in a language that is off is kept and comes back when that language is enabled again.
 */
import type { LocalizedTextValue } from './contracts/define.ts';

export type ClassLocale = 'en' | 'tr';
export interface ClassLanguage {
  mainLanguage: ClassLocale;
  secondLanguageEnabled: boolean;
}

export const DEFAULT_CLASS_LANGUAGE: ClassLanguage = { mainLanguage: 'en', secondLanguageEnabled: false };

/**
 * Student-page override (S13b2, D-117): a class may give its students' personal pages their own mode
 * (e.g. the display English only, the student pages Turkish only). `studentPageMainLanguage` null =
 * the student pages follow the class mode.
 */
export interface StudentPageLanguageSetting {
  studentPageMainLanguage: ClassLocale | null;
  studentPageSecondLanguageEnabled: boolean | null;
}

/** The language mode of the class's student pages. */
export function studentPageLanguage(c: ClassLanguage & Partial<StudentPageLanguageSetting>): ClassLanguage {
  if (!c.studentPageMainLanguage) return { mainLanguage: c.mainLanguage, secondLanguageEnabled: c.secondLanguageEnabled };
  return { mainLanguage: c.studentPageMainLanguage, secondLanguageEnabled: c.studentPageSecondLanguageEnabled ?? false };
}
export const CLASS_LANGUAGE_MODES = ['en', 'tr', 'en+tr', 'tr+en'] as const;
export type ClassLanguageMode = (typeof CLASS_LANGUAGE_MODES)[number];

export const otherLocale = (l: ClassLocale): ClassLocale => (l === 'en' ? 'tr' : 'en');

/** The languages switched on for a class, main language first. */
export const classLocales = (l: ClassLanguage): ClassLocale[] => (l.secondLanguageEnabled ? [l.mainLanguage, otherLocale(l.mainLanguage)] : [l.mainLanguage]);

export const modeOf = (l: ClassLanguage): ClassLanguageMode => (l.secondLanguageEnabled ? (l.mainLanguage === 'en' ? 'en+tr' : 'tr+en') : l.mainLanguage);
export const languageOfMode = (m: ClassLanguageMode): ClassLanguage => ({ mainLanguage: m.startsWith('tr') ? 'tr' : 'en', secondLanguageEnabled: m.includes('+') });

/** The display language to use: the requested one when it is switched on, otherwise the main language. */
export const displayLocale = (l: ClassLanguage, wanted?: ClassLocale | null): ClassLocale => (wanted && classLocales(l).includes(wanted) ? wanted : l.mainLanguage);

/**
 * Label text in `locale`; when that language has no text, the other stored language (fallback) so the
 * class never sees an empty label. `missing` is true when the fallback was used.
 */
export function pickLabel(t: LocalizedTextValue | null | undefined, locale: ClassLocale): { text: string; missing: boolean } {
  const own = t?.[locale]?.trim();
  if (own) return { text: own, missing: false };
  const other = t?.[otherLocale(locale)]?.trim();
  return { text: other ?? '', missing: Boolean(other) };
}

/** An enabled language without text while another language has some: shown as "needs translation" in editors. */
export const needsTranslation = (t: LocalizedTextValue | null | undefined, l: ClassLanguage): ClassLocale[] => {
  const has = (x: ClassLocale) => Boolean(t?.[x]?.trim());
  if (!has('en') && !has('tr')) return [];
  return classLocales(l).filter((x) => !has(x));
};

/** Languages enabled in at least one of these classes (for editors shared by several classes), main languages first. */
export function unionLocales(ls: readonly ClassLanguage[]): ClassLocale[] {
  const out: ClassLocale[] = [];
  for (const l of ls) if (!out.includes(l.mainLanguage)) out.push(l.mainLanguage);
  for (const l of ls) for (const x of classLocales(l)) if (!out.includes(x)) out.push(x);
  return out.length ? out : ['en'];
}

/**
 * Languages a class's seeded defaults are written in (S20d, D-172): the class's languages and those
 * of its student pages (D-117), main language first. A default for a Turkish-only class is Turkish
 * only, so no hidden English copy goes stale when the teacher renames it.
 */
export const seedLocales = (c: ClassLanguage & Partial<StudentPageLanguageSetting>): ClassLocale[] => unionLocales([c, studentPageLanguage(c)]);

/** Only the `locales` of a default label (the whole label when none of them has text). */
export function inLocales(t: LocalizedTextValue, locales: readonly ClassLocale[]): LocalizedTextValue {
  const out: LocalizedTextValue = {};
  for (const l of locales) {
    const v = t[l];
    if (v?.trim()) out[l] = v;
  }
  return Object.keys(out).length ? out : { ...t };
}

/**
 * A seeded default when a language is switched on later (D-172): if every language stored in
 * `stored` still equals the default `seeded` text (the teacher never changed it), the label gets the
 * default text of the `locales` it lacks. Returns the completed label, or null when there is nothing
 * to add or the label was edited (an edited label is the teacher's; the editor marks it "Needs
 * translation" instead).
 */
export function completeDefault(stored: LocalizedTextValue, seeded: LocalizedTextValue, locales: readonly ClassLocale[]): LocalizedTextValue | null {
  const present = (['en', 'tr'] as const).filter((l) => stored[l]?.trim());
  if (!present.length || present.some((l) => stored[l]!.trim() !== seeded[l]?.trim())) return null;
  const missing = locales.filter((l) => !stored[l]?.trim() && seeded[l]?.trim());
  if (!missing.length) return null;
  const out: LocalizedTextValue = { ...stored };
  for (const l of missing) out[l] = seeded[l] ?? '';
  return out;
}
