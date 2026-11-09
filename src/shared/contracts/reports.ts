/**
 * Statistics & reports (S11: RPT-1..6, DAT-6, D-091).
 *
 * Every module contributes report SECTIONS through its server manifest (`reports`). A section is
 * data, not layout: labelled metrics and tables of typed cells. The client renders every section
 * with the same components (tables, accessible SVG charts drawn FROM the tables, CSV, print), and the
 * server writes the same tables as CSV. Cells keep RPT-5 honest by type:
 *   n       a count, optionally with its denominator (`d`) — e.g. 3 / 12 lessons attended
 *   nr      NOT RECORDED (nobody recorded anything) — never shown as 0
 *   absent  the student was absent / away — never shown as 0
 *   na      not applicable (e.g. not in the class that week)
 * There is no overall score cell and no section may add one (no score from reminders, RPT-5).
 * All endpoints are `teacher` / `admin` access: PIN-gated in classroom mode (423, RPT-6, PIN-8).
 */
import { z } from 'zod';
import { POLICY_KEYS } from '../modules.ts';
import { REPORT_VIEW_NAME_MAX, ReportViewSpec, SectionsParam, ViewRef } from '../reportViews.ts';
import { Empty, LocalizedText, Ok, endpoint } from './define.ts';
import { Id, IsoDate } from './school.ts';

/** A label: an i18n key with parameters, a teacher-editable text (snapshot), or literal text (names, titles). */
export const ReportLabel = z.union([
  z.object({ k: z.string(), p: z.record(z.string(), z.union([z.string(), z.number()])).optional() }),
  z.object({ text: LocalizedText, now: LocalizedText.optional() }),
  z.object({ raw: z.string() }),
]);
export type ReportLabel = z.infer<typeof ReportLabel>;

export const ReportCell = z.discriminatedUnion('t', [
  z.object({ t: z.literal('n'), v: z.number(), d: z.number().nullable().optional() }),
  z.object({ t: z.literal('nr') }),
  z.object({ t: z.literal('absent') }),
  z.object({ t: z.literal('na') }),
  z.object({ t: z.literal('label'), v: ReportLabel }),
  z.object({ t: z.literal('date'), v: z.string() }),
  z.object({ t: z.literal('range'), from: z.string(), to: z.string() }),
  z.object({ t: z.literal('student'), id: z.string(), name: z.string() }),
  /** Days since something happened; null = never. */
  z.object({ t: z.literal('days'), v: z.number().nullable() }),
]);
export type ReportCell = z.infer<typeof ReportCell>;

export const ReportColumn = z.object({ key: z.string(), label: ReportLabel, numeric: z.boolean().optional() });
export type ReportColumn = z.infer<typeof ReportColumn>;

/**
 * A chart drawn from the table it belongs to (the table is its accessible data table): one bar or
 * line per row (`labelColumn`), values from `valueColumns` (count cells only; nr/absent/na are gaps).
 */
export const ReportChart = z.object({ kind: z.enum(['bar', 'line']), labelColumn: z.string(), valueColumns: z.array(z.string()).min(1).max(4) });
export type ReportChart = z.infer<typeof ReportChart>;

export const ReportTable = z.object({
  key: z.string(),
  /** What the table is about when a section has several (e.g. the counter's name), shown before the title. */
  about: ReportLabel.optional(),
  title: ReportLabel,
  note: ReportLabel.optional(),
  columns: z.array(ReportColumn),
  rows: z.array(z.object({ key: z.string(), cells: z.array(ReportCell) })),
  chart: ReportChart.optional(),
});
export type ReportTable = z.infer<typeof ReportTable>;

export const ReportMetric = z.object({ key: z.string(), label: ReportLabel, cell: ReportCell });
export type ReportMetric = z.infer<typeof ReportMetric>;

export const ReportSection = z.object({
  key: z.string(),
  /** Module policy key (null = core). */
  module: z.enum(POLICY_KEYS).nullable(),
  title: ReportLabel,
  intro: ReportLabel.optional(),
  metrics: z.array(ReportMetric),
  tables: z.array(ReportTable),
  notes: z.array(ReportLabel),
});
export type ReportSection = z.infer<typeof ReportSection>;
/** What a module's report builder returns (the server stamps `module`). */
export type ReportSectionData = Omit<ReportSection, 'module'>;

