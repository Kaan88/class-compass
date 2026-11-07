import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classKey, detectDelimiter, freeTextRows, inferMapping, nameSimilarity, parseCells, POSSIBLE_MATCH } from '../../src/domain/importing.ts';

describe('importer domain logic (IMP-2, IMP-3, IMP-4)', () => {
  it('free text: list positions are not student numbers, numbers before/after the name are (IMP-2)', () => {
    const rows = freeTextRows([{ text: '1. Ayşe Nur Kara' }, { text: '2) Mehmet Ali Kaya' }, { text: '3 Elif Su Doğan' }]);
    expect(rows.map((r) => r.cells)).toEqual([
      ['', 'Ayşe Nur Kara'],
      ['', 'Mehmet Ali Kaya'],
      ['', 'Elif Su Doğan'],
    ]);
    const numbered = freeTextRows([{ text: '1101 Can Öz' }, { text: '1102 Su Er' }, { text: 'Deniz Ak 1205' }]);
    expect(numbered.map((r) => r.cells[0])).toEqual(['1101', '1102', '1205']);
  });

  it('detects delimiters and never treats "Surname, Given" as two columns without numbers', () => {
    expect(detectDelimiter(['1\tAyşe', '2\tCan'])).toBe('\t');
    expect(detectDelimiter(['101;Ayşe', '102;Can'])).toBe(';');
    expect(detectDelimiter(['Yılmaz, Ayşe', 'Kaya, Can'])).toBeNull();
    expect(detectDelimiter(['101,Ayşe', '102,Can'])).toBe(',');
  });

  it('normalises class labels written in different ways (D-013)', () => {
    for (const s of ['3-A', '3/A', '3 A', '3A', '3. Sınıf / A Şubesi']) expect(classKey(s)).toBe('3a');
    expect(classKey('Ayşe Kara')).toBeNull();
  });

  it('never guesses surnames: given/family only from explicit columns (IMP-3)', () => {
    const header = { cells: ['Öğrenci No', 'Adı Soyadı'], page: null, confidence: null };
    const m = inferMapping([header, { cells: ['1203', 'AYŞE NUR KARA YILMAZ'], page: null, confidence: null }]);
    const p = parseCells(['1203', 'AYŞE NUR KARA YILMAZ'], m);
    expect(p).toMatchObject({ fullName: 'Ayşe Nur Kara Yılmaz', givenNames: null, familyName: null, studentNumber: '1203' });
    const split = inferMapping([{ cells: ['No', 'Adı', 'Soyadı'], page: null, confidence: null }, { cells: ['5', 'Ayşe Nur', 'Kara Yılmaz'], page: null, confidence: null }]);
    expect(parseCells(['5', 'Ayşe Nur', 'Kara Yılmaz'], split)).toMatchObject({ fullName: 'Ayşe Nur Kara Yılmaz', givenNames: 'Ayşe Nur', familyName: 'Kara Yılmaz' });
  });

  it('name similarity: Turkish folding and word order give 1, typos stay below 1 but above the threshold (IMP-4)', () => {
    expect(nameSimilarity('ÇAĞLA IŞIK', 'Çağla Işık')).toBe(1);
    expect(nameSimilarity('Deniz Akın', 'Deniz Akim')).toBeGreaterThanOrEqual(POSSIBLE_MATCH);
    expect(nameSimilarity('Deniz Akın', 'Deniz Akim')).toBeLessThan(1);
    expect(nameSimilarity('Deniz Akın', 'Mehmet Kaya')).toBeLessThan(POSSIBLE_MATCH);
  });

  it('name similarity is symmetric and bounded (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (a, b) => {
        const s = nameSimilarity(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(nameSimilarity(b, a)).toBeCloseTo(s, 10);
      }),
    );
  });
});
