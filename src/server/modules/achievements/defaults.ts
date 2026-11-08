/**
 * Built-in achievements (S13c item 1, D-121): seeded once with stable ids (`defaultAchievementId`),
 * so a replay, a restore or a second server start never makes duplicates. Text and icons of a default
 * already in the database are refreshed from the catalogue (awards keep their own snapshot); an admin's
 * school-wide archive is kept.
 */
import { DEFAULT_ACHIEVEMENTS, defaultAchievementId } from '../../../shared/achievements.ts';
import type { Db } from '../../db/client.ts';
import { achievementDefinitions } from '../../db/schema.ts';

export function ensureAchievementDefaults(db: Db, now: number): void {
  const have = new Set(
    db
      .select({ key: achievementDefinitions.key })
      .from(achievementDefinitions)
      .all()
      .map((r) => r.key),
  );
  for (const d of DEFAULT_ACHIEVEMENTS) {
    if (have.has(d.key)) continue;
    db.insert(achievementDefinitions)
      .values({
        id: defaultAchievementId(d.key),
        key: d.key,
        name: d.name,
        description: d.description,
        icon: d.icon,
        tier: d.tier,
        category: d.category,
        kind: d.kind,
        ruleJson: d.rule,
        subjectId: null,
        createdBy: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
}
