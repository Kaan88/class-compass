/**
 * School-wide usage report for administrators (RPT-1, RPT-6). Counts per class+subject and per
 * teacher only: no student names, no notes, no private teacher notes, no Secret Student choices.
 * Each count has what it is out of where one exists (RPT-5); "not recorded" when nothing was.
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import { schoolDaysBetween, daysBetween } from '../../../domain/periods.ts';
import { MAX_REPORT_DAYS, type ReportSection, type UsageReport } from '../../../shared/contracts/reports.ts';
import { compareNames } from '../../../shared/text/turkish.ts';
import { attendanceDaily, classes, counterEvents, homeworkAssignments, lessons, schoolYears, subjects, teachingContexts, users } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { closedDatesBetween } from '../school/closures.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { CLOSED, col, countOrNr, key, lbl, n, raw, table, text } from './cells.ts';

/** Default period: the school year that contains today (else the newest), from its start to today. */
export function usageRange(ctx: RequestContext, from?: string, to?: string): { from: string; to: string; today: string } {
  const today = localDate(ctx.now(), getSchoolSettings(ctx.db).timezone);
  const years = ctx.db.select().from(schoolYears).orderBy(asc(schoolYears.startsOn)).all();
  const year = years.find((y) => y.startsOn <= today && today <= y.endsOn) ?? years[years.length - 1];
  const f = from ?? year?.startsOn ?? today;
  const t = to ?? (year && today > year.endsOn ? year.endsOn : today);
  if (f > t) throw new AppError('VALIDATION', 'The start date is after the end date', { reason: 'RANGE_INVALID' });
  if (daysBetween(f, t) > MAX_REPORT_DAYS) throw new AppError('VALIDATION', 'The period is too long', { reason: 'RANGE_TOO_LONG' });
  return { from: f, to: t, today };
}

export function usageReport(ctx: RequestContext, input: { from?: string | undefined; to?: string | undefined }): UsageReport {
  const { from, to, today } = usageRange(ctx, input.from, input.to);
  const ctxRows = ctx.db
    .select({ c: teachingContexts, cls: classes, subjectName: subjects.name, teacher: users.displayName })
    .from(teachingContexts)
    .innerJoin(classes, eq(classes.id, teachingContexts.classId))
    .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
    .innerJoin(users, eq(users.id, teachingContexts.teacherId))
    .all();
  const held = ctx.db
    .select({ id: lessons.id, contextId: lessons.contextId, localDate: lessons.localDate })
    .from(lessons)
    .where(and(eq(lessons.status, 'ended'), gte(lessons.localDate, from), lte(lessons.localDate, to)))
    .all();
  const contextIds = ctxRows.map((r) => r.c.id);
  const heldIds = held.map((l) => l.id);
  const taps = heldIds.length ? ctx.db.select({ contextId: counterEvents.contextId, voidedAt: counterEvents.voidedAt, lessonId: counterEvents.lessonId }).from(counterEvents).where(inArray(counterEvents.lessonId, heldIds)).all() : [];
  const homework = contextIds.length
    ? ctx.db
        .select({ contextId: homeworkAssignments.contextId })
        .from(homeworkAssignments)
        .where(and(inArray(homeworkAssignments.contextId, contextIds), gte(homeworkAssignments.dueOn, from), lte(homeworkAssignments.dueOn, to)))
        .all()
    : [];
  const recorded = ctx.db
    .select({ classId: attendanceDaily.classId, localDate: attendanceDaily.localDate })
    .from(attendanceDaily)
    .where(and(gte(attendanceDaily.localDate, from), lte(attendanceDaily.localDate, to)))
    .all();
  const recordedDays = new Map<string, Set<string>>();
  for (const r of recorded) recordedDays.set(r.classId, (recordedDays.get(r.classId) ?? new Set<string>()).add(r.localDate));
  // Closure days of the holiday calendar are not school days (S25b, D-186).
  const schoolDays = schoolDaysBetween({ from, to }, today, undefined, closedDatesBetween(ctx.db, from, to));
  // Weekdays up to today, all of them closures: "no school", never x / 0.
  const schoolDaySet = new Set(schoolDays);
  const allClosed = !schoolDays.length && schoolDaysBetween({ from, to }, today).length > 0;

  const rows = ctxRows
    .filter((r) => held.some((l) => l.contextId === r.c.id) || r.c.endedAt === null)
    .sort((a, b) => compareNames(a.cls.name, b.cls.name) || (a.subjectName.en ?? '').localeCompare(b.subjectName.en ?? '') || a.teacher.localeCompare(b.teacher));
  const contextsTable = table({
    key: 'contexts',
    title: key('report.usage.byContext'),
    columns: [
      col('class', key('report.col.class')),
      col('subject', key('report.col.subject')),
      col('teacher', key('report.col.teacher')),
      col('lessons', key('report.col.lessonsHeld'), true),
      col('attendance', key('report.attendance.coverage'), true),
      col('counterTaps', key('report.usage.counterTaps'), true),
      col('homework', key('report.homework.assignmentsDue'), true),
    ],
    rows: rows.map((r) => {
      const mineHeld = held.filter((l) => l.contextId === r.c.id);
      const days = recordedDays.get(r.cls.id) ?? new Set<string>();
      const live = taps.filter((t) => t.contextId === r.c.id && t.voidedAt === null).length;
      return {
        key: r.c.id,
        cells: [
          lbl(raw(r.cls.name)),
          lbl(text(r.subjectName)),
          lbl(raw(r.teacher)),
          n(mineHeld.length),
          allClosed ? CLOSED : n(schoolDays.filter((d) => days.has(d)).length, schoolDays.length),
          countOrNr(live, mineHeld.length > 0),
          n(homework.filter((h) => h.contextId === r.c.id).length),
        ],
      };
    }),
    chart: { kind: 'bar', labelColumn: 'class', valueColumns: ['lessons'] },
  });
  const teachers = [...new Set(rows.map((r) => r.c.teacherId))];
  const teacherTable = table({
    key: 'teachers',
    title: key('report.usage.byTeacher'),
    columns: [col('teacher', key('report.col.teacher')), col('contexts', key('report.usage.contexts'), true), col('lessons', key('report.col.lessonsHeld'), true), col('days', key('report.overview.lessonDays'), true)],
    rows: teachers
      .map((id) => {
        const mine = rows.filter((r) => r.c.teacherId === id);
        const ids = new Set(mine.map((r) => r.c.id));
        const ls = held.filter((l) => ids.has(l.contextId));
        return { key: id, name: mine[0]!.teacher, cells: [lbl(raw(mine[0]!.teacher)), n(mine.length), n(ls.length), allClosed ? CLOSED : n(new Set(ls.map((l) => l.localDate).filter((d) => schoolDaySet.has(d))).size, schoolDays.length)] };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ key: k, cells }) => ({ key: k, cells })),
  });
  const section: ReportSection = {
    key: 'usage',
    module: null,
    title: key('report.section.usage'),
    intro: key('report.usage.intro'),
    metrics: [
      { key: 'lessons', label: key('report.overview.lessonsHeld'), cell: n(held.length) },
      { key: 'schoolDays', label: key('report.usage.schoolDays'), cell: allClosed ? CLOSED : n(schoolDays.length) },
      { key: 'contexts', label: key('report.usage.contexts'), cell: n(rows.length) },
    ],
    tables: [contextsTable, teacherTable],
    notes: [key('report.usage.privacyNote'), key('report.attendance.holidaysNote')],
  };
  return { schoolName: getSchoolSettings(ctx.db).schoolName, from, to, generatedAt: ctx.now(), sections: [section] };
}
