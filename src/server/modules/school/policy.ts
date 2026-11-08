/**
 * Resource-authorisation helpers (ACC-4, ACC-10, DAT-1) reused by every later stage. Access classes
 * only say *who* may call an endpoint; these say *which rows* they may touch.
 */
import { and, eq, gt, isNull, lte, or, type SQL } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import type { Db } from '../../db/client.ts';
import { classes, enrolments, schoolSettings, schoolYears, teachingContexts } from '../../db/schema.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { AppError, notFound } from '../../lib/errors.ts';

export type ClassRow = typeof classes.$inferSelect;
export type ContextRow = typeof teachingContexts.$inferSelect;
export type YearRow = typeof schoolYears.$inferSelect;

/** The single settings row (created at startup by ensureSchoolDefaults). */
export function getSchoolSettings(db: Db) {
  const s = db.select().from(schoolSettings).where(eq(schoolSettings.id, 1)).get();
  if (!s) throw new Error('school_settings row missing: ensureSchoolDefaults must run at startup');
  return s;
}

export const effectiveTimezone = (db: Db, cls: Pick<ClassRow, 'timezone'> | null) => cls?.timezone ?? getSchoolSettings(db).timezone;

/** Today's local date for a class (or the school) using the injectable clock. */
export const todayFor = (deps: Pick<AppDeps, 'db' | 'now'>, cls: Pick<ClassRow, 'timezone'> | null) => localDate(deps.now(), effectiveTimezone(deps.db, cls));

/**
 * An enrolment counts on local day `date` when fromDate <= date < toDate (toDate exclusive, open
 * when null) — D-021. Rosters use this with `todayFor(class)`, so a move or promotion dated in the
 * future leaves the student in the old class until that day.
 */
export const enrolmentActiveOn = (date: string): SQL => and(lte(enrolments.fromDate, date), or(isNull(enrolments.toDate), gt(enrolments.toDate, date)))!;

/** Not yet ended on `date` (current or scheduled): toDate is null or after `date`. */
export const enrolmentNotEndedOn = (date: string): SQL => or(isNull(enrolments.toDate), gt(enrolments.toDate, date))!;

/** The calendar day after an ISO date (used for exclusive end dates). */
export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Default start date for a new enrolment in `cls`: today in the class timezone, clamped into the
 * class's school year (a class of next year starts on its first day; of a past year, on its last).
 */
export function defaultEnrolmentDate(deps: Pick<AppDeps, 'db' | 'now'>, cls: ClassRow): string {
  const today = todayFor(deps, cls);
  const y = getYear(deps.db, cls.schoolYearId);
  return today < y.startsOn ? y.startsOn : today > y.endsOn ? y.endsOn : today;
}

export function getClass(db: Db, classId: string): ClassRow {
  const c = db.select().from(classes).where(eq(classes.id, classId)).get();
  if (!c) throw notFound('Class');
  return c;
}

export function getYear(db: Db, yearId: string): YearRow {
  const y = db.select().from(schoolYears).where(eq(schoolYears.id, yearId)).get();
  if (!y) throw notFound('School year');
  return y;
}

/** Archived school years are read-only (DAT-1). */
export function assertYearWritable(db: Db, yearId: string): YearRow {
  const y = getYear(db, yearId);
  if (y.archivedAt) throw new AppError('CONFLICT', 'This school year is archived and read-only', { reason: 'YEAR_ARCHIVED' });
  return y;
}

/** A class is writable when neither it nor its school year is archived. */
export function assertClassWritable(db: Db, cls: ClassRow): void {
  assertYearWritable(db, cls.schoolYearId);
  if (cls.archivedAt) throw new AppError('CONFLICT', 'This class is archived and read-only', { reason: 'CLASS_ARCHIVED' });
}

/** The same rule as `assertClassWritable`, as a boolean (for "at least one of these classes is writable"). */
export const isClassWritable = (db: Db, cls: ClassRow): boolean => cls.archivedAt === null && getYear(db, cls.schoolYearId).archivedAt === null;

function teacherId(ctx: RequestContext): string {
  if (!ctx.user || ctx.user.role !== 'teacher') throw new AppError('FORBIDDEN', 'Teacher account required');
  return ctx.user.id;
}

/** The signed-in teacher has an active teaching context in this class (any subject). Returns the class. */
export function assertTeachesClass(ctx: RequestContext, classId: string): ClassRow {
  const tid = teacherId(ctx);
  const ok = ctx.db
    .select({ id: teachingContexts.id })
    .from(teachingContexts)
    .where(and(eq(teachingContexts.teacherId, tid), eq(teachingContexts.classId, classId), isNull(teachingContexts.endedAt)))
    .get();
  if (!ok) throw new AppError('FORBIDDEN', 'You are not assigned to this class');
  return getClass(ctx.db, classId);
}

/** The context exists, belongs to the signed-in teacher and is active (ACC-10). Returns it. */
export function assertOwnsContext(ctx: RequestContext, contextId: string): ContextRow {
  const tid = teacherId(ctx);
  const row = ctx.db.select().from(teachingContexts).where(eq(teachingContexts.id, contextId)).get();
  if (!row || row.teacherId !== tid || row.endedAt !== null) throw new AppError('FORBIDDEN', 'Not your class and subject');
  return row;
}
