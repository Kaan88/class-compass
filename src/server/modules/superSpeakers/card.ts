/**
 * Super Speakers on the classroom student card (S14e2, D-154): the student's own live points this
 * week (the board's week, school timezone), shown in the class+subject that receives the Super
 * Speakers badges (like the report section). Never a rank or another student's points; nothing when
 * the student has no points this week.
 */
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { weekRangeOf } from '../../../domain/speakers.ts';
import type { ClassroomCardItem } from '../../../shared/contracts/classroomCard.ts';
import { pointEvents } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ClassroomCardInput } from '../manifest.ts';
import { badgeSubject, getSettings, schoolTimezone } from './service.ts';

export function speakersCard(ctx: RequestContext, input: ClassroomCardInput): Extract<ClassroomCardItem, { key: 'superSpeakers' }>['data'] | null {
  const subject = badgeSubject(ctx.db);
  if (subject !== null && subject.id !== input.context.subjectId) return null;
  const week = weekRangeOf(ctx.now(), schoolTimezone(ctx.db), getSettings(ctx.db).weekStartsOn);
  const row = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(pointEvents)
    .where(and(eq(pointEvents.studentId, input.studentId), isNull(pointEvents.voidedAt), gte(pointEvents.localDate, week.start), lte(pointEvents.localDate, week.end)))
    .get();
  const points = row?.n ?? 0;
  return points > 0 ? { points } : null;
}
