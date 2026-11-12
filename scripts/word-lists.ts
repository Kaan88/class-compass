/**
 * `npm run gen:word-lists` (S28b, D-198): writes the larger known-word lists of the student text check
 * (`src/shared/text/wordsLargeEn.ts`, `wordsLargeTr.ts`) from two permissively licensed sources
 * (docs/ASSETS.md → "Text"). The generated files are committed; this script is how they are made, so
 * nobody edits them by hand.
 *
 * - English: SCOWL 2020.12.07 (Kevin Atkinson, MIT-like licence, notices in `src/shared/text/licenses/scowl.txt`),
 *   the size levels 10, 20, 35 and 40 of the `english`, `american` and `british` word lists: the common
 *   words by frequency class and the 12dicts / 3esl (English for learners) lists. Download and unpack:
 *     curl -L -o scowl.tar.gz https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz
 *     tar xzf scowl.tar.gz            (gives scowl-2020.12.07/final/…)
 * - Turkish: Zemberek-NLP (Ahmet A. Akın, Mehmet D. Akın; Apache-2.0, `src/shared/text/licenses/zemberek-nlp.txt`),
 *   commit 688bd9b3cfde3cf6e3cc9c132609b859fccbf411 (version 0.18.0): the lemma dictionary
 *   `master-dictionary.dict` and the frequency list of the 10 000 most common word forms `first-10K`, both in
 *   `morphology/src/main/resources/tr/`:
 *     https://raw.githubusercontent.com/ahmetaa/zemberek-nlp/688bd9b3cfde3cf6e3cc9c132609b859fccbf411/morphology/src/main/resources/tr/<file>
 *
 *   npm run gen:word-lists -- --scowl <scowl-2020.12.07/final> --zemberek <folder with the two files>
 *
 * Every input file is checked against its pinned SHA-256 before it is read, so the output can only come
 * from the recorded versions. What the script does:
 * 1. Keeps plain lower-case words of 3+ letters (English a–z; Turkish letters), folded like the check folds
 *    text (`foldForSearch`); no names (capitalised entries), abbreviations, apostrophes, digits or
 *    multi-word entries, no Turkish interjections or reduplications ("lololo"). Turkish verbs are listed
 *    by stem (okumak → oku), and a lemma whose last vowel drops (ağız → ağzı) or whose last consonant
 *    doubles (hak → hakkı) also gets that stem, because the check's suffix stripping does not undo those
 *    changes. Words that look like mashing are dropped too: no vowel, three same letters in a row, one
 *    short piece repeated ("haha", "tutu").
 * 2. Drops every word the built-in language check refuses (`findRiskyWord`, with its endings and
 *    spellings), the folded spelling of every risky word (also the `noFold` ones: "pust", "pic"), the
 *    words of `NOT_FOR_SCHOOL` (`src/shared/text/notForSchool.ts`) and the beginnings of
 *    `NOT_FOR_SCHOOL_STEMS` below (slurs, sexual, vulgar and drug words the language check does not
 *    block) and `NOT_WORDS`. Those words are not "known": a word that is not known is never refused for
 *    that alone, it only counts towards the unknown share.
 * 3. Drops every word the check already recognises with our own small lists or with shorter words of the
 *    list (shortest first: "walked" goes when "walk" is in), which keeps the lists small without changing
 *    what they accept. A not-known word is never such a shorter word (`notKnown`, D-198).
 * 4. Fails when a not-known word or its plural is still recognised with the finished lists.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_FOR_SCHOOL, NOT_FOR_SCHOOL_EN, NOT_FOR_SCHOOL_TR, NOT_KNOWN } from '../src/shared/text/notForSchool.ts';
import { RISKY_EN, RISKY_TR } from '../src/shared/text/riskyWords.ts';
import { enRecognised, findRiskyWord, isRecognisedWord, trRecognised } from '../src/shared/text/textQuality.ts';
import { foldForSearch, lowerTr } from '../src/shared/text/turkish.ts';
import { EN_WORDS } from '../src/shared/text/wordsEn.ts';
import { TR_WORDS } from '../src/shared/text/wordsTr.ts';

const ROOT = join(import.meta.dirname, '..');
export const OUT_EN = join(ROOT, 'src', 'shared', 'text', 'wordsLargeEn.ts');
export const OUT_TR = join(ROOT, 'src', 'shared', 'text', 'wordsLargeTr.ts');

const SCOWL_LEVELS = [10, 20, 35, 40] as const;
const SCOWL_KINDS = ['english', 'american', 'british'] as const;

/** SHA-256 of every input file (SCOWL 2020.12.07 `final/`, Zemberek-NLP at commit 688bd9b). */
const PINNED: Record<string, string> = {
  'english-words.10': 'f19988ecdb0280ab63340e5c5e155a814ab3d0f225ae60f5cb9e000252283b0b',
  'english-words.20': '618998fff18fb9e143a5bab49e669ec48c023758f0db476d6b64ec06994ba71e',
  'english-words.35': 'f36ace33ff09bd5eda5f3ccbcc9971c1b6a8887fa62f5ad7f93e3c220d871388',
  'english-words.40': 'fc5c2058cd24af4ca6a9bca97ce7d300c8899753715d029fc8bb3cbe602eef7f',
  'american-words.10': '6ed66394d8b46ed12feac7aad989dfc4620c4f2051316ab774560aae71140994',
  'american-words.20': 'a7ae730cd5f2ee11b584c163bf0750cc7659e336c3a04da1a8a2e9c44b604b9e',
  'american-words.35': 'c999d002cfe31a2c3d9726eee1b87697402bb71cc831a2c63d064403c6a3a7fb',
  'american-words.40': '5a9c03d207087acabc969b32c6ef93ed376208287b2c8343f7952d0d06085577',
  'british-words.10': 'cdf5841d5cbd9c0c07bddd7a2eb65b1d3d4c4dc7990f30edccfc0abb7d1236fa',
  'british-words.20': '50a1f325b1b278e418c0084428b1919f2a1ddc2bafc99234e1cf2e442dfca6c3',
  'british-words.35': 'afb66faedb0c23d4619aab67110b58f0f640799811f51ef4182f5814f733c2ab',
  'british-words.40': '37d25a050c104761e2da3c4708522f5da7fcc3c6b87c4a4256ef96587570f714',
  'master-dictionary.dict': '7eec0b78ca39c243e665bb1001eaaa6bda3a8dc86773e736d3a21fc9eb1c4c23',
  'first-10K': '0264f2f84424c160cc3e85578092011040038b782c8f6df92d53c1359f32b414',
};

