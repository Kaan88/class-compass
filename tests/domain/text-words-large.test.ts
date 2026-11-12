/**
 * The larger word lists of the student text check (S28b, D-198; GOL-5, refines D-123): real but uncommon
 * English and Turkish words are known now, and the nonsense rules behave as before (keyboard mashing
 * always looks at what our own small lists do not know).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_FOR_SCHOOL, NOT_WORDS, turkishStems, unwanted } from '../../scripts/word-lists.ts';
import { LARGE_WORDS } from '../../src/shared/text/largeWords.ts';
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
      // Keyboard mashing is decided on the small lists, whatever dictionary is passed in.
      const small = checkStudentText(s, kind);
      if (!small.ok && small.reason === 'KEYBOARD_MASH') expect(checkStudentText(s, kind, large)).toEqual(small);
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

  it('keyboard mashing is never a dictionary reason (the student page shows it without the large lists)', () => {
    expect(DICTIONARY_REASONS.has('KEYBOARD_MASH')).toBe(false);
    expect([...DICTIONARY_REASONS].sort()).toEqual(['FEW_VOWELS', 'LONG_WORD', 'UNKNOWN_WORDS']);
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

  it('carry their licence notices into every build, with the full texts next to them (docs/ASSETS.md)', () => {
    expect(LARGE_WORDS.notices.join(' ')).toContain('Kevin Atkinson');
    expect(LARGE_WORDS.notices.join(' ')).toContain('Apache License, Version 2.0');
    const scowl = readFileSync('src/shared/text/licenses/scowl.txt', 'utf8');
    expect(scowl).toContain('Permission to use, copy, modify, distribute and sell these');
    expect(scowl).toContain('WordNet 1.6 Copyright 1997 by Princeton University');
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
