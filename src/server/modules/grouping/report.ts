/**
 * Grouping history (RPT-1, RPT-5): per arrangement, the held lessons it was shown in (counted with
 * `groupingReport`, so applying again in one lesson counts once); per student, lessons in a group
 * and lessons left out because they were away. Pair rules are never shown here (GRP-7).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { groupTemplates, lessonGroupings } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, key, n, NA, student, table, text } from '../reports/cells.ts';
import { groupingReport } from './service.ts';

function groupingsIn(ctx: RequestContext, scope: ReportScope) {
  const ids = scope.lessons.map((l) => l.id);
  return ids.length ? ctx.db.select().from(lessonGroupings).where(and(eq(lessonGroupings.contextId, scope.context.id), inArray(lessonGroupings.lessonId, ids))).all() : [];
}

export function groupingHistorySection(ctx: RequestContext, scope: ReportScope): ReportSectionData | null {
  const held = new Set(scope.lessons.map((l) => l.id));
  const counts = groupingReport(ctx, { contextId: scope.context.id, from: scope.from, to: scope.to });
  const used = counts.arrangementsUsed.filter((a) => a.lessons > 0);
  const rows = groupingsIn(ctx, scope);
  const templates = used.length ? ctx.db.select().from(groupTemplates).where(inArray(groupTemplates.id, used.map((u) => u.templateId))).all() : [];
  const lessonsWithGroups = new Set(rows.map((r) => r.lessonId));
  if (scope.studentId && !lessonsWithGroups.size) return null;
  const perStudent = scope.students.map((s) => {
    const enrolled = scope.lessons.filter((l) => lessonsWithGroups.has(l.id) && scope.enrolledOn(s.id, l.localDate));
    const inGroup = new Set(rows.filter((r) => r.effectiveGroupsJson.some((g) => g.memberIds.includes(s.id))).map((r) => r.lessonId));
    const away = new Set(rows.filter((r) => r.excludedAbsentIds.includes(s.id)).map((r) => r.lessonId));
    return { s, enrolled: enrolled.length, inGroup: [...inGroup].filter((id) => held.has(id)).length, away: [...away].filter((id) => !inGroup.has(id)).length };
  });
  return {
    key: 'groupingHistory',
    title: key('report.section.grouping'),
    metrics: [{ key: 'lessonsWithGroups', label: key('report.grouping.lessonsWithGroups'), cell: n(lessonsWithGroups.size, scope.lessons.length) }],
    tables: [
      table({
        key: 'arrangements',
        title: key('report.grouping.arrangements'),
        columns: [col('name', key('report.col.arrangement')), col('lessons', key('report.col.lessonsHeld'), true)],
        rows: templates.map((t) => ({ key: t.id, cells: [{ t: 'label', v: text(t.name) }, n(used.find((u) => u.templateId === t.id)?.lessons ?? 0, scope.lessons.length)] })),
        chart: { kind: 'bar', labelColumn: 'name', valueColumns: ['lessons'] },
      }),
      table({
        key: 'students',
        title: key('report.grouping.byStudent'),
        columns: [col('student', key('report.col.student')), col('inGroup', key('report.grouping.inGroup'), true), col('away', key('report.grouping.away'), true)],
        rows: perStudent.map(({ s, enrolled, inGroup, away }) => ({ key: s.id, cells: enrolled ? [student(s), n(inGroup, enrolled), n(away, enrolled)] : [student(s), NA, NA] })),
      }),
    ],
    notes: [key('report.grouping.countNote')],
  };
}

export function groupingTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const byLesson = new Map(scope.lessons.map((l) => [l.id, l]));
  return groupingsIn(ctx, scope).flatMap((r): TimelineEvent[] => {
    const l = byLesson.get(r.lessonId);
    const g = r.effectiveGroupsJson.find((x) => x.memberIds.includes(studentId));
    if (!l || !g || r.clearedAt !== null) return [];
    return [{ date: l.localDate, at: r.appliedAt, module: 'grouping', what: key('report.timeline.group'), detail: text(g.name) }];
  });
}
