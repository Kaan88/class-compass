/**
 * Counter reports (RPT-3, RPT-5, CNT-7/8, DAT-6). For every counter of the class+subject, separately
 * (reminder totals are never added up across counters or turned into a score):
 * - per lesson: the lesson total = live events of that lesson (CNT-8), class-only taps, undone taps;
 * - per week: explicit week ranges in the class timezone, lessons held, total (trend);
 * - per student: weekly counts (a week without lessons is "not recorded", a week outside the class
 *   "not in the class", never 0), the period total, and reminders per attended lesson shown as the
 *   numerator / denominator, counting only lessons whose attendance was recorded.
 * Only lessons that were held (ended) count; labels are the ones used at the time, with today's
 * label when it was renamed since (DAT-6).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { addDays } from '../../../domain/dates.ts';
import { weekStartsBetween } from '../../../domain/periods.ts';
import type { ReportSectionData, ReportTable, TimelineEvent } from '../../../shared/contracts/reports.ts';
import type { Db } from '../../db/client.ts';
import { counterEvents, counters, type CounterLabelSnapshotJson } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { lessonAttendance } from '../attendance/report.ts';
import { isModuleEnabled } from '../school/modules.ts';
import type { ReportScope } from '../manifest.ts';
import { col, countOrNr, date, key, n, NA, NR, range, scopeIds, student, table, text } from '../reports/cells.ts';

/** Most weekly columns in the per-student table (the newest weeks of the period). */
export const MAX_WEEK_COLUMNS = 16;

type EventRow = typeof counterEvents.$inferSelect;
type CounterRow = typeof counters.$inferSelect;

function eventsOf(db: Db, counterIds: string[], lessonIds: string[]): EventRow[] {
  if (!counterIds.length || !lessonIds.length) return [];
  return db
    .select()
    .from(counterEvents)
    .where(and(inArray(counterEvents.counterId, counterIds), inArray(counterEvents.lessonId, lessonIds)))
    .orderBy(asc(counterEvents.occurredAt))
    .all();
}

/** Labels used in the period (newest event), with the current labels as the rename hint. */
function labelsOf(c: CounterRow, events: EventRow[]): CounterLabelSnapshotJson {
  const last = [...events].reverse().find((e) => e.counterId === c.id);
  return last?.labelSnapshotJson ?? { main: c.labelsJson.main, individual: c.labelsJson.individual };
}