/**
 * Words that are real but not wanted as "known" in a primary-school app and that the language check
 * does not block: the hand list in `src/shared/text/notForSchool.ts` (slurs and insults, sexual, vulgar
 * and drug words). Matched on the folded word and, for English, its plural; `NOT_KNOWN` adds the folded
 * spelling of every built-in risky word, which `findRiskyWord` does not match for the `noFold` entries
 * ("pust" for "puşt", "pic" for "piç").
 */
export { NOT_FOR_SCHOOL };
const RISKY_FOLDS = new Set([...RISKY_EN, ...RISKY_TR].map((e) => foldForSearch(e.w)));

/** Tokens of the Turkish frequency list (news and web text) that are not words: web addresses, agency and party abbreviations, filler. */
export const NOT_WORDS = new Set('com www http https html org net edit dha aa iha akp chp mhp hdp nde yaa'.split(' '));

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function readPinned(dir: string, name: string): Buffer {
  const path = join(dir, name);
  if (!existsSync(path)) throw new Error(`missing input ${path} (see the header of scripts/word-lists.ts)`);
  const buf = readFileSync(path);
  const want = PINNED[name];
  if (sha256(buf) !== want) throw new Error(`${name}: SHA-256 ${sha256(buf)} is not the pinned ${want}; wrong version?`);
  return buf;
}

/**
 * Beginnings that drop a word whatever follows ("shittiest", "penises", "damnation"): the built-in risky
 * words of four or more letters that start no innocent word (no `exact` or `noFold` flag; the check matches
 * them with a few endings only, so it never refuses innocent words; here a lost word only becomes
 * unknown) and a few more stems that start no everyday word ("sex" would take "sextant", "seks" "seksen").
 */
