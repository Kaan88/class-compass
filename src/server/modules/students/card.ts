/**
 * The classroom student card (S14e2, D-154): what the class may see when the teacher taps a name on
 * the classroom screen. `classroom` access (no PIN, works while the teacher area is locked), so it is
 * strict about who and what:
 * - only the teacher's own running class+subject (`assertOwnsContext`) and a student who is in the
 *   class today; anything else answers 404, so the card never confirms that a student exists
 *   elsewhere;
 * - only the items modules declare in their manifest's `classroomCard`, each a member of the shared
 *   `ClassroomCardItem` allow-list, and only those of modules enabled for the class+subject. The
 *   output schema strips anything else.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { ClassroomCard } from '../../../shared/contracts/classroomCard.ts';
import { initials } from '../../../shared/text/turkish.ts';
import { enrolments, students } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { classroomCardContributions } from '../index.ts';
import { assertOwnsContext, enrolmentActiveOn, getClass, todayFor, type ContextRow } from '../school/policy.ts';

/** The teacher's own running class+subject, or 404 (not 403: the card says nothing about other classes). */
function ownContext(ctx: RequestContext, contextId: string): ContextRow {
  try {
    return assertOwnsContext(ctx, contextId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'FORBIDDEN') throw notFound('Student');
    throw err;
  }
}

export function classroomCard(ctx: RequestContext, contextId: string, studentId: string): ClassroomCard {
  const context = ownContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const today = todayFor(ctx, cls);
  const row = ctx.db
    .select({ student: students })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.studentId))
    .where(and(eq(enrolments.classId, cls.id), eq(enrolments.studentId, studentId), enrolmentActiveOn(today), isNull(students.deactivatedAt)))
    .get();
  if (!row) throw notFound('Student');
  const s = row.student;
  const items: ClassroomCard['items'] = [];
  for (const c of classroomCardContributions(ctx.db, context.id)) {
    const data = c.build(ctx, { studentId: s.id, context, cls, today });
    if (data) items.push({ key: c.key, data } as ClassroomCard['items'][number]);
  }
  return { student: { id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue }, items };
}