function counterTables(ctx: RequestContext, scope: ReportScope, c: CounterRow, events: EventRow[], attendance: ReturnType<typeof lessonAttendance>): ReportTable[] {
  const snap = labelsOf(c, events);
  const main = text(snap.main, c.labelsJson.main);
  const individual = text(snap.individual, c.labelsJson.individual);
  const mine = events.filter((e) => e.counterId === c.id);
  const live = mine.filter((e) => e.voidedAt === null);
  const tables: ReportTable[] = [];

  if (!scope.studentId) {
    tables.push(
      table({
        key: `lessons-${c.id}`,
        title: key('report.counters.perLesson'),
        note: key('report.counters.perLessonNote'),
        columns: [col('date', key('report.col.date')), col('total', key('report.counters.lessonTotal'), true), col('classOnly', key('report.counters.classOnly'), true), col('undone', key('report.counters.undone'), true)],
        rows: scope.lessons.map((l) => {
          const inLesson = mine.filter((e) => e.lessonId === l.id);
          const liveIn = inLesson.filter((e) => e.voidedAt === null);
          return { key: l.id, cells: [date(l.localDate), n(liveIn.length), n(liveIn.filter((e) => e.studentId === null).length), n(inLesson.length - liveIn.length)] };
        }),
        chart: { kind: 'bar', labelColumn: 'date', valueColumns: ['total'] },
      }),
    );
    const weeks = weekStartsBetween({ from: scope.from, to: scope.to }, scope.weekStartsOn);
    tables.push(
      table({
        key: `weeks-${c.id}`,
        title: key('report.counters.perWeek'),
        columns: [col('week', key('report.col.week')), col('lessons', key('report.col.lessonsHeld'), true), col('total', key('report.counters.weekTotal'), true)],
        rows: weeks.map((w) => {
          const we = addDays(w, 6);
          const ls = scope.lessons.filter((l) => l.localDate >= w && l.localDate <= we);
          const lsIds = new Set(ls.map((l) => l.id));
          return { key: w, cells: [range(w, we), n(ls.length), countOrNr(live.filter((e) => lsIds.has(e.lessonId)).length, ls.length > 0)] };
        }),
        chart: { kind: 'line', labelColumn: 'week', valueColumns: ['total'] },
      }),
    );
  }

  if (c.scope !== 'lesson') {
    const allWeeks = weekStartsBetween({ from: scope.from, to: scope.to }, scope.weekStartsOn);
    const weeks = allWeeks.slice(-MAX_WEEK_COLUMNS);
    const lessonsInWeek = (w: string) => scope.lessons.filter((l) => l.localDate >= w && l.localDate <= addDays(w, 6));
    const rows = scope.students.map((s) => {
      const theirs = live.filter((e) => e.studentId === s.id);
      const weekCells = weeks.map((w) => {
        const we = addDays(w, 6);
        let inClass = false;
        for (let d = w; d <= we; d = addDays(d, 1)) if (d >= scope.from && d <= scope.to && scope.enrolledOn(s.id, d)) inClass = true;
        if (!inClass) return NA;
        const ls = lessonsInWeek(w);
        if (!ls.length) return NR;
        const lsIds = new Set(ls.map((l) => l.id));
        return n(theirs.filter((e) => lsIds.has(e.lessonId)).length);
      });
      // Reminders per attended lesson: only lessons whose attendance for this student was recorded.
      let attended = 0;
      let inAttended = 0;
      let unrecorded = 0;
      let enrolledLessons = 0;
      for (const l of scope.lessons) {
        const st = attendance.get(`${l.id}|${s.id}`);
        if (st === undefined) continue;
        enrolledLessons += 1;
        if (st === 'not_recorded') unrecorded += 1;
        else if (st === 'present' || st === 'late') {
          attended += 1;
          inAttended += theirs.filter((e) => e.lessonId === l.id).length;
        }
      }
      const total = enrolledLessons ? n(theirs.length) : NA;
      const perAttended = attended ? n(inAttended, attended) : enrolledLessons - unrecorded > 0 ? n(0, 0) : NR;
      return { key: s.id, cells: [student(s), ...weekCells, total, perAttended, enrolledLessons ? n(unrecorded, enrolledLessons) : NA] };
    });
    tables.push(
      table({
        key: `students-${c.id}`,
        title: key('report.counters.perStudent'),
        note: allWeeks.length > weeks.length ? key('report.counters.weeksCapped', { count: weeks.length, from: weeks[0]!, to: addDays(weeks[weeks.length - 1]!, 6) }) : key('report.counters.perStudentNote'),
        columns: [
          col('student', key('report.col.student')),
          ...weeks.map((w) => col(`w-${w}`, key('report.col.weekRange', { from: w, to: addDays(w, 6) }), true)),
          col('total', key('report.counters.periodTotal'), true),
          col('perAttended', key('report.counters.perAttended'), true),
          col('unrecorded', key('report.counters.lessonsWithoutAttendance'), true),
        ],
        rows,
      }),
    );
  }
  // Each table names the counter as it was called in the period, with today's name when renamed (DAT-6).
  return tables.map((t) => ({ ...t, about: t.key.startsWith('students-') ? individual : main }));
}

export function countersSection(ctx: RequestContext, scope: ReportScope): ReportSectionData | null {
  const all = ctx.db.select().from(counters).where(eq(counters.contextId, scope.context.id)).orderBy(asc(counters.sortOrder), asc(counters.createdAt)).all();
  const lessonIds = scope.lessons.map((l) => l.id);
  const events = eventsOf(ctx.db, all.map((c) => c.id), lessonIds);
  const used = all.filter((c) => c.archivedAt === null || events.some((e) => e.counterId === c.id));
  if (!used.length) return null;
  const attendance = isModuleEnabled(ctx.db, scope.context.id, 'attendance') ? lessonAttendance(ctx.db, scope) : new Map();
  const ids = new Set(scopeIds(scope));
  return {
    key: 'counters',
    title: key('report.section.counters'),
    intro: key('report.counters.intro'),
    metrics: used.map((c) => {
      const live = events.filter((e) => e.counterId === c.id && e.voidedAt === null && (!scope.studentId || (e.studentId !== null && ids.has(e.studentId))));
      return { key: c.id, label: text(labelsOf(c, events).main, c.labelsJson.main), cell: n(live.length) };
    }),
    tables: used.flatMap((c) => counterTables(ctx, scope, c, events, attendance)),
    notes: [key('report.counters.noScore'), key('report.counters.heldOnly')],
  };
}

export function countersTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const all = ctx.db.select().from(counters).where(eq(counters.contextId, scope.context.id)).all();
  const events = eventsOf(ctx.db, all.map((c) => c.id), scope.lessons.map((l) => l.id)).filter((e) => e.studentId === studentId && e.voidedAt === null);
  const out: TimelineEvent[] = [];
  for (const l of scope.lessons) {
    for (const c of all) {
      const mine = events.filter((e) => e.lessonId === l.id && e.counterId === c.id);
      if (!mine.length) continue;
      out.push({ date: l.localDate, at: l.startedAt, module: 'counters', what: text(mine[mine.length - 1]!.labelSnapshotJson.individual, c.labelsJson.individual), detail: key('report.timeline.count', { count: mine.length }) });
    }
  }
  return out;
}
