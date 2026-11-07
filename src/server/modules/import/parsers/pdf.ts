/**
 * PDF text layer via unpdf (pdf.js, IMP-1). Text items are grouped into lines by their y position
 * and split into cells where the horizontal gap is wider than a space, which recovers the columns
 * of an e-Okul class list (page headers repeat on every page and are classified as headings).
 *
 * A PDF without a text layer is a scan. No PDF rasteriser is installed on the server, so scanned
 * PDFs are refused with SCANNED_PDF and the teacher is asked to upload a photo of the page instead
 * (which goes through local OCR).
 */
import { extractTextItems, getDocumentProxy } from 'unpdf';
import type { SourceRow } from '../../../../domain/importing.ts';

interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export function itemsToRows(pages: Item[][]): SourceRow[] {
  const rows: SourceRow[] = [];
  pages.forEach((items, p) => {
    const lines: Array<{ y: number; items: Item[] }> = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const tol = Math.max(2, it.fontSize * 0.4);
      const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (line) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let prevEnd = -Infinity;
      for (const it of line.items) {
        const gap = it.x - prevEnd;
        const space = Math.max(3, it.fontSize * 0.6);
        if (cells.length && gap <= space) cells[cells.length - 1] = `${cells[cells.length - 1]}${gap > it.fontSize * 0.15 ? ' ' : ''}${it.str}`;
        else cells.push(it.str);
        prevEnd = it.x + it.width;
      }
      rows.push({ cells: cells.map((c) => c.trim()), page: p + 1, confidence: null });
    }
  });
  return rows;
}

export async function parsePdf(buf: Buffer): Promise<{ rows: SourceRow[]; scanned: boolean; pages: number }> {
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, items } = await extractTextItems(doc);
  const rows = itemsToRows(items as Item[][]);
  const scanned = !rows.some((r) => r.cells.some((c) => /\p{L}/u.test(c)));
  return { rows, scanned, pages: totalPages };
}
