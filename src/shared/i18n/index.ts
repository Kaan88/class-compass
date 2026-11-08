import { en, type MessageKey } from './en.ts';
import { tr } from './tr.ts';
import type { LocalizedTextValue as LocalizedText } from '../contracts/define.ts';

export type Locale = 'en' | 'tr';
export const dictionaries = { en, tr } as const;
export type { MessageKey };

const pluralRules = { en: new Intl.PluralRules('en'), tr: new Intl.PluralRules('tr') };

/** Translate a key. `{name}` placeholders are filled from vars; `count` selects `_one`/`_other`. */
export function translate(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const dict = dictionaries[locale] as Record<string, string>;
  let k = key;
  if (typeof vars.count === 'number') {
    const form = pluralRules[locale].select(vars.count);
    if (`${key}_${form}` in dict) k = `${key}_${form}`;
    else if (`${key}_other` in dict) k = `${key}_other`;
  }
  const template = dict[k] ?? (en as Record<string, string>)[k] ?? key;
  return template.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars[v] ?? `{${v}}`));
}

/** Pick a teacher-editable label in the viewer's language, falling back to the other language. */
export function pickText(t: LocalizedText | null | undefined, locale: Locale): string {
  if (!t) return '';
  return (locale === 'tr' ? (t.tr ?? t.en) : (t.en ?? t.tr)) ?? '';
}

/** Locale-aware date formatting in a given IANA timezone (DSH-2). */
export function formatDate(ms: number, locale: Locale, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { timeZone, ...opts }).format(ms);
}

/**
 * Explicit week range for counter history (CNT-7): "Mon 9 Nov – Sun 15 Nov". `start` / `end` are
 * local calendar dates of the class timezone, which the table states once in its caption (not in
 * every column header, usability audit 2026-11). `year: true` adds the year to the end date.
 */
export function formatWeekRange(start: string, end: string, locale: Locale, opts: { year?: boolean } = {}): string {
  const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const tag = locale === 'tr' ? 'tr-TR' : 'en-GB';
  const part = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...o }).format(at(d));
  const day = (d: string) => `${part(d, { weekday: 'short' })} ${part(d, { day: 'numeric', month: 'short' })}`;
  return `${day(start)} – ${day(end)}${opts.year ? ` ${part(end, { year: 'numeric' })}` : ''}`;
}

/** A local calendar date ('YYYY-MM-DD') in words: "1 Sept 2026" / "1 Eyl 2026"; `year: false` leaves the year out. */
export function formatDay(iso: string, locale: Locale, opts: { year?: boolean } = {}): string {
  const at = Date.parse(`${iso}T12:00:00Z`);
  if (Number.isNaN(at)) return iso;
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(opts.year === false ? {} : { year: 'numeric' }) }).format(at);
}
