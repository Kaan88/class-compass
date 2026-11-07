/**
 * Secret Students fairness report (RPT-1, RPT-5, SEC-3, D-010). Lives in this folder because only it
 * may read `secret_selections`, and reads the students of REVEALED rounds only: a sealed round, or one
 * of an abandoned lesson, is counted as a round and never shows who was chosen. Per student: times
 * revealed, the outcomes, turns kept because they were away (withdrawn_absent: the turn is kept, not
 * used), the last time and the days since it.
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { daysBetween } from '../../../domain/periods.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { secretRounds, secretSelections } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, date, days, key, n, NA, NR, student, table } from '../reports/cells.ts';

function roundsIn(ctx: RequestContext, scope: ReportScope) {
  return ctx.db
    .select()
    .from(secretRounds)
    .where(and(eq(secretRounds.contextId, scope.context.id), gte(secretRounds.localDate, scope.from), lte(secretRounds.localDate, scope.to)))
    .orderBy(asc(secretRounds.drawnAt))
    .all();
}

/** Selections of revealed rounds only (SEC-3). */
function revealedSelections(ctx: RequestContext, scope: ReportScope) {
  const rounds = roundsIn(ctx, scope);
  const revealed = rounds.filter((r) => r.revealedAt !== null && r.status === 'live');
  const ids = revealed.map((r) => r.id);
  const sels = ids.length
    ? ctx.db.select().from(secretSelections).where(inArray(secretSelections.roundId, ids)).orderBy(asc(secretSelections.selectedAt)).all()
    : [];
  return { rounds, revealed, sels, dateOf: new Map(revealed.map((r) => [r.id, r.localDate])) };
}

export function secretSection(ctx: RequestContext, scope: ReportScope): ReportSectionData | null {
  const { rounds, revealed, sels, dateOf } = revealedSelections(ctx, scope);
  if (!rounds.length && scope.studentId) return null;
  const end = scope.to < scope.today ? scope.to : scope.today;
  const revealedDates = new Set(revealed.map((r) => r.localDate));
  const rows = scope.students.map((s) => {
    const mine = sels.filter((x) => x.studentId === s.id);
    const chosen = mine.filter((x) => x.status === 'revealed');
    const dates = chosen.map((x) => dateOf.get(x.roundId)!).sort();
    const last = dates.length ? dates[dates.length - 1]! : null;
    const inClass = [...revealedDates].some((d) => scope.enrolledOn(s.id, d));
    if (!inClass) return { key: s.id, cells: [student(s), NA, NA, NA, NA, NA, NA, NA] };
    return {
      key: s.id,
      cells: [
        student(s),
        n(chosen.length),
        n(chosen.filter((x) => x.outcome === 'goal_met').length, chosen.length),
        n(chosen.filter((x) => x.outcome === 'still_practising').length, chosen.length),
        n(chosen.filter((x) => x.outcome !== 'goal_met' && x.outcome !== 'still_practising').length, chosen.length),
        n(mine.filter((x) => x.status === 'withdrawn_absent').length),
        last ? date(last) : NR,
        days(last ? daysBetween(last, end) : null),
      ],
    };
  });
  return {
    key: 'secretStudents',
    title: key('report.section.secret'),
    intro: key('report.secret.intro'),
    metrics: [
      { key: 'rounds', label: key('report.secret.rounds'), cell: n(rounds.filter((r) => r.status === 'live').length) },
      { key: 'revealed', label: key('report.secret.revealedRounds'), cell: n(revealed.length, rounds.filter((r) => r.status === 'live').length) },
    ],
    tables: [
      table({
        key: 'students',
        title: key('report.secret.byStudent'),
        columns: [
          col('student', key('report.col.student')),
          col('revealed', key('report.secret.timesRevealed'), true),
          col('goalMet', key('report.secret.goalMet'), true),
          col('practising', key('report.secret.stillPractising'), true),
          col('notAssessed', key('report.secret.notAssessed'), true),
          col('kept', key('report.secret.keptAway'), true),
          col('last', key('report.col.lastTime')),
          col('since', key('report.col.daysSince'), true),
        ],
        rows,
        chart: { kind: 'bar', labelColumn: 'student', valueColumns: ['revealed'] },
      }),
    ],
    notes: [key('report.secret.revealedOnly'), key('report.secret.keptNote')],
  };
}

export function secretTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const { sels, dateOf } = revealedSelections(ctx, scope);
  return sels
    .filter((x) => x.studentId === studentId && (x.status === 'revealed' || x.status === 'withdrawn_absent'))
    .map((x) => ({
      date: dateOf.get(x.roundId)!,
      at: x.selectedAt,
      module: 'secretStudents' as const,
      what: x.status === 'revealed' ? key('report.timeline.secretRevealed') : key('report.timeline.secretKept'),
      detail: x.status === 'revealed' && x.outcome ? key(`secret.outcome.${x.outcome}`) : null,
    }));
}
