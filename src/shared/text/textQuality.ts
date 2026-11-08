/**
 * Quality and language checks for student free text (S13c item 12, D-123). Pure and shared: the
 * server is authoritative (every student write runs it), the student page runs the same code while
 * the child types for instant, friendly feedback.
 *
 * 1. Language check (`findRiskyWord`): built-in EN/TR lists plus the school's and teachers' words,
 *    matched on WHOLE words after normalisation: Turkish lower-casing, folding (ı→i, ş→s, …),
 *    leetspeak (4→a 3→e 0→o 1→i $→s …), stretched letters ("fuuuck"), letters split by spaces or
 *    dots ("s.h.i.t"), `*` as a hidden letter, and English/Turkish endings. A word is never matched
 *    inside another word (Scunthorpe problem); the allow list always wins.
 * 2. Nonsense check (`checkStudentText`): minimum length per kind, long runs of one character,
 *    mostly symbols or digits, shouting, keyboard mashing (QWERTY, Turkish Q and F rows), words
 *    without vowels, very long unknown words, repeated words, and too few recognised EN/TR words
 *    (our own word lists with simple suffix stripping, so "okuyacağım" counts as real).
 *
 * The result names a reason only; the message shown to the child is the i18n key
 * `textCheck.<REASON>` with a kind-specific example. The matched word is never stored or logged.
 */
import { BUILTIN_ALLOW, RISKY_EN, RISKY_PHRASES, RISKY_TR, type RiskyEntry } from './riskyWords.ts';
import { foldForSearch, lowerTr } from './turkish.ts';
import { EN_WORDS } from './wordsEn.ts';
import { TR_WORDS } from './wordsTr.ts';

export const TEXT_KINDS = ['goal', 'reflection', 'note', 'selfAssessment', 'evidenceText', 'linkTitle', 'practiceChoice'] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

export const TEXT_REASONS = ['BLOCKED_WORD', 'TOO_SHORT', 'REPEATED_CHARS', 'SYMBOLS', 'SHOUTING', 'KEYBOARD_MASH', 'LONG_WORD', 'FEW_VOWELS', 'REPEATED_WORDS', 'UNKNOWN_WORDS'] as const;
export type TextReason = (typeof TEXT_REASONS)[number];

/** School-wide limits (admin settings). */
export interface TextLimits {
  minGoalWords: number;
  minGoalLetters: number;
}
export const DEFAULT_TEXT_LIMITS: TextLimits = { minGoalWords: 3, minGoalLetters: 12 };

/** Extra words: the school's block/allow lists and the words the class's teachers added. */
export interface WordLists {
  block: readonly string[];
  allow: readonly string[];
}
export const NO_EXTRA_WORDS: WordLists = { block: [], allow: [] };

export type TextCheckResult = { ok: true } | { ok: false; reason: TextReason };

/** Which checks a kind gets. Link titles and practice choices are short labels: language check and gross nonsense only. */
const KIND_RULES: Record<TextKind, { minWords: number; minLetters: number; dictionary: boolean }> = {
  goal: { minWords: 3, minLetters: 12, dictionary: true },
  reflection: { minWords: 2, minLetters: 8, dictionary: true },
  note: { minWords: 2, minLetters: 8, dictionary: true },
  selfAssessment: { minWords: 1, minLetters: 2, dictionary: true },
  evidenceText: { minWords: 2, minLetters: 8, dictionary: true },
  linkTitle: { minWords: 0, minLetters: 0, dictionary: false },
  practiceChoice: { minWords: 0, minLetters: 0, dictionary: false },
};

const LONG_RUN = 5;
const MAX_WORD = 24;
const SHOUT_LETTERS = 15;
const VOWELS = new Set('aeiouyıöü'.split(''));

