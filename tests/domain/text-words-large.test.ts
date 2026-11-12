/**
 * The larger word lists of the student text check (S28b, D-198; GOL-5, refines D-123): real but uncommon
 * English and Turkish words are known now, and the nonsense rules behave as before (keyboard mashing is
 * never found more often with the large lists, and a real word they know is not mashing: S28b review).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_FOR_SCHOOL, NOT_WORDS, notKnownForm, recognisedNotKnown, turkishStems, unwanted } from '../../scripts/word-lists.ts';
import { LARGE_WORDS } from '../../src/shared/text/largeWords.ts';
import { NOT_KNOWN } from '../../src/shared/text/notForSchool.ts';
import { checkStudentText, DICTIONARY_REASONS, findRiskyWord, isRecognisedWord, SMALL_WORDS, TEXT_KINDS, type TextKind } from '../../src/shared/text/textQuality.ts';
import { LARGE_EN } from '../../src/shared/text/wordsLargeEn.ts';
import { LARGE_TR } from '../../src/shared/text/wordsLargeTr.ts';
import { FRESH_EN, FRESH_TR, GIBBERISH_EN, GIBBERISH_TR, REAL_EN, REAL_TR } from './text-corpus.ts';

const large = { words: LARGE_WORDS };

describe('real but uncommon words are accepted now (D-198)', () => {
  // Each was refused as UNKNOWN_WORDS with our own lists only (checked below), and is fine with the larger ones.
  const cases: Array<[string, TextKind]> = [
    ['Volcanoes erupt magma', 'reflection'],
    ['Astronauts orbit planets', 'reflection'],
    ['Penguins huddle together', 'note'],
    ['Glaciers carve canyons', 'goal'],
    ['Kangaroos carry joeys', 'evidenceText'],
    ['Telescopes magnify galaxies', 'reflection'],
    ['Yanardağlar lav püskürtür', 'reflection'],
    ['Kirpiler dikenlerini kabartır', 'note'],
    ['Teleskopla gökyüzünü gözlemledim', 'reflection'],
    ['Depremler fay hatlarında olur', 'reflection'],
    ['Kütüphanede mikroskobu inceledim', 'evidenceText'],
    ['Gökkuşağının renklerini sıraladım', 'goal'],
  ];

  it.each(cases)('accepts %s (%s)', (text, kind) => {
    expect(checkStudentText(text, kind)).toEqual({ ok: false, reason: 'UNKNOWN_WORDS' });
    expect(checkStudentText(text, kind, large)).toEqual({ ok: true });
  });

  it('knows uncommon words in both languages, with endings and Turkish suffixes', () => {
    for (const w of ['xylophone', 'harmonica', 'telescopes', 'astronauts', 'rhythm', 'strengths', 'cockpit', 'arsenal', 'microscope'])
      expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(true);
    for (const w of ['kaplumbağa', 'gökkuşağı', 'yanardağ', 'deprem', 'teleskop', 'mikroskop', 'kütüphanede', 'ağzını', 'oğlunu', 'hakkında', 'sıkıştırdım', 'seksen', 'fırçaladım'])
      expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(true);
  });

  it('keeps every word the small lists know (a text the small lists accept is accepted with the large ones)', () => {
    for (const w of SMALL_WORDS.en) expect(LARGE_WORDS.en.has(w), w).toBe(true);
    for (const w of SMALL_WORDS.tr) expect(LARGE_WORDS.tr.has(w), w).toBe(true);
  });
});

describe('the nonsense rules behave as before', () => {
  it.each([...GIBBERISH_EN, ...GIBBERISH_TR])('still rejects the gibberish %s', (s) => {
    for (const kind of ['goal', 'reflection'] as const) {
      expect(checkStudentText(s, kind, large).ok).toBe(false);
      // Keyboard mashing never comes up more often with the large lists.
      const withLarge = checkStudentText(s, kind, large);
      if (!withLarge.ok && withLarge.reason === 'KEYBOARD_MASH') expect(checkStudentText(s, kind)).toEqual(withLarge);
    }
  });

  it.each([...REAL_EN, ...REAL_TR, ...FRESH_EN, ...FRESH_TR])('still accepts the real goal %s', (s) => {
    expect(checkStudentText(s, 'goal', large)).toEqual({ ok: true });
  });

  it('names the same reason per rule with the large lists', () => {
    const samples: Array<[string, string]> = [
      ['I read', 'TOO_SHORT'],
      ['I will reaaaaaad a book', 'REPEATED_CHARS'],
      ['### I will read %%%% $$$$ ####', 'SYMBOLS'],
      ['I WILL READ ONE BOOK EVERY WEEK', 'SHOUTING'],
      ['I will asdf qwer', 'KEYBOARD_MASH'],
      ['I will asdasd', 'KEYBOARD_MASH'],
      ['I will lololo', 'KEYBOARD_MASH'],
      ['Ben hahaha yaptım', 'KEYBOARD_MASH'],
      ['I will read brrrkzzt', 'FEW_VOWELS'],
      ['read read read read books', 'REPEATED_WORDS'],
      ['teacher teacher teacher', 'REPEATED_WORDS'],
      ['blorf zintu quabbo', 'UNKNOWN_WORDS'],
      ['fuck this', 'BLOCKED_WORD'],
    ];
    for (const [text, reason] of samples) {
      expect(checkStudentText(text, 'goal'), text).toEqual({ ok: false, reason });
      expect(checkStudentText(text, 'goal', large), text).toEqual({ ok: false, reason });
    }
  });

  it('real words with a keyboard row run are not mashing once the large lists know them (S28b review)', () => {
    // Each was refused as random keys with our own lists: "erty" (property, liberty, poverty), "trew" (strewn), and
    // "hunter" + "tyr…" across two unknown words.
    const cases: Array<[string, TextKind]> = [
      ['The property of the old house was big.', 'reflection'],
      ['I wrote about poverty in our town', 'reflection'],
      ['Liberty means being free', 'note'],
      ['Leaves were strewn on the playground today.', 'reflection'],
      ['The hunter tyrannosaurus was huge', 'reflection'],
      ['I will learn about liberty and property', 'goal'],
    ];
    for (const [text, kind] of cases) {
      expect(checkStudentText(text, kind), text).toEqual({ ok: false, reason: 'KEYBOARD_MASH' });
      expect(checkStudentText(text, kind, large), text).toEqual({ ok: true });
    }
    // Every entry of the generated lists in a neutral sentence: none is read as mashing.
    for (const w of [...LARGE_EN.split(/\s+/u), ...LARGE_TR.split(/\s+/u)].filter(Boolean)) {
      const r = checkStudentText(`I like the word ${w} today`, 'reflection', large);
      expect(r.ok || r.reason !== 'KEYBOARD_MASH', w).toBe(true);
    }
    // Mashing next to real words is still mashing.
    for (const text of ['The property asdf qwer', 'I like poverty jkl hjkl', 'Özgürlük asdfgh güzel', 'property lololo house'])
      expect(checkStudentText(text, 'reflection', large), text).toEqual({ ok: false, reason: 'KEYBOARD_MASH' });
  });

  it('the reasons that depend on the dictionary include mashing; the language check never does', () => {
    expect([...DICTIONARY_REASONS].sort()).toEqual(['FEW_VOWELS', 'KEYBOARD_MASH', 'LONG_WORD', 'UNKNOWN_WORDS']);
    for (const kind of TEXT_KINDS) expect(checkStudentText('fuck this', kind, large)).toEqual({ ok: false, reason: 'BLOCKED_WORD' });
  });
});

describe('the generated lists (npm run gen:word-lists)', () => {
  const en = LARGE_EN.split(/\s+/u).filter(Boolean);
  const tr = LARGE_TR.split(/\s+/u).filter(Boolean);

  it('are folded words of three or more letters, sorted and without duplicates', () => {
    for (const list of [en, tr]) {
      expect(list.length).toBeGreaterThan(10_000);
      expect([...list].sort()).toEqual(list);
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) expect(w, w).toMatch(/^[a-z]{3,}$/u);
    }
  });

  it('hold no risky, unwanted or non-word entries', () => {
    for (const w of [...en, ...tr]) {
      expect(findRiskyWord(w), w).toBeNull();
      expect(unwanted(w), w).toBe(false);
    }
    for (const w of [...NOT_FOR_SCHOOL, ...NOT_WORDS]) {
      expect(LARGE_WORDS.en.has(w) && !SMALL_WORDS.en.has(w), w).toBe(false);
      expect(LARGE_WORDS.tr.has(w) && !SMALL_WORDS.tr.has(w), w).toBe(false);
    }
    for (const w of ['shittiest', 'penises', 'damnation', 'lololo', 'hahaha', 'com']) expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(false);
  });

  it('never recognise a not-for-school word, also not through a shorter word plus an ending (S28b review)', () => {
    // "boner" was "bone" + "r", "hooker" "hook" + "er", "kerhane" "kerhan" + "e"; the small lists know none of these.
    for (const w of NOT_KNOWN) {
      expect(isRecognisedWord(w), w).toBe(false);
      expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(false);
    }
    expect(recognisedNotKnown(en, tr)).toEqual([]);
    for (const w of ['boner', 'semen', 'stripper', 'hooker', 'kike', 'paki', 'nazi', 'kokain', 'fahise', 'kerhane', 'cinsellik', 'seksi']) expect(NOT_KNOWN.has(w), w).toBe(true);
    for (const w of ['hookers', 'strippers', 'boners', 'clitorises', 'mulattoes', 'seduced', 'kerhanede', 'kerhaneler', 'osuruklar', 'gavurlar'])
      expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(false);
  });

  it('hold none of a fixed list of slurs, vulgar, sexual and drug words (checked on the lists themselves)', () => {
    const slursEn = 'wetback redskin mulatto spastic harlot floozy nymphomaniac sodomy rape molester clitoris ejaculate ejaculation copulate intercourse turd crappy midget imbecile cretin hashish opium'.split(' ');
    const slursTr = 'pust kulampara nonos pic got bok tasak sic osur osuruk esrarkes zampara gavur sehvet godos'.split(' ');
    for (const w of slursEn) {
      expect(en.includes(w), w).toBe(false);
      expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(false);
    }
    for (const w of slursTr) {
      expect(tr.includes(w), w).toBe(false);
      // "got" is also the English past of "get" (our small list), so it stays a known word.
      if (w !== 'got') expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(false);
    }
    // No entry is one of them with endings ("clitorises", "seduced", "gavurcasina").
    for (const w of slursEn) expect(notKnownForm.en(w), w).toBe(true);
    for (const w of en) expect(notKnownForm.en(w), w).toBe(false);
    for (const w of tr) expect(notKnownForm.tr(w), w).toBe(false);
    // Innocent words that start like one stay known.
    for (const w of ['analiz', 'boks', 'sicim', 'spiced', 'grape', 'hook', 'bone', 'strip']) expect(isRecognisedWord(w, LARGE_WORDS), w).toBe(true);
  });

  it('carry their licence notices into every build, with the full texts next to them (docs/ASSETS.md)', () => {
    expect(LARGE_WORDS.notices.join(' ')).toContain('Kevin Atkinson');
    expect(LARGE_WORDS.notices.join(' ')).toContain('Apache License, Version 2.0');
    const scowl = readFileSync('src/shared/text/licenses/scowl.txt', 'utf8');
    expect(scowl).toContain('Permission to use, copy, modify, distribute and sell these');
    expect(scowl).toContain('WordNet 1.6 Copyright 1997 by Princeton University');
    // The full notices travel with the lists (SCOWL's VarCon, Ispell and WordNet notices and disclaimers; the Apache License).
    const [enNotice, trNotice] = LARGE_WORDS.notices;
    for (const s of ['Copyright 2016 by Benjamin Titze', 'Copyright 1993, Geoff Kuenning', 'WordNet 1.6 Copyright 1997 by Princeton University', 'Redistributions in binary form must reproduce'])
      expect(enNotice, s).toContain(s);
    expect(enNotice).toContain(scowl.replace(/\r\n/gu, '\n'));
    expect(trNotice).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
    const zemberek = readFileSync('src/shared/text/licenses/zemberek-nlp.txt', 'utf8');
    expect(zemberek).toContain('Copyright 2018 Ahmet A. Akın, Mehmet D. Akın');
    expect(zemberek).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
  });

  it('turn Turkish lemmas into the stems the suffix stripping needs', () => {
    expect(turkishStems('okumak', '')).toEqual(['oku']);
    expect(turkishStems('ağız', '[A:LastVowelDrop]')).toEqual(['ağız', 'ağz']);
    expect(turkishStems('hak', '[A:Doubling, InverseHarmony]')).toEqual(['hak', 'hakk']);
    expect(turkishStems('parmak', '[P:Noun]')).toEqual(['parmak']);
  });
});
