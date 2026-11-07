/**
 * Reports (S11: RPT-1..6, D-091): assembles the sections that the modules contribute through their
 * manifests, the student timeline, and CSV files of report tables. Reading only; nothing is written
 * except the audit row of an export.
 */
import { and, eq } from 'drizzle-orm';
import { safeFileName, toCsv, type CsvDelimiter, type CsvValue } from '../../../domain/csv.ts';
import type { Report, ReportSection, ReportTable, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { pickText, translate, type Locale } from '../../../shared/i18n/index.ts';
import { reportCellText, reportLabelText } from '../../../shared/reportText.ts';
import { enrolments } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { reportContributions, timelineContributions } from '../index.ts';
import type { ReportScope } from '../manifest.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { key } from './cells.ts';
import { buildScope, type Viewer } from './scope.ts';

type Input = { contextId: string; from?: string | undefined; to?: string | undefined; studentId?: string | undefined };

const studentOut = (s: { id: string; fullName: string; deactivatedAt: number | null }) => ({ id: s.id, fullName: s.fullName, active: s.deactivatedAt === null });

export function sectionsFor(ctx: RequestContext, scope: ReportScope): ReportSection[] {
  const out: ReportSection[] = [];
  for (const c of reportContributions(ctx.db, scope.context.id)) {
    const data = c.build(ctx, scope);
    if (data) out.push({ ...data, module: c.module });
  }
  return out;
}

export function buildReport(ctx: RequestContext, input: Input, viewer: Viewer): Report {
  const { scope, info } = buildScope(ctx, input.contextId, viewer, input);
  // The student filter lists everyone in the class during the period, even when one is chosen.
  const everyone = input.studentId ? buildScope(ctx, input.contextId, viewer, { from: scope.from, to: scope.to }).scope.students : scope.students;
  return {
    schoolName: getSchoolSettings(ctx.db).schoolName,
    context: info,
    from: scope.from,
    to: scope.to,
    student: scope.studentId ? studentOut(scope.students[0]!) : null,
    students: everyone.map(studentOut),
    generatedAt: ctx.now(),
    sections: sectionsFor(ctx, scope),
  };
}

// ---------------------------------------------------------------- timeline
const TIMELINE_LIMIT = 1500;

/** Class membership changes of the student in this class (core events of the timeline). */
function enrolmentEvents(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const rows = ctx.db.select().from(enrolments).where(and(eq(enrolments.studentId, studentId), eq(enrolments.classId, scope.cls.id))).all();
  const out: TimelineEvent[] = [];
  for (const e of rows) {
    if (e.fromDate >= scope.from && e.fromDate <= scope.to) out.push({ date: e.fromDate, at: null, module: null, what: key('report.timeline.joined', { className: scope.cls.name }), detail: key(`report.enrolReason.${e.reason}` as never) });
    if (e.toDate && e.toDate >= scope.from && e.toDate <= scope.to) out.push({ date: e.toDate, at: null, module: null, what: key('report.timeline.left', { className: scope.cls.name }), detail: null });
  }
  return out;
}

export function buildTimeline(ctx: RequestContext, input: { contextId: string; studentId: string; from?: string | undefined; to?: string | undefined }) {
  const { scope, info } = buildScope(ctx, input.contextId, 'teacher', input);
  const student = scope.students[0];
  if (!student) throw notFound('Student');
  let events: TimelineEvent[] = enrolmentEvents(ctx, scope, student.id);
  for (const c of timelineContributions(ctx.db, scope.context.id)) events.push(...c.build(ctx, scope, student.id).map((e) => ({ ...e, module: c.module })));
  events = events.filter((e) => e.date >= scope.from && e.date <= scope.to).sort((a, b) => a.date.localeCompare(b.date) || (a.at ?? 0) - (b.at ?? 0));
  const truncated = events.length > TIMELINE_LIMIT;
  return { context: info, student: studentOut(student), from: scope.from, to: scope.to, events: truncated ? events.slice(-TIMELINE_LIMIT) : events, truncated };
}

// ---------------------------------------------------------------- CSV (RPT-4)
/**
 * One table as CSV in the viewer's language. A count with a denominator becomes two columns
 * ("Present" and "Present – out of") so spreadsheets keep both as numbers; "not recorded", "absent"
 * and "not in the class" stay words (RPT-5).
 */
export function tableCsv(t: ReportTable, locale: Locale, delimiter: CsvDelimiter): string {
  const withDen = t.columns.map((_, i) => t.rows.some((r) => r.cells[i]?.t === 'n' && r.cells[i].d !== undefined && r.cells[i].d !== null));
  const header: CsvValue[] = [];
  t.columns.forEach((c, i) => {
    const label = reportLabelText(c.label, locale);
    header.push(label);
    if (withDen[i]) header.push(translate(locale, 'report.csv.outOf', { label }));
  });
  const rows = t.rows.map((r) => {
    const out: CsvValue[] = [];
    r.cells.forEach((c, i) => {
      if (c.t === 'n') {
        out.push(c.v);
        if (withDen[i]) out.push(c.d ?? '');
      } else if (c.t === 'days') {
        out.push(c.v ?? reportCellText(c, locale));
        if (withDen[i]) out.push('');
      } else {
        out.push(reportCellText(c, locale));
        if (withDen[i]) out.push('');
      }
    });
    return out;
  });
  return toCsv(header, rows, delimiter);
}

export function findTable(sections: readonly ReportSection[], section: string, tableKey: string): ReportTable {
  const t = sections.find((s) => s.key === section)?.tables.find((x) => x.key === tableKey);
  if (!t) throw new AppError('NOT_FOUND', 'Report table not found', { reason: 'REPORT_TABLE_NOT_FOUND' });
  return t;
}

export const csvDelimiter = (d: 'comma' | 'semicolon' | undefined): CsvDelimiter => (d === 'semicolon' ? ';' : ',');

/** CSV file name: class, subject, section, table and period (ASCII only). */
export function csvName(report: Pick<Report, 'context' | 'from' | 'to'>, section: string, table: string, locale: Locale): string {
  return `${safeFileName(`${report.context.className}-${pickText(report.context.subjectName, locale)}-${section}-${table}-${report.from}_${report.to}`)}.csv`;
}

/** Content-Disposition for a generated download (ASCII name; never a user-supplied path). */
export const attachment = (name: string) => `attachment; filename="${safeFileName(name.replace(/\.csv$/u, ''))}.csv"`;


