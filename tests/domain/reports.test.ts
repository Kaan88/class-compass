/** Pure helpers of S11: CSV escaping (RPT-4), report periods (RPT-2), backup retention (OPS-2). */
import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, safeFileName, toCsv } from '../../src/domain/csv.ts';
import { presetRange, schoolDaysBetween, weekStartsBetween } from '../../src/domain/periods.ts';
import { backupsToKeep } from '../../src/domain/retention.ts';

describe('CSV (RPT-4)', () => {
  it('escapes cells that a spreadsheet would run as a formula', () => {
    for (const s of ['=1+2', '+90 555', '-5', '@SUM(A1)', '\tx', '\rx']) expect(csvCell(s).replace(/^"|"$/gu, '').startsWith("'")).toBe(true);
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('Ayşe, Işıl')).toBe('"Ayşe, Işıl"');
    expect(csvCell('a;b', ';')).toBe('"a;b"');
    expect(csvCell('a;b', ',')).toBe('a;b');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
  });

  it('writes UTF-8 with a BOM and CRLF lines', () => {
    const csv = toCsv(['Öğrenci', 'Sayı'], [['Çınar', 3], ['=Ece', 0]], ';');
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['Öğrenci;Sayı', 'Çınar;3', "'=Ece;0", '']);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('file names are ASCII only', () => {
    expect(safeFileName('3-A İngilizce/../ödev')).toMatch(/^[A-Za-z0-9._-]+$/u);
    expect(safeFileName('')).toBe('export');
  });
});

describe('report periods (RPT-2)', () => {
  const cal = { today: '2026-11-11', weekStartsOn: 1, year: { from: '2026-09-01', to: '2027-06-30' }, terms: [{ from: '2026-09-01', to: '2027-01-22' }, { from: '2027-02-08', to: '2027-06-30' }] };
  it('day, week, month, term, year and custom ranges stay inside the school year', () => {
    expect(presetRange('day', cal)).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(presetRange('week', cal)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(presetRange('month', cal)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('term', cal)).toEqual({ from: '2026-09-01', to: '2027-01-22' });
    expect(presetRange('year', cal)).toEqual(cal.year);
    expect(presetRange('custom', cal, undefined, { from: '2026-12-01', to: '2026-08-01' })).toEqual({ from: '2026-09-01', to: '2026-12-01' });
    expect(presetRange('week', { ...cal, weekStartsOn: 0 })).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    // In a term break the latest term that started is used.
    expect(presetRange('term', cal, '2027-02-01')).toEqual({ from: '2026-09-01', to: '2027-01-22' });
  });

  it('school days stop at today; weeks cover the range', () => {
    expect(schoolDaysBetween({ from: '2026-11-06', to: '2026-11-20' }, '2026-11-11')).toEqual(['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(weekStartsBetween({ from: '2026-11-11', to: '2026-11-23' }, 1)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
  });
});

describe('backup retention (OPS-2)', () => {
  it('keeps the newest backup of each hour, day and month up to the configured counts', () => {
    const at = (iso: string) => Date.parse(iso);
    const b = [
      { name: 'a', at: at('2026-11-09T10:50:00Z') },
      { name: 'b', at: at('2026-11-09T10:10:00Z') },
      { name: 'c', at: at('2026-11-09T09:30:00Z') },
      { name: 'd', at: at('2026-11-08T22:00:00Z') },
      { name: 'e', at: at('2026-10-02T22:00:00Z') },
    ];
    expect([...backupsToKeep(b, { hourly: 1, daily: 0, monthly: 0 })].sort()).toEqual(['a']);
    expect([...backupsToKeep(b, { hourly: 2, daily: 0, monthly: 0 })].sort()).toEqual(['a', 'c']);
    expect([...backupsToKeep(b, { hourly: 0, daily: 2, monthly: 0 })].sort()).toEqual(['a', 'd']);
    expect([...backupsToKeep(b, { hourly: 0, daily: 0, monthly: 2 })].sort()).toEqual(['a', 'e']);
    expect([...backupsToKeep([], { hourly: 48, daily: 30, monthly: 12 })]).toEqual([]);
  });
});
