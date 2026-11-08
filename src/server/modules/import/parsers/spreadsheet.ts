/**
 * Excel workbooks (.xlsx and .xls, D-013: e-Okul exports) via SheetJS Community Edition 0.20.3,
 * installed from the official SheetJS CDN tarball and pinned with its integrity hash in
 * package-lock.json (D-076). The npm registry `xlsx@0.18.5` is not used: it has known prototype
 * pollution and ReDoS advisories fixed only in the CDN releases.
 *
 * Every sheet with content is read in order; merged cells keep their value in the top-left cell
 * (the column mapping handles label/value drift). Formulas are not evaluated; only cell text is used.
 *
 * Size safety (STU-8, D-079): a tiny file can declare a huge sheet dimension (`<dimension
 * ref="A1:XFD1048576">`), and expanding it with blank cells would block the server and exhaust its
 * memory. So rows are cut at parse time (`sheetRows`), the range is shrunk to the cells that really
 * exist and clamped to MAX_SHEET_COLS columns, and reading stops once enough rows were collected.
 */
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { MAX_IMPORT_ROWS, type SourceRow } from '../../../../domain/importing.ts';

XLSX.set_cptable(cptable);

/** Rows read per sheet: the row cap plus room for titles and repeated page headers. */
export const MAX_SHEET_ROWS = MAX_IMPORT_ROWS + 100;
/** Student lists have a handful of columns; anything wider is cut. */
export const MAX_SHEET_COLS = 60;
const MAX_SHEETS = 20;

/**
 * The range to read: from the declared start (as before, so columns keep their positions) to the
 * last cell that really exists, within the row/column caps (null when the sheet is empty).
 */
function usedRange(ws: XLSX.WorkSheet): XLSX.Range | null {
  const start = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 };
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (maxR < start.r || maxC < start.c) return null;
  return { s: start, e: { r: Math.min(maxR, start.r + MAX_SHEET_ROWS - 1), c: Math.min(maxC, start.c + MAX_SHEET_COLS - 1) } };
}

/** A sheet with content, for the sheet picker (S13b): its name, non-blank row count and the first rows. */
export interface SheetInfo {
  name: string;
  rows: number;
  preview: string[][];
}
const PREVIEW_ROWS = 5;
const PREVIEW_COLS = 6;

/**
 * Reads every sheet with content (up to 20). Rows carry the sheet's ordinal among the sheets with
 * content as `page`, so a caller can keep only the sheets the teacher chose (`sheetInfo[page - 1]`).
 */
export function parseWorkbook(buf: Buffer): { rows: SourceRow[]; sheets: number; sheetInfo: SheetInfo[] } {
  // Old BIFF5 exports without a code page are Turkish (Windows-1254, code page 1254).
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, codepage: 1254, dense: false, sheetRows: MAX_SHEET_ROWS });
  const rows: SourceRow[] = [];
  const sheetInfo: SheetInfo[] = [];
  let sheets = 0;
  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    if (rows.length > MAX_IMPORT_ROWS) break;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const range = usedRange(ws);
    if (!range) continue;
    ws['!ref'] = XLSX.utils.encode_range(range);
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
    if (!data.some((r) => r.some((c) => String(c ?? '').trim()))) continue;
    sheets++;
    const filled = data.map((r) => r.map((c) => String(c ?? ''))).filter((r) => r.some((c) => c.trim()));
    sheetInfo.push({ name, rows: filled.length, preview: filled.slice(0, PREVIEW_ROWS).map((r) => r.slice(0, PREVIEW_COLS).map((c) => c.slice(0, 60))) });
    for (const r of data) rows.push({ cells: r.map((c) => String(c ?? '')), page: sheets, confidence: null });
  }
  return { rows, sheets, sheetInfo };
}