export const NOT_FOR_SCHOOL_STEMS: readonly string[] = [
  ...[...RISKY_EN, ...RISKY_TR].filter((e) => !e.noFold && !e.exact).map((e) => foldForSearch(e.w)).filter((w) => w.length >= 4),
  ...'damn piss sexual sexie sexed sexes penis vagin porn masturb orgasm erotic prostitut fornicat rapist pedophil paedophil'.split(' '),
  ...'ejaculat copulat sodom molest nymphoman masochis sadis booz'.split(' '),
  ...'porno sevisme sevismek tecavuz fahise uyusturucu osur tasak sehvet erotik orgazm kulampara zampara esrarkes gerizekal cinsel kokain'.split(' '),
];

/** Not a word we want to call known: unwanted, risky, or looks like mashing (no vowel, only vowels, "aaah", "hmm", "haha"). */
export const unwanted = (w: string) =>
  NOT_FOR_SCHOOL.has(w) ||
  NOT_KNOWN.has(w) ||
  RISKY_FOLDS.has(w) ||
  NOT_WORDS.has(w) ||
  (w.endsWith('s') && NOT_FOR_SCHOOL_EN.has(w.slice(0, -1))) ||
  NOT_FOR_SCHOOL_STEMS.some((stem) => w.startsWith(stem)) ||
  findRiskyWord(w) !== null ||
  !/[aeiouy]/u.test(w) ||
  /^[aeiou]+$/u.test(w) ||
  /(.)\1\1/u.test(w) ||
  /^(\p{L}{2,3})\1+$/u.test(w) ||
  /^(?:h+m+|a+h+|o+h+|u+h+|e+h+)$/u.test(w);

/** Shortest first, then alphabetical: base forms come before the forms made from them. */
const byLength = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * A not-known word of the same language with endings ("clitorises", "seduced", "mulattoes",
 * "gavurcasina"): the language's recognition with those words as the dictionary. Turkish only from four
 * letters, because its suffix stripping would make innocent words of the short ones ("sicim" is not
 * "sic" + "im"), and never with English words ("analiz" is not "anal" + "iz").
 */
const notKnownOf = (words: ReadonlySet<string>, risky: readonly { w: string }[], min: number) =>
  new Set([...words, ...risky.map((e) => foldForSearch(e.w))].filter((w) => NOT_KNOWN.has(w) && w.length >= min));
const NOT_KNOWN_EN = notKnownOf(NOT_FOR_SCHOOL_EN, RISKY_EN, 3);
const NOT_KNOWN_TR4 = notKnownOf(NOT_FOR_SCHOOL_TR, RISKY_TR, 4);
export const notKnownForm = { en: (w: string) => enRecognised(w, NOT_KNOWN_EN), tr: (w: string) => trRecognised(w, NOT_KNOWN_TR4) };

/** Keep only what `recognised` does not already accept with the small list and the words kept so far. */
function compact(candidates: Iterable<string>, small: ReadonlySet<string>, recognised: (w: string, words: ReadonlySet<string>) => boolean, derived: (w: string) => boolean): string[] {
  const words = new Set(small);
  const kept: string[] = [];
  for (const w of [...new Set(candidates)].sort(byLength)) {
    if (unwanted(w) || derived(w) || recognised(w, words)) continue;
    words.add(w);
    kept.push(w);
  }
  return kept.sort();
}

export function englishWords(scowlFinal: string): string[] {
  const out: string[] = [];
  for (const kind of SCOWL_KINDS) {
    for (const level of SCOWL_LEVELS) {
      // SCOWL's files are ISO-8859-1.
      const text = readPinned(scowlFinal, `${kind}-words.${level}`).toString('latin1');
      for (const line of text.split(/\r?\n/u)) {
        const raw = line.trim();
        if (!/^[a-zà-ÿ]+$/u.test(raw)) continue; // capitalised (names), apostrophes, hyphens, digits out
        const w = foldForSearch(raw);
        if (/^[a-z]{3,}$/u.test(w)) out.push(w);
      }
    }
  }
  return compact(out, EN_WORDS, (w, words) => enRecognised(w, words, NOT_KNOWN), notKnownForm.en);
}

