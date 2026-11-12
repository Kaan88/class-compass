/**
 * HTML-table ".xls" student lists (S20c, D-171; IMP-1, STU-8): some school systems export a list as
 * a web page with a .xls name. Only the table text is read, in the parser worker with its time limit;
 * nothing in the page is executed or fetched, and anything that is neither a real workbook nor a plain
 * HTML table is still refused. Fictional names only.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyRows, inferMapping } from '../../src/domain/importing.ts';
import { looksLikeHtmlTable, MIME, sniffFile } from '../../src/server/modules/files/sniff.ts';
import { extractFile } from '../../src/server/modules/import/parsers/index.ts';
import { decodeEntities, MAX_HTML_CELL_CHARS, MAX_HTML_TABLES, parseHtmlTables } from '../../src/server/modules/import/parsers/html.ts';
import { ALLOWED_MIME } from '../../src/shared/contracts/files.ts';
import { en as enMain } from '../../src/shared/i18n/en.ts';
import { tr as trMain } from '../../src/shared/i18n/tr.ts';
import { makeEnv, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';
import { HOSTILE_MARKER, hostileHtmlXls, htmlTableXls, hugeHtmlXls, MULTI_CLASS_STUDENTS, multipart } from '../import-fixtures.ts';

const cfg = { ocrCacheDir: path.join(os.tmpdir(), 'cc-ocr-cache-test'), OCR_TIMEOUT_MS: 120_000, PARSE_TIMEOUT_MS: 60_000 };

async function withFile<T>(buf: Buffer, fn: (p: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-html-'));
  const p = path.join(dir, 'f');
  await fsp.writeFile(p, buf);
  try {
    return await fn(p);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const students = (rows: Array<{ cells: string[]; page: number | null; confidence: number | null }>) => {
  const source = rows.filter((r) => r.cells.some((c) => c.trim()));
  return classifyRows(source, inferMapping(source)).filter((r) => !r.heading);
};

describe('HTML-table .xls: parser (D-171)', () => {
  it('reads Excel-flavoured HTML: office markup, styles and conditional comments skipped, merged title cells, character references decoded', () => {
    const res = parseHtmlTables(htmlTableXls());
    expect(res.tables).toBe(1);
    expect(res.truncated).toBe(false);
    const st = students(res.rows);
    expect(st.map((r) => r.parsed.studentNumber)).toEqual(MULTI_CLASS_STUDENTS.map((s) => s[0]));
    expect(st.find((r) => r.parsed.studentNumber === '5202')!.parsed.fullName).toBe('Çınar Masalcı');
    expect(st.find((r) => r.parsed.studentNumber === '5201')!.parsed.className).toBe('3. Sınıf / B Şubesi');
    expect(res.rows.flatMap((r) => r.cells).join(' ')).not.toMatch(/mso-number-format|ExcelWorkbook|Liste<\/x:Name>/u);
  });

  it('a hostile page: scripts, comments, frames, objects, SVG and attributes never reach a cell; broken references and an unterminated tag are harmless', () => {
    const res = parseHtmlTables(hostileHtmlXls());
    const text = res.rows.flatMap((r) => r.cells).join(' | ');
    expect(text).not.toContain(HOSTILE_MARKER);
    expect(text).not.toMatch(/javascript|example\.org|alert|onerror|<|>/u);
    expect(text).not.toMatch(/9999|8888|7777/u);
    const st = students(res.rows);
    // An unknown reference stays as written (audit finding 3); invalid numeric ones are left out.
    expect(st.map((r) => r.parsed.fullName)).toEqual(['Ece Kurgu', 'Kaan Örnek', 'Ada Deneme&bogus;', 'Mert Taslak', 'Son Satır']);
    expect(st.map((r) => r.parsed.studentNumber)).toEqual(['6101', '6102', '6103', '6104', '6105']);
  });

  it('limits: rows, columns and characters per cell are capped (huge table)', () => {
    const res = parseHtmlTables(hugeHtmlXls());
    expect(res.truncated).toBe(true);
    expect(res.rows.length).toBeLessThanOrEqual(2100);
    expect(res.rows.reduce((m, r) => Math.max(m, r.cells.length), 0)).toBeLessThanOrEqual(60);
    expect(res.rows.reduce((m, r) => Math.max(m, ...r.cells.map((c) => c.length)), 0)).toBeLessThanOrEqual(MAX_HTML_CELL_CHARS);
  });

  it('audit finding 1: tables past the 20th are never dropped silently; the page is refused with a reason (D-079)', async () => {
    const tablesHtml = (count: number) => Buffer.from(Array.from({ length: count }, (_, i) => `<table><tr><td>Ada Kurgu${i}</td><td>${6100 + i}</td></tr></table>`).join(''));
    // Exactly the limit is read in full.
    const atLimit = parseHtmlTables(tablesHtml(MAX_HTML_TABLES));
    expect(atLimit).toMatchObject({ tables: MAX_HTML_TABLES, tooManyTables: false });
    expect(atLimit.rows).toHaveLength(MAX_HTML_TABLES);
    // One more table (top level or nested) stops the reading and says so.
    expect(parseHtmlTables(tablesHtml(MAX_HTML_TABLES + 1)).tooManyTables).toBe(true);
    const nested = Buffer.from(Array.from({ length: MAX_HTML_TABLES }, (_, i) => `<table><tr><td>T${i}</td><td><table><tr><td>N${i}</td></tr></table></td></tr></table>`).join(''));
    expect(parseHtmlTables(nested).tooManyTables).toBe(true);
    // The importer refuses such a file with its own reason instead of importing part of it.
    await expect(withFile(tablesHtml(MAX_HTML_TABLES + 1), (p) => extractFile(cfg, { path: p, mime: MIME.htmlTable, name: 'liste.xls' }))).rejects.toMatchObject({
      details: { reason: 'IMPORT_HTML_TOO_MANY_TABLES', max: MAX_HTML_TABLES },
    });
    // The message names the same limit in both languages.
    expect(enMain['error.IMPORT_HTML_TOO_MANY_TABLES']).toContain(String(MAX_HTML_TABLES));
    expect(trMain['error.IMPORT_HTML_TOO_MANY_TABLES']).toContain(String(MAX_HTML_TABLES));
  });

  it('audit finding 2: a rowspan past the span limit covers the rest of the table, so later rows never shift one column left', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>${7000 + i}</td>${i === 0 ? '<td rowspan="100">3/A</td>' : ''}<td>Ela Kurgu${i}</td></tr>`).join('');
    const out = parseHtmlTables(Buffer.from(`<table>${rows}</table>`)).rows.map((r) => r.cells);
    expect(out).toHaveLength(60);
    expect(out[0]).toEqual(['7000', '3/A', 'Ela Kurgu0']);
    // Row 55 is past the 50-row span limit: its name is still in the third column.
    expect(out[55]).toEqual(['7055', '', 'Ela Kurgu55']);
    expect(out.every((r, i) => r[0] === String(7000 + i) && r[2] === `Ela Kurgu${i}`)).toBe(true);
    // A span within the limit still ends where it says.
    const short = parseHtmlTables(Buffer.from('<table><tr><td rowspan="2">3/A</td><td>Ada</td></tr><tr><td>Can</td></tr><tr><td>3/B</td><td>Ece</td></tr></table>')).rows.map((r) => r.cells);
    expect(short).toEqual([
      ['3/A', 'Ada'],
      ['', 'Can'],
      ['3/B', 'Ece'],
    ]);
  });

  it('audit finding 2 (review): a long rowspan that ends before the table does frees its column, so the next grade cell and its names stay in place', () => {
    // Grade 3 spans 120 pupils, grade 4 the next 110: both spans are past the old 50-row limit.
    const rows = Array.from({ length: 230 }, (_, i) => {
      const grade = i === 0 ? '<td rowspan="120">3</td>' : i === 120 ? '<td rowspan="110">4</td>' : '';
      return `<tr>${grade}<td>Ela Kurgu${i}</td><td>${7000 + i}</td></tr>`;
    }).join('');
    const out = parseHtmlTables(Buffer.from(`<table>${rows}</table>`)).rows.map((r) => r.cells);
    expect(out).toHaveLength(230);
    expect(out[0]).toEqual(['3', 'Ela Kurgu0', '7000']);
    expect(out[119]).toEqual(['', 'Ela Kurgu119', '7119']);
    expect(out[120]).toEqual(['4', 'Ela Kurgu120', '7120']);
    expect(out[229]).toEqual(['', 'Ela Kurgu229', '7229']);
    expect(out.every((r, i) => r.length === 3 && r[1] === `Ela Kurgu${i}` && r[2] === String(7000 + i))).toBe(true);
  });

  it('review of the audit fixes (point 6): a colspan up to the column limit keeps its width, so the next cell stays in its column; a wider one covers the row to the limit', () => {
    // A heading spanning 55 columns (above the old span limit of 50, below MAX_SHEET_COLS = 60), then a cell.
    const wide = parseHtmlTables(Buffer.from('<table><tr><td colspan="55">Liste</td><td>Sonra</td></tr><tr><td>1</td></tr></table>')).rows.map((r) => r.cells);
    expect(wide[0]![0]).toBe('Liste');
    expect(wide[0]![55]).toBe('Sonra');
    expect(wide[0]!.slice(1, 55).every((c) => c === '')).toBe(true);
    expect(wide[0]).toHaveLength(56);
    // Past the limit: the span covers the row to column 60, and the next cell is beyond it (never shifted in).
    const past = parseHtmlTables(Buffer.from('<table><tr><td colspan="70">Liste</td><td>Sonra</td></tr></table>')).rows.map((r) => r.cells);
    expect(past[0]).toHaveLength(60);
    expect(past[0]![0]).toBe('Liste');
    expect(past[0]!.includes('Sonra')).toBe(false);
  });

  it('audit finding 3: an unknown named character reference stays as written; the letters used in names are decoded', () => {
    expect(decodeEntities('Ay&bogus;e')).toBe('Ay&bogus;e');
    expect(decodeEntities('&Ccedil;a&gbreve;r&inodot; &Ouml;z&uuml;m &Scedil;eker &Idot;pek &Uuml;mit &scedil;&ouml;&ccedil;&Gbreve;')).toBe('Çağrı Özüm Şeker İpek Ümit şöçĞ');
    expect(decodeEntities('Ren&eacute;e M&uuml;ller Jos&eacute; Pe&ntilde;a Bj&ouml;rn &Aring;sa')).toBe('Renée Müller José Peña Björn Åsa');
    // Inherited object keys are not references.
    expect(decodeEntities('&constructor; &toString;')).toBe('&constructor; &toString;');
    const res = parseHtmlTables(Buffer.from('<table><tr><td>Ay&xyzzy;e Kurgu</td><td>&Ccedil;&inodot;nar</td></tr></table>'));
    expect(res.rows[0]!.cells).toEqual(['Ay&xyzzy;e Kurgu', 'Çınar']);
  });

  it('rowspan and colspan keep later columns in place; nested layout tables do not leak into outer cells', () => {
    const html = Buffer.from(
      '<table><tr><th>No</th><th>Adı Soyadı</th><th>Sınıfı</th></tr><tr><td>1</td><td>Ela Kurgu</td><td rowspan="2">3/A</td></tr><tr><td>2</td><td>Can Örnek</td></tr><tr><td colspan="2">Toplam</td><td>2</td></tr></table>',
    );
    expect(parseHtmlTables(html).rows.map((r) => r.cells)).toEqual([
      ['No', 'Adı Soyadı', 'Sınıfı'],
      ['1', 'Ela Kurgu', '3/A'],
      ['2', 'Can Örnek', ''],
      ['Toplam', '', '2'],
    ]);
    expect(decodeEntities('&Ccedil;a&#287;r&#x131; &amp; &bogus; A&Bc &#0;')).toBe('Çağrı & &bogus; A&Bc ');
  });

  it('extractFile runs it in the parser worker with the time limit, and says the list came from a web page', async () => {
    const ex = await withFile(htmlTableXls(), (p) => extractFile(cfg, { path: p, mime: MIME.htmlTable, name: 'liste.xls' }));
    expect(ex.sourceType).toBe('xls');
    expect(ex.notices).toContain('HTML_TABLE');
    expect(students(ex.rows)).toHaveLength(MULTI_CLASS_STUDENTS.length);
    const huge = await withFile(hugeHtmlXls(), (p) => extractFile(cfg, { path: p, mime: MIME.htmlTable, name: 'liste.xls' }));
    expect(huge.notices).toContain('TOO_MANY_ROWS');
    expect(huge.rows.length).toBeLessThanOrEqual(2000);
    // The worker's time limit stops a parse that takes too long.
    await expect(withFile(hugeHtmlXls(), (p) => extractFile({ ...cfg, PARSE_TIMEOUT_MS: 1 }, { path: p, mime: MIME.htmlTable, name: 'liste.xls' }))).rejects.toMatchObject({
      details: { reason: 'PARSE_TIMEOUT' },
    });
  });
});

describe('HTML-table .xls: sniffing (D-171, STU-8)', () => {
  it('only an HTML table with a .xls name, only for student lists', async () => {
    const allowed = ALLOWED_MIME.import_source;
    await withFile(htmlTableXls(), async (p) => {
      expect(await sniffFile(p, allowed, { name: 'Liste.XLS' })).toEqual({ ok: true, mime: MIME.htmlTable });
      // The same bytes under another name, or for another kind of upload: refused as markup.
      expect(await sniffFile(p, allowed, { name: 'liste.csv' })).toMatchObject({ ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' });
      expect(await sniffFile(p, allowed)).toMatchObject({ ok: false });
      expect(await sniffFile(p, ALLOWED_MIME.document, { name: 'liste.xls' })).toMatchObject({ ok: false, reason: 'FILE_TYPE_NOT_ALLOWED' });
    });
    // HTML without a table, SVG, and a script before the table are not "a plain HTML table".
    for (const bad of ['<html><body><p>Liste</p></body></html>', '<svg xmlns="http://www.w3.org/2000/svg"><table><tr></tr></table></svg>', '<script>x()</script><table><tr><td>A</td></tr></table>']) {
      expect(looksLikeHtmlTable(Buffer.from(bad)), bad).toBe(false);
      await withFile(Buffer.from(bad), async (p) => expect(await sniffFile(p, allowed, { name: 'liste.xls' }), bad).toMatchObject({ ok: false }));
    }
    expect(looksLikeHtmlTable(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<table><tr><td>Ada</td></tr></table>', 'utf16le')]))).toBe(true);
    expect(looksLikeHtmlTable(hostileHtmlXls())).toBe(true);
  });
});

describe('HTML-table .xls over HTTP (D-171)', () => {
  let env: TestEnv;
  let s: School;
  let root: string;
  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-import-html-'));
    env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
    s = await buildSchool(env);
  });
  afterAll(async () => {
    await env.app.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('uploads as a student list, previews like a workbook, and is never served back as HTML', async () => {
    const m = multipart(hostileHtmlXls(), 'e-okul-liste.xls', 'application/vnd.ms-excel');
    const up = await s.teacherA.req('POST', '/api/files?kind=import_source', m.body, m.headers);
    expect(up.status).toBe(200);
    expect(up.body.mime).toBe(MIME.htmlTable);
    const b = await ok(s.teacherA.post('/api/import/batches', { classId: s.c3a.id, fileId: up.body.id }));
    expect(b).toMatchObject({ sourceType: 'xls', fileName: 'e-okul-liste.xls' });
    expect(b.notices).toContain('HTML_TABLE');
    expect(JSON.stringify(b)).not.toContain(HOSTILE_MARKER);
    expect(b.rows.filter((r: { flags: string[] }) => !r.flags.includes('heading_ignored')).map((r: { parsed: { fullName: string } }) => r.parsed.fullName)).toEqual([
      'Ece Kurgu',
      'Kaan Örnek',
      'Ada Deneme&bogus;',
      'Mert Taslak',
      'Son Satır',
    ]);
    const got = await s.teacherA.req('GET', `/api/files/${up.body.id}`);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe(MIME.htmlTable);
    expect(String(got.headers['content-disposition'])).toMatch(/^attachment/u);
    expect(got.headers['content-security-policy']).toContain('sandbox');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    // The same page named .csv as a student list: refused.
    const csv = multipart(htmlTableXls(), 'liste.csv', 'text/csv');
    const r = await s.teacherA.req('POST', '/api/files?kind=import_source', csv.body, csv.headers);
    expect(r.body.error.details.reason).toBe('FILE_TYPE_NOT_ALLOWED');
  });
});
