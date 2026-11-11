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
    expect(st.map((r) => r.parsed.fullName)).toEqual(['Ece Kurgu', 'Kaan Örnek', 'Ada Deneme', 'Mert Taslak', 'Son Satır']);
    expect(st.map((r) => r.parsed.studentNumber)).toEqual(['6101', '6102', '6103', '6104', '6105']);
  });

  it('limits: rows, columns, characters per cell and the number of tables are capped (huge table)', () => {
    const res = parseHtmlTables(hugeHtmlXls());
    expect(res.truncated).toBe(true);
    expect(res.rows.length).toBeLessThanOrEqual(2100);
    expect(res.rows.reduce((m, r) => Math.max(m, r.cells.length), 0)).toBeLessThanOrEqual(60);
    expect(res.rows.reduce((m, r) => Math.max(m, ...r.cells.map((c) => c.length)), 0)).toBeLessThanOrEqual(MAX_HTML_CELL_CHARS);
    const many = Buffer.from(Array.from({ length: MAX_HTML_TABLES + 5 }, (_, i) => `<table><tr><td>T${i}</td><td><table><tr><td>N${i}</td></tr></table></td></tr></table>`).join(''));
    const capped = parseHtmlTables(many);
    expect(capped.tables).toBe(MAX_HTML_TABLES);
    const cells = capped.rows.flatMap((r) => r.cells);
    expect(cells).not.toContain(`T${MAX_HTML_TABLES}`);
    expect(cells).not.toContain(`N${MAX_HTML_TABLES}`);
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
    expect(decodeEntities('&Ccedil;a&#287;r&#x131; &amp; &bogus; A&Bc &#0;')).toBe('Çağrı &  A&Bc ');
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
      'Ada Deneme',
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
