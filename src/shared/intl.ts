/**
 * Cached Intl formatters and collators (S15a, D-162). Constructing an `Intl.DateTimeFormat` or
 * `Intl.Collator` is expensive (it loads ICU data: tens of microseconds and native memory that only a
 * garbage collection gives back), and calling `format` / `compare` on an existing one is cheap. Every
 * formatter or collator in server, shared and domain code comes from here, never from `new Intl.…`
 * per call (CONVENTIONS). Same locale and options give the same object, so results are identical to
 * constructing a new one each time.
 *
 * The keys come from code (a few locales, timezones and option literals), so the caches stay small; a
 * cap clears a cache if something unexpected ever floods it.
 */

const CACHE_MAX = 500;

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const collators = new Map<string, Intl.Collator>();

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** `new Intl.DateTimeFormat(locale, options)`, built once per locale and options. Throws like the constructor (an invalid timezone is not cached). */
export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  return cached(dateFormats, `${locale}|${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options));
}

/** `new Intl.Collator(locale, options)`, built once per locale and options. */
export function collator(locale: string | undefined, options: Intl.CollatorOptions = {}): Intl.Collator {
  return cached(collators, `${locale ?? ''}|${JSON.stringify(options)}`, () => new Intl.Collator(locale, options));
}

/** Same result as `a.localeCompare(b, 'tr')` without building a collator per comparison. */
export const compareTr = (a: string, b: string): number => collator('tr').compare(a, b);
