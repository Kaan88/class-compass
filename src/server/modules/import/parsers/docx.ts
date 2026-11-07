/**
 * Word documents (.docx) via mammoth (IMP-1). Tables become rows of cells; paragraphs outside
 * tables become rows too (titles are classified as headings later). A document without tables is a
 * free list (one student per paragraph).
 */
import mammoth from 'mammoth';
import { freeTextRows, type SourceRow } from '../../../../domain/importing.ts';

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#(\d+);/gu, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gu, '&')
    .trim();

/** mammoth's HTML is simple and well formed: <table><tr><td><p>…</p></td></tr></table> and <p>…</p>. */
export function htmlToRows(html: string): SourceRow[] {
  const rows: SourceRow[] = [];
  const paragraphs: string[] = [];
  let hasTable = false;
  const blocks = html.split(/(<table[\s\S]*?<\/table>)/u);
  for (const block of blocks) {
    if (block.startsWith('<table')) {
      hasTable = true;
      for (const tr of block.match(/<tr[\s\S]*?<\/tr>/gu) ?? []) {
        const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gu) ?? []).map(decode);
        rows.push({ cells, page: null, confidence: null });
      }
    } else {
      for (const p of block.match(/<(p|h\d|li)[^>]*>[\s\S]*?<\/\1>/gu) ?? []) {
        const text = decode(p);
        paragraphs.push(text);
        rows.push({ cells: [text], page: null, confidence: null });
      }
    }
  }
  return hasTable ? rows : freeTextRows(paragraphs.map((text) => ({ text })));
}

export async function parseDocx(buf: Buffer): Promise<SourceRow[]> {
  const { value } = await mammoth.convertToHtml({ buffer: buf }, { ignoreEmptyParagraphs: false });
  return htmlToRows(value);
}
