/**
 * The large known-word dictionary of the student text check (S28b, D-198): our own small lists plus
 * the lists generated from SCOWL (English) and Zemberek-NLP (Turkish) by `npm run gen:word-lists`
 * (sources and licences in docs/ASSETS.md and `licenses/`). About 120 kB gzip, so the student page never
 * loads it with its first render: the server always checks with it, and the page loads it (`import()`)
 * only after its own small lists found a word they did not know (`student/common.tsx`).
 */
import type { WordDictionary } from './textQuality.ts';
import { EN_WORDS } from './wordsEn.ts';
import { LARGE_EN, LARGE_EN_NOTICE } from './wordsLargeEn.ts';
import { LARGE_TR, LARGE_TR_NOTICE } from './wordsLargeTr.ts';
import { TR_WORDS } from './wordsTr.ts';

const words = (list: string) => list.split(/\s+/u).filter(Boolean);

/** `notices`: the copyright and licence notices of the generated lists, a property so that every build carrying the lists carries them. */
export const LARGE_WORDS: WordDictionary & { readonly notices: readonly string[] } = {
  en: new Set([...EN_WORDS, ...words(LARGE_EN)]),
  tr: new Set([...TR_WORDS, ...words(LARGE_TR)]),
  notices: [LARGE_EN_NOTICE, LARGE_TR_NOTICE],
};
