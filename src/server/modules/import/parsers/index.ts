/**
 * Source → rows of cells (IMP-1). The parser is chosen by the SNIFFED type of the upload (never the
 * client's file name or type), with the file name only telling CSV and TXT apart for the notice.
 * Workbooks, Word and PDF files are parsed in a worker thread with a time limit (runParser.ts), OCR
 * in tesseract's own worker (ocr.ts); only plain text is decoded on the main thread.
 */
import fsp from 'node:fs/promises';
import { freeTextRows, MAX_IMPORT_ROWS, type SourceRow } from '../../../../domain/importing.ts';
import type { Config } from '../../../config.ts';
import { AppError } from '../../../lib/errors.ts';
import { MIME } from '../../files/sniff.ts';
import { recognise } from './ocr.ts';
import { runParser } from './runParser.ts';
import type { SheetInfo } from './spreadsheet.ts';
import { decodeText, parseText } from './text.ts';

export type ImportSourceType = 'paste' | 'csv' | 'xlsx' | 'xls' | 'docx' | 'pdf' | 'image';

export interface Extracted {
  sourceType: ImportSourceType;
  rows: SourceRow[];
  /** Workbooks: the sheets read (names chosen in the sheet picker, or the only sheet); null otherwise. */
  sheets: string[] | null;
  /** Machine-readable notices shown in the preview (i18n `import.notice.<KEY>`). */
  notices: string[];
}

function cap(rows: SourceRow[], notices: string[], max: number): SourceRow[] {
  if (rows.length <= max) return rows;
  notices.push('TOO_MANY_ROWS');
  return rows.slice(0, max);
}

/** `maxRows`: the row cap (default MAX_IMPORT_ROWS; a list with several classes reads up to MAX_SPLIT_ROWS, D-171). */
export function extractPaste(text: string, maxRows: number = MAX_IMPORT_ROWS): Extracted {
  const notices: string[] = [];
  return { sourceType: 'paste', rows: cap(parseText(text.normalize('NFC')), notices, maxRows), notices, sheets: null };
}

/** The sheets of a workbook upload, for the sheet picker (S13b); an empty list for any other file. */
export async function listSheets(config: Pick<Config, 'PARSE_TIMEOUT_MS'>, file: { path: string; mime: string }): Promise<SheetInfo[]> {
  if (file.mime !== MIME.xlsx && file.mime !== MIME.xls) return [];
  try {
    return (await runParser('workbook', await fsp.readFile(file.path), config.PARSE_TIMEOUT_MS)).sheetInfo;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('VALIDATION', 'The file could not be read', { reason: 'IMPORT_UNREADABLE' });
  }
}

/**
 * `sheets` (workbooks with several sheets, S13b): the sheet names the teacher chose. Without a choice
 * a workbook with more than one sheet is refused with SHEET_CHOICE_REQUIRED (the client shows the
 * sheet picker first); a single sheet needs no choice.
 */
export async function extractFile(
  config: Pick<Config, 'ocrCacheDir' | 'OCR_TIMEOUT_MS' | 'PARSE_TIMEOUT_MS'>,
  file: { path: string; mime: string; name: string | null },
  opts: { sheets?: string[] | undefined; maxRows?: number | undefined } = {},
): Promise<Extracted> {
  const buf = await fsp.readFile(file.path);
  const notices: string[] = [];
  const maxRows = opts.maxRows ?? MAX_IMPORT_ROWS;
  const capped = (rows: SourceRow[]) => cap(rows, notices, maxRows);
  const fail = (reason: string, message: string) => new AppError('VALIDATION', message, { reason });
  try {
    switch (file.mime) {
      case MIME.text: {
        const { text, encoding } = decodeText(buf);
        notices.push(`ENCODING_${encoding.toUpperCase().replace(/-/gu, '_')}`);
        const csv = /\.csv$/iu.test(file.name ?? '');
        return { sourceType: csv ? 'csv' : 'paste', rows: capped(parseText(text)), notices, sheets: null };
      }
      case MIME.xlsx:
      case MIME.xls: {
        const { rows, sheetInfo } = await runParser('workbook', buf, config.PARSE_TIMEOUT_MS, maxRows);
        const names = sheetInfo.map((s) => s.name);
        let chosen = names;
        if (opts.sheets?.length) {
          const unknown = opts.sheets.filter((n) => !names.includes(n));
          if (unknown.length) throw fail('SHEET_NOT_FOUND', 'This sheet is not in the workbook');
          chosen = names.filter((n) => opts.sheets!.includes(n));
        } else if (names.length > 1) {
          throw new AppError('VALIDATION', 'Choose which sheet to read', { reason: 'SHEET_CHOICE_REQUIRED', sheets: sheetInfo });
        }
        const keep = new Set(chosen.map((n) => names.indexOf(n) + 1));
        if (chosen.length > 1) notices.push('SHEETS_READ');
        return { sourceType: file.mime === MIME.xlsx ? 'xlsx' : 'xls', rows: capped(rows.filter((r) => keep.has(r.page ?? 0))), notices, sheets: chosen.length ? chosen : null };
      }
      case MIME.htmlTable: {
        // An HTML table with a .xls name (S20c, D-171): table text only, read in the parser worker.
        const { rows, tables, truncated, tooManyTables } = await runParser('htmlTable', buf, config.PARSE_TIMEOUT_MS, maxRows);
        // More tables than are read (`tables` is then the limit): refused, never cut (D-079).
        if (tooManyTables) throw new AppError('VALIDATION', 'This page has too many tables', { reason: 'IMPORT_HTML_TOO_MANY_TABLES', max: tables });
        notices.push('HTML_TABLE');
        if (truncated) notices.push('TOO_MANY_ROWS');
        if (!rows.some((r) => r.cells.some((c) => c.trim()))) throw fail('IMPORT_NO_ROWS', 'No names were found');
        return { sourceType: 'xls', rows: capped(rows), notices: [...new Set(notices)], sheets: null };
      }
      case MIME.docx:
        return { sourceType: 'docx', rows: capped(await runParser('docx', buf, config.PARSE_TIMEOUT_MS)), notices, sheets: null };
      case MIME.pdf: {
        const { rows, scanned } = await runParser('pdf', buf, config.PARSE_TIMEOUT_MS);
        if (scanned) throw fail('SCANNED_PDF', 'This PDF has no text (it is a scan). Upload a photo of the page instead.');
        return { sourceType: 'pdf', rows: capped(rows), notices, sheets: null };
      }
      case MIME.jpeg:
      case MIME.png:
      case MIME.webp: {
        const lines = await recognise(config, buf);
        notices.push('OCR_LOCAL');
        if (!lines.length) throw fail('OCR_NO_TEXT', 'No text was found in the picture');
        return { sourceType: 'image', rows: capped(freeTextRows(lines.map((l) => ({ text: l.text, confidence: l.confidence })))), notices, sheets: null };
      }
      default:
        throw fail('IMPORT_TYPE_NOT_SUPPORTED', 'This file cannot be read as a student list');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw fail('IMPORT_UNREADABLE', 'The file could not be read');
  }
}
