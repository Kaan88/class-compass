/**
 * Assistant fairness report (RPT-1, RPT-5, AST-4/5). Per student, in the period: turns done (the
 * effective assistant = actual ?? planned), turns missed because they were away (kept, never lost),
 * the last turn and the days since it. Days still to come are not counted.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { daysBetween } from '../../../domain/periods.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { assistantAssignments } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, date, days, key, n, NA, NR, scopeIds, student, table } from '../reports/cells.ts';
import { checksOn } from './duties.ts';

function daysIn(ctx: RequestContext, scope: ReportScope) {
  const end = scope.to < scope.today ? scope.to : scope.today;
  return ctx.db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, scope.context.id), gte(assistantAssignments.localDate, scope.from), lte(assistantAssignments.localDate, end)))
    .orderBy(asc(assistantAssignments.localDate))
    .all();
}

const who = (r: { actualStudentId: string | null; plannedStudentId: string | null }) => r.actualStudentId ?? r.plannedStudentId;

export function assistantSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const rows = daysIn(ctx, scope);
  const ids = new Set(scopeIds(scope));
  const end = scope.to < scope.today ? scope.to : scope.today;
  const stats = scope.students.map((s) => {
    const done = rows.filter((r) => who(r) === s.id);
    const missed = rows.filter((r) => r.absentStudentIds.includes(s.id) && who(r) !== s.id).length;
    const last = done.length ? done[done.length - 1]!.localDate : null;
    const inClassDays = rows.filter((r) => scope.enrolledOn(s.id, r.localDate)).length;
    return { s, done: done.length, missed, last, inClassDays };
  });
  const filled = rows.filter((r) => who(r) !== null && (!scope.studentId || ids.has(who(r)!))).length;
  // Duty ticks (S13a, D-100): only those of the day's assistant count.
  const ticks = checksOn(ctx.db, scope.context.id, rows.map((r) => r.localDate)).filter((c) => rows.some((r) => r.localDate === c.localDate && who(r) === c.studentId) && (!scope.studentId || ids.has(c.studentId)));
  const daysTicked = new Set(ticks.map((c) => c.localDate)).size;
  return {
    key: 'assistant',
    title: key('report.section.assistant'),
    intro: key('report.assistant.intro'),
    metrics: [
      { key: 'days', label: key('report.assistant.daysWithAssistant'), cell: n(rows.filter((r) => who(r) !== null).length, rows.length) },
      ...(scope.studentId ? [{ key: 'turns', label: key('report.assistant.turns'), cell: n(filled) }] : []),
      { key: 'dutyDays', label: key('report.assistant.daysWithDuties'), cell: n(daysTicked, filled) },
      { key: 'duties', label: key('report.assistant.dutiesTicked'), cell: n(ticks.length) },
    ],
    tables: [
      table({
        key: 'students',
        title: key('report.assistant.byStudent'),
        note: key('report.assistant.byStudentNote'),
        columns: [
          col('student', key('report.col.student')),
          col('turns', key('report.assistant.turns'), true),
          col('missed', key('report.assistant.missed'), true),
          col('last', key('report.col.lastTime')),
          col('since', key('report.col.daysSince'), true),
        ],
        rows: stats.map(({ s, done, missed, last, inClassDays }) => ({
          key: s.id,
          cells: inClassDays ? [student(s), n(done, inClassDays), n(missed), last ? date(last) : NR, days(last ? daysBetween(last, end) : null)] : [student(s), NA, NA, NA, NA],
        })),
        chart: { kind: 'bar', labelColumn: 'student', valueColumns: ['turns', 'missed'] },
      }),
    ],
    notes: [key('report.assistant.keptNote')],
  };
}

export function assistantTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const rows = daysIn(ctx, scope);
  const ticks = checksOn(ctx.db, scope.context.id, rows.map((r) => r.localDate)).filter((c) => c.studentId === studentId);
  return rows.flatMap((r): TimelineEvent[] => {
    const done = ticks.filter((c) => c.localDate === r.localDate).length;
    if (who(r) === studentId) return [{ date: r.localDate, at: null, module: 'assistant', what: key('report.timeline.assistant'), detail: done ? key('report.timeline.assistantDuties', { count: done }) : null }];
    if (r.absentStudentIds.includes(studentId)) return [{ date: r.localDate, at: null, module: 'assistant', what: key('report.timeline.assistantMissed'), detail: null }];
    return [];
  });
}
