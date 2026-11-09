/**
 * Who may see which report (RPT-6, ACC-4, ACC-10) and what a report covers (RPT-2).
 * - A teacher sees the reports of their own class+subject assignments, including ended ones and
 *   archived school years (read-only history, DAT-1); never another teacher's. An ENDED assignment
 *   only covers the days the teacher held it (activeFrom..endedAt in the class timezone): nothing
 *   recorded after it ended (a successor's goals, attendance, new classmates) is shown (ACC-4, ACC-10).
 * - An administrator sees every class+subject (school-wide reporting).
 * Both access classes are PIN-gated in classroom mode (423 before anything else, PIN-8).
 */
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import { daysBetween } from '../../../domain/periods.ts';
import { MAX_REPORT_DAYS, type ReportContextInfo } from '../../../shared/contracts/reports.ts';
import { compareNames, sortByName } from '../../../shared/text/turkish.ts';
import type { Db } from '../../db/client.ts';
import { enrolments, lessons, students, subjects, teachingContexts, terms, users } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import type { ReportScope } from '../manifest.ts';
import { effectiveTimezone, getClass, getSchoolSettings, getYear, todayFor, type ContextRow } from '../school/policy.ts';

export type Viewer = 'teacher' | 'admin';

/** The context, if the signed-in user may see its reports. */
export function reportableContext(ctx: RequestContext, contextId: string, viewer: Viewer): ContextRow {
  const row = ctx.db.select().from(teachingContexts).where(eq(teachingContexts.id, contextId)).get();
  if (viewer === 'admin') {
    if (!row) throw notFound('Class and subject');
    return row;
  }
  if (!row || row.teacherId !== ctx.user?.id) throw new AppError('FORBIDDEN', 'Not your class and subject');
  return row;
}

export function contextInfo(ctx: Pick<RequestContext, 'db' | 'now'>, c: ContextRow): ReportContextInfo {
  const cls = getClass(ctx.db, c.classId);
  const year = getYear(ctx.db, cls.schoolYearId);
  const subject = ctx.db.select().from(subjects).where(eq(subjects.id, c.subjectId)).get();
  const teacher = ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, c.teacherId)).get();
  const settings = getSchoolSettings(ctx.db);
  const termRows = ctx.db.select().from(terms).where(eq(terms.schoolYearId, year.id)).orderBy(asc(terms.startsOn)).all();
  return {
    id: c.id,
    classId: cls.id,
    className: cls.name,
    classNames: [],
    subjectName: subject?.name ?? {},
    teacherName: teacher?.name ?? '',
    year: { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn, archived: year.archivedAt !== null },
    terms: termRows.map((t) => ({ name: t.name, startsOn: t.startsOn, endsOn: t.endsOn })),
    timezone: effectiveTimezone(ctx.db, cls),
    today: todayFor(ctx, cls),
    weekStartsOn: settings.weekStartsOn,
    ended: c.endedAt !== null || cls.archivedAt !== null || year.archivedAt !== null,
  };
}

/** Contexts for the report filter: the teacher's own (incl. ended), or all for an administrator. Current first. */
export function listReportContexts(ctx: RequestContext, viewer: Viewer): ReportContextInfo[] {
  const rows = viewer === 'admin' ? ctx.db.select().from(teachingContexts).all() : ctx.db.select().from(teachingContexts).where(eq(teachingContexts.teacherId, ctx.user!.id)).all();
  return rows
    .map((r) => contextInfo(ctx, r))
    .sort((a, b) => Number(a.ended) - Number(b.ended) || b.year.startsOn.localeCompare(a.year.startsOn) || compareNames(a.className, b.className) || (a.subjectName.en ?? '').localeCompare(b.subjectName.en ?? '') || a.teacherName.localeCompare(b.teacherName));
}

/**
 * S14e2 (D-154): the teacher's class+subjects whose reports can show this student: the student was
 * in the class at some time in the school year (for an ended assignment, while the teacher held it).
 * Same order as the report filter (current first).
 */
export function studentReportContexts(ctx: RequestContext, studentId: string): ReportContextInfo[] {
  const spans = ctx.db.select({ classId: enrolments.classId, fromDate: enrolments.fromDate, toDate: enrolments.toDate }).from(enrolments).where(eq(enrolments.studentId, studentId)).all();
  if (!spans.length) return [];
  const own = new Map(ctx.db.select().from(teachingContexts).where(eq(teachingContexts.teacherId, ctx.user!.id)).all().map((c) => [c.id, c]));
  return listReportContexts(ctx, 'teacher').filter((info) => {
    const held = heldPeriod(own.get(info.id)!, 'teacher', info.timezone);
    const from = held && held.from > info.year.startsOn ? held.from : info.year.startsOn;
    const to = held && held.to < info.year.endsOn ? held.to : info.year.endsOn;
    // toDate is exclusive (D-021): an enrolment that ended on `from` was over before the period began.
    return spans.some((s) => s.classId === info.classId && s.fromDate <= to && (s.toDate === null || s.toDate > from));
  });
}

