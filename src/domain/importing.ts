/**
 * Student list importer — pure logic (S9: IMP-2, IMP-3, IMP-4, D-013). No I/O: the server's parsers
 * turn every source (paste, CSV, Excel, Word, PDF, OCR) into rows of cells, and this module
 * - splits free-text lines (numbered lists, "1234 Ayşe Nur Yılmaz") into cells,
 * - finds the header row (e-Okul: "Öğrenci No", "Adı", "Soyadı", "Sınıfı/Şubesi") or infers the
 *   columns from their content,
 * - classifies rows (headings, repeated page headers, blank rows) and parses the editable fields,
 * - flags uncertainty and duplicates within the file.
 *
 * Names (IMP-3): the full name is kept exactly as given (Turkish characters, every part of a
 * multi-part name; ALL CAPS e-Okul names are title-cased with Turkish rules). Given names and family
 * name are filled ONLY when the source has explicit columns for them (Adı / Soyadı); a surname is
 * never guessed from a multi-word name.
 */
import { foldForSearch, normaliseName, smartTitleCase } from '../shared/text/turkish.ts';

export interface SourceRow {
  cells: string[];
  page: number | null;
  /** OCR confidence 0–100 for the line (null when not OCR). */
  confidence: number | null;
}

export type Field = 'fullName' | 'givenNames' | 'familyName' | 'studentNumber' | 'className' | 'index' | 'ignore';

export interface Mapping {
  headerRow: number | null;
  fullName: number | null;
  givenNames: number | null;
  familyName: number | null;
  studentNumber: number | null;
  className: number | null;
}

export interface Parsed {
  fullName: string;
  givenNames: string | null;
  familyName: string | null;
  studentNumber: string | null;
  className: string | null;
}

export type RowFlag =
  | 'low_confidence'
  | 'duplicate_in_file'
  | 'possible_match'
  | 'number_match'
  | 'number_elsewhere'
  | 'missing_name'
  | 'missing_number'
  | 'heading_ignored'
  | 'class_mismatch';

export interface ClassifiedRow {
  /** Index into the source rows. */
  source: number;
  cells: string[];
  page: number | null;
  confidence: number | null;
  heading: boolean;
  parsed: Parsed;
  flags: RowFlag[];
  /** Second or later occurrence of a duplicate (the first one is the one to keep). */
  repeat: boolean;
}

/** OCR lines below this confidence are flagged for checking (IMP-2). */
export const LOW_CONFIDENCE = 75;

const clean = (s: string | undefined | null) => normaliseName(String(s ?? '').replace(/ /gu, ' '));
const hasLetter = (s: string) => /\p{L}/u.test(s);
const isBlank = (cells: readonly string[]) => cells.every((c) => !clean(c));

