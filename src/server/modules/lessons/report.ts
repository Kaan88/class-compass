/**
 * Core report sections (RPT-1, RPT-5): the overview of a class+subject and its lesson reflections.
 * Counts only, each with what it is out of; nothing is combined into a score.
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { weekStartsBetween } from '../../../domain/periods.ts';
import { addDays } from '../../../domain/dates.ts';
import type { ReportSectionData } from '../../../shared/contracts/reports.ts';
import { lessons } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, date, key, lbl, n, NR, range, raw, table, text } from '../reports/cells.ts';

export function overviewSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const abandoned = ctx.db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.contextId, scope.context.id), eq(lessons.status, 'abandoned'), gte(lessons.localDate, scope.from), lte(lessons.localDate, scope.to)))
    .all().length;
  const days = new Set(scope.lessons.map((l) => l.localDate));
  const weeks = weekStartsBetween({ from: scope.from, to: scope.to }, scope.weekStartsOn);
  const names = [...new Set(scope.lessons.map((l) => l.classNameSnapshot))].filter((nm) => nm !== scope.cls.name);
  return {
    key: 'overview',
    title: key('report.section.overview'),
    intro: key('report.overview.intro'),
    metrics: [
      { key: 'lessons', label: key('report.overview.lessonsHeld'), cell: n(scope.lessons.length) },
      { key: 'days', label: key('report.overview.lessonDays'), cell: n(days.size) },
      { key: 'abandoned', label: key('report.overview.abandoned'), cell: n(abandoned) },
      { key: 'students', label: scope.studentId ? key('report.overview.student') : key('report.overview.students'), cell: n(scope.students.length) },
    ],
    tables: [
      table({
        key: 'lessonsPerWeek',
        title: key('report.overview.perWeek'),
        columns: [col('week', key('report.col.week')), col('lessons', key('report.col.lessonsHeld'), true)],
        rows: weeks.map((w) => ({ key: w, cells: [range(w, addDays(w, 6)), n(scope.lessons.filter((l) => l.localDate >= w && l.localDate <= addDays(w, 6)).length)] })),
        chart: { kind: 'bar', labelColumn: 'week', valueColumns: ['lessons'] },
      }),
    ],
    // DAT-6: lessons keep the class name they were held under.
    notes: names.length ? [key('report.overview.formerNames', { names: names.join(', '), now: scope.cls.name })] : [],
  };
}

/** Lesson reflections (LES-3): the teacher's rating and note. Administrators see ratings only. */
export function lessonReflectionsSection(_ctx: RequestContext, scope: ReportScope): ReportSectionData | null {
  if (scope.studentId) return null;
  const showNotes = scope.viewer === 'teacher';
  const rows = scope.lessons.map((l) => {
    const r = l.reflectionJson;
    const cells = [date(l.localDate), lbl(text(l.routineNameJson)), r?.rating ? n(r.rating, 5) : NR];
    if (showNotes) cells.push(r?.note ? lbl(raw(r.note)) : NR);
    return { key: l.id, cells };
  });
  const rated = scope.lessons.filter((l) => l.reflectionJson?.rating).length;
  const columns = [col('date', key('report.col.date')), col('routine', key('report.col.routine')), col('rating', key('report.col.rating'), true)];
  if (showNotes) columns.push(col('note', key('report.col.note')));
  return {
    key: 'lessonReflections',
    title: key('report.section.lessonReflections'),
    metrics: [{ key: 'rated', label: key('report.reflections.rated'), cell: n(rated, scope.lessons.length) }],
    tables: [table({ key: 'lessons', title: key('report.reflections.lessons'), columns, rows })],
    notes: showNotes ? [] : [key('report.reflections.adminNoNotes')],
  };
}
