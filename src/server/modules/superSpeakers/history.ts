/**
 * Super Speakers history (S12, SSP-9, D-130): the weekly reset is only a time window, so every past
 * week stays queryable. Two views, both built from typed report cells (CSV and print come for free):
 * - the administrator's school-wide history (winners per week, totals per class and week, per scorer,
 *   per student) on the Super Speakers page;
 * - the class+subject report section and student timeline (S11 report hooks), limited to points the
 *   students earned while in that class, shown in the badge subject's reports (or every subject when
 *   there is none).
 */
import { and, gte, inArray, lte } from 'drizzle-orm';
import { weekEndOf, weekStartOfDate } from '../../../domain/counters.ts';
import { addDays } from '../../../domain/dates.ts';
import { classTotals, podium, totalsByStudent } from '../../../domain/speakers.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { compareNames } from '../../../shared/text/turkish.ts';
import type { Db } from '../../db/client.ts';
import { pointEvents, scorerLinks, students } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { invalid } from '../../lib/errors.ts';
import type { ReportScope } from '../manifest.ts';
import { col, key, n, NA, range, raw, scopeIds, student, table } from '../reports/cells.ts';
import { badgeSubject, getSettings, participatingClasses } from './service.ts';

type PointRow = typeof pointEvents.$inferSelect;

/** Longest admin history period (about two school years). */
const MAX_DAYS = 800;

function pointsIn(db: Db, from: string, to: string, studentIds?: readonly string[]): PointRow[] {
  const conds = [gte(pointEvents.localDate, from), lte(pointEvents.localDate, to)];
  if (studentIds) {
    if (!studentIds.length) return [];
    conds.push(inArray(pointEvents.studentId, [...studentIds]));
  }
  return db.select().from(pointEvents).where(and(...conds)).all();
}

