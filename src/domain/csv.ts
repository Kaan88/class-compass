/**
 * CSV export (RPT-4, DAT-4). Pure, no I/O; used by the server for report sections and the full
 * data export.
 *
 * - UTF-8 with a byte-order mark, so Excel opens Turkish characters (ç ğ ı İ ö ş ü) correctly.
 * - RFC 4180 quoting: a cell containing the delimiter, a quote, CR or LF is quoted, quotes doubled.
 * - Formula injection (CSV injection): a TEXT cell that starts with `=`, `+`, `-`, `@`, TAB or CR is
 *   prefixed with an apostrophe so spreadsheet programs show it as text instead of running it.
 *   Real numbers are written as numbers and never prefixed (a negative number stays a number).
 * - Delimiter: `,` by default; `;` for spreadsheet programs set up for Turkish (where `,` is the
 *   decimal separator and Excel expects `;` between columns).
 */

export const CSV_BOM = '﻿';
export type CsvDelimiter = ',' | ';';
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/u;

/** One cell as CSV text (without the delimiter). */
export function csvCell(value: CsvValue, delimiter: CsvDelimiter = ','): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = value.normalize('NFC');
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (s.includes(delimiter) || /["\r\n]/u.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** One CSV row without its line end (`toCsv` joins these with CRLF). */
export const csvLine = (r: readonly CsvValue[], delimiter: CsvDelimiter = ','): string => r.map((v) => csvCell(v, delimiter)).join(delimiter);

/** A whole CSV document: BOM, header row, data rows, CRLF line ends (what Excel expects). */
export function toCsv(header: readonly CsvValue[], rows: readonly (readonly CsvValue[])[], delimiter: CsvDelimiter = ','): string {
  const line = (r: readonly CsvValue[]) => csvLine(r, delimiter);
  return CSV_BOM + [line(header), ...rows.map(line)].join('\r\n') + '\r\n';
}

/** A safe download file name (ASCII letters, digits, dot, dash, underscore). */
export function safeFileName(name: string, fallback = 'export'): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/ı/gu, 'i')
    .replace(/İ/gu, 'I')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '');
  return ascii.slice(0, 100) || fallback;
}