export const ReportContextInfo = z.object({
  id: z.string(),
  classId: z.string(),
  /** Class name now; `classNames` lists the names used in lessons of the period (DAT-6). */
  className: z.string(),
  classNames: z.array(z.string()),
  subjectName: LocalizedText,
  teacherName: z.string(),
  year: z.object({ id: z.string(), name: z.string(), startsOn: z.string(), endsOn: z.string(), archived: z.boolean() }),
  terms: z.array(z.object({ name: LocalizedText, startsOn: z.string(), endsOn: z.string() })),
  timezone: z.string(),
  today: z.string(),
  weekStartsOn: z.number().int(),
  /** The teaching assignment has ended or the class/year is archived (read-only history). */
  ended: z.boolean(),
});
export type ReportContextInfo = z.infer<typeof ReportContextInfo>;

export const ReportStudent = z.object({ id: z.string(), fullName: z.string(), active: z.boolean() });

export const Report = z.object({
  schoolName: z.string(),
  context: ReportContextInfo,
  from: z.string(),
  to: z.string(),
  student: ReportStudent.nullable(),
  /** Students in the class at any time in the period (the student filter). */
  students: z.array(ReportStudent),
  generatedAt: z.number(),
  sections: z.array(ReportSection),
});
export type Report = z.infer<typeof Report>;

export const ReportInput = z.object({
  contextId: Id,
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  studentId: Id.optional(),
  /** S14e1 (D-153): only these sections / tables (`shared/reportViews.ts`); absent = everything. Unrequested sections are not built. */
  sections: SectionsParam.optional(),
});

export const reportContexts = endpoint({
  method: 'GET',
  path: '/api/teacher/reports/contexts',
  access: 'teacher',
  input: Empty,
  output: z.object({ contexts: z.array(ReportContextInfo) }),
});
export const contextReport = endpoint({ method: 'GET', path: '/api/teacher/contexts/:contextId/report', access: 'teacher', input: ReportInput, output: Report });

export const CsvInput = ReportInput.extend({ section: z.string().min(1).max(60), table: z.string().min(1).max(60), delimiter: z.enum(['comma', 'semicolon']).optional() });
/** CSV of one table of one section (UTF-8 with BOM, formula-safe, RPT-4). Raw route: the body is text/csv. */
export const contextReportCsv = endpoint({ method: 'GET', path: '/api/teacher/contexts/:contextId/report/csv', access: 'teacher', input: CsvInput, output: z.unknown() });

