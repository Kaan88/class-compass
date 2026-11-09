/**
 * The class assistant on the classroom student card (S14e2, D-154): how many days the student has
 * been the assistant in this class+subject this term, up to today (the effective assistant of a day,
 * as in the report). Outside a term the school year so far counts. Nothing when it is zero; never a
 * comparison with classmates.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { ClassroomCardItem } from '../../../shared/contracts/classroomCard.ts';
import { assistantAssignments, terms } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ClassroomCardInput } from '../manifest.ts';
import { getYear } from '../school/policy.ts';

export function assistantCard(ctx: RequestContext, input: ClassroomCardInput): Extract<ClassroomCardItem, { key: 'assistant' }>['data'] | null {
  const { today } = input;
  const year = getYear(ctx.db, input.cls.schoolYearId);
  const term = ctx.db
    .select()
    .from(terms)
    .where(and(eq(terms.schoolYearId, year.id), lte(terms.startsOn, today), gte(terms.endsOn, today)))
    .orderBy(asc(terms.startsOn))
    .get();
  const from = term?.startsOn ?? year.startsOn;
  const days = ctx.db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, input.context.id), gte(assistantAssignments.localDate, from), lte(assistantAssignments.localDate, today)))
    .all()
    .filter((r) => (r.actualStudentId ?? r.plannedStudentId) === input.studentId).length;
  return days > 0 ? { days } : null;
}
