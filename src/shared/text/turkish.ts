/**
 * All Turkish-aware text handling lives here (UX-5, IMP-3). Never sort or case names elsewhere.
 * - Sorting: Intl.Collator('tr') (ç after c, ğ after g, ı before i, ö after o, ş after s, ü after u)
 * - Casing: tr-TR locale rules (i ↔ İ, ı ↔ I)
 * - Storage: NFC-normalised, whitespace-collapsed
 */

const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

export const compareNames = (a: string, b: string): number => collator.compare(a, b);

export function sortByName<T>(items: readonly T[], key: (t: T) => string): T[] {
  return [...items].sort((x, y) => compareNames(key(x), key(y)));
}

/** NFC + trim + collapse internal whitespace. Keeps every character the user typed. */
export function normaliseName(s: string): string {
  return s.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export const upperTr = (s: string) => s.toLocaleUpperCase('tr-TR');
export const lowerTr = (s: string) => s.toLocaleLowerCase('tr-TR');

/**
 * Search/match key: lower-case with Turkish rules, then strip diacritics and map ı→i so that
 * "IŞIK", "Işık", "isik" all fold to "isik". Used for duplicate *flagging* only — never for
 * automatic merging (IMP-4).
 */
export function foldForSearch(s: string): string {
  return lowerTr(normaliseName(s))
    .replace(/ı/gu, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC');
}

/**
 * Title-case each word using Turkish rules, e.g. "ALİ IŞIK" → "Ali Işık". Only used when the
 * source is entirely upper- or lower-case (e-Okul exports are often ALL CAPS); mixed case is kept.
 */
export function smartTitleCase(s: string): string {
  const n = normaliseName(s);
  if (n !== upperTr(n) && n !== lowerTr(n)) return n;
  return n
    .split(' ')
    .map((w) =>
      w
        .split(/(['’-])/u)
        .map((part) => (part.length > 0 && !/^['’-]$/u.test(part) ? upperTr(part.charAt(0)) + lowerTr(part.slice(1)) : part))
        .join(''),
    )
    .join(' ');
}

/**
 * Initials for avatars: first letter of the first given name + first letter of the last word.
 * No assumptions beyond "first word" and "last word" (multi-part names like "Ayşe Nur Kara Yılmaz"
 * give "AY"). Uses Turkish upper-casing so "ilknur ışık" → "İI".
 */
export function initials(fullName: string): string {
  const words = normaliseName(fullName).split(' ').filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  return upperTr(first + last);
}

/** Stable, attractive avatar hue (0–359) derived from the student id, not the name (renames keep colour). */
export function avatarHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 18 well-spaced hues, avoiding muddy yellow-greens.
  const palette = [0, 15, 28, 200, 210, 222, 235, 250, 265, 280, 295, 310, 325, 340, 160, 172, 185, 192];
  return palette[Math.abs(h) % palette.length]!;
}
