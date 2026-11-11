/**
 * Several classes in one file (S20c, D-171; IMP-2): Turkish-aware class label keys and splitting the
 * rows of a fictional school-wide list by its class column.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classesMatching, classifyRows, classLabelKey, crossClassDuplicates, inferMapping, splitByClass, type SourceRow } from '../../src/domain/importing.ts';
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

  it('rows under two classes: one child twice (first copy, then repeats), two children with one name, never within one class (IMP-2, D-171)', () => {
    const rows = rowsOf([
      ['Adı Soyadı', 'Okul No', 'Sınıfı'],
      ['Nehir Uydurmaca', '', '3/A'],
      ['Ece Hayalperest', '7001', '3/A'],
      ['Mert Kurgulu', '7010', '3/A'],
      ['Nehir Uydurmaca', '', '3/B'],
      ['Ece Hayalperest', '7002', '3/B'],
      ['Başka İsim', '7010', '3/C'],
      ['Ada Örnek', '', '3/B'],
      ['Ada Örnek', '', '3/B'],
    ]);
    const mapping = inferMapping(rows);
    const classified = classifyRows(rows, mapping);
    const byLabel = (i: number) => rows[i]!.cells[2]!;
    const cross = crossClassDuplicates(classified, byLabel);
    expect(Object.fromEntries(cross)).toEqual({ 1: 'duplicate', 4: 'repeat', 2: 'same_name', 5: 'same_name', 3: 'duplicate', 6: 'repeat' });
    // The same list where 3/B is not imported: nothing across classes for its rows.
    const without = crossClassDuplicates(classified, (i) => (byLabel(i) === '3/B' ? null : byLabel(i)));
    expect(Object.fromEntries(without)).toEqual({ 3: 'duplicate', 6: 'repeat' });
    // Two labels into one class: no longer "another class".
    expect(crossClassDuplicates(classified, () => 'one').size).toBe(0);
  });
});
