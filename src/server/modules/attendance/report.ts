/**
 * Attendance report section and timeline (RPT-1, RPT-3, RPT-5, ATT-2).
 * - Coverage = school days with any attendance record for the class / school days in the period
 *   (Monday–Friday up to today; there is no holiday calendar, so holidays count as school days).
 * - Per student, every school day they were in the class is present / late / absent / excused /
 *   not recorded, each shown out of those days. Not recorded is never counted as present or absent.
 * Also the lesson attendance helper other sections use ("per attended lesson", exceptions first).
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { effectiveAttendance, type AttendanceStatus, type EffectiveAttendance } from '../../../domain/attendance.ts';
import { addDays } from '../../../domain/dates.ts';
import { schoolDaysBetween, weekStartsBetween } from '../../../domain/periods.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import type { Db } from '../../db/client.ts';
import { attendanceDaily, attendanceLessonExceptions } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, key, n, NA, range, scopeIds, student, table } from '../reports/cells.ts';

const STATUSES: readonly AttendanceStatus[] = ['present', 'late', 'absent', 'excused'];

/** Daily rows of the class's students in the period: `${studentId}|${date}` → status. */
function dailyMap(db: Db, classId: string, ids: string[], from: string, to: string): Map<string, AttendanceStatus> {
  if (!ids.length) return new Map();
  const rows = db
    .select({ studentId: attendanceDaily.studentId, localDate: attendanceDaily.localDate, status: attendanceDaily.status })
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.classId, classId), inArray(attendanceDaily.studentId, ids), gte(attendanceDaily.localDate, from), lte(attendanceDaily.localDate, to)))
    .all();
  return new Map(rows.map((r) => [`${r.studentId}|${r.localDate}`, r.status]));
}

/**
 * Effective attendance of each student in each held lesson of the scope (exception › daily › not
 * recorded): `${lessonId}|${studentId}` → status. Only students enrolled on the lesson day appear.
 */
export function lessonAttendance(db: Db, scope: ReportScope): Map<string, EffectiveAttendance> {
  const ids = scopeIds(scope);
  const daily = dailyMap(db, scope.cls.id, ids, scope.from, scope.to);
  const lessonIds = scope.lessons.map((l) => l.id);
  const exc = lessonIds.length && ids.length ? db.select().from(attendanceLessonExceptions).where(and(inArray(attendanceLessonExceptions.lessonId, lessonIds), inArray(attendanceLessonExceptions.studentId, ids))).all() : [];
  const excMap = new Map(exc.map((e) => [`${e.lessonId}|${e.studentId}`, e.status]));
  const out = new Map<string, EffectiveAttendance>();
  for (const l of scope.lessons) {
    for (const sid of ids) {
      if (!scope.enrolledOn(sid, l.localDate)) continue;
      out.set(`${l.id}|${sid}`, effectiveAttendance(excMap.get(`${l.id}|${sid}`), daily.get(`${sid}|${l.localDate}`)));
    }
  }
  return out;
}

export function attendanceSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const ids = scopeIds(scope);
  const schoolDays = schoolDaysBetween({ from: scope.from, to: scope.to }, scope.today);
  const daily = dailyMap(ctx.db, scope.cls.id, ids, scope.from, scope.to);
  const recordedDays = new Set([...daily.keys()].map((k) => k.split('|')[1]!));
  const covered = schoolDays.filter((d) => recordedDays.has(d)).length;
  const perStudent = scope.students.map((s) => {
    const days = schoolDays.filter((d) => scope.enrolledOn(s.id, d));
    const counts: Record<EffectiveAttendance, number> = { present: 0, late: 0, absent: 0, excused: 0, not_recorded: 0 };
    for (const d of days) counts[daily.get(`${s.id}|${d}`) ?? 'not_recorded'] += 1;
    return { s, days: days.length, counts };
  });
  const lessonsRecorded = scope.lessons.filter((l) => ids.some((sid) => daily.has(`${sid}|${l.localDate}`))).length;
  const weeks = weekStartsBetween({ from: scope.from, to: scope.to }, scope.weekStartsOn);
  return {
    key: 'attendance',
    title: key('report.section.attendance'),
    intro: key('report.attendance.intro'),
    metrics: [
      { key: 'coverage', label: key('report.attendance.coverage'), cell: n(covered, schoolDays.length) },
      { key: 'lessonsRecorded', label: key('report.attendance.lessonsRecorded'), cell: n(lessonsRecorded, scope.lessons.length) },
    ],
    tables: [
      table({
        key: 'students',
        title: key('report.attendance.byStudent'),
        note: key('report.attendance.byStudentNote'),
        columns: [
          col('student', key('report.col.student')),
          col('days', key('report.col.schoolDaysInClass'), true),
          ...STATUSES.map((st) => col(st, key(`attendance.status.${st}`), true)),
          col('not_recorded', key('attendance.status.not_recorded'), true),
        ],
        rows: perStudent.map(({ s, days, counts }) => ({
          key: s.id,
          cells: [student(s), days ? n(days) : NA, ...[...STATUSES, 'not_recorded' as const].map((st) => (days ? n(counts[st], days) : NA))],
        })),
      }),
      table({
        key: 'weeks',
        title: key('report.attendance.byWeek'),
        columns: [
          col('week', key('report.col.week')),
          col('recordedDays', key('report.col.recordedDays'), true),
          col('present', key('attendance.status.present'), true),
          col('absent', key('attendance.status.absent'), true),
          col('late', key('attendance.status.late'), true),
          col('excused', key('attendance.status.excused'), true),
        ],
        rows: weeks.map((w) => {
          const we = addDays(w, 6);
          const wd = schoolDays.filter((d) => d >= w && d <= we);
          const tally: Record<AttendanceStatus, number> = { present: 0, late: 0, absent: 0, excused: 0 };
          for (const [k, st] of daily) {
            const d = k.split('|')[1]!;
            if (d >= w && d <= we) tally[st] += 1;
          }
          return { key: w, cells: [range(w, we), n(wd.filter((d) => recordedDays.has(d)).length, wd.length), n(tally.present), n(tally.absent), n(tally.late), n(tally.excused)] };
        }),
        chart: { kind: 'bar', labelColumn: 'week', valueColumns: ['present', 'absent', 'late', 'excused'] },
      }),
    ],
    notes: [key('report.attendance.holidaysNote')],
  };
}

export function attendanceTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  const daily = dailyMap(ctx.db, scope.cls.id, [studentId], scope.from, scope.to);
  const out: TimelineEvent[] = [];
  for (const [k, st] of daily) {
    const d = k.split('|')[1]!;
    if (st === 'present' || !scope.enrolledOn(studentId, d)) continue;
    out.push({ date: d, at: null, module: 'attendance', what: key(`attendance.status.${st}`), detail: null });
  }
  return out;
}
