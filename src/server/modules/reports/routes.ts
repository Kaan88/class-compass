/**
 * Report endpoints (RPT-1..6). Teacher endpoints serve the teacher's own class+subject contexts only;
 * admin endpoints every context (without the teacher's lesson notes) and the school-wide usage
 * report. All are `teacher` / `admin` access: 423 in locked classroom mode before anything else.
 * CSV downloads are raw routes (text/csv, UTF-8 with BOM, formula-safe) and are audited.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as C from '../../../shared/contracts/reports.ts';
import type { Locale } from '../../../shared/i18n/index.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { rawRoute, route } from '../../lib/http.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { listReportContexts } from './scope.ts';
import { attachment, buildReport, buildTimeline, csvDelimiter, csvName, findTable, tableCsv } from './service.ts';
import { usageReport } from './usage.ts';

const localeOf = (ctx: RequestContext): Locale => ctx.user?.locale ?? getSchoolSettings(ctx.db).defaultLocale;

function sendCsv(ctx: RequestContext, reply: FastifyReply, body: string, name: string, what: Record<string, unknown>) {
  audit(ctx.db, ctx.actor, { action: 'report.csv_exported', entity: 'report', entityId: null, after: what }, ctx.now());
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', attachment(name))
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .send(body);
}

export function registerReportRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.reportContexts, (ctx) => ({ contexts: listReportContexts(ctx, 'teacher') }));
  route(app, deps, C.contextReport, (ctx, input) => buildReport(ctx, input, 'teacher'));
  rawRoute(app, deps, C.contextReportCsv, (ctx, input, { reply }) => {
    const report = buildReport(ctx, input, 'teacher');
    const locale = localeOf(ctx);
    const t = findTable(report.sections, input.section, input.table);
    return sendCsv(ctx, reply, tableCsv(t, locale, csvDelimiter(input.delimiter)), csvName(report, input.section, input.table, locale), { contextId: input.contextId, section: input.section, table: input.table, from: report.from, to: report.to });
  });
  route(app, deps, C.studentTimeline, (ctx, input) => buildTimeline(ctx, input));

  route(app, deps, C.adminReportContexts, (ctx) => ({ contexts: listReportContexts(ctx, 'admin') }));
  route(app, deps, C.adminContextReport, (ctx, input) => buildReport(ctx, input, 'admin'));
  rawRoute(app, deps, C.adminContextReportCsv, (ctx, input, { reply }) => {
    const report = buildReport(ctx, input, 'admin');
    const locale = localeOf(ctx);
    const t = findTable(report.sections, input.section, input.table);
    return sendCsv(ctx, reply, tableCsv(t, locale, csvDelimiter(input.delimiter)), csvName(report, input.section, input.table, locale), { contextId: input.contextId, section: input.section, table: input.table, from: report.from, to: report.to });
  });
  route(app, deps, C.usageReport, (ctx, input) => usageReport(ctx, input));
  rawRoute(app, deps, C.usageReportCsv, (ctx, input, { reply }) => {
    const report = usageReport(ctx, input);
    const locale = localeOf(ctx);
    const t = findTable(report.sections, input.section, input.table);
    return sendCsv(ctx, reply, tableCsv(t, locale, csvDelimiter(input.delimiter)), `usage-${input.table}-${report.from}_${report.to}.csv`, { section: input.section, table: input.table, from: report.from, to: report.to });
  });
}
