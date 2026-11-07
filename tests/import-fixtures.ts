/**
 * FICTIONAL student lists generated in code for the importer tests (S9, D-013). Nothing here is real
 * data: the school, the names and the numbers are made up. Layouts imitate e-Okul class list
 * exports: title rows, a header row ("S.No", "Öğrenci No", "Adı", "Soyadı", "Sınıfı/Şubesi"), ALL
 * CAPS Turkish names, merged title cells and the header repeated on every page.
 */
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import * as XLSX from 'xlsx';

/** Fictional class 3-A: [number, given names (ALL CAPS), family name (ALL CAPS)]. */
export const EOKUL_STUDENTS: Array<[string, string, string]> = [
  ['1101', 'AYŞE NUR', 'YILMAZ'],
  ['1102', 'ALİ RIZA', 'ÖZTÜRK'],
  ['1103', 'ZEYNEP', 'ÇELİK ŞAHİN'],
  ['1104', 'İLKNUR', 'IŞIK'],
  ['1105', 'MEHMET EMİN', 'DOĞAN'],
  ['1106', 'ELİF SU', 'KAYA'],
  ['1107', 'ÇAĞRI', 'GÜNEŞ'],
  ['1108', 'EMRE', 'ŞEN'],
];
export const EXPECTED_NAMES = ['Ayşe Nur Yılmaz', 'Ali Rıza Öztürk', 'Zeynep Çelik Şahin', 'İlknur Işık', 'Mehmet Emin Doğan', 'Elif Su Kaya', 'Çağrı Güneş', 'Emre Şen'];

const HEADER = ['S.No', 'Öğrenci No', 'Adı', 'Soyadı', 'Cinsiyeti', 'Sınıfı/Şubesi'];

/** e-Okul-like sheet: title rows, header, page break with the header repeated, page footers. */
export function eOkulRows(): string[][] {
  const rows: string[][] = [
    ['T.C.'],
    ['KARTAL YUVASI İLKOKULU (KURGUSAL)'],
    ['2026-2027 EĞİTİM ÖĞRETİM YILI 3. SINIF / A ŞUBESİ SINIF LİSTESİ'],
    [],
    HEADER,
  ];
  EOKUL_STUDENTS.forEach(([no, given, family], i) => {
    if (i === 5) rows.push(['Sayfa 1 / 2'], [], HEADER);
    rows.push([String(i + 1), no, given, family, i % 2 ? 'Erkek' : 'Kız', '3/A']);
  });
  rows.push([], ['Sayfa 2 / 2']);
  return rows;
}

function eOkulWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet(eOkulRows());
  // Merged title cells, as in the real export.
  ws['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 5 } }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sınıf Listesi');
  return wb;
}

export const eOkulXlsx = (): Buffer => XLSX.write(eOkulWorkbook(), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
export const eOkulXls = (): Buffer => XLSX.write(eOkulWorkbook(), { type: 'buffer', bookType: 'biff8' }) as Buffer;

/**
 * A tiny workbook that DECLARES a whole-sheet dimension (A1:XFD1048576) around two real rows (S9
 * review: blank-cell expansion). Written normally, then the sheet XML's <dimension> is patched in
 * the zip (writing such a range directly would itself expand every cell).
 */
export function oversizedDimensionXlsx(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([['Öğrenci No', 'Adı Soyadı'], ['101', 'Ayşe Kurgu']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Liste');
  const zip = XLSX.CFB.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, { type: 'buffer' });
  const entry = zip.FileIndex[zip.FullPaths.findIndex((f: string) => f.endsWith('xl/worksheets/sheet1.xml'))]!;
  const xml = Buffer.from(entry.content as Uint8Array).toString('utf8');
  if (!xml.includes('<dimension ref="A1:B2"')) throw new Error('unexpected sheet XML');
  entry.content = Buffer.from(xml.replace('<dimension ref="A1:B2"', '<dimension ref="A1:XFD1048576"'), 'utf8');
  return Buffer.from(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }) as Uint8Array);
}

// ---------------------------------------------------------------- Windows-1254 CSV
const CP1254: Record<string, number> = { Ç: 0xc7, Ğ: 0xd0, İ: 0xdd, Ö: 0xd6, Ş: 0xde, Ü: 0xdc, ç: 0xe7, ğ: 0xf0, ı: 0xfd, ö: 0xf6, ş: 0xfe, ü: 0xfc };

