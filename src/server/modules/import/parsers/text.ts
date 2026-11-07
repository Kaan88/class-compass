/**
 * Pasted text, CSV and TXT (IMP-1, D-013). Turkish Excel exports are often Windows-1254 or UTF-16,
 * so the encoding is detected: a BOM (UTF-8, UTF-16 LE/BE), UTF-16 without a BOM (zero bytes in every
 * other position), strict UTF-8, and Windows-1254 as the fallback.
 */
import Papa from 'papaparse';
import { detectDelimiter, freeTextRows, type SourceRow } from '../../../../domain/importing.ts';

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1254';

export function detectEncoding(buf: Buffer): { encoding: TextEncoding; bom: number } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  const sample = buf.subarray(0, 4096);
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenZero++;
    else oddZero++;
  }
  const half = sample.length / 2;
  if (half > 0 && oddZero / half > 0.3 && evenZero / half < 0.05) return { encoding: 'utf-16le', bom: 0 };
  if (half > 0 && evenZero / half > 0.3 && oddZero / half < 0.05) return { encoding: 'utf-16be', bom: 0 };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { encoding: 'utf-8', bom: 0 };
  } catch {
    return { encoding: 'windows-1254', bom: 0 };
  }
}

export function decodeText(buf: Buffer): { text: string; encoding: TextEncoding } {
  const { encoding, bom } = detectEncoding(buf);
  const body = buf.subarray(bom);
  const text = encoding === 'utf-16be' ? new TextDecoder('utf-16le').decode(Buffer.from(body).swap16()) : new TextDecoder(encoding).decode(body);
  return { text: text.normalize('NFC'), encoding };
}

/**
 * Text → rows. Lines with a common separator (tab from an Excel copy, `;` from Turkish CSV, `,`)
 * are columns (quotes handled by papaparse); anything else is a free list (numbered lines, names
 * with numbers).
 */
export function parseText(text: string): SourceRow[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const delimiter = detectDelimiter(lines);
  if (delimiter) {
    const res = Papa.parse<string[]>(text.replace(/\r\n?/gu, '\n'), { delimiter, skipEmptyLines: false });
    return res.data.map((cells) => ({ cells: cells.map((c) => String(c ?? '')), page: null, confidence: null }));
  }
  return freeTextRows(lines.map((l) => ({ text: l })));
}
