/**
 * Importer parsers on generated FICTIONAL fixtures (S9: IMP-1, IMP-3, D-013): e-Okul xls/xlsx with
 * title rows and repeated page headers, Windows-1254 CSV, UTF-16 text, Word table, PDF text, and
 * local OCR of a rendered typed list with a low-confidence line flagged.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { classifyRows, inferMapping, type ClassifiedRow } from '../../src/domain/importing.ts';
import { extractFile, extractPaste } from '../../src/server/modules/import/parsers/index.ts';
import { detectEncoding } from '../../src/server/modules/import/parsers/text.ts';
import { MIME } from '../../src/server/modules/files/sniff.ts';
import { csv1254, docxTable, eOkulPdf, eOkulXls, eOkulXlsx, EXPECTED_NAMES, PDF_STUDENTS, typedListPng, utf16Tsv } from '../import-fixtures.ts';

const cfg = { ocrCacheDir: path.join(os.tmpdir(), 'cc-ocr-cache-test'), OCR_TIMEOUT_MS: 120_000 };

async function viaFile(buf: Buffer, mime: string, name: string) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-imp-'));
  const p = path.join(dir, 'f');
  await fsp.writeFile(p, buf);
  try {
    return await extractFile(cfg, { path: p, mime, name });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function students(rows: ClassifiedRow[]) {
  return rows.filter((r) => !r.heading);
}

function classify(extracted: { rows: Array<{ cells: string[]; page: number | null; confidence: number | null }> }, target = '3-A') {
  const source = extracted.rows.filter((r) => r.cells.some((c) => c.trim()));
  const mapping = inferMapping(source);
  return { mapping, rows: classifyRows(source, mapping, { targetClassName: target }) };
}

describe('importer parsers (IMP-1, D-013)', () => {
  it('reads an e-Okul .xlsx export: titles and repeated page headers ignored, ALL CAPS names title-cased, given/family split only from explicit columns (IMP-3)', async () => {
    const ex = await viaFile(eOkulXlsx(), MIME.xlsx, 'liste.xlsx');
    expect(ex.sourceType).toBe('xlsx');
    const { mapping, rows } = classify(ex);
    expect(mapping.givenNames).not.toBeNull();
    expect(mapping.familyName).not.toBeNull();
    expect(mapping.studentNumber).not.toBeNull();
    const st = students(rows);
    expect(st.map((r) => r.parsed.fullName)).toEqual(EXPECTED_NAMES);
    expect(st[2]!.parsed).toMatchObject({ givenNames: 'Zeynep', familyName: 'Çelik Şahin', studentNumber: '1103' });
    expect(st.every((r) => r.flags.length === 0)).toBe(true);
    // Title rows, the page footer and the header repeated on page 2 are headings.
    expect(rows.filter((r) => r.heading).map((r) => r.cells.join(' ').trim())).toEqual(
      expect.arrayContaining(['T.C.', 'Sayfa 1 / 2', 'Sayfa 2 / 2', expect.stringContaining('Öğrenci No')]),
    );
  });

  it('reads the same layout from a legacy .xls (BIFF8) workbook', async () => {
    const ex = await viaFile(eOkulXls(), MIME.xls, 'liste.xls');
    expect(ex.sourceType).toBe('xls');
    expect(students(classify(ex).rows).map((r) => r.parsed.fullName)).toEqual(EXPECTED_NAMES);
  });

  it('detects a Windows-1254 CSV (Turkish Excel export) and keeps Turkish characters (UX-5)', async () => {
    expect(detectEncoding(csv1254()).encoding).toBe('windows-1254');
    const ex = await viaFile(csv1254(), MIME.text, 'liste.csv');
    expect(ex.sourceType).toBe('csv');
    expect(ex.notices).toContain('ENCODING_WINDOWS_1254');
    expect(students(classify(ex).rows).map((r) => r.parsed.fullName)).toEqual(EXPECTED_NAMES.slice(0, 4));
  });

  it('detects UTF-16 text with a BOM; a single "Adı Soyadı" column is kept whole (no surname guessing)', async () => {
    const ex = await viaFile(utf16Tsv(), MIME.text, 'liste.txt');
    expect(ex.notices).toContain('ENCODING_UTF_16LE');
    const st = students(classify(ex).rows);
    expect(st.map((r) => r.parsed.fullName)).toEqual(EXPECTED_NAMES.slice(0, 3));
    expect(st.every((r) => r.parsed.givenNames === null && r.parsed.familyName === null)).toBe(true);
  });

  it('reads a Word table and ignores the title paragraph', async () => {
    const ex = await viaFile(await docxTable(), MIME.docx, 'liste.docx');
    expect(ex.sourceType).toBe('docx');
    const { rows } = classify(ex);
    expect(students(rows).map((r) => [r.parsed.studentNumber, r.parsed.fullName])).toEqual(EXPECTED_NAMES.slice(0, 4).map((n, i) => [String(1101 + i), n]));
    expect(rows.find((r) => r.cells.join('').includes('Sınıf Listesi'))?.heading).toBe(true);
  });

  it('reads the text layer of a PDF with the header repeated on each page', async () => {
    const ex = await viaFile(await eOkulPdf(), MIME.pdf, 'liste.pdf');
    expect(ex.sourceType).toBe('pdf');
    const st = students(classify(ex).rows);
    expect(st.map((r) => r.parsed.fullName)).toEqual(['Müge Çoban', 'Ömer Faruk Köse', 'Ümmühan Toprak Çöllü', 'Can Öz']);
    expect(st.map((r) => r.parsed.studentNumber)).toEqual(PDF_STUDENTS.map((s) => s[0]));
  });

  it('refuses a scanned PDF without a text layer and asks for a photo instead', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    await expect(viaFile(Buffer.from(await pdf.save()), MIME.pdf, 'scan.pdf')).rejects.toMatchObject({ details: { reason: 'SCANNED_PDF' } });
  });

  it('pasted text: headings and blank lines ignored, numbered list positions are not student numbers, multi-part names kept (IMP-3)', () => {
    const text = '3-A Sınıf Listesi\n\n1. Ayşe Nur Kara Yılmaz\n2. Mehmet Ali Kaya\n\n3. Elif Su Doğan\nSayfa 1/1\n';
    const { rows } = classify(extractPaste(text));
    const st = students(rows);
    expect(st.map((r) => r.parsed.fullName)).toEqual(['Ayşe Nur Kara Yılmaz', 'Mehmet Ali Kaya', 'Elif Su Doğan']);
    expect(st.every((r) => r.parsed.studentNumber === null && r.parsed.familyName === null)).toBe(true);
    expect(rows.filter((r) => r.heading)).toHaveLength(2);
  });

  it('pasted tab-separated rows from Excel use the header row', () => {
    const { rows } = classify(extractPaste('Öğrenci No\tAdı\tSoyadı\n301\tCAN\tYILDIZ\n302\tSU\tAK\n'));
    expect(students(rows).map((r) => [r.parsed.studentNumber, r.parsed.givenNames, r.parsed.familyName, r.parsed.fullName])).toEqual([
      ['301', 'Can', 'Yıldız', 'Can Yıldız'],
      ['302', 'Su', 'Ak', 'Su Ak'],
    ]);
  });

  it(
    'OCR runs locally on a rendered typed list; a damaged line is flagged low_confidence (IMP-7, ENG-3 uncertain OCR)',
    async () => {
      const png = await typedListPng(['1101 Ayşe Nur Yılmaz', '1102 Ali Rıza Öztürk', '1103 Zeynep Çelik Şahin'], '1104 İlknur Işık');
      const ex = await viaFile(png, MIME.png, 'list.png');
      expect(ex.sourceType).toBe('image');
      expect(ex.notices).toContain('OCR_LOCAL');
      const { rows } = classify(ex);
      const st = students(rows);
      const good = st.filter((r) => ['1101', '1102', '1103'].includes(r.parsed.studentNumber ?? ''));
      expect(good.map((r) => r.parsed.fullName)).toEqual(['Ayşe Nur Yılmaz', 'Ali Rıza Öztürk', 'Zeynep Çelik Şahin']);
      expect(good.every((r) => !r.flags.includes('low_confidence') && (r.confidence ?? 0) >= 75)).toBe(true);
      // The damaged line is read, but flagged for the teacher to check.
      const rest = rows.filter((r) => !good.includes(r));
      expect(rest.length).toBeGreaterThan(0);
      expect(rest.every((r) => r.flags.includes('low_confidence'))).toBe(true);
    },
    180_000,
  );
});