export function encode1254(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) out.push(c);
    else if (CP1254[ch] !== undefined) out.push(CP1254[ch]!);
    else throw new Error(`No Windows-1254 byte for ${ch}`);
  }
  return Buffer.from(out);
}

/** Turkish Excel "CSV (semicolon)" export in Windows-1254 without a BOM. */
export function csv1254(): Buffer {
  const lines = ['Öğrenci No;Adı;Soyadı', ...EOKUL_STUDENTS.slice(0, 4).map(([n, g, f]) => `${n};${g};${f}`)];
  return encode1254(lines.join('\r\n') + '\r\n');
}

/** UTF-16 LE with BOM (Excel "Unicode text"), tab separated. */
export function utf16Tsv(): Buffer {
  const text = ['Öğrenci No\tAdı Soyadı', ...EOKUL_STUDENTS.slice(0, 3).map(([n, g, f]) => `${n}\t${g} ${f}`)].join('\r\n');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

// ---------------------------------------------------------------- DOCX
const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(t)}</w:tc>`;

/** A Word document: a title paragraph and a table (No / Adı Soyadı). */
export async function docxTable(): Promise<Buffer> {
  const rows = [['No', 'Adı Soyadı'], ...EOKUL_STUDENTS.slice(0, 4).map(([n, g, f]) => [n, `${g} ${f}`])];
  const body = `${para('3-A Sınıf Listesi')}<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>${para('')}`;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------------------------------------------------------------- PDF (text layer)
/**
 * A two-page e-Okul-like PDF with the header repeated on every page. pdf-lib's standard fonts are
 * WinAnsi, which has Ç Ö Ü ç ö ü but not Ğ İ Ş ı ğ ş, so these fictional names use only the former
 * (Turkish letters outside WinAnsi are covered by the CSV, Excel, Word and OCR fixtures).
 */
export const PDF_STUDENTS: Array<[string, string, string]> = [
  ['2201', 'MÜGE', 'ÇOBAN'],
  ['2202', 'ÖMER FARUK', 'KÖSE'],
  ['2203', 'ÜMMÜHAN', 'TOPRAK ÇÖLLÜ'],
  ['2204', 'CAN', 'ÖZ'],
];
export async function eOkulPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const cols = [40, 90, 170, 320, 470];
  const header = ['S.No', 'Ogrenci No', 'Adi', 'Soyadi', 'Sinifi/Subesi'];
  for (let pageNo = 0; pageNo < 2; pageNo++) {
    const page = pdf.addPage([595, 842]);
    page.drawText('ORNEK ILKOKULU (KURGUSAL) - SINIF LISTESI', { x: 40, y: 800, size: 12, font });
    header.forEach((h, i) => page.drawText(h, { x: cols[i]!, y: 760, size: 10, font }));
    PDF_STUDENTS.slice(pageNo * 2, pageNo * 2 + 2).forEach(([no, g, f], i) => {
      const y = 740 - i * 18;
      [String(pageNo * 2 + i + 1), no, g, f, '3/A'].forEach((v, c) => page.drawText(v, { x: cols[c]!, y, size: 10, font }));
    });
    page.drawText(`Sayfa ${pageNo + 1} / 2`, { x: 260, y: 40, size: 9, font });
  }
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------- image for OCR
/**
 * A rendered "typed list" (black text on white, as from a printer) for local OCR. The `damaged`
 * line is printed with gaps (white stripes, like a worn printer ribbon) so Tesseract reads it with
 * low confidence; the whole page is slightly blurred like a phone photo.
 */
export async function typedListPng(lines: string[], damaged: string | null = null): Promise<Buffer> {
  const all = damaged ? [...lines, damaged] : lines;
  const h = 80 + all.length * 64;
  const font = 'Arial, Liberation Sans, DejaVu Sans, Helvetica, sans-serif';
  const text = all.map((l, i) => `<text x="40" y="${90 + i * 64}" font-family="${font}" font-size="38" fill="#000">${esc(l)}</text>`).join('');
  const y = 90 + lines.length * 64 - 35;
  const stripes = damaged ? Array.from({ length: 50 }, (_, i) => `<rect x="${40 + i * 9}" y="${y}" width="4" height="45" fill="#fff"/>`).join('') : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${text}${stripes}</svg>`;
  return sharp(Buffer.from(svg)).blur(1).png().toBuffer();
}

// ---------------------------------------------------------------- multipart
export function multipart(data: Buffer, filename: string, contentType: string, field = 'file') {
  const boundary = `----ccTest${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
