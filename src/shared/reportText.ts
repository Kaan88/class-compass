/**
 * Text of report labels and cells (D-091), shared by the client (screen, print) and the server (CSV),
 * so a CSV says exactly what the screen says. RPT-5 wording: "not recorded", "absent" and "not in the
 * class" are words, never 0.
 */
import type { ReportCell, ReportLabel } from './contracts/reports.ts';
import { pickText, translate, type Locale } from './i18n/index.ts';

export function reportLabelText(l: ReportLabel, locale: Locale): string {
  if ('k' in l) return translate(locale, l.k, l.p ?? {});
  if ('text' in l) {
    const then = pickText(l.text, locale);
    return l.now ? translate(locale, 'report.renamed', { then, now: pickText(l.now, locale) }) : then;
  }
  return l.raw;
}

/** One cell as plain text (CSV, print, chart titles). Counts with a denominator read "3 / 12". */
export function reportCellText(c: ReportCell, locale: Locale): string {
  switch (c.t) {
    case 'n':
      return c.d === undefined || c.d === null ? String(c.v) : `${c.v} / ${c.d}`;
    case 'nr':
      return translate(locale, 'metric.notRecorded');
    case 'absent':
      return translate(locale, 'report.cell.absent');
    case 'na':
      return translate(locale, 'report.cell.na');
    case 'closed':
      return translate(locale, 'report.cell.closed');
    case 'label':
      return reportLabelText(c.v, locale);
    case 'date':
      return c.v;
    case 'range':
      return `${c.from} – ${c.to}`;
    case 'student':
      return c.name;
    case 'days':
      return c.v === null ? translate(locale, 'report.cell.never') : String(c.v);
  }
}

/** The number a chart plots for a cell, or null for a gap (not recorded / absent / not applicable). */
export const chartValue = (c: ReportCell | undefined): number | null => (c && c.t === 'n' ? c.v : c && c.t === 'days' ? c.v : null);
