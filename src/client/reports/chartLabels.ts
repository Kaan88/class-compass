/**
 * Chart axis labels (usability audit 2026-11): short dates instead of ISO weeks, rows with the same
 * label told apart by the next text column (class · subject), labels thinned or turned when they
 * would overlap, and ellipsised (the full text stays in each bar's <title> and in the table below).
 */
import type { ReportCell, ReportTable } from '../../shared/contracts/reports.ts';
import { formatDay, type Locale } from '../../shared/i18n/index.ts';
import { reportCellText } from '../../shared/reportText.ts';

/** The text one axis label shows for a cell: a week or date as "31 Aug", anything else as in the table. */
export function axisLabel(c: ReportCell, locale: Locale): string {
  if (c.t === 'range') return formatDay(c.from, locale, { year: false });
  if (c.t === 'date') return formatDay(c.v, locale, { year: false });
  // A self-assessment step ("4 of 5" / "5 üzerinden 4") is its number on the axis; the axis title
  // and the table say what it is out of.
  if (c.t === 'label' && 'k' in c.v && c.v.k === 'report.goals.confidenceValue' && c.v.p?.value !== undefined) return String(c.v.p.value);
  return reportCellText(c, locale);
}

/**
 * One label per row. When two rows would show the same text (four bars all called "3-A"), the text
 * of the next text column is added: "3-A · English".
 */
export function rowLabels(table: ReportTable, rows: ReportTable['rows'], labelIdx: number, locale: Locale): string[] {
  const base = rows.map((r) => axisLabel(r.cells[labelIdx]!, locale));
  const dupes = base.some((b, i) => base.indexOf(b) !== i);
  if (!dupes) return base;
  const texty = new Set(['label', 'date', 'range']);
  const extraIdx = table.columns.findIndex((c, i) => i !== labelIdx && !c.numeric && rows.every((r) => texty.has(r.cells[i]?.t ?? '')));
  if (extraIdx < 0) return base;
  return rows.map((r, i) => (base.indexOf(base[i]!) !== base.lastIndexOf(base[i]!) ? `${base[i]} · ${axisLabel(r.cells[extraIdx]!, locale)}` : base[i]!));
}

export const ellipsis = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`);

/**
 * How to place the labels in a plot `plotWidth` px wide with `n` bands at a font of `fontPx`:
 * straight when they fit, turned 40° when they do not, and only every `step`-th label when even
 * turned labels would touch. `maxChars` is the ellipsis length.
 */
export function labelLayout(labels: string[], plotWidth: number, fontPx: number): { step: number; rotate: boolean; maxChars: number } {
  const n = Math.max(1, labels.length);
  const band = plotWidth / n;
  const charW = fontPx * 0.6;
  const longest = Math.max(1, ...labels.map((l) => l.length));
  if (longest * charW <= band - 4) return { step: 1, rotate: false, maxChars: longest };
  // Turned labels need about one line height of band each.
  const step = Math.max(1, Math.ceil((fontPx * 1.4) / band));
  return { step, rotate: true, maxChars: 18 };
}
