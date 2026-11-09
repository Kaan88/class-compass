/**
 * Sentence starters (S14d, D-152): short sentence beginnings a child taps to start writing
 * ("I want to get better at ___."). Pure and shared: the student page fills the box with them, the
 * server refuses a text that still has the blank or is only a starter (`STARTER_UNFINISHED` in
 * `textQuality.ts`), and the teacher's own starters are checked with a sample word in the blank.
 *
 * The blank is three underscores (`___`); two or more underscores typed by a teacher are stored as one
 * blank.
 */
import { foldForSearch } from './turkish.ts';
import type { TextKind } from './textQuality.ts';

/** Where a starter is offered: goal words, reflections, notes, self-assessments, evidence words, captions, practice ideas. */
export const STARTER_KINDS = ['goal', 'reflection', 'note', 'selfAssessment', 'evidence', 'caption', 'practice'] as const;
export type StarterKind = (typeof STARTER_KINDS)[number];

export const STARTER_BLANK = '___';

/** The text check kind of what a starter of this kind begins. */
export const STARTER_TEXT_KIND: Record<StarterKind, TextKind> = {
  goal: 'goal',
  reflection: 'reflection',
  note: 'note',
  selfAssessment: 'selfAssessment',
  evidence: 'evidenceText',
  caption: 'linkTitle',
  practice: 'practiceChoice',
};

/** A word that fills the blank when a teacher's starter is checked (it must read as real words). */
export const STARTER_SAMPLE: Record<'en' | 'tr', string> = { en: 'reading books', tr: 'kitap okumak' };

/** Any blank still in the text (two or more underscores). */
const BLANK_RE = /_{2,}/u;

export const hasBlank = (text: string) => BLANK_RE.test(text);

/** A teacher's starter as stored: trimmed, single spaces, every blank written `___`. */
export const normaliseStarter = (text: string) =>
  text
    .normalize('NFC')
    .replace(/_{2,}/gu, STARTER_BLANK)
    .replace(/\s+/gu, ' ')
    .trim();

/** The starter with its blank(s) filled. */
export const fillBlank = (starter: string, words: string) => starter.replace(/_{2,}/gu, words);

/** The words of a text for comparing with starters: folded, without blanks, punctuation and extra spaces. */
const core = (text: string) =>
  foldForSearch(text)
    .replace(/_+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The text is not finished: a blank is still in it, or it is only one of the starters (with the blank
 * removed). A student taps a starter and must add their own words.
 */
export function isUnfinishedStarter(text: string, starters: readonly string[]): boolean {
  if (hasBlank(text)) return true;
  const c = core(text);
  if (!c) return false;
  return starters.some((s) => core(s) === c);
}

/** Where the first blank is (for selecting it in the text box), or null. */
export function blankRange(text: string): { start: number; end: number } | null {
  const m = BLANK_RE.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}
