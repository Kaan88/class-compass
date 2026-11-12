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
 *   in a workbook); `rowspan` leaves the spanned cells of the next rows empty, for exactly as many
 *   rows as it says (up to 9999; never clamped, so no later row shifts a column).
 * - The content of `script`, `style`, `template`, `textarea`, `title`, `xml`, `noscript`, `noembed`,
 *   `noframes`, `iframe`, `object`, `svg` and `math` elements and of comments is skipped entirely.
 * - Limits: rows (`MAX_SHEET_ROWS`, then `truncated`), columns (`MAX_SHEET_COLS`), tables
 *   (`MAX_HTML_TABLES`: a page with more stops with `tooManyTables` and the import is refused, never
 *   cut, D-079), characters per cell (`MAX_HTML_CELL_CHARS`), colspans (`MAX_SPAN`).
 * - Character references: numeric ones and the common named ones are decoded; an unknown `&name;`
 *   stays as it was written (never a letter cut out of a name).
 */
import type { SourceRow } from '../../../../domain/importing.ts';
import { MAX_SHEET_COLS, MAX_SHEET_ROWS, SHEET_ROW_MARGIN } from './spreadsheet.ts';
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
  // Other letters that turn up in names (Latin-1 and Latin Extended-A).
  auml: 'ä',
  Auml: 'Ä',
  aacute: 'á',
  Aacute: 'Á',
  agrave: 'à',
  Agrave: 'À',
  aring: 'å',
  Aring: 'Å',
  atilde: 'ã',
  Atilde: 'Ã',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  Egrave: 'È',
  ecirc: 'ê',
  Ecirc: 'Ê',
  euml: 'ë',
  Euml: 'Ë',
  iacute: 'í',
  Iacute: 'Í',
  igrave: 'ì',
  Igrave: 'Ì',
  iuml: 'ï',
  Iuml: 'Ï',
  oacute: 'ó',
  Oacute: 'Ó',
  ograve: 'ò',
  Ograve: 'Ò',
  ocirc: 'ô',
  Ocirc: 'Ô',
  otilde: 'õ',
  Otilde: 'Õ',
  oslash: 'ø',
  Oslash: 'Ø',
  uacute: 'ú',
  Uacute: 'Ú',
  ugrave: 'ù',
  Ugrave: 'Ù',
  yacute: 'ý',
  Yacute: 'Ý',
  yuml: 'ÿ',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  szlig: 'ß',
  aelig: 'æ',
  AElig: 'Æ',
  oelig: 'œ',
  OElig: 'Œ',
  scaron: 'š',
  Scaron: 'Š',
  zcaron: 'ž',
  Zcaron: 'Ž',
  ccaron: 'č',
  Ccaron: 'Č',
  cacute: 'ć',
  Cacute: 'Ć',
  lstrok: 'ł',
  Lstrok: 'Ł',
  dstrok: 'đ',
  Dstrok: 'Đ',
  shy: '',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  middot: '·',
  acirc: 'â',
  Acirc: 'Â',
  icirc: 'î',
  Icirc: 'Î',
  ucirc: 'û',
  Ucirc: 'Û',
};

/**
 * Character references → text. An unknown `&name;` stays as written (audit fix: deleting it cut
 * letters out of names); an invalid numeric reference is left out.
 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});?/gu, (m, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return '';
      return String.fromCodePoint(code);
    }
    // An unknown name is kept as its literal text ("&bogus;", "A&Bc"), so no letters disappear.
    return Object.hasOwn(NAMED, ref) ? NAMED[ref]! : m;
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

/**
 * A span value of at least 1. A colspan is clamped to MAX_SPAN; a rowspan keeps its real value (at
 * most 9999 by the pattern; it costs one counter per column), so the rows below it, and the rows
 * after it ends, keep their columns (audit fix: a clamp shifted them one column left, a span "to the
 * table end" one column right).
 */
function attr(attrs: string, name: keyof typeof SPAN_ATTR): number {
  const m = SPAN_ATTR[name].exec(attrs);
  const n = m ? Number(m[1]) : 1;
  if (!Number.isFinite(n)) return 1;
  return name === 'rowspan' ? Math.max(1, n) : Math.max(1, Math.min(MAX_SPAN, n));
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
  /** More than MAX_HTML_TABLES tables: reading stopped, and the import is refused (never cut, D-079). */
  tooManyTables: boolean;
}

/** The rows of the tables of an HTML document (see the file comment for the rules and limits). */
export function parseHtmlTables(buf: Buffer, maxRows?: number): HtmlTableResult {
  const rowLimit = maxRows === undefined ? MAX_SHEET_ROWS : maxRows + SHEET_ROW_MARGIN;
  const s = decodeText(buf).text;
  const out: SourceRow[] = [];
  const stack: TableState[] = [];
  let tables = 0;
  let truncated = false;
  let tooManyTables = false;

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
    if (out.length >= rowLimit) {
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
  while (i < n && !truncated && !tooManyTables) {
    const lt = s.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) addText(s.slice(i, textEnd));
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
      addText('<');
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
        const t = stack.pop();
        if (t) endRow(t);
      } else if (tables >= MAX_HTML_TABLES) {
        // One table past the limit, at any depth: stop; the caller refuses the file (never cut silently).
        tooManyTables = true;
      } else {
        tables++;
        stack.push({ rows: [], row: null, carry: [], covered: new Set(), col: 0, cell: null });
      }
      continue;
    }
    const t = top();
    if (!t) continue;
    if (name === 'tr') {
      if (closing) endRow(t);
      else startRow(t);
    } else if (name === 'td' || name === 'th') {
      if (closing) endCell(t);
      else startCell(t, attrs);
    } else if (BREAKS.has(name)) addText(' ');
  }
  while (stack.length) endRow(stack.pop()!);
  return { rows: out, tables, truncated, tooManyTables };
}
