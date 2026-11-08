/** Student text checks (S13c item 12, D-123): nonsense and risky words in English and Turkish. */
import { describe, expect, it } from 'vitest';
import { checkStudentText, findRiskyWord, isRecognisedWord, TEXT_KINDS } from '../../src/shared/text/textQuality.ts';
import { GIBBERISH_EN, GIBBERISH_TR, REAL_EN, REAL_TR } from './text-corpus.ts';

describe('corpus (at least 100 of each, EN and TR)', () => {
  it('has enough samples', () => {
    for (const list of [REAL_EN, REAL_TR, GIBBERISH_EN, GIBBERISH_TR]) expect(list.length).toBeGreaterThanOrEqual(100);
  });

  it.each([...REAL_EN, ...REAL_TR])('accepts the real child-like goal %s', (s) => {
    expect(checkStudentText(s, 'goal')).toEqual({ ok: true });
  });

  it.each([...GIBBERISH_EN, ...GIBBERISH_TR])('rejects the gibberish %s', (s) => {
    expect(checkStudentText(s, 'goal').ok).toBe(false);
    expect(checkStudentText(s, 'reflection').ok).toBe(false);
  });
});

describe('nonsense rules', () => {
  it('names a reason per rule', () => {
    expect(checkStudentText('I read', 'goal')).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(checkStudentText('I will reaaaaaad a book', 'goal')).toEqual({ ok: false, reason: 'REPEATED_CHARS' });
    expect(checkStudentText('### I will read %%%% $$$$ ####', 'goal')).toEqual({ ok: false, reason: 'SYMBOLS' });
    expect(checkStudentText('I WILL READ ONE BOOK EVERY WEEK', 'goal')).toEqual({ ok: false, reason: 'SHOUTING' });
    expect(checkStudentText('I will asdf qwer', 'goal')).toEqual({ ok: false, reason: 'KEYBOARD_MASH' });
    expect(checkStudentText('I will read brrrkzzt', 'goal')).toEqual({ ok: false, reason: 'FEW_VOWELS' });
    expect(checkStudentText('read read read read books', 'goal')).toEqual({ ok: false, reason: 'REPEATED_WORDS' });
    expect(checkStudentText('lorem ipsum dolor sit amet', 'goal')).toEqual({ ok: false, reason: 'UNKNOWN_WORDS' });
    expect(checkStudentText('I will read abcdefghijklmnopqrstuvwxyzab', 'goal').ok).toBe(false);
  });

  it('honours the configurable goal minimum', () => {
    expect(checkStudentText('Read books', 'goal').ok).toBe(false);
    expect(checkStudentText('Read books', 'goal', { limits: { minGoalWords: 2, minGoalLetters: 20 } })).toEqual({ ok: true });
  });

  it('strips Turkish suffixes and consonant changes', () => {
    for (const w of ['okuyacağım', 'kitabımı', 'öğreneceğim', 'çalışacağım', 'kelimeleri', 'gidiyorum', 'ekmeği', 'derste', 'OKUYACAĞIM']) expect(isRecognisedWord(w), w).toBe(true);
    for (const w of ['asdfler', 'qwertyim', 'xkcdlar']) expect(isRecognisedWord(w), w).toBe(false);
  });

  it('allows empty optional link titles and checks every kind', () => {
    expect(checkStudentText('', 'linkTitle')).toEqual({ ok: true });
    for (const kind of TEXT_KINDS) expect(checkStudentText('fuck this', kind)).toEqual({ ok: false, reason: 'BLOCKED_WORD' });
  });
});

describe('risky words', () => {
  it.each([
    ['fuck', 'fuck'],
    ['f.u.c.k this', 'fuck'],
    ['f u c k', 'fuck'],
    ['fuuuuck', 'fuck'],
    ['FUCKING', 'fuck'],
    ['f*ck', 'fuck'],
    ['sh1t', 'shit'],
    ['$hit', 'shit'],
    ['a$$', 'ass'],
    ['b1tch', 'bitch'],
    ['shitty', 'shit'],
    ['siktir', 'sik'],
    ['s i k t i r', 'sik'],
    ['SİKTİR', 'sik'],
    ['sikerim', 'sik'],
    ['orospular', 'orospu'],
    ['0r0spu', 'orospu'],
    ['aptallar', 'aptal'],
    ['gerizekalı', 'gerizekali'],
    ['geri zekalı', 'geri zekali'],
    ['amk', 'amk'],
    ['göt', 'got'],
    ['piç', 'pic'],
    ['salaksın', 'salak'],
  ])('catches %s', (text, word) => {
    expect(findRiskyWord(`Ben ${text} dedim`)).toBe(word);
  });

  it.each([
    'I got a new book',
    'I like this pic of my cat',
    'My class is the best',
    'I passed the test',
    'I will assess my work',
    'We had a classic game',
    'I read about Scunthorpe and Essex',
    'The grass is green',
    'My teacher is an assistant',
    'I will read the passage',
    'I analysed the story',
    'I am happy',
    'Sıkı çalışacağım',
    'Siki calisacagim',
    'Ders çok sıkıcı değildi',
    'Amcam ile kitap okudum',
    'Ama ben denedim',
    'Amacım okumak',
    'Kitabı okula götüreceğim',
    'Sikke topluyorum',
    'Şikayet etmedim',
    'Piknik yaptık',
    'Pen is blue and my pen is red',
    'Dickens wrote stories',
    'A cocktail of fruit juice',
    'I saw a pussycat',
  ])('does not block the innocent %s', (text) => {
    expect(findRiskyWord(text)).toBeNull();
  });

  it('uses the admin and teacher block and allow lists', () => {
    expect(findRiskyWord('You are a dingbat')).toBeNull();
    expect(findRiskyWord('You are a dingbat', { block: ['dingbat'], allow: [] })).toBe('dingbat');
    expect(findRiskyWord('dingbats everywhere', { block: ['dingbat'], allow: [] })).toBe('dingbat');
    expect(findRiskyWord('That was stupid', { block: [], allow: ['stupid'] })).toBeNull();
  });
});
