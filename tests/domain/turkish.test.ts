import { describe, expect, it } from 'vitest';
import { avatarHue, compareNames, foldForSearch, initials, normaliseName, smartTitleCase, sortByName } from '../../src/shared/text/turkish.ts';

describe('Turkish text handling (UX-5, IMP-3)', () => {
  it('sorts with Turkish alphabet order', () => {
    const names = ['Şule', 'Selin', 'Çağla', 'Cem', 'İpek', 'Irmak', 'Ömer', 'Oğuz', 'Ümit', 'Utku', 'Ilgaz'];
    expect(sortByName(names, (x) => x)).toEqual(['Cem', 'Çağla', 'Ilgaz', 'Irmak', 'İpek', 'Oğuz', 'Ömer', 'Selin', 'Şule', 'Utku', 'Ümit']);
    expect(compareNames('ali', 'Ali')).toBe(0);
  });

  it('builds initials with Turkish casing and multi-part names', () => {
    expect(initials('ilknur ışık')).toBe('İI');
    expect(initials('Ayşe Nur Kara Yılmaz')).toBe('AY');
    expect(initials('Çağrı')).toBe('Ç');
    expect(initials('  ')).toBe('?');
  });

  it('title-cases ALL-CAPS e-Okul names correctly, keeps mixed case untouched', () => {
    expect(smartTitleCase('ALİ IŞIK')).toBe('Ali Işık');
    expect(smartTitleCase('İREM ÇİÇEK')).toBe('İrem Çiçek');
    expect(smartTitleCase('mehmet can')).toBe('Mehmet Can');
    expect(smartTitleCase('McKenzie de Souza')).toBe('McKenzie de Souza');
  });

  it('folds for duplicate detection', () => {
    expect(foldForSearch('IŞIK')).toBe(foldForSearch('ışık'));
    expect(foldForSearch('Işık')).toBe('isik');
    expect(foldForSearch('ÇAĞRI')).toBe('cagri');
  });

  it('normalises composed and decomposed characters to the same string', () => {
    expect(normaliseName('Şule')).toBe('Şule');
    expect(normaliseName(' Ali   Can ')).toBe('Ali Can');
  });

  it('gives stable avatar colours', () => {
    expect(avatarHue('student-1')).toBe(avatarHue('student-1'));
  });
});