const TR_LETTERS = /^[a-zçğıöşüâîû]+$/u;
const TR_VOWELS = /[aeıioöuüâîû]/u;

/** The lemma's stems as the check needs them: verb stem, dropped-vowel stem, doubled-consonant stem. */
export function turkishStems(lemma: string, attrs: string): string[] {
  const stems: string[] = [];
  const pos = /P:(\w+)/u.exec(attrs)?.[1] ?? '';
  let w = lemma;
  if (pos === '' && /m[ae]k$/u.test(w) && w.length > 4) w = w.slice(0, -3); // a verb (no P: means noun or verb)
  stems.push(w);
  if (/A:[^;\]]*LastVowelDrop/u.test(attrs)) {
    const i = w.search(new RegExp(`${TR_VOWELS.source}[^aeıioöuüâîû]$`, 'u'));
    if (i > 0) stems.push(w.slice(0, i) + w.slice(i + 1));
  }
  if (/A:[^;\]]*Doubling/u.test(attrs)) stems.push(w + w.at(-1));
  return stems;
}

export function turkishWords(zemberek: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const w = foldForSearch(raw);
    if (w.length >= 3 && /^[a-z]+$/u.test(w)) out.push(w);
  };
  const dict = readPinned(zemberek, 'master-dictionary.dict').toString('utf8');
  for (const line of dict.split(/\r?\n/u)) {
    const m = /^(\S+)\s*(\[[^\]]*\])?\s*$/u.exec(line.trim());
    if (!m || line.startsWith('#')) continue;
    const lemma = m[1]!;
    const attrs = m[2] ?? '';
    if (/P:(Punc|Abbrv|Prop|Interj|Dup)/u.test(attrs) || lemma !== lowerTr(lemma) || !TR_LETTERS.test(lemma)) continue;
    for (const s of turkishStems(lemma, attrs)) add(s);
  }
  // The 10 000 most common word forms: only the ones written in lower case (no names), letters only.
  const freq = readPinned(zemberek, 'first-10K').toString('utf8');
  for (const line of freq.split(/\r?\n/u)) {
    const raw = line.trim();
    if (raw && raw === lowerTr(raw) && TR_LETTERS.test(raw)) add(raw);
  }
  return compact(out, TR_WORDS, (w, words) => trRecognised(w, words, 0, NOT_KNOWN), notKnownForm.tr);
}

/**
 * Words the finished lists must not recognise, also not through a shorter word plus endings ("boner"
 * as "bone" + "r"): every `NOT_KNOWN` word. Returns the ones that are (empty when fine).
 */
export function recognisedNotKnown(en: readonly string[], tr: readonly string[]): string[] {
  const dict = { en: new Set([...EN_WORDS, ...en]), tr: new Set([...TR_WORDS, ...tr]), notKnown: NOT_KNOWN };
  return [...NOT_KNOWN].filter((w) => isRecognisedWord(w, dict));
}

/**
 * The notices that travel with the lists into the client build: a short line, then the full text of
 * `src/shared/text/licenses/<file>` (SCOWL's Copyright file with the VarCon, Ispell and WordNet notices
 * and the WordNet disclaimer, which must appear on all copies; the Apache License for Zemberek-NLP).
 */
export const NOTICES = {
  LARGE_EN:
    'English word list derived from SCOWL 2020.12.07 (http://wordlist.aspell.net/), changed by Class Compass (filtered). Copyright 2000-2018 by Kevin Atkinson; VarCon Copyright 2000-2016 by Kevin Atkinson and Copyright 2016 by Benjamin Titze; Ispell word lists Copyright 1993, Geoff Kuenning, Granada Hills, CA, all rights reserved; WordNet 1.6 Copyright 1997 by Princeton University, all rights reserved. The full notices, conditions and disclaimers follow.',
  LARGE_TR:
    'Turkish word list derived from Zemberek-NLP 0.18.0 (https://github.com/ahmetaa/zemberek-nlp). Copyright 2018 Ahmet A. Akın, Mehmet D. Akın. Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0); changed by Class Compass (stems, filtered). The licence follows.',
} as const;
export const LICENSE_FILES = { LARGE_EN: 'scowl.txt', LARGE_TR: 'zemberek-nlp.txt' } as const;

