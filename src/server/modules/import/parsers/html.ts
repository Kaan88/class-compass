/**
 * HTML-table ".xls" files (S20c, D-171): some school systems export a list as a web page with a
 * `.xls` name, which Excel opens as a sheet. Only the TEXT of the tables is read here, with a small
 * hand-written scanner over the decoded string: no DOM, no HTML engine, nothing is executed, no URL
 * is ever followed (images, links, stylesheets and frames are just tags to skip). Runs in the parser
 * worker with its time limit and memory cap (runParser.ts), like the other document parsers.
 *
 * - Rows come from `<tr>`, cells from `<td>`/`<th>` of the innermost open table; text inside a nested
 *   table belongs to the nested table's own rows, never to the outer cell (layout tables around a data
 *   table become blank rows, which the importer drops).
 * - `colspan` keeps later columns in place (the value stays in the first column, like merged cells
 *   in a workbook); `rowspan` leaves the spanned cells of the next rows empty.
 * - The content of `script`, `style`, `template`, `textarea`, `title`, `xml`, `noscript`, `noembed`,
 *   `noframes`, `iframe`, `object`, `svg` and `math` elements and of comments is skipped entirely.
 * - Limits: rows (`MAX_SHEET_ROWS`, then `truncated`), columns (`MAX_SHEET_COLS`), tables
 *   (`MAX_HTML_TABLES`), characters per cell (`MAX_HTML_CELL_CHARS`), spans (`MAX_SPAN`).
 */
import type { SourceRow } from '../../../../domain/importing.ts';
import { MAX_SHEET_COLS, MAX_SHEET_ROWS } from './spreadsheet.ts';
import { decodeText } from './text.ts';

export const MAX_HTML_TABLES = 20;
export const MAX_HTML_CELL_CHARS = 500;
const MAX_SPAN = 50;
/** Longest tag (with its attributes) the scanner reads; a longer one is skipped as text-less markup. */
const MAX_TAG_CHARS = 8192;

const SKIP_CONTENT = new Set(['script', 'style', 'template', 'textarea', 'title', 'xml', 'noscript', 'noembed', 'noframes', 'iframe', 'object', 'svg', 'math']);
/** Tags that separate words inside a cell. */
const BREAKS = new Set(['br', 'p', 'div', 'li']);

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ccedil: 'ç',
  Ccedil: 'Ç',
  ouml: 'ö',
  Ouml: 'Ö',
  uuml: 'ü',
  Uuml: 'Ü',
  scedil: 'ş',
  Scedil: 'Ş',
  gbreve: 'ğ',
  Gbreve: 'Ğ',
  inodot: 'ı',
  imath: 'ı',
  Idot: 'İ',
  acirc: 'â',
  Acirc: 'Â',
  icirc: 'î',
  Icirc: 'Î',
  ucirc: 'û',
  Ucirc: 'Û',
};

/** Character references → text; an unknown `&name;` or an invalid character is left out. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});?/gu, (m, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return '';
      return String.fromCodePoint(code);
    }
    // An unknown name with its ";" is a reference we cannot read (left out); without one it is text ("A&Bc").
    return NAMED[ref] ?? (m.endsWith(';') ? '' : m);
  });
}

interface TableState {
  rows: string[][];
  row: string[] | null;
  /** Column → rows still covered by a rowspan from above. */
  carry: number[];
  /** Columns covered in the current row by spans from above. */
  covered: Set<number>;
  col: number;
  cell: { col: number; text: string } | null;
}

