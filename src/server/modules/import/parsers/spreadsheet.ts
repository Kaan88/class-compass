/**
 * Excel workbooks (.xlsx and .xls, D-013: e-Okul exports) via SheetJS Community Edition 0.20.3,
 * installed from the official SheetJS CDN tarball and pinned with its integrity hash in
 * package-lock.json (D-076). The npm registry `xlsx@0.18.5` is not used: it has known prototype
 * pollution and ReDoS advisories fixed only in the CDN releases.
 *
 * Every sheet with content is read in order; merged cells keep their value in the top-left cell
 * (the column mapping handles label/value drift). Formulas are not evaluated; only cell text is used.
 */
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import type { SourceRow } from '../../../../domain/importing.ts';

XLSX.set_cptable(cptable);

export function parseWorkbook(buf: Buffer): { rows: SourceRow[]; sheets: number } {
  // Old BIFF5 exports without a code page are Turkish (Windows-1254, code page 1254).
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, codepage: 1254, dense: false });
  const rows: SourceRow[] = [];
  let sheets = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
    if (!data.some((r) => r.some((c) => String(c ?? '').trim()))) continue;
    sheets++;
    for (const r of data) rows.push({ cells: r.map((c) => String(c ?? '')), page: sheets, confidence: null });
  }
  return { rows, sheets };
}