// ---------------------------------------------------------------- recognised words
const EN_ENDINGS = ['ies', 'es', 's', 'ed', 'd', 'ing', 'er', 'est', 'ly', 'ful'];
const TR_SUFFIXES = [
  ...'iyorum uyorum iyoruz uyoruz iyor uyor yorum yoruz yor yacagim yecegim acagim ecegim yacagiz yecegiz acagiz ecegiz yacak yecek acak ecek yacag yeceg acag eceg'.split(' '),
  ...'abilirim ebilirim abilir ebilir yabilir yebilir abil ebil yabil yebil maliyim meliyim mali meli mak mek ma me mayi meyi masi mesi'.split(' '),
  ...'dim dum tim tum dik duk tik tuk din dun tin tun di du ti tu dir dur tir tur mis mus arak erek yarak yerek ip up yip yup ince unca yince yunca'.split(' '),
  ...'lar ler lari leri larim lerim imiz umuz iniz unuz miz muz niz nuz im um in un iz uz m n yim yum sin sun siniz sunuz'.split(' '),
  ...'da de ta te dan den tan ten nda nde ndan nden a e i u ya ye yi yu na ne ni nu si su nin nun ki ca ce ci cu li lu siz suz lik luk la le yla yle'.split(' '),
  ...'daki deki taki teki ar er ir ur r arim erim irim urum elim alim ayim eyim sa se yse ysa'.split(' '),
];
const TR_SUFFIX_SET = new Set(TR_SUFFIXES);
const TR_SUFFIXES_LONGEST_FIRST = [...TR_SUFFIX_SET].sort((a, b) => b.length - a.length);
/** Final consonant change before a vowel ending (kitap → kitabı, ekmek → ekmeği, git → gidiyor). */
const MUTATIONS: Record<string, string> = { b: 'p', d: 't', g: 'k', c: 'c' };

function enRecognised(w: string): boolean {
  if (EN_WORDS.has(w)) return true;
  for (const end of EN_ENDINGS) {
    if (!w.endsWith(end) || w.length - end.length < 2) continue;
    const base = w.slice(0, -end.length);
    if (EN_WORDS.has(base) || EN_WORDS.has(`${base}e`)) return true;
    if (end === 'ies' && EN_WORDS.has(`${base}y`)) return true;
    // stopped → stop, running → run
    if (base.length > 2 && base.at(-1) === base.at(-2) && EN_WORDS.has(base.slice(0, -1))) return true;
  }
  return false;
}

function trRecognised(w: string, depth = 0): boolean {
  if (TR_WORDS.has(w)) return true;
  const last = w.at(-1) ?? '';
  if (MUTATIONS[last] && TR_WORDS.has(w.slice(0, -1) + MUTATIONS[last])) return true;
  if (depth >= 4) return false;
  for (const s of TR_SUFFIXES_LONGEST_FIRST) {
    if (w.length - s.length >= 2 && w.endsWith(s) && trRecognised(w.slice(0, -s.length), depth + 1)) return true;
  }
  return false;
}