const SPAN_ATTR = { colspan: /(?:^|\s)colspan\s*=\s*["']?(\d{1,4})/iu, rowspan: /(?:^|\s)rowspan\s*=\s*["']?(\d{1,4})/iu } as const;

function attr(attrs: string, name: keyof typeof SPAN_ATTR): number {
  const m = SPAN_ATTR[name].exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Math.max(1, Math.min(MAX_SPAN, Number.isFinite(n) ? n : 1));
}

/** The index of the `>` that ends the tag starting at `from` (quotes respected), or -1. */
function tagEnd(s: string, from: number): number {
  let quote = '';
  const stop = Math.min(s.length, from + MAX_TAG_CHARS);
  for (let i = from; i < stop; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

export interface HtmlTableResult {
  rows: SourceRow[];
  tables: number;
  truncated: boolean;
}

/** The rows of the tables of an HTML document (see the file comment for the rules and limits). */
export function parseHtmlTables(buf: Buffer): HtmlTableResult {
  const s = decodeText(buf).text;
  const out: SourceRow[] = [];
  const stack: TableState[] = [];
  let tables = 0;
  let truncated = false;
  let ignoredDepth = 0;

  const top = () => stack[stack.length - 1];
  const addText = (text: string) => {
    const t = top();
    if (!t?.cell || t.cell.text.length > MAX_HTML_CELL_CHARS) return;
    t.cell.text += text.length > MAX_HTML_CELL_CHARS * 2 ? text.slice(0, MAX_HTML_CELL_CHARS * 2) : text;
  };
  const endCell = (t: TableState) => {
    if (!t.cell || !t.row) return;
    const text = decodeEntities(t.cell.text).replace(/\s+/gu, ' ').trim().slice(0, MAX_HTML_CELL_CHARS);
    if (t.cell.col < MAX_SHEET_COLS) t.row[t.cell.col] = text;
    t.cell = null;
  };
  const endRow = (t: TableState) => {
    endCell(t);
    if (!t.row) return;
    // Columns still covered by a rowspan after the last cell keep their place too.
    let width = t.row.length;
    for (const c of t.covered) width = Math.max(width, c + 1);
    const cells = Array.from({ length: Math.min(width, MAX_SHEET_COLS) }, (_, i) => t.row![i] ?? '');
    t.row = null;
    if (out.length >= MAX_SHEET_ROWS) {
      truncated = true;
      return;
    }
    out.push({ cells, page: null, confidence: null });
  };
  const startRow = (t: TableState) => {
    endRow(t);
    t.row = [];
    t.col = 0;
    t.covered = new Set();
    t.carry.forEach((n, c) => {
      if (n > 0) {
        t.covered.add(c);
        t.carry[c] = n - 1;
      }
    });
  };
  const startCell = (t: TableState, attrs: string) => {
    if (!t.row) startRow(t);
    endCell(t);
    while (t.covered.has(t.col)) t.row![t.col++] = '';
    const colspan = attr(attrs, 'colspan');
    const rowspan = attr(attrs, 'rowspan');
    t.cell = { col: t.col, text: '' };
    for (let c = t.col; c < t.col + colspan && c < MAX_SHEET_COLS; c++) {
      if (c > t.col) t.row![c] = '';
      if (rowspan > 1) t.carry[c] = Math.max(t.carry[c] ?? 0, rowspan - 1);
    }
    t.col += colspan;
  };

  let i = 0;
  const n = s.length;
  while (i < n && !truncated) {
    const lt = s.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i && ignoredDepth === 0) addText(s.slice(i, textEnd));
    if (lt < 0) break;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') {
      const e = s.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const closing = s[lt + 1] === '/';
    const nameStart = lt + (closing ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < n && /[A-Za-z0-9:-]/u.test(s[nameEnd]!)) nameEnd++;
    if (nameEnd === nameStart) {
      // A lone "<" in text.
      if (ignoredDepth === 0) addText('<');
      i = lt + 1;
      continue;
    }
    const name = s.slice(nameStart, nameEnd).toLowerCase();
    const gt = tagEnd(s, nameEnd);
    if (gt < 0) {
      // An absurdly long tag is skipped up to its next ">" as markup; an unterminated one ends the file.
      const e = s.indexOf('>', nameEnd);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    const attrs = s.slice(nameEnd, gt);
    i = gt + 1;
    const selfClosing = attrs.trimEnd().endsWith('/');
    if (!closing && SKIP_CONTENT.has(name) && !selfClosing) {
      // Skip everything up to the matching end tag (no nesting needed for these elements).
      const re = new RegExp(`</${name}\\s*>`, 'giu');
      re.lastIndex = i;
      const m = re.exec(s);
      i = m ? m.index + m[0].length : n;
      continue;
    }
    if (name === 'table') {
      if (closing) {
        if (ignoredDepth > 0) ignoredDepth--;
        else {
          const t = stack.pop();
          if (t) endRow(t);
        }
      } else if (ignoredDepth > 0 || tables >= MAX_HTML_TABLES) {
        // Tables past the limit (and everything inside them) are skipped, at any depth.
        ignoredDepth++;
      } else {
        tables++;
        stack.push({ rows: [], row: null, carry: [], covered: new Set(), col: 0, cell: null });
      }
      continue;
    }
    const t = top();
    if (!t || ignoredDepth > 0) continue;
    if (name === 'tr') {
      if (closing) endRow(t);
      else startRow(t);
    } else if (name === 'td' || name === 'th') {
      if (closing) endCell(t);
      else startCell(t, attrs);
    } else if (BREAKS.has(name)) addText(' ');
  }
  while (stack.length) endRow(stack.pop()!);
  return { rows: out, tables, truncated };
}
