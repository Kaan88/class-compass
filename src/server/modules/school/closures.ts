/**
 * School holiday calendar (S25b, D-186): an administrator's named closures (days without school) per
 * school year. The only reader and writer of `school_closures`; everything that counts school days
 * (report coverage and denominators, the Daily Assistant's week, the demo history) asks
 * `closedDatesBetween` / `closedDatesOfYear`, and the classroom asks `closureOn` for today's calm note.
 * Every change is audited in its transaction and needs a writable (not archived) school year (DAT-1).
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { z } from 'zod';
import { closedDates, closedSchoolDays, fixedHolidaysIn } from '../../../domain/holidays.ts';
import type * as C from '../../../shared/contracts/school.ts';
import { MAX_CLOSURES_PER_YEAR } from '../../../shared/contracts/school.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { normaliseName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { schoolClosures } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { conflict, invalid, notFound } from '../../lib/errors.ts';
import { assertYearWritable, getYear } from './policy.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type ClosureRow = typeof schoolClosures.$inferSelect;

const cleanName = (t: LocalizedTextValue): LocalizedTextValue => {
  const out: LocalizedTextValue = {};
  if (t.en?.trim()) out.en = normaliseName(t.en);
  if (t.tr?.trim()) out.tr = normaliseName(t.tr);
  return out;
};

function closureDto(r: ClosureRow): C.Closure {
  const span = { from: r.startsOn, to: r.endsOn };
  return { id: r.id, schoolYearId: r.schoolYearId, name: r.name, startsOn: r.startsOn, endsOn: r.endsOn, schoolDays: closedSchoolDays(span, closedDates([span])) };
}

const rowsOfYear = (db: Db, yearId: string) => db.select().from(schoolClosures).where(eq(schoolClosures.schoolYearId, yearId)).orderBy(asc(schoolClosures.startsOn), asc(schoolClosures.endsOn)).all();

export function listClosures(db: Db, yearId: string) {
  const y = getYear(db, yearId);
  return { closures: rowsOfYear(db, y.id).map(closureDto), archived: y.archivedAt !== null };
}

function assertInYear(y: { startsOn: string; endsOn: string }, startsOn: string, endsOn: string) {
  if (startsOn > endsOn) throw invalid('Start date must be on or before the end date', { reason: 'DATES_REVERSED' });
  if (startsOn < y.startsOn || endsOn > y.endsOn) throw invalid('A holiday must fall inside the school year', { reason: 'CLOSURE_OUTSIDE_YEAR' });
}

function assertRoom(db: Db, yearId: string, adding: number) {
  if (rowsOfYear(db, yearId).length + adding > MAX_CLOSURES_PER_YEAR) throw conflict('This school year has too many holidays', { reason: 'TOO_MANY_CLOSURES' });
}

export function createClosure(ctx: RequestContext, input: In<typeof C.createClosure>): C.Closure {
  return tx(ctx.db, () => {
    const y = assertYearWritable(ctx.db, input.yearId);
    assertInYear(y, input.startsOn, input.endsOn);
    assertRoom(ctx.db, y.id, 1);
    const now = ctx.now();
    const row: ClosureRow = { id: newId(), schoolYearId: y.id, name: cleanName(input.name), startsOn: input.startsOn, endsOn: input.endsOn, createdAt: now, updatedAt: now };
    ctx.db.insert(schoolClosures).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'closure.create', entity: 'school_closure', entityId: row.id, after: { yearId: y.id, name: row.name, startsOn: row.startsOn, endsOn: row.endsOn } }, now);
    return closureDto(row);
  });
}

function getClosure(db: Db, id: string): ClosureRow {
  const r = db.select().from(schoolClosures).where(eq(schoolClosures.id, id)).get();
  if (!r) throw notFound('Holiday');
  return r;
}

export function updateClosure(ctx: RequestContext, input: In<typeof C.updateClosure>): C.Closure {
  return tx(ctx.db, () => {
    const r = getClosure(ctx.db, input.closureId);
    const y = assertYearWritable(ctx.db, r.schoolYearId);
    const next = { name: input.name ? cleanName(input.name) : r.name, startsOn: input.startsOn ?? r.startsOn, endsOn: input.endsOn ?? r.endsOn };
    assertInYear(y, next.startsOn, next.endsOn);
    const now = ctx.now();
    ctx.db.update(schoolClosures).set({ ...next, updatedAt: now }).where(eq(schoolClosures.id, r.id)).run();
    audit(ctx.db, ctx.actor, { action: 'closure.update', entity: 'school_closure', entityId: r.id, before: { name: r.name, startsOn: r.startsOn, endsOn: r.endsOn }, after: next }, now);
    return closureDto({ ...r, ...next, updatedAt: now });
  });
}

/** Closures are calendar configuration (nothing references them by id): deleted while the year is writable. */
export function deleteClosure(ctx: RequestContext, closureId: string): void {
  tx(ctx.db, () => {
    const r = getClosure(ctx.db, closureId);
    assertYearWritable(ctx.db, r.schoolYearId);
    ctx.db.delete(schoolClosures).where(eq(schoolClosures.id, r.id)).run();
    audit(ctx.db, ctx.actor, { action: 'closure.delete', entity: 'school_closure', entityId: r.id, before: { name: r.name, startsOn: r.startsOn, endsOn: r.endsOn } }, ctx.now());
  });
}