// ---------------------------------------------------------------- header labels
/** Folded header label → field (EN + TR, e-Okul spellings). */
const LABELS: Array<[RegExp, Field]> = [
  [/^(ogrenci(nin)? )?(adi soyadi|ad soyad|adi ve soyadi|ad ve soyad|adi-soyadi|ad-soyad|isim soyisim|ad soyadi)$/u, 'fullName'],
  [/^(full name|name|student name|student|pupil|pupil name|ogrenci|ogrenci adi soyadi|isim)$/u, 'fullName'],
  [/^(ogrenci(nin)? )?(adi|ad|isim|isimleri)$/u, 'givenNames'],
  [/^(first name|first names|given name|given names|forename|forenames)$/u, 'givenNames'],
  [/^(ogrenci(nin)? )?(soyadi|soyad|soyisim|soyismi)$/u, 'familyName'],
  [/^(last name|surname|family name)$/u, 'familyName'],
  [/^(ogrenci no|ogrenci numarasi|ogr no|ogr\.? no|okul no|okul numarasi|numara|numarasi|no|number|student number|student no|school number|e-?okul no)$/u, 'studentNumber'],
  [/^(sinifi\/subesi|sinifi \/ subesi|sinif\/sube|sinif \/ sube|sinifi|sinif|subesi|sube|class|form|grade|class name)$/u, 'className'],
  [/^(sira|sira no|s\.? ?no|sn|#|nr|no\.)$/u, 'index'],
  [/^(cinsiyet|cinsiyeti|gender|sex|dogum tarihi|date of birth|tc kimlik no|t\.?c\.? kimlik no|kimlik no|veli|veli adi|telefon|phone|adres|address|baba adi|anne adi|uyruk|durum|durumu|kayit tarihi|aciklama|notes?)$/u, 'ignore'],
];

const foldLabel = (s: string) =>
  foldForSearch(s)
    .replace(/[:*]+$/u, '')
    .replace(/\s*\/\s*/gu, '/')
    .replace(/\s+/gu, ' ')
    .trim();

export function headerField(label: string): Field | null {
  const f = foldLabel(label);
  if (!f) return null;
  for (const [re, field] of LABELS) if (re.test(f) || re.test(f.replace(/\//gu, ' / '))) return field;
  return null;
}

/**
 * The header row: the first row (within the first 40) with at least two recognised labels, one of
 * them a name field, or a single "Adı Soyadı"-style label. Returns its field per column.
 */
export function detectHeader(rows: readonly SourceRow[]): { row: number; fields: Array<Field | null> } | null {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const fields = rows[i]!.cells.map((c) => headerField(c));
    const known = fields.filter((f) => f !== null && f !== 'ignore').length;
    const named = fields.some((f) => f === 'fullName' || f === 'givenNames' || f === 'familyName');
    if (named && (known >= 2 || fields.includes('fullName'))) return { row: i, fields };
  }
  return null;
}

// ---------------------------------------------------------------- free text
const LIST_MARKER = /^\s*(?:[-*•·▪◦]\s+|\(?\d{1,3}[.)]\s+|\d{1,3}\s*[-–]\s+)/u;
const NUMBER_TOKEN = /^[\p{N}][\p{N}-]{0,15}$/u;

/**
 * Lines without column separators (a pasted numbered list, OCR lines) → cells `[number, name]`.
 * List markers ("1.", "2)", "-", "•") are list positions, not student numbers. A bare leading number
 * is a list position when the lines count 1, 2, 3…, otherwise a student number; a number after the
 * name is a student number.
 */
export function freeTextRows(lines: ReadonlyArray<{ text: string; page?: number | null; confidence?: number | null }>): SourceRow[] {
  const split = lines.map((l) => {
    const text = clean(l.text.replace(/[|¦]/gu, ' '));
    const stripped = text.replace(LIST_MARKER, '');
    const tokens = stripped.split(' ').filter(Boolean);
    const lead: string[] = [];
    while (tokens.length && NUMBER_TOKEN.test(tokens[0]!)) lead.push(tokens.shift()!);
    const trail: string[] = [];
    while (tokens.length && NUMBER_TOKEN.test(tokens[tokens.length - 1]!)) trail.unshift(tokens.pop()!);
    return { text, lead, name: tokens.join(' '), trail, page: l.page ?? null, confidence: l.confidence ?? null };
  });
  // Is a single leading number a running position (1, 2, 3…) across the list?
  const singles = split.filter((s) => s.lead.length === 1 && s.name).map((s) => Number(s.lead[0]));
  let sequential = singles.length >= 2 && singles[0]! <= 3;
  for (let i = 1; i < singles.length && sequential; i++) if (singles[i]! !== singles[i - 1]! + 1) sequential = false;
  if (singles.length === 1) sequential = singles[0]! <= 3;
  return split.map((s) => {
    if (!s.name) return { cells: ['', s.text], page: s.page, confidence: s.confidence };
    let number = '';
    if (s.trail.length) number = s.trail[s.trail.length - 1]!;
    else if (s.lead.length >= 2) number = s.lead[s.lead.length - 1]!;
    else if (s.lead.length === 1 && !sequential) number = s.lead[0]!;
    return { cells: [number, s.name], page: s.page, confidence: s.confidence };
  });
}

/** Column separator used by most lines of a text, or null for free text. */
export function detectDelimiter(lines: readonly string[]): '\t' | ';' | ',' | null {
  const content = lines.map((l) => l.trim()).filter(Boolean);
  if (content.length === 0) return null;
  const share = (ch: string) => content.filter((l) => l.includes(ch)).length / content.length;
  if (share('\t') >= 0.5) return '\t';
  if (share(';') >= 0.5) return ';';
  if (share(',') >= 0.6) {
    // "Yılmaz, Ayşe" once per line could be "Family, Given": only treat commas as columns when the
    // lines agree on the number of commas AND some column is numeric.
    const counts = content.filter((l) => l.includes(',')).map((l) => l.split(',').length);
    const same = counts.every((c) => c === counts[0]);
    const numeric = content.some((l) => l.split(',').some((c) => NUMBER_TOKEN.test(c.trim())));
    if (same && numeric) return ',';
  }
  return null;
}

// ---------------------------------------------------------------- column inference
const SEQ_TOLERANCE = 0.8;

function columnValues(rows: readonly SourceRow[], col: number): string[] {
  return rows.map((r) => clean(r.cells[col])).filter(Boolean);
}

function isSequential(values: readonly string[]): boolean {
  const nums = values.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  if (nums.length < 2) return false;
  let ok = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]! + 1) ok++;
  return ok / (nums.length - 1) >= SEQ_TOLERANCE && nums[0]! <= 3;
}

const CLASS_VALUE = /^(\d{1,2})\s*(?:\.\s*s[iı]n[iı]f[iı]?)?\s*[-/.]?\s*([\p{L}])(?:\s*[şs]ubes[iı])?$/iu;

/** "3-A", "3/A", "3 A", "3. Sınıf / A Şubesi" → "3a" (null when it is not a class label). */
export function classKey(s: string): string | null {
  const f = foldForSearch(clean(s)).replace(/sinifi?/gu, ' ').replace(/subesi?/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const m = /^(\d{1,2})\s*([\p{L}])$/u.exec(f) ?? /^(\d{1,2})\s+([\p{L}])$/u.exec(f);
  if (m) return `${m[1]}${m[2]}`;
  return CLASS_VALUE.test(clean(s)) ? foldForSearch(clean(s)).replace(/[^\p{L}\p{N}]/gu, '') : null;
}

/** Infer columns from the content when there is no header (or to complete a header mapping). */
function inferFromContent(rows: readonly SourceRow[], start: number): Omit<Mapping, 'headerRow'> {
  const data = rows.slice(start).filter((r) => !isBlank(r.cells));
  const width = Math.max(0, ...data.map((r) => r.cells.length));
  const stats = Array.from({ length: width }, (_, c) => {
    const vals = columnValues(data, c);
    const n = vals.length || 1;
    return {
      c,
      filled: vals.length / Math.max(1, data.length),
      numeric: vals.filter((v) => NUMBER_TOKEN.test(v)).length / n,
      letters: vals.filter((v) => hasLetter(v) && !classKey(v)).length / n,
      classLike: vals.filter((v) => classKey(v) !== null).length / n,
      sequential: isSequential(vals),
      avgLen: vals.reduce((a, v) => a + v.length, 0) / n,
    };
  });
  const numberCols = stats.filter((s) => s.filled >= 0.3 && s.numeric >= 0.6);
  const numberCol = numberCols.find((s) => !s.sequential) ?? null;
  const classCol = stats.find((s) => s.filled >= 0.3 && s.classLike >= 0.6) ?? null;
  const nameCols = stats.filter((s) => s.filled >= 0.3 && s.letters >= 0.6 && s !== classCol).sort((a, b) => b.avgLen - a.avgLen);
  return { fullName: nameCols[0]?.c ?? null, givenNames: null, familyName: null, studentNumber: numberCol?.c ?? null, className: classCol?.c ?? null };
}

/**
 * Merged-cell quirk of spreadsheet exports: the label sits in one column and the values in the next
 * (or the label spans two columns and the data starts in the second). Move a mapped column to its
 * right neighbour when it is mostly empty below the header and the neighbour is mostly filled and
 * unmapped.
 */
function fixDrift(rows: readonly SourceRow[], start: number, m: Mapping): Mapping {
  const data = rows.slice(start).filter((r) => !isBlank(r.cells));
  if (!data.length) return m;
  const fill = (c: number) => columnValues(data, c).length / data.length;
  const used = () => new Set([m.fullName, m.givenNames, m.familyName, m.studentNumber, m.className].filter((x): x is number => x !== null));
  const out = { ...m };
  for (const key of ['fullName', 'givenNames', 'familyName', 'studentNumber', 'className'] as const) {
    const c = out[key];
    if (c === null || fill(c) >= 0.3) continue;
    for (const d of [c + 1, c - 1]) {
      if (d >= 0 && !used().has(d) && fill(d) >= 0.6) {
        out[key] = d;
        break;
      }
    }
  }
  return out;
}

/** Automatic field mapping (IMP-2): header labels when present, otherwise the column contents. */
export function inferMapping(rows: readonly SourceRow[]): Mapping {
  const header = detectHeader(rows);
  if (!header) return { headerRow: null, ...inferFromContent(rows, 0) };
  const first = (f: Field) => {
    const i = header.fields.indexOf(f);
    return i < 0 ? null : i;
  };
  let m: Mapping = {
    headerRow: header.row,
    fullName: first('fullName'),
    givenNames: first('givenNames'),
    familyName: first('familyName'),
    studentNumber: first('studentNumber'),
    className: first('className'),
  };
  // "Adı" alone without "Soyadı" is the whole name column.
  if (m.fullName === null && m.givenNames !== null && m.familyName === null) m = { ...m, fullName: m.givenNames, givenNames: null };
  if (m.fullName === null && m.givenNames === null && m.familyName !== null) m = { ...m, fullName: m.familyName, familyName: null };
  m = fixDrift(rows, header.row + 1, m);
  if (m.studentNumber === null) {
    const guess = inferFromContent(rows, header.row + 1).studentNumber;
    const taken = new Set([m.fullName, m.givenNames, m.familyName, m.className]);
    if (guess !== null && !taken.has(guess) && header.fields[guess] !== 'index' && header.fields[guess] !== 'ignore') m.studentNumber = guess;
  }
  return m;
}

/** Column labels for the mapping screen: the header cells, or "1", "2", … */
export function columnLabels(rows: readonly SourceRow[], mapping: Mapping): string[] {
  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  const header = mapping.headerRow !== null ? rows[mapping.headerRow]?.cells ?? [] : [];
  return Array.from({ length: width }, (_, c) => clean(header[c]) || String(c + 1));
}

// ---------------------------------------------------------------- rows
const HEADING_WORDS =
  /(^|\s)(t\.?\s?c\.?|mudurlugu|bakanligi|milli egitim|ogrenci listesi|sinif listesi|sube listesi|ogrenci liste|e-?okul|sayfa|page|egitim ogretim|ogretim yili|okulu|ilkokulu|ortaokulu|lisesi|anaokulu|school|class list|student list|list of|sinif|class|liste|list|toplam|total|tarih|date|imza|signature|ogretmen|teacher)(\s|$|:)/u;
const DATE_LIKE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u;
const PAGE_LIKE = /^(sayfa|page)?\s*\d+\s*(\/|of|-)\s*\d+$/u;

/** A title, page or footer line rather than a student (IMP-3: headings are ignored). */
export function isHeadingText(text: string): boolean {
  const f = foldForSearch(text).replace(/[^\p{L}\p{N}./:\s-]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!f) return false;
  if (DATE_LIKE.test(f) || PAGE_LIKE.test(f)) return true;
  if (/:$/u.test(text.trim())) return true;
  if (headerField(text) !== null) return true;
  return HEADING_WORDS.test(f);
}

const cleanNumber = (s: string) => {
  const v = clean(s).replace(/\s+/gu, '').replace(/\.0+$/u, '');
  return /^[\p{L}\p{N}-]{1,32}$/u.test(v) && /\p{N}/u.test(v) ? v : '';
};
const cleanPart = (s: string | undefined) => {
  const v = clean(s);
  return v && hasLetter(v) ? smartTitleCase(v) : '';
};

/** The editable fields of one row under `mapping`. */
export function parseCells(cells: readonly string[], m: Mapping): Parsed {
  const at = (i: number | null) => (i === null ? '' : clean(cells[i]));
  const given = m.givenNames !== null ? cleanPart(cells[m.givenNames]) : '';
  const family = m.familyName !== null ? cleanPart(cells[m.familyName]) : '';
  let fullName = m.fullName !== null ? cleanPart(cells[m.fullName]) : '';
  // A full-name column wins (kept as given); otherwise the explicit parts are joined in order.
  if (m.fullName === null || (!fullName && (given || family))) fullName = [given, family].filter(Boolean).join(' ');
  return {
    fullName,
    givenNames: m.givenNames !== null && given ? given : null,
    familyName: m.familyName !== null && family ? family : null,
    studentNumber: cleanNumber(at(m.studentNumber)) || null,
    className: at(m.className) || null,
  };
}

/** Same header row as the detected one (repeated per page in e-Okul PDFs and exports). */
function isRepeatedHeader(cells: readonly string[], header: readonly string[] | null): boolean {
  if (!header) return false;
  const a = cells.map((c) => foldLabel(c)).filter(Boolean);
  const b = header.map((c) => foldLabel(c)).filter(Boolean);
  if (!a.length) return false;
  if (a.join('|') === b.join('|')) return true;
  const known = cells.filter((c) => headerField(c) !== null).length;
  return known >= 2 && known >= a.length - 1;
}

/**
 * Classify every non-blank source row under `mapping` (IMP-2/3): headings (rows above the header,
 * repeated headers, titles, page numbers, footers) are kept as `heading` rows so the teacher can see
 * them; blank rows are dropped. Flags missing fields, low OCR confidence, a class that differs from
 * the target class and duplicates within the file.
 */
export function classifyRows(rows: readonly SourceRow[], mapping: Mapping, opts: { targetClassName?: string | null } = {}): ClassifiedRow[] {
  const header = mapping.headerRow !== null ? rows[mapping.headerRow]?.cells ?? null : null;
  const targetKey = opts.targetClassName ? classKey(opts.targetClassName) : null;
  const out: ClassifiedRow[] = [];
  rows.forEach((r, source) => {
    if (isBlank(r.cells)) return;
    const parsed = parseCells(r.cells, mapping);
    const filled = r.cells.map((c) => clean(c)).filter(Boolean);
    const nameCell = mapping.fullName !== null ? clean(r.cells[mapping.fullName]) : [clean(r.cells[mapping.givenNames ?? -1]), clean(r.cells[mapping.familyName ?? -1])].join(' ').trim();
    let heading = false;
    if (mapping.headerRow !== null && source <= mapping.headerRow) heading = true;
    else if (isRepeatedHeader(r.cells, header)) heading = true;
    else if (!parsed.studentNumber && filled.length <= 2 && isHeadingText(filled.join(' '))) heading = true;
    else if (nameCell && isHeadingText(nameCell) && !parsed.studentNumber) heading = true;
    else if (!nameCell && !parsed.studentNumber && filled.length > 0 && filled.every((c) => isHeadingText(c) || !hasLetter(c))) heading = true;
    const flags: RowFlag[] = [];
    if (heading) flags.push('heading_ignored');
    else {
      if (!hasLetter(parsed.fullName)) flags.push('missing_name');
      if (mapping.studentNumber !== null && !parsed.studentNumber) flags.push('missing_number');
      if (r.confidence !== null && r.confidence < LOW_CONFIDENCE) flags.push('low_confidence');
      if (targetKey && parsed.className) {
        const k = classKey(parsed.className);
        if (k && k !== targetKey) flags.push('class_mismatch');
      }
    }
    out.push({ source, cells: [...r.cells], page: r.page, confidence: r.confidence, heading, parsed: heading ? { ...parsed, fullName: filled.join(' ') } : parsed, flags, repeat: false });
  });
  markDuplicates(out);
  return out;
}

/** Flag every occurrence of a folded name or a student number that appears more than once (IMP-2). */
export function markDuplicates(rows: ClassifiedRow[]): void {
  const seenName = new Map<string, number>();
  const seenNumber = new Map<string, number>();
  for (const r of rows) {
    r.flags = r.flags.filter((f) => f !== 'duplicate_in_file');
    r.repeat = false;
  }
  rows.forEach((r, i) => {
    if (r.heading || !hasLetter(r.parsed.fullName)) return;
    const name = foldForSearch(r.parsed.fullName);
    const num = r.parsed.studentNumber;
    const firstName = seenName.get(name);
    const firstNum = num ? seenNumber.get(num) : undefined;
    const first = firstNum ?? firstName;
    if (first !== undefined) {
      for (const j of [first, i]) if (!rows[j]!.flags.includes('duplicate_in_file')) rows[j]!.flags.push('duplicate_in_file');
      r.repeat = true;
    }
    if (firstName === undefined) seenName.set(name, i);
    if (num && firstNum === undefined) seenNumber.set(num, i);
  });
}

// ---------------------------------------------------------------- matching helpers
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * Similarity of two names (0–1) on their folded forms (IMP-4): 1 = same folded name, 0.95 = same
 * words in another order, otherwise 1 − edit distance / length. Used to SUGGEST possible matches only.
 */
export function nameSimilarity(a: string, b: string): number {
  const fa = foldForSearch(a);
  const fb = foldForSearch(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  const ta = fa.split(' ').sort().join(' ');
  const tb = fb.split(' ').sort().join(' ');
  if (ta === tb) return 0.95;
  return 1 - levenshtein(fa, fb) / Math.max(fa.length, fb.length);
}

/** Names at least this similar are offered as possible matches (never merged without a choice). */
export const POSSIBLE_MATCH = 0.85;
