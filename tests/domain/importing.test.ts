import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyRows, classKey, detectDelimiter, freeTextRows, headingSignal, inferMapping, looksLikePositions, nameSimilarity, parseCells, POSSIBLE_MATCH } from '../../src/domain/importing.ts';

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

describe('importer review fixes (IMP-2, IMP-3, IMP-4)', () => {
  const rowsOf = (text: string) => {
    const rows = freeTextRows(text.split('\n').map((t) => ({ text: t })));
    return classifyRows(rows, inferMapping(rows));
  };

  it('generic heading words inside names only flag the row; strong titles are headings (IMP-3)', () => {
    expect(headingSignal('Ellen Page')).toBe('weak');
    expect(headingSignal('Mehmet Öğretmen')).toBe('weak');
    expect(headingSignal('Ayşe Yılmaz')).toBeNull();
    for (const t of ['3-A Listesi', 'Sınıf Listesi', 'Atatürk İlkokulu', 'Sayfa 2', 'Sayfa 1 / 3', 'Toplam 32', 'Sınıf: 3-A', 'Sınıf Öğretmeni: Ayşe Kara', 'Tarih 01.02.2026', 'Öğrenci No']) {
      expect(headingSignal(t), t).toBe('strong');
    }
    const r = rowsOf('3-A Listesi\nEllen Page\nMehmet Öğretmen\nAyşe Yılmaz');
    expect(r.map((x) => [x.parsed.fullName, x.heading, x.possibleHeading])).toEqual([
      ['3-A Listesi', true, false],
      ['Ellen Page', false, true],
      ['Mehmet Öğretmen', false, true],
      ['Ayşe Yılmaz', false, false],
    ]);
    expect(r[1]!.flags).toContain('possible_heading');
  });

  it('list positions survive a missing line and page restarts; "N - name" keeps a real student number (IMP-2, IMP-4)', () => {
    expect(looksLikePositions([1, 2, 4, 5])).toBe(true);
    expect(looksLikePositions([1, 2, 3, 1, 2])).toBe(true);
    expect(looksLikePositions([245, 312, 418])).toBe(false);
    expect(looksLikePositions([1, 9, 30])).toBe(false);
    expect(freeTextRows([{ text: '1 Ayşe Yılmaz' }, { text: '2 Mehmet Kaya' }, { text: '4 Zeynep Demir' }, { text: '5 Can Öz' }]).map((r) => r.cells[0])).toEqual(['', '', '', '']);
    expect(freeTextRows([{ text: '245 - Ayşe Yılmaz' }, { text: '312 - Mehmet Kaya' }, { text: '418 - Zeynep Demir' }]).map((r) => r.cells)).toEqual([
      ['245', 'Ayşe Yılmaz'],
      ['312', 'Mehmet Kaya'],
      ['418', 'Zeynep Demir'],
    ]);
    expect(freeTextRows([{ text: '1 - Ayşe Yılmaz' }, { text: '2 - Mehmet Kaya' }]).map((r) => r.cells[0])).toEqual(['', '']);
  });

  it('same name with different numbers is two children; same number or unnumbered copies are duplicates (IMP-2)', () => {
    const two = rowsOf('1201 Ahmet Yılmaz\n1305 Ahmet Yılmaz\n1400 Zeynep Kaya');
    expect(two.map((r) => r.repeat)).toEqual([false, false, false]);
    expect(two[0]!.flags).toContain('same_name_in_file');
    expect(two[1]!.flags).not.toContain('duplicate_in_file');
    const dup = rowsOf('1201 Ahmet Yılmaz\nAhmet Yılmaz\n1201 Ahmet Yilmaz');
    expect(dup.map((r) => r.repeat)).toEqual([false, true, true]);
    expect(dup.every((r) => r.flags.includes('duplicate_in_file'))).toBe(true);
  });
});