/**
 * The built-in fixed-date Turkish national holidays inside the year, each as a one-day closure. A date
 * that an existing closure already covers is skipped (pressing it twice adds nothing). One audit row.
 */
export function addPublicHolidays(ctx: RequestContext, yearId: string): { added: number; skipped: number } {
  return tx(ctx.db, () => {
    const y = assertYearWritable(ctx.db, yearId);
    const covered = closedDates(rowsOfYear(ctx.db, y.id).map((r) => ({ from: r.startsOn, to: r.endsOn })));
    const holidays = fixedHolidaysIn({ from: y.startsOn, to: y.endsOn });
    const fresh = holidays.filter((h) => !covered.has(h.date));
    assertRoom(ctx.db, y.id, fresh.length);
    const now = ctx.now();
    for (const h of fresh) ctx.db.insert(schoolClosures).values({ id: newId(), schoolYearId: y.id, name: { ...h.name }, startsOn: h.date, endsOn: h.date, createdAt: now, updatedAt: now }).run();
    const result = { added: fresh.length, skipped: holidays.length - fresh.length };
    audit(ctx.db, ctx.actor, { action: 'closure.add_public_holidays', entity: 'school_year', entityId: y.id, after: { ...result, dates: fresh.map((h) => h.date) } }, now);
    return result;
  });
}

/** Closure dates of every school year that overlap [from, to], cut to the range (reports, usage). */
export function closedDatesBetween(db: Db, from: string, to: string): Set<string> {
  const rows = db
    .select({ from: schoolClosures.startsOn, to: schoolClosures.endsOn })
    .from(schoolClosures)
    .where(and(lte(schoolClosures.startsOn, to), gte(schoolClosures.endsOn, from)))
    .all();
  return closedDates(rows, { from, to });
}

/** Every closure date of one school year (the Daily Assistant's weeks, the demo history). */
export function closedDatesOfYear(db: Db, yearId: string): Set<string> {
  return closedDates(rowsOfYear(db, yearId).map((r) => ({ from: r.startsOn, to: r.endsOn })));
}

/** The closure on a local date of a school year (the first by start date), or null: the classroom's calm note. */
export function closureOn(db: Db, yearId: string, date: string): { id: string; name: LocalizedTextValue; startsOn: string; endsOn: string; updatedAt: number } | null {
  const r = db
    .select()
    .from(schoolClosures)
    .where(and(eq(schoolClosures.schoolYearId, yearId), lte(schoolClosures.startsOn, date), gte(schoolClosures.endsOn, date)))
    .orderBy(asc(schoolClosures.startsOn))
    .get();
  return r ? { id: r.id, name: r.name, startsOn: r.startsOn, endsOn: r.endsOn, updatedAt: r.updatedAt } : null;
}
