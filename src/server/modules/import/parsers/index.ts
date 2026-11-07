/**
 * Source → rows of cells (IMP-1). The parser is chosen by the SNIFFED type of the upload (never the
 * client's file name or type), with the file name only telling CSV and TXT apart for the notice.
 */
import fsp from 'node:fs/promises';
import { freeTextRows, type SourceRow } from '../../../../domain/importing.ts';
import type { Config } from '../../../config.ts';
import { AppError } from '../../../lib/errors.ts';
import { MIME } from '../../files/sniff.ts';
import { parseDocx } from './docx.ts';
import { recognise } from './ocr.ts';
import { parsePdf } from './pdf.ts';
import { parseWorkbook } from './spreadsheet.ts';
import { decodeText, parseText } from './text.ts';

export type ImportSourceType = 'paste' | 'csv' | 'xlsx' | 'xls' | 'docx' | 'pdf' | 'image';

export interface Extracted {
  sourceType: ImportSourceType;
  rows: SourceRow[];
  /** Machine-readable notices shown in the preview (i18n `import.notice.<KEY>`). */
  notices: string[];
}

const MAX_ROWS = 2000;

function cap(rows: SourceRow[], notices: string[]): SourceRow[] {
  if (rows.length <= MAX_ROWS) return rows;
  notices.push('TOO_MANY_ROWS');
  return rows.slice(0, MAX_ROWS);
}

export function extractPaste(text: string): Extracted {
  const notices: string[] = [];
  return { sourceType: 'paste', rows: cap(parseText(text.normalize('NFC')), notices), notices };
}

export async function extractFile(config: Pick<Config, 'ocrCacheDir' | 'OCR_TIMEOUT_MS'>, file: { path: string; mime: string; name: string | null }): Promise<Extracted> {
  const buf = await fsp.readFile(file.path);
  const notices: string[] = [];
  const fail = (reason: string, message: string) => new AppError('VALIDATION', message, { reason });
  try {
    switch (file.mime) {
      case MIME.text: {
        const { text, encoding } = decodeText(buf);
        notices.push(`ENCODING_${encoding.toUpperCase().replace(/-/gu, '_')}`);
        const csv = /\.csv$/iu.test(file.name ?? '');
        return { sourceType: csv ? 'csv' : 'paste', rows: cap(parseText(text), notices), notices };
      }
      case MIME.xlsx:
      case MIME.xls: {
        const { rows, sheets } = parseWorkbook(buf);
        if (sheets > 1) notices.push('SHEETS_READ');
        return { sourceType: file.mime === MIME.xlsx ? 'xlsx' : 'xls', rows: cap(rows, notices), notices };
      }
      case MIME.docx:
        return { sourceType: 'docx', rows: cap(await parseDocx(buf), notices), notices };
      case MIME.pdf: {
        const { rows, scanned } = await parsePdf(buf);
        if (scanned) throw fail('SCANNED_PDF', 'This PDF has no text (it is a scan). Upload a photo of the page instead.');
        return { sourceType: 'pdf', rows: cap(rows, notices), notices };
      }
      case MIME.jpeg:
      case MIME.png:
      case MIME.webp: {
        const lines = await recognise(config, buf);
        notices.push('OCR_LOCAL');
        if (!lines.length) throw fail('OCR_NO_TEXT', 'No text was found in the picture');
        return { sourceType: 'image', rows: cap(freeTextRows(lines.map((l) => ({ text: l.text, confidence: l.confidence }))), notices), notices };
      }
      default:
        throw fail('IMPORT_TYPE_NOT_SUPPORTED', 'This file cannot be read as a student list');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw fail('IMPORT_UNREADABLE', 'The file could not be read');
  }
}
