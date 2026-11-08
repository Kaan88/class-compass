/**
 * Built-in risky / offensive words for student free text, English and Turkish (S13c item 12, D-123).
 * Written for Class Compass (no third-party list was copied; see docs/ASSETS.md). Admins add and
 * remove words school-wide and teachers add words for their classes; the allow list wins.
 *
 * Each entry is matched against WHOLE words after normalisation (`textQuality.ts`), never as a
 * substring inside another word (the Scunthorpe problem):
 * - `exact`: no endings are added (short words that are the start of innocent words);
 * - `noFold`: matched only as typed with Turkish letters (its folded form is an innocent English or
 *   Turkish word, e.g. "göt" → "got", "piç" → "pic").
 * Without a flag, the folded form also matches with English (-s, -ed, -ing, -er) or Turkish suffixes.
 */
export interface RiskyEntry {
  w: string;
  exact?: boolean;
  noFold?: boolean;
}

export const RISKY_EN: readonly RiskyEntry[] = [
  { w: 'fuck' },
  { w: 'fuk', exact: true },
  { w: 'fck', exact: true },
  { w: 'motherfucker' },
  { w: 'shit' },
  { w: 'bullshit' },
  { w: 'bitch' },
  { w: 'bastard' },
  { w: 'asshole' },
  { w: 'ass', exact: true },
  { w: 'arse', exact: true },
  { w: 'dumbass' },
  { w: 'jackass' },
  { w: 'dick', exact: true },
  { w: 'dickhead' },
  { w: 'cock', exact: true },
  { w: 'pussy', exact: true },
  { w: 'cunt' },
  { w: 'wank' },
  { w: 'wanker' },
  { w: 'twat' },
  { w: 'bollocks', exact: true },
  { w: 'slut' },
  { w: 'whore' },
  { w: 'piss', exact: true },
  { w: 'pissed', exact: true },
  { w: 'porn' },
  { w: 'sex', exact: true },
  { w: 'sexy', exact: true },
  { w: 'boobs', exact: true },
  { w: 'tits', exact: true },
  { w: 'damn', exact: true },
  { w: 'crap', exact: true },
  { w: 'nigger' },
  { w: 'nigga' },
  { w: 'faggot' },
  { w: 'fag', exact: true },
  { w: 'retard' },
  { w: 'stupid' },
  { w: 'idiot' },
  { w: 'moron' },
  { w: 'loser', exact: true },
  { w: 'kys', exact: true },
];

export const RISKY_TR: readonly RiskyEntry[] = [
  { w: 'amk', exact: true },
  { w: 'aq', exact: true },
  { w: 'amq', exact: true },
  { w: 'mk', exact: true },
  { w: 'amına' },
  { w: 'aminakoyim', exact: true },
  { w: 'amcık' },
  { w: 'ananı', exact: true },
  { w: 'orospu' },
  { w: 'oruspu' },
  { w: 'piç', noFold: true },
  { w: 'sik' },
  { w: 'sikik' },
  { w: 'siktir' },
  { w: 'yarrak' },
  { w: 'yarak', exact: true },
  { w: 'dalyarak' },
  { w: 'göt', noFold: true },
  { w: 'götveren' },
  { w: 'ibne' },
  { w: 'kaltak' },
  { w: 'kahpe' },
  { w: 'pezevenk' },
  { w: 'gavat' },
  { w: 'şerefsiz' },
  { w: 'puşt', noFold: true },
  { w: 'yavşak' },
  { w: 'oç', exact: true, noFold: true },
  { w: 'aptal' },
  { w: 'salak' },
  { w: 'gerizekalı' },
  { w: 'dangalak' },
];

/** Multi-word phrases (matched on consecutive normalised words). */
export const RISKY_PHRASES: readonly (readonly string[])[] = [
  ['geri', 'zekali'],
  ['kill', 'yourself'],
  ['amina', 'koyim'],
  ['amina', 'koyayim'],
];

/**
 * Innocent words whose folded spelling would otherwise match a risky stem plus a suffix (tested):
 * "sıkı" (tight, firm) and "sıkıcı" (boring) typed without Turkish letters are "siki" and "sikici";
 * "Sikkim" is a place name.
 */
export const BUILTIN_ALLOW: readonly string[] = ['siki', 'sikica', 'sikiyim', 'sikisik', 'sikinti', 'sikintili', 'sikmak', 'sikma', 'sikildim', 'sikici', 'sikicilar', 'sikin', 'amca', 'amcam', 'amcamla', 'ama', 'amac', 'amaci', 'sikkim'];
