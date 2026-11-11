/**
 * Several classes in one file (S20c, D-171; IMP-2): Turkish-aware class label keys and splitting the
 * rows of a fictional school-wide list by its class column.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classesMatching, classLabelKey, inferMapping, splitByClass, type SourceRow } from '../../src/domain/importing.ts';
import { multiClassRows } from '../import-fixtures.ts';

const rowsOf = (cells: string[][]): SourceRow[] => cells.filter((r) => r.some((c) => c.trim())).map((c) => ({ cells: c, page: null, confidence: null }));

describe('class labels and splitting by class (IMP-2, D-171)', () => {
  it('the usual spellings of one class have one key; other classes differ (Turkish-aware)', () => {
    const same = ['3-A', '3/A', '3 A', '3A', '3-a', '03-A', '3. Sınıf / A Şubesi', '3. SINIF / A ŞUBESİ', ' 3 / A '];
    expect(new Set(same.map(classLabelKey))).toEqual(new Set(['3a']));
    expect(classLabelKey('3/B')).toBe('3b');
    expect(classLabelKey('4-A')).toBe('4a');
    // Turkish letters keep their identity and use Turkish case rules: Ç is not C, I (ı) is not İ (i).
    expect(classLabelKey('2-Ç')).toBe(classLabelKey('2/ç'));
    expect(classLabelKey('2-Ç')).not.toBe(classLabelKey('2-C'));
    expect(classLabelKey('2-I')).toBe(classLabelKey('2 ı'));
    expect(classLabelKey('2-I')).not.toBe(classLabelKey('2-İ'));
    expect(classLabelKey('2-İ')).toBe(classLabelKey('2-i'));
    // Labels that are not "grade + letter" compare by their letters and digits, Turkish case rules.
    expect(classLabelKey('Hazırlık')).toBe(classLabelKey('HAZIRLIK'));
    expect(classLabelKey('Anasınıfı B')).toBe(classLabelKey('ANASINIFI / B'));
    expect(classLabelKey('')).toBeNull();
    expect(classLabelKey('  - / ')).toBeNull();
    expect(classesMatching('3/A', [{ name: '3-A' }, { name: '3-B' }, { name: '3 A' }]).map((c) => c.name)).toEqual(['3-A', '3 A']);
  });

  it('every grade and letter written with any separator gives the same key (property)', () => {
    const letters = [...'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ'];
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.constantFrom(...letters), fc.constantFrom('-', '/', ' ', '', ' / ', '. Sınıf / '), (grade, letter, sep) => {
        const suffix = sep === '. Sınıf / ' ? ' Şubesi' : '';
        expect(classLabelKey(`${grade}${sep}${letter}${suffix}`)).toBe(classLabelKey(`${grade}-${letter}`));
      }),
      { seed: 171, numRuns: 200 },
    );
  });

  it('splits a school list by its class column: headings belong to no class, rows without a class form their own group', () => {
    const rows = rowsOf(multiClassRows());
    const mapping = inferMapping(rows);
    expect(mapping.className).not.toBeNull();
    const groups = splitByClass(rows, mapping);
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
      ['3a', 4],
      ['3b', 2],
      ['5c', 2],
      ['', 1],
    ]);
    expect(groups[0]!.labels).toEqual(['3/A', '3-A', '3 A']);
    expect(groups[1]!.labels).toEqual(['3. Sınıf / B Şubesi', '3/B']);
    expect(groups[3]!.labels).toEqual([]);
    // Only student rows are in groups: titles, the repeated header and page footers are not.
    const inGroups = new Set(groups.flatMap((g) => g.rows));
    expect([...inGroups].every((i) => /^\d+$/u.test(rows[i]!.cells[0]!))).toBe(true);
    expect(inGroups.size).toBe(9);
  });
});