/** Is this word an English or Turkish word we know (after folding and simple ending removal)? */
export function isRecognisedWord(word: string): boolean {
  const w = foldForSearch(word).replace(/['’]/gu, '');
  if (!w) return false;
  return enRecognised(w) || trRecognised(w);
}

// ---------------------------------------------------------------- language check
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i', '€': 'e' };
const EN_RISKY_ENDINGS = ['s', 'es', 'ed', 'd', 'ing', 'in', 'er', 'ers', 'y', 'ies', 'head', 'hole'];

interface PreparedEntry {
  lower: string;
  fold: string;
  exact: boolean;
  noFold: boolean;
}

const prepare = (e: RiskyEntry): PreparedEntry => ({ lower: lowerTr(e.w), fold: foldForSearch(e.w), exact: e.exact ?? false, noFold: e.noFold ?? false });
const BUILTIN: PreparedEntry[] = [...RISKY_EN, ...RISKY_TR].map(prepare);
const BUILTIN_ALLOW_SET = new Set(BUILTIN_ALLOW.map((w) => foldForSearch(w)));

const collapse = (s: string) => s.replace(/(\p{L})\1+/gu, '$1');
const hasStretch = (s: string) => /(\p{L})\1\1/u.test(s);

/** `rest` is made only of endings (at most two Turkish suffixes, or one English ending, after a doubled final letter too). */
function onlyEndings(rest: string, stemLast: string): boolean {
  if (rest === '') return true;
  // shitty → shit + ty: a doubled final letter before the ending
  if (EN_RISKY_ENDINGS.includes(rest) || (rest.startsWith(stemLast) && EN_RISKY_ENDINGS.includes(rest.slice(1)))) return true;
  if (TR_SUFFIX_SET.has(rest)) return true;
  for (const s of TR_SUFFIXES_LONGEST_FIRST) if (rest.startsWith(s) && TR_SUFFIX_SET.has(rest.slice(s.length))) return true;
  return false;
}

function matchesEntry(token: { lower: string; fold: string }, e: PreparedEntry): boolean {
  if (e.noFold) return token.lower === e.lower;
  const t = token.fold;
  if (t === e.fold) return true;
  if (hasStretch(t) && collapse(t) === collapse(e.fold)) return true;
  if (e.exact) return false;
  if (t.startsWith(e.fold) && onlyEndings(t.slice(e.fold.length), e.fold.at(-1) ?? '')) return true;
  // f*ck: a star hides one letter
  if (t.includes('*') && t.length === e.fold.length) return [...t].every((ch, i) => ch === '*' || ch === e.fold[i]);
  return false;
}

/** Words of the text as the language check sees them (several spellings per word). */
function riskyTokens(text: string): Array<{ lower: string; fold: string }> {
  const lower = lowerTr(text.normalize('NFC'));
  const raw = lower.split(/[\s.,;:?"'’()[\]{}/\\|_\-+=~^<>]+/u).map((t) => t.replace(/^[!*]+|[!*]+$/gu, ''));
  const words = raw.filter(Boolean);
  const out: Array<{ lower: string; fold: string }> = [];
  const add = (w: string) => {
    if (!/\p{L}/u.test(w)) return;
    const mapped = [...w].map((ch) => LEET[ch] ?? ch).join('');
    const l = mapped.replace(/[^\p{L}*]/gu, '');
    if (!l) return;
    out.push({ lower: l, fold: foldForSearch(l).replace(/[^\p{L}*]/gu, '') });
  };
  for (const w of words) add(w);
  // "f u c k" / "s.i.k": three or more single letters in a row are also read as one word.
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) add(run.join(''));
    run = [];
  };
  for (const w of words) {
    if ([...w].length === 1) run.push(w);
    else flush();
  }
  flush();
  return out;
}

/**
 * The first risky word in `text`, or null. `lists` adds the school's and teachers' words; the allow
 * list (and the built-in innocent words) always wins. Returned for tests only: callers must never
 * store or log it.
 */
export function findRiskyWord(text: string, lists: WordLists = NO_EXTRA_WORDS): string | null {
  const allow = new Set([...BUILTIN_ALLOW_SET, ...lists.allow.map((w) => foldForSearch(w))]);
  const extra = lists.block.map((w) => prepare({ w, exact: [...foldForSearch(w)].length <= 3 })).filter((e) => e.fold && !allow.has(e.fold));
  const entries = [...BUILTIN.filter((e) => !allow.has(e.fold)), ...extra];
  const tokens = riskyTokens(text);
  for (const t of tokens) {
    if (allow.has(t.fold) || allow.has(t.lower)) continue;
    const hit = entries.find((e) => matchesEntry(t, e));
    if (hit) return hit.fold;
  }
  const folds = tokens.map((t) => t.fold);
  for (const phrase of RISKY_PHRASES) {
    for (let i = 0; i + phrase.length <= folds.length; i++) if (phrase.every((p, j) => folds[i + j] === p)) return phrase.join(' ');
  }
  return null;
}

// ---------------------------------------------------------------- nonsense check
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertyuıopğü', 'asdfghjklşi', 'zxcvbnmöç', 'fgğıodrnhpqw', 'uieaütkmlyşx', 'jövcçzsbx'];
const ROW_GRAMS = new Set<string>();
for (const row of ROWS) {
  for (const r of [row, [...row].reverse().join('')]) for (let i = 0; i + 4 <= r.length; i++) ROW_GRAMS.add(r.slice(i, i + 4));
}
const hasRowRun = (s: string) => {
  for (let i = 0; i + 4 <= s.length; i++) if (ROW_GRAMS.has(s.slice(i, i + 4))) return true;
  return false;
};

const lettersOf = (s: string) => [...s].filter((ch) => /\p{L}/u.test(ch));
const vowelRatio = (w: string) => {
  const ls = lettersOf(lowerTr(w));
  return ls.length ? ls.filter((c) => VOWELS.has(c)).length / ls.length : 1;
};

/**
 * Check one piece of student text. `limits` are the school's goal limits; `lists` the extra words.
 * Empty optional text (a link without a title) is fine: callers only check text that was written.
 */
export function checkStudentText(text: string, kind: TextKind, opts: { limits?: TextLimits; lists?: WordLists } = {}): TextCheckResult {
  const t = text.normalize('NFC').trim();
  if (!t) return kind === 'linkTitle' || kind === 'practiceChoice' ? { ok: true } : { ok: false, reason: 'TOO_SHORT' };
  if (findRiskyWord(t, opts.lists)) return { ok: false, reason: 'BLOCKED_WORD' };

  const rule = KIND_RULES[kind];
  const limits = opts.limits ?? DEFAULT_TEXT_LIMITS;
  const minWords = kind === 'goal' ? limits.minGoalWords : rule.minWords;
  const minLetters = kind === 'goal' ? limits.minGoalLetters : rule.minLetters;

  const letters = lettersOf(t);
  const words = t.split(/[^\p{L}\p{N}'’]+/u).filter((w) => /\p{L}/u.test(w));
  if (words.length < minWords && letters.length < minLetters) return { ok: false, reason: 'TOO_SHORT' };

  if (new RegExp(`(\\p{L})\\1{${LONG_RUN - 1},}`, 'u').test(lowerTr(t)) || /(\S)\1{6,}/u.test(t)) return { ok: false, reason: 'REPEATED_CHARS' };

  const nonSpace = [...t.replace(/\s+/gu, '')].length;
  if (nonSpace >= 5 && letters.length / nonSpace < 0.6) return { ok: false, reason: 'SYMBOLS' };

  const upper = letters.filter((ch) => ch !== lowerTr(ch) && ch === ch.toLocaleUpperCase('tr-TR')).length;
  if (upper >= SHOUT_LETTERS && upper / letters.length > 0.7) return { ok: false, reason: 'SHOUTING' };

  const known = words.map((w) => isRecognisedWord(w));
  const unknown = words.filter((_, i) => !known[i]).map((w) => lowerTr(w).replace(/['’]/gu, ''));
  if (unknown.some((w) => w.length >= 4 && hasRowRun(w)) || hasRowRun(unknown.join(''))) return { ok: false, reason: 'KEYBOARD_MASH' };
  if (unknown.some((w) => [...w].length > MAX_WORD)) return { ok: false, reason: 'LONG_WORD' };
  if (unknown.some((w) => [...w].length >= 5 && vowelRatio(w) < 0.2) || (letters.length >= 8 && vowelRatio(t) < 0.22)) return { ok: false, reason: 'FEW_VOWELS' };

  const folded = words.map((w) => foldForSearch(w));
  let same = 1;
  for (let i = 1; i < folded.length; i++) {
    same = folded[i] === folded[i - 1] ? same + 1 : 1;
    if (same >= 4) return { ok: false, reason: 'REPEATED_WORDS' };
  }
  if (folded.length >= 5 && new Set(folded).size / folded.length < 0.4) return { ok: false, reason: 'REPEATED_WORDS' };

  if (rule.dictionary && words.length > 0 && known.filter(Boolean).length / words.length < 0.5) return { ok: false, reason: 'UNKNOWN_WORDS' };
  return { ok: true };
}

/** The example sentence key shown with a message (kind-specific, in the student-page language). */
export const exampleKeyFor = (kind: TextKind) =>
  (kind === 'goal' ? 'textCheck.example.goal' : kind === 'evidenceText' || kind === 'linkTitle' ? 'textCheck.example.evidence' : 'textCheck.example.reflection') as
    | 'textCheck.example.goal'
    | 'textCheck.example.evidence'
    | 'textCheck.example.reflection';