/** The notice string of a generated file: the short line and the full licence text. */
export const noticeOf = (name: 'LARGE_EN' | 'LARGE_TR') =>
  `${NOTICES[name]}\n\n${readFileSync(join(ROOT, 'src', 'shared', 'text', 'licenses', LICENSE_FILES[name]), 'utf8').replace(/\r\n/gu, '\n')}`;

/** The generated TypeScript file: a header with the source and licence, the words in lines of about 120 characters. */
export function render(name: 'LARGE_EN' | 'LARGE_TR', words: readonly string[], source: string): string {
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > 120) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return [
    '/**',
    ` * GENERATED by \`npm run gen:word-lists\` (scripts/word-lists.ts, S28b, D-198); do not edit by hand.`,
    ...source.split('\n').map((l) => ` * ${l}`.trimEnd()),
    ` * ${words.length} folded words; forms the check recognises from shorter words or our own lists are left out.`,
    ' */',
    // A string, not only a comment: the minifier drops comments, and `LARGE_WORDS.notices` holds the
    // notices with the full licence texts, so the built chunk the student page loads carries them too.
    `export const ${name}_NOTICE = ${JSON.stringify(noticeOf(name))};`,
    '',
    `export const ${name} = \``,
    ...lines,
    '`;',
    '',
  ].join('\n');
}

export const EN_SOURCE = `English: SCOWL 2020.12.07 (http://wordlist.aspell.net/), size levels ${SCOWL_LEVELS.join(', ')} of the
english, american and british word lists. Copyright 2000-2018 by Kevin Atkinson, and the copyrights
of its sources (12dicts, Moby Words II and Brian Kelk's word list: public domain; WordNet 1.6
Copyright 1997 by Princeton University; the american and british lists made with VarCon, Copyright
2000-2016 by Kevin Atkinson and Copyright 2016 by Benjamin Titze, from the Ispell word lists,
Copyright 1993, Geoff Kuenning, BSD licence): permission to use, copy, modify, distribute and sell
these word lists for any purpose without fee, provided the notices appear in all copies. The full
notices are in src/shared/text/licenses/scowl.txt and in LARGE_EN_NOTICE below; the lists are
provided "as is" without warranty. Changed for Class Compass: folded, filtered.`;

export const TR_SOURCE = `Turkish: Zemberek-NLP 0.18.0 (https://github.com/ahmetaa/zemberek-nlp), commit 688bd9b,
morphology/src/main/resources/tr/master-dictionary.dict and first-10K. Copyright 2018 Ahmet A. Akın,
Mehmet D. Akın, licensed under the Apache License, Version 2.0 (src/shared/text/licenses/zemberek-nlp.txt,
http://www.apache.org/licenses/LICENSE-2.0). Changed for Class Compass: reduced to folded stems,
filtered for a school app and for what the check already recognises.`;

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/').split('/').pop()!);
if (isMain) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    const v = i >= 0 ? process.argv[i + 1] : undefined;
    if (!v) throw new Error(`usage: node scripts/word-lists.ts --scowl <scowl-2020.12.07/final> --zemberek <folder>`);
    return v;
  };
  const en = englishWords(arg('--scowl'));
  const tr = turkishWords(arg('--zemberek'));
  const leaks = recognisedNotKnown(en, tr);
  if (leaks.length) throw new Error(`not-for-school words still recognised: ${leaks.join(' ')}`);
  writeFileSync(OUT_EN, render('LARGE_EN', en, EN_SOURCE));
  writeFileSync(OUT_TR, render('LARGE_TR', tr, TR_SOURCE));
  console.log(`wrote ${en.length} English and ${tr.length} Turkish words`);
}