/** Week starts (oldest first) of every week overlapping [from, to]. */
function weeksOf(from: string, to: string, weekStartsOn: number): string[] {
  const out: string[] = [];
  for (let w = weekStartOfDate(from, weekStartsOn); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}
const nextDay = (d: string) => addDays(d, 1);

/** The rows grouped by a key, each group in the rows' order (one pass instead of a filter per key, D-162). */
function groupBy(rows: readonly PointRow[], keyOf: (r: PointRow) => string): Map<string, PointRow[]> {
  const out = new Map<string, PointRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** `weekStartOfDate` of each row's local day, worked out once per distinct day. */
function weekOfRow(weekStartsOn: number): (r: PointRow) => string {
  const cache = new Map<string, string>();
  return (r) => {
    let w = cache.get(r.localDate);
    if (w === undefined) cache.set(r.localDate, (w = weekStartOfDate(r.localDate, weekStartsOn)));
    return w;
  };
}
const NONE: readonly PointRow[] = [];

/** The administrator's school-wide history section for [from, to] (SSP-9). */
export function adminHistory(ctx: RequestContext, from: string, to: string): ReportSectionData {
  if (from > to) throw invalid('The start date is after the end date', { reason: 'BAD_PERIOD' });
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_DAYS) throw invalid('Choose a shorter period', { reason: 'PERIOD_TOO_LONG' });
  const s = getSettings(ctx.db);
  const weeks = weeksOf(from, to, s.weekStartsOn);
  // The weekly tables cover whole weeks (as the board showed them), even when the period starts or ends
  // mid-week; the metrics, scorer and student tables cover exactly [from, to].
  const weekFrom = weeks[0] ?? from;
  const weekTo = weeks.length ? weekEndOf(weeks[weeks.length - 1]!) : to;
  const wide = pointsIn(ctx.db, weekFrom < from ? weekFrom : from, weekTo > to ? weekTo : to);
  const wideLive = wide.filter((r) => r.voidedAt === null);
  const all = wide.filter((r) => r.localDate >= from && r.localDate <= to);
  const live = all.filter((r) => r.voidedAt === null);
  const weekOf = weekOfRow(s.weekStartsOn);
  const liveByWeek = groupBy(wideLive, weekOf);
  const names = new Map(
    (wideLive.length ? ctx.db.select({ id: students.id, name: students.fullName }).from(students).where(inArray(students.id, [...new Set(wideLive.map((r) => r.studentId))])).all() : []).map((r) => [r.id, r.name]),
  );
  const nameOf = (id: string) => names.get(id) ?? '';
  const lastClass = new Map<string, string>();
  for (const r of [...live].sort((a, b) => a.occurredAt - b.occurredAt)) lastClass.set(r.studentId, r.classNameSnapshot);

  // Winners per week: the podium (dense ranks 1–3) as the board showed it, every tied student listed.
  const winnerRows = weeks.flatMap((w) => {
    const rows = liveByWeek.get(w) ?? NONE;
    const weekClass = new Map<string, string>();
    for (const r of [...rows].sort((a, b) => a.occurredAt - b.occurredAt)) weekClass.set(r.studentId, r.classNameSnapshot);
    const places = podium(
      [...totalsByStudent(rows)].map(([id, points]) => ({ student: id, points })),
      nameOf,
    );
    return places.flatMap((p) =>
      p.students.map((id) => ({ key: `${w}:${p.rank}:${id}`, cells: [range(w, weekEndOf(w)), n(p.rank), student({ id, fullName: nameOf(id) }), { t: 'label' as const, v: raw(weekClass.get(id) ?? '') }, n(p.points)] })),
    );
  });

  // Totals per class and week: every class that took part or is taking part now, 0 included (SSP-3).
  const classMap = new Map<string, string>();
  for (const c of participatingClasses(ctx.db, ctx.now(), s)) classMap.set(c.id, c.name);
  for (const r of wideLive) if (!classMap.has(r.classIdSnapshot)) classMap.set(r.classIdSnapshot, r.classNameSnapshot);
  const classList = [...classMap].map(([id, name]) => ({ id, name }));
  const classWeekRows = weeks.flatMap((w) =>
    classTotals(classList, (liveByWeek.get(w) ?? NONE).map((r) => ({ classId: r.classIdSnapshot }))).map((c) => ({
      key: `${w}:${c.classId}`,
      cells: [range(w, weekEndOf(w)), { t: 'label' as const, v: raw(c.name) }, n(c.points)],
    })),
  );

  // Per scorer: points given, taken back (own undo or voided by an administrator), students reached.
  const linkIds = [...new Set(all.map((r) => r.scorerLinkId))];
  const labels = new Map((linkIds.length ? ctx.db.select({ id: scorerLinks.id, label: scorerLinks.label }).from(scorerLinks).where(inArray(scorerLinks.id, linkIds)).all() : []).map((r) => [r.id, r.label]));
  const byScorer = groupBy(all, (r) => r.scorerLinkId);
  const scorerRows = linkIds
    .map((id) => {
      const mine = byScorer.get(id) ?? NONE;
      const ok = mine.filter((r) => r.voidedAt === null);
      return { id, label: labels.get(id) ?? '', given: ok.length, voided: mine.length - ok.length, reached: new Set(ok.map((r) => r.studentId)).size };
    })
    .sort((a, b) => compareNames(a.label, b.label))
    .map((x) => ({ key: x.id, cells: [{ t: 'label' as const, v: raw(x.label) }, n(x.given), n(x.voided), n(x.reached)] }));

  // Per student: points in the period and the number of weeks with a point.
  const totals = totalsByStudent(live);
  const liveByStudent = groupBy(live, (r) => r.studentId);
  const studentRows = [...totals]
    .sort((a, b) => b[1] - a[1] || compareNames(nameOf(a[0]), nameOf(b[0])))
    .map(([id, points]) => ({
      key: id,
      cells: [student({ id, fullName: nameOf(id) }), { t: 'label' as const, v: raw(lastClass.get(id) ?? '') }, n(points), n(new Set((liveByStudent.get(id) ?? NONE).map(weekOf)).size, weeks.length)],
    }));

  return {
    key: 'superSpeakers',
    title: key('speakers.history.title'),
    intro: key('speakers.history.intro'),
    metrics: [
      { key: 'points', label: key('speakers.history.points'), cell: n(live.length) },
      { key: 'students', label: key('speakers.history.students'), cell: n(totals.size) },
      { key: 'voided', label: key('speakers.history.voided'), cell: n(all.length - live.length) },
      { key: 'weeks', label: key('speakers.history.weeks'), cell: n(weeks.length) },
    ],
    tables: [
      table({
        key: 'winners',
        title: key('speakers.history.winners'),
        note: key('speakers.history.winnersNote'),
        columns: [col('week', key('speakers.history.week')), col('place', key('speakers.history.place'), true), col('student', key('report.col.student')), col('class', key('speakers.history.class')), col('points', key('speakers.history.points'), true)],
        rows: winnerRows,
      }),
      table({
        key: 'classes',
        title: key('speakers.history.byClass'),
        columns: [col('week', key('speakers.history.week')), col('class', key('speakers.history.class')), col('points', key('speakers.history.points'), true)],
        rows: classWeekRows,
      }),
      table({
        key: 'scorers',
        title: key('speakers.history.byScorer'),
        columns: [col('scorer', key('speakers.history.scorer')), col('given', key('speakers.history.points'), true), col('voided', key('speakers.history.voided'), true), col('reached', key('speakers.history.students'), true)],
        rows: scorerRows,
        chart: { kind: 'bar', labelColumn: 'scorer', valueColumns: ['given'] },
      }),
      table({
        key: 'students',
        title: key('speakers.history.byStudent'),
        columns: [col('student', key('report.col.student')), col('class', key('speakers.history.class')), col('points', key('speakers.history.points'), true), col('weeks', key('speakers.history.weeksWithPoints'), true)],
        rows: studentRows,
      }),
    ],
    notes: [key('speakers.history.resetNote')],
  };
}

// ---------------------------------------------------------------- S11 report hooks (class+subject)
/** Shown in the badge subject's reports; in every subject's when the school has no such subject. */
function appliesTo(db: Db, scope: ReportScope): boolean {
  const subj = badgeSubject(db);
  return subj === null || subj.id === scope.context.subjectId;
}

const classPoints = (db: Db, scope: ReportScope, ids: readonly string[]) =>
  pointsIn(db, scope.from, scope.to, ids).filter((r) => r.voidedAt === null && r.classIdSnapshot === scope.cls.id);

/** The class+subject report section: points per student and per week, earned while in this class. */
export function speakersReportSection(ctx: RequestContext, scope: ReportScope): ReportSectionData | null {
  if (!appliesTo(ctx.db, scope)) return null;
  const ids = scopeIds(scope);
  const rows = classPoints(ctx.db, scope, ids);
  const s = getSettings(ctx.db);
  const weeks = weeksOf(scope.from, scope.to < scope.today ? scope.to : scope.today, s.weekStartsOn);
  const weekOf = weekOfRow(s.weekStartsOn);
  const totals = totalsByStudent(rows);
  const byWeek = groupBy(rows, weekOf);
  const byStudent = groupBy(rows, (r) => r.studentId);
  // Asked once per student and week by each table: worked out once.
  const enrolledMemo = new Map<string, boolean>();
  const enrolledIn = (id: string, w: string) => {
    const k = `${id}|${w}`;
    let v = enrolledMemo.get(k);
    if (v === undefined) {
      v = false;
      for (let d = w; d <= weekEndOf(w); d = nextDay(d))
        if (d >= scope.from && d <= scope.to && scope.enrolledOn(id, d)) {
          v = true;
          break;
        }
      enrolledMemo.set(k, v);
    }
    return v;
  };
  return {
    key: 'superSpeakers',
    title: key('speakers.report.title'),
    intro: key('speakers.report.intro'),
    metrics: [
      { key: 'points', label: key('speakers.history.points'), cell: n(rows.length) },
      { key: 'students', label: key('speakers.report.studentsWithPoints'), cell: n(totals.size, scope.students.length) },
    ],
    tables: [
      table({
        key: 'students',
        title: key('speakers.history.byStudent'),
        note: key('speakers.report.studentsNote'),
        columns: [col('student', key('report.col.student')), col('points', key('speakers.history.points'), true), col('weeks', key('speakers.history.weeksWithPoints'), true)],
        rows: scope.students.map((st) => {
          const inWeeks = weeks.filter((w) => enrolledIn(st.id, w)).length;
          const mine = byStudent.get(st.id) ?? NONE;
          return { key: st.id, cells: inWeeks ? [student(st), n(mine.length), n(new Set(mine.map(weekOf)).size, inWeeks)] : [student(st), NA, NA] };
        }),
        chart: { kind: 'bar', labelColumn: 'student', valueColumns: ['points'] },
      }),
      table({
        key: 'weeks',
        title: key('speakers.report.byWeek'),
        columns: [col('week', key('speakers.history.week')), col('points', key('speakers.history.points'), true), col('students', key('speakers.report.studentsWithPoints'), true)],
        rows: weeks.map((w) => {
          const inWeek = byWeek.get(w) ?? NONE;
          const enrolled = scope.students.filter((st) => enrolledIn(st.id, w)).length;
          return { key: w, cells: [range(w, weekEndOf(w)), n(inWeek.length), n(new Set(inWeek.map((r) => r.studentId)).size, enrolled)] };
        }),
      }),
    ],
    notes: [key('speakers.history.resetNote')],
  };
}

/** One timeline line per day with points (count only; no scorer names). */
export function speakersTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  if (!appliesTo(ctx.db, scope)) return [];
  const rows = classPoints(ctx.db, scope, [studentId]);
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.localDate, (byDay.get(r.localDate) ?? 0) + 1);
  return [...byDay]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, at: null, module: 'superSpeakers', what: key('speakers.timeline.points', { count }), detail: null }));
}