// ---------------------------------------------------------------- student timeline (RPT-1)
export const TimelineEvent = z.object({
  date: z.string(),
  /** For ordering within a day. */
  at: z.number().nullable(),
  module: z.enum(POLICY_KEYS).nullable(),
  what: ReportLabel,
  detail: ReportLabel.nullable(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.object({
  context: ReportContextInfo,
  student: ReportStudent,
  from: z.string(),
  to: z.string(),
  events: z.array(TimelineEvent),
  truncated: z.boolean(),
});
export const studentTimeline = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/students/:studentId/timeline',
  access: 'teacher',
  input: z.object({ contextId: Id, studentId: Id, from: IsoDate.optional(), to: IsoDate.optional() }),
  output: Timeline,
});

// ---------------------------------------------------------------- admin (school-wide)
export const adminReportContexts = endpoint({ method: 'GET', path: '/api/admin/reports/contexts', access: 'admin', input: Empty, output: z.object({ contexts: z.array(ReportContextInfo) }) });
export const adminContextReport = endpoint({ method: 'GET', path: '/api/admin/contexts/:contextId/report', access: 'admin', input: ReportInput, output: Report });
export const adminContextReportCsv = endpoint({ method: 'GET', path: '/api/admin/contexts/:contextId/report/csv', access: 'admin', input: CsvInput, output: z.unknown() });

/** School-wide usage (no private notes, no student-level data): one section per table of classes/teachers. */
export const UsageReport = z.object({ schoolName: z.string(), from: z.string(), to: z.string(), generatedAt: z.number(), sections: z.array(ReportSection) });
export type UsageReport = z.infer<typeof UsageReport>;
export const usageReport = endpoint({ method: 'GET', path: '/api/admin/reports/usage', access: 'admin', input: z.object({ from: IsoDate.optional(), to: IsoDate.optional() }), output: UsageReport });
export const usageReportCsv = endpoint({
  method: 'GET',
  path: '/api/admin/reports/usage/csv',
  access: 'admin',
  input: z.object({ from: IsoDate.optional(), to: IsoDate.optional(), section: z.string().min(1).max(60), table: z.string().min(1).max(60), delimiter: z.enum(['comma', 'semicolon']).optional() }),
  output: z.unknown(),
});

// ---------------------------------------------------------------- report views (S14e1, D-153)
/** One table of a section in the catalogue; `perItem` = one table per item (counter), keyed `<key>-<id>`. */
export const ReportCatalogTable = z.object({ key: z.string(), title: ReportLabel, perItem: z.boolean() });
export const ReportCatalogSection = z.object({ key: z.string(), module: z.enum(POLICY_KEYS).nullable(), title: ReportLabel, tables: z.array(ReportCatalogTable) });
export type ReportCatalogSection = z.infer<typeof ReportCatalogSection>;
export const ReportCatalog = z.object({ sections: z.array(ReportCatalogSection) });
export type ReportCatalog = z.infer<typeof ReportCatalog>;
/** With a class+subject: only the sections of the modules switched on there (after the access check). */
const CatalogInput = z.object({ contextId: Id.optional() });
export const reportCatalog = endpoint({ method: 'GET', path: '/api/teacher/reports/catalog', access: 'teacher', input: CatalogInput, output: ReportCatalog });
export const adminReportCatalog = endpoint({ method: 'GET', path: '/api/admin/reports/catalog', access: 'admin', input: CatalogInput, output: ReportCatalog });

export const ReportViewName = z.string().trim().min(1).max(REPORT_VIEW_NAME_MAX);
export const SavedReportView = z.object({ id: z.string(), name: z.string(), spec: ReportViewSpec, updatedAt: z.number() });
export type SavedReportView = z.infer<typeof SavedReportView>;
export const ReportViews = z.object({ views: z.array(SavedReportView), defaultView: ViewRef, max: z.number().int() });
export type ReportViews = z.infer<typeof ReportViews>;
const ViewIdInput = z.object({ viewId: Id });
const CreateViewInput = z.object({ name: ReportViewName, spec: ReportViewSpec });
const UpdateViewInput = ViewIdInput.extend({ name: ReportViewName.optional(), spec: ReportViewSpec.optional() });
const DefaultViewInput = z.object({ view: ViewRef });

/** The signed-in account's own saved views; teachers and administrators each have their own list. */
export const reportViews = endpoint({ method: 'GET', path: '/api/teacher/report-views', access: 'teacher', input: Empty, output: ReportViews });
export const createReportView = endpoint({ method: 'POST', path: '/api/teacher/report-views', access: 'teacher', input: CreateViewInput, output: SavedReportView });
export const updateReportView = endpoint({ method: 'PUT', path: '/api/teacher/report-views/:viewId', access: 'teacher', input: UpdateViewInput, output: SavedReportView });
export const deleteReportView = endpoint({ method: 'DELETE', path: '/api/teacher/report-views/:viewId', access: 'teacher', input: ViewIdInput, output: Ok });
export const setDefaultReportView = endpoint({ method: 'PUT', path: '/api/teacher/reports/default-view', access: 'teacher', input: DefaultViewInput, output: Ok });

export const adminReportViews = endpoint({ method: 'GET', path: '/api/admin/report-views', access: 'admin', input: Empty, output: ReportViews });
export const adminCreateReportView = endpoint({ method: 'POST', path: '/api/admin/report-views', access: 'admin', input: CreateViewInput, output: SavedReportView });
export const adminUpdateReportView = endpoint({ method: 'PUT', path: '/api/admin/report-views/:viewId', access: 'admin', input: UpdateViewInput, output: SavedReportView });
export const adminDeleteReportView = endpoint({ method: 'DELETE', path: '/api/admin/report-views/:viewId', access: 'admin', input: ViewIdInput, output: Ok });
export const adminSetDefaultReportView = endpoint({ method: 'PUT', path: '/api/admin/reports/default-view', access: 'admin', input: DefaultViewInput, output: Ok });

/** Longest period one report covers (a school year plus margin). */
export const MAX_REPORT_DAYS = 400;
