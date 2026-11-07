/**
 * School-year rollover wizard (DAT-1, DAT-2, D-092). One transaction built from the existing,
 * audited school and student services (no new write paths):
 *   1. create the new year;
 *   2. optionally create its classes from the old ones (grade + 1, name with the grade raised or as
 *      the administrator typed it); classes in `excludeClassIds` (a graduating final grade) end with
 *      the old year: they are not re-created and nobody is promoted out of them;
 *   3. optionally assign the same teachers and subjects (active assignments only);
 *   4. optionally promote each old class's active students on the new year's first day (history
 *      kept: the old enrolment ends, a `promotion` enrolment starts);
 *   5. optionally archive the old year (read-only, reports stay available).
 * Applying needs the old year's name typed as confirmation; the preview changes nothing.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/maintenance.ts';
import type { RolloverPlan } from '../../../shared/contracts/maintenance.ts';
import { tx } from '../../db/client.ts';
import { classes, enrolments, schoolYears, teachingContexts } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { invalid, notFound } from '../../lib/errors.ts';
import { assignTeachingContext, createClass, createYear, setYearArchived } from '../school/service.ts';
import { promoteClass } from '../students/service.ts';

type Input = z.infer<typeof C.RolloverInput>;

/** "3-A" → "4-A" when the class has a grade and its name starts with that number. */
export function nextClassName(name: string, grade: number | null): string {
  if (grade === null) return name;
  const m = /^(\d+)(.*)$/u.exec(name);
  return m && Number(m[1]) === grade ? `${grade + 1}${m[2]}` : name;
}

function plan(ctx: RequestContext, input: Input): RolloverPlan {
  const year = ctx.db.select().from(schoolYears).where(eq(schoolYears.id, input.fromYearId)).get();
  if (!year) throw notFound('School year');
  const old = ctx.db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolYearId, year.id), isNull(classes.archivedAt)))
    .orderBy(asc(classes.name))
    .all();
  const problems: RolloverPlan['problems'] = [];
  if (input.startsOn <= year.endsOn) problems.push({ reason: 'NEW_YEAR_OVERLAPS', classId: null });
  if (input.startsOn > input.endsOn) problems.push({ reason: 'RANGE_INVALID', classId: null });
  if (year.archivedAt !== null && input.promote) problems.push({ reason: 'OLD_YEAR_ARCHIVED', classId: null });
  if (input.copyAssignments && !input.copyClasses) problems.push({ reason: 'ASSIGNMENTS_NEED_CLASSES', classId: null });
  if (input.promote && !input.copyClasses) problems.push({ reason: 'PROMOTE_NEEDS_CLASSES', classId: null });
  const excluded = new Set(input.excludeClassIds ?? []);
  const rows = old.map((c) => {
    const newName = (input.classNames?.[c.id] ?? nextClassName(c.name, c.grade)).trim();
    const activeStudents = ctx.db
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(and(eq(enrolments.classId, c.id), isNull(enrolments.toDate)))
      .all().length;
    const assignments = ctx.db
      .select({ id: teachingContexts.id })
      .from(teachingContexts)
      .where(and(eq(teachingContexts.classId, c.id), isNull(teachingContexts.endedAt)))
      .all().length;
    return { id: c.id, name: c.name, newName, grade: c.grade, newGrade: c.grade === null ? null : c.grade + 1, activeStudents, assignments, included: !excluded.has(c.id) };
  });
  const seen = new Map<string, string>();
  for (const r of rows.filter((x) => x.included)) {
    const k = r.newName.toLocaleLowerCase('tr');
    if (seen.has(k)) problems.push({ reason: 'DUPLICATE_CLASS_NAME', classId: r.id });
    seen.set(k, r.id);
  }
  return { fromYear: { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn, archived: year.archivedAt !== null }, classes: rows, problems };
}

export const rolloverPreview = (ctx: RequestContext, input: Input) => plan(ctx, input);

export function rolloverApply(ctx: RequestContext, input: Input & { confirm: string }) {
  const p = plan(ctx, input);
  if (input.confirm.trim() !== p.fromYear.name) throw invalid('Type the name of the old school year to confirm', { reason: 'CONFIRMATION_MISMATCH' });
  if (p.problems.length) throw invalid('The rollover cannot be applied as planned', { reason: p.problems[0]!.reason, problems: p.problems });
  return tx(ctx.db, () => {
    const year = createYear(ctx, { name: input.name, startsOn: input.startsOn, endsOn: input.endsOn });
    let classesCreated = 0;
    let assignmentsCreated = 0;
    let studentsPromoted = 0;
    let studentsSkipped = 0;
    if (input.copyClasses) {
      for (const c of p.classes.filter((x) => x.included)) {
        const old = ctx.db.select().from(classes).where(eq(classes.id, c.id)).get()!;
        const created = createClass(ctx, {
          schoolYearId: year.id,
          name: c.newName,
          grade: c.newGrade ?? undefined,
          theme: old.theme,
          timezone: old.timezone ?? undefined,
          soundsEnabled: old.soundsEnabled,
          animationsEnabled: old.animationsEnabled,
        });
        classesCreated += 1;
        if (input.copyAssignments) {
          const active = ctx.db
            .select()
            .from(teachingContexts)
            .where(and(eq(teachingContexts.classId, c.id), isNull(teachingContexts.endedAt)))
            .all();
          for (const a of active) {
            assignTeachingContext(ctx, { teacherId: a.teacherId, classId: created.id, subjectId: a.subjectId });
            assignmentsCreated += 1;
          }
        }
        if (input.promote) {
          const r = promoteClass(ctx, { classId: c.id, toClassId: created.id, date: input.startsOn });
          studentsPromoted += r.moved.length;
          studentsSkipped += r.skipped.length;
        }
      }
    }
    if (input.archiveOld) setYearArchived(ctx, p.fromYear.id, true);
    const result = { yearId: year.id, classesCreated, classesNotContinued: input.copyClasses ? p.classes.filter((c) => !c.included).length : 0, assignmentsCreated, studentsPromoted, studentsSkipped, archivedOld: input.archiveOld };
    audit(ctx.db, ctx.actor, { action: 'school_year.rollover', entity: 'school_year', entityId: p.fromYear.id, after: result }, ctx.now());
    return result;
  });
}