/**
 * The period of a report: the given dates, by default the school year up to today. Clamped to the
 * school year (enrolments and school days are per year); at most MAX_REPORT_DAYS long.
 */
export function reportRange(info: ReportContextInfo, from?: string, to?: string, held?: { from: string; to: string } | null): { from: string; to: string } {
  const y = info.year;
  const defTo = info.today < y.startsOn ? y.startsOn : info.today > y.endsOn ? y.endsOn : info.today;
  let f = from ?? y.startsOn;
  let t = to ?? defTo;
  if (f > t) throw new AppError('VALIDATION', 'The start date is after the end date', { reason: 'RANGE_INVALID' });
  if (f < y.startsOn) f = y.startsOn;
  if (t > y.endsOn) t = y.endsOn;
  if (f > t) throw new AppError('VALIDATION', 'The period is outside this school year', { reason: 'RANGE_OUTSIDE_YEAR' });
  if (held) {
    if (f < held.from) f = held.from;
    if (t > held.to) t = held.to;
    if (f > t) throw new AppError('VALIDATION', 'The period is outside the time you taught this class and subject', { reason: 'RANGE_OUTSIDE_ASSIGNMENT' });
  }
  if (daysBetween(f, t) > MAX_REPORT_DAYS) throw new AppError('VALIDATION', 'The period is too long', { reason: 'RANGE_TOO_LONG' });
  return { from: f, to: t };
}

/**
 * The days a teacher held an ended assignment (null = no limit: an administrator, or an assignment
 * still running, whose teacher can see the class anyway).
 */
export function heldPeriod(context: ContextRow, viewer: Viewer, timezone: string): { from: string; to: string } | null {
  if (viewer !== 'teacher' || context.endedAt === null) return null;
  return { from: localDate(context.activeFrom, timezone), to: localDate(context.endedAt, timezone) };
}

/** Enrolment intervals of this class overlapping [from, to] (toDate exclusive, D-021). */
function classEnrolments(db: Db, classId: string, from: string, to: string) {
  return db
    .select({ studentId: enrolments.studentId, fromDate: enrolments.fromDate, toDate: enrolments.toDate })
    .from(enrolments)
    .where(and(eq(enrolments.classId, classId), lte(enrolments.fromDate, to), or(isNull(enrolments.toDate), gt(enrolments.toDate, from))))
    .all();
}

export function buildScope(ctx: RequestContext, contextId: string, viewer: Viewer, input: { from?: string | undefined; to?: string | undefined; studentId?: string | undefined }): { scope: ReportScope; info: ReportContextInfo } {
  const context = reportableContext(ctx, contextId, viewer);
  const info = contextInfo(ctx, context);
  const { from, to } = reportRange(info, input.from, input.to, heldPeriod(context, viewer, info.timezone));
  const cls = getClass(ctx.db, context.classId);
  const year = getYear(ctx.db, cls.schoolYearId);
  const spans = classEnrolments(ctx.db, cls.id, from, to);
  const ids = [...new Set(spans.map((s) => s.studentId))];
  let people = ids.length ? ctx.db.select().from(students).where(inArray(students.id, ids)).all() : [];
  people = sortByName(people, (s) => s.fullName);
  let studentId: string | null = null;
  if (input.studentId) {
    const one = people.find((p) => p.id === input.studentId);
    if (!one) throw notFound('Student');
    people = [one];
    studentId = one.id;
  }
  const bySt = new Map<string, Array<{ fromDate: string; toDate: string | null }>>();
  for (const s of spans) bySt.set(s.studentId, [...(bySt.get(s.studentId) ?? []), s]);
  const enrolledOn = (sid: string, d: string) => (bySt.get(sid) ?? []).some((s) => s.fromDate <= d && (s.toDate === null || s.toDate > d));
  const held = ctx.db
    .select()
    .from(lessons)
    .where(and(eq(lessons.contextId, context.id), eq(lessons.status, 'ended'), gte(lessons.localDate, from), lte(lessons.localDate, to)))
    .orderBy(asc(lessons.localDate), asc(lessons.startedAt))
    .all();
  info.classNames = [...new Set(held.map((l) => l.classNameSnapshot))];
  const scope: ReportScope = {
    context,
    cls,
    year,
    from,
    to,
    today: info.today,
    timezone: info.timezone,
    weekStartsOn: info.weekStartsOn,
    viewer,
    studentId,
    students: people,
    enrolledOn,
    lessons: held,
  };
  return { scope, info };
}

