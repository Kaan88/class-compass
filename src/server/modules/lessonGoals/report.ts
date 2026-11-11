/**
 * Lesson goals report section (S25d, D-188; RPT-1, RPT-5): the lessons of the period that had a goal,
 * each with its review, and how many goals were reached, partly reached or not yet reached out of the
 * goals that were reviewed. A goal nobody reviewed is "not recorded", never "not yet". No score.
 */
import { inArray } from 'drizzle-orm';
import type { ReportSectionData } from '../../../shared/contracts/reports.ts';
import { LESSON_GOAL_OUTCOMES } from '../../../shared/lessonGoals.ts';
import { lessonGoals } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, date, key, lbl, n, NR, raw, table } from '../reports/cells.ts';
import type { LessonGoalRow } from './service.ts';

const outcomeKey = {
  reached: 'lessonGoals.outcome.reached',
  partly: 'lessonGoals.outcome.partly',
  notYet: 'lessonGoals.outcome.notYet',
} as const;

function goalsOf(ctx: RequestContext, lessonIds: readonly string[]): Map<string, LessonGoalRow> {
  const out = new Map<string, LessonGoalRow>();
  for (let i = 0; i < lessonIds.length; i += 500) {
    for (const r of ctx.db.select().from(lessonGoals).where(inArray(lessonGoals.lessonId, lessonIds.slice(i, i + 500))).all()) out.set(r.lessonId, r);
  }
  return out;
}

export function lessonGoalsSection(ctx: RequestContext, scope: ReportScope): ReportSectionData | null {
  if (scope.studentId) return null;
  const goals = goalsOf(
    ctx,
    scope.lessons.map((l) => l.id),
  );
  const withGoal = scope.lessons.filter((l) => goals.has(l.id));
  if (!withGoal.length) return null;
  const reviewed = withGoal.filter((l) => goals.get(l.id)!.outcome !== null);
  const count = (o: (typeof LESSON_GOAL_OUTCOMES)[number]) => reviewed.filter((l) => goals.get(l.id)!.outcome === o).length;
  return {
    key: 'lessonGoals',
    title: key('report.section.lessonGoals'),
    intro: key('report.lessonGoals.intro'),
    metrics: [
      { key: 'withGoal', label: key('report.lessonGoals.withGoal'), cell: n(withGoal.length, scope.lessons.length) },
      { key: 'reviewed', label: key('report.lessonGoals.reviewed'), cell: n(reviewed.length, withGoal.length) },
      { key: 'reached', label: key('report.lessonGoals.reached'), cell: reviewed.length ? n(count('reached'), reviewed.length) : NR },
    ],
    tables: [
      table({
        key: 'outcomes',
        title: key('report.lessonGoals.outcomes'),
        columns: [col('outcome', key('report.lessonGoals.col.outcome')), col('lessons', key('report.lessonGoals.col.lessons'), true)],
        rows: LESSON_GOAL_OUTCOMES.map((o) => ({ key: o, cells: [lbl(key(outcomeKey[o])), reviewed.length ? n(count(o), reviewed.length) : NR] })),
        chart: { kind: 'bar', labelColumn: 'outcome', valueColumns: ['lessons'] },
      }),
      table({
        key: 'lessons',
        title: key('report.lessonGoals.lessons'),
        columns: [col('date', key('report.col.date')), col('goal', key('report.lessonGoals.col.goal')), col('outcome', key('report.lessonGoals.col.outcome'))],
        rows: withGoal.map((l) => {
          const g = goals.get(l.id)!;
          return { key: l.id, cells: [date(l.localDate), lbl(raw(g.text)), g.outcome ? lbl(key(outcomeKey[g.outcome])) : NR] };
        }),
      }),
    ],
    notes: [],
  };
}
