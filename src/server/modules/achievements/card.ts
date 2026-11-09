/**
 * Achievements on the classroom student card (S14e2, D-154): the student's most recent live awards in
 * this class+subject, newest first. Secret Student achievements are left out (the card never carries
 * Secret Student data); nothing is counted against classmates and no level is shown.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import type { ClassroomCardItem } from '../../../shared/contracts/classroomCard.ts';
import { achievementDefinitions, studentAchievements } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ClassroomCardInput } from '../manifest.ts';
import { effectiveTimezone } from '../school/policy.ts';

/** How many awards the card shows. */
export const CARD_RECENT_AWARDS = 4;

export function achievementsCard(ctx: RequestContext, input: ClassroomCardInput): Extract<ClassroomCardItem, { key: 'achievements' }>['data'] | null {
  const rows = ctx.db
    .select({ award: studentAchievements, category: achievementDefinitions.category })
    .from(studentAchievements)
    .innerJoin(achievementDefinitions, eq(achievementDefinitions.id, studentAchievements.achievementId))
    .where(and(eq(studentAchievements.studentId, input.studentId), eq(studentAchievements.contextId, input.context.id), isNull(studentAchievements.revokedAt)))
    .orderBy(desc(studentAchievements.awardedAt))
    .all()
    .filter((r) => r.category !== 'secret')
    .slice(0, CARD_RECENT_AWARDS);
  if (!rows.length) return null;
  const tz = effectiveTimezone(ctx.db, input.cls);
  return {
    items: rows.map(({ award: a }) => ({
      id: a.id,
      name: a.nameSnapshot,
      icon: a.iconSnapshot as Extract<ClassroomCardItem, { key: 'achievements' }>['data']['items'][number]['icon'],
      tier: a.tierSnapshot,
      awardedOn: localDate(a.awardedAt, tz),
    })),
  };
}
