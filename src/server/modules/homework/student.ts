/**
 * Homework on the personal student page (S10, STU-2): the student's own assignments in one
 * class+subject with the status the teacher gave them, read-only. Never the teacher's private notes on
 * the assignment or the mark, never other students. No mark = not checked yet (HW-4), never "missing".
 */
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { addDays } from '../../../domain/dates.ts';
import type { StudentHomeworkSection } from '../../../shared/contracts/goals.ts';
import { homeworkAssignments, homeworkMarks } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { StudentPageInput } from '../manifest.ts';
import { todayFor } from '../school/policy.ts';

/** How far back the student page lists assignments (by due date). */
export const STUDENT_HOMEWORK_DAYS = 60;

export function homeworkSection(ctx: RequestContext, { studentId, context, cls }: StudentPageInput): StudentHomeworkSection {
  const today = todayFor(ctx, cls);
  const rows = ctx.db
    .select()
    .from(homeworkAssignments)
    .where(
      and(
        eq(homeworkAssignments.contextId, context.id),
        isNull(homeworkAssignments.archivedAt),
        lte(homeworkAssignments.assignedOn, today),
        gte(homeworkAssignments.dueOn, addDays(today, -STUDENT_HOMEWORK_DAYS)),
      ),
    )
    .orderBy(desc(homeworkAssignments.dueOn), desc(homeworkAssignments.assignedOn))
    .all();
  const marks = rows.length
    ? new Map(
        ctx.db
          .select({ assignmentId: homeworkMarks.assignmentId, status: homeworkMarks.status })
          .from(homeworkMarks)
          .where(and(eq(homeworkMarks.studentId, studentId), inArray(homeworkMarks.assignmentId, rows.map((r) => r.id))))
          .all()
          .map((m) => [m.assignmentId, m.status]),
      )
    : new Map<string, string>();
  return {
    assignments: rows.map((a) => {
      const key = marks.get(a.id);
      const def = key ? a.statusSetJson.find((s) => s.key === key) : undefined;
      return {
        id: a.id,
        title: a.title,
        details: a.details,
        assignedOn: a.assignedOn,
        dueOn: a.dueOn,
        status: key ? { key, label: def?.label ?? { en: key }, kind: def?.kind ?? 'other' } : null,
      };
    }),
  };
}
