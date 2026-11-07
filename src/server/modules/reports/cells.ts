/**
 * Builders for report cells and labels (D-091) shared by every module's report section. Only these
 * cell kinds exist; RPT-5: `nr` (not recorded), `absent` and `na` (not applicable) are never 0.
 */
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import type { ReportCell, ReportColumn, ReportLabel, ReportTable } from '../../../shared/contracts/reports.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';

export const key = (k: MessageKey, p?: Record<string, string | number>): ReportLabel => (p ? { k, p } : { k });
export const raw = (s: string): ReportLabel => ({ raw: s });
/** A teacher-editable label as it was (snapshot), with the current text when it was renamed since (DAT-6). */
export function text(then: LocalizedTextValue, now?: LocalizedTextValue | null): ReportLabel {
  const same = !now || (now.en ?? '') === (then.en ?? '') && (now.tr ?? '') === (then.tr ?? '');
  return same ? { text: then } : { text: then, now };
}

export const n = (v: number, d?: number | null): ReportCell => (d === undefined ? { t: 'n', v } : { t: 'n', v, d });
export const NR: ReportCell = { t: 'nr' };
export const ABSENT: ReportCell = { t: 'absent' };
export const NA: ReportCell = { t: 'na' };
export const lbl = (v: ReportLabel): ReportCell => ({ t: 'label', v });
export const date = (v: string): ReportCell => ({ t: 'date', v });
export const range = (from: string, to: string): ReportCell => ({ t: 'range', from, to });
export const student = (s: { id: string; fullName: string }): ReportCell => ({ t: 'student', id: s.id, name: s.fullName });
export const days = (v: number | null): ReportCell => ({ t: 'days', v });
/** A count when anything was recorded, otherwise "not recorded". */
export const countOrNr = (v: number, recorded: boolean, d?: number | null): ReportCell => (recorded ? n(v, d) : NR);

export const col = (k: string, label: ReportLabel, numeric = false): ReportColumn => (numeric ? { key: k, label, numeric } : { key: k, label });

/** A table from columns and rows of cells (same order as the columns). */
export function table(t: { key: string; title: ReportLabel; note?: ReportLabel; columns: ReportColumn[]; rows: Array<{ key: string; cells: ReportCell[] }>; chart?: ReportTable['chart'] }): ReportTable {
  for (const r of t.rows) if (r.cells.length !== t.columns.length) throw new Error(`report table ${t.key}: row ${r.key} has ${r.cells.length} cells for ${t.columns.length} columns`);
  return { key: t.key, title: t.title, ...(t.note ? { note: t.note } : {}), columns: t.columns, rows: t.rows, ...(t.chart ? { chart: t.chart } : {}) };
}

/** Ids of the students a report covers (the whole class in the period, or the chosen one). */
export const scopeIds = (scope: { students: ReadonlyArray<{ id: string }> }) => scope.students.map((s) => s.id);
