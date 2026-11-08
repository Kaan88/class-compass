/**
 * Achievements in the reports (S13c item 8, RPT-1): the badges awarded in the period per student
 * (given by the teacher / automatic / removed), by category (given / automatic / removed) and by the
 * teacher who gave them, and each award in the student's timeline. Counts only: no ranking, no
 * comparison, no score. Every table has the usual CSV download.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ACHIEVEMENT_CATEGORIES } from '../../../shared/achievements.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { localDate } from '../../../domain/dates.ts';
import type { ReportSectionData, TimelineEvent } from '../../../shared/contracts/reports.ts';
import { achievementDefinitions, studentAchievements, users } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { ReportScope } from '../manifest.ts';
import { col, key, lbl, n, NA, raw, scopeIds, student, table, text } from '../reports/cells.ts';

function awardsIn(ctx: RequestContext, scope: ReportScope) {
  const ids = new Set(scopeIds(scope));
  return ctx.db
    .select()
    .from(studentAchievements)
    .where(and(eq(studentAchievements.contextId, scope.context.id)))
    .all()
    .map((a) => ({ ...a, date: localDate(a.awardedAt, scope.timezone) }))
    .filter((a) => ids.has(a.studentId) && a.date >= scope.from && a.date <= scope.to)
    .sort((a, b) => a.awardedAt - b.awardedAt);
}

type AwardIn = ReturnType<typeof awardsIn>[number];
const CATEGORY_KEY = Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((c) => [c, `report.achievements.category.${c}`])) as Record<(typeof ACHIEVEMENT_CATEGORIES)[number], MessageKey>;

/** Given / automatic / removed per badge category (the category of the badge definition). */
function byCategory(ctx: RequestContext, all: readonly AwardIn[]) {
  const ids = [...new Set(all.map((a) => a.achievementId))];
  const cat = new Map((ids.length ? ctx.db.select({ id: achievementDefinitions.id, category: achievementDefinitions.category }).from(achievementDefinitions).where(inArray(achievementDefinitions.id, ids)).all() : []).map((d) => [d.id, d.category]));
  return ACHIEVEMENT_CATEGORIES.flatMap((c) => {
    const mine = all.filter((a) => (cat.get(a.achievementId) ?? 'custom') === c);
    if (!mine.length) return [];
    const live = mine.filter((a) => a.revokedAt === null);
    return [{ key: c, cells: [lbl(key(CATEGORY_KEY[c])), n(live.filter((a) => a.source === 'manual').length), n(live.filter((a) => a.source !== 'manual').length), n(mine.length - live.length)] }];
  });
}

/** Badges given by hand, per awarding teacher (automatic badges have no awarding teacher). */
function byTeacher(ctx: RequestContext, all: readonly AwardIn[]) {
  const manual = all.filter((a) => a.source === 'manual' && a.awardedBy !== null);
  const ids = [...new Set(manual.map((a) => a.awardedBy!))];
  const names = new Map((ids.length ? ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)).all() : []).map((u) => [u.id, u.name]));
  return ids
    .map((id) => ({ id, name: names.get(id) ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map(({ id, name }) => {
      const mine = manual.filter((a) => a.awardedBy === id);
      const live = mine.filter((a) => a.revokedAt === null).length;
      return { key: id, cells: [lbl(raw(name)), n(live), n(mine.length - live)] };
    });
}

export function achievementsSection(ctx: RequestContext, scope: ReportScope): ReportSectionData {
  const all = awardsIn(ctx, scope);
  const live = all.filter((a) => a.revokedAt === null);
  return {
    key: 'achievements',
    title: key('report.section.achievements'),
    intro: key('report.achievements.intro'),
    metrics: [
      { key: 'awards', label: key('report.achievements.awards'), cell: n(live.length) },
      { key: 'students', label: key('report.achievements.studentsWithBadges'), cell: n(new Set(live.map((a) => a.studentId)).size, scope.students.length) },
    ],
    tables: [
      table({
        key: 'students',
        title: key('report.achievements.byStudent'),
        note: key('report.achievements.byStudentNote'),
        columns: [col('student', key('report.col.student')), col('manual', key('report.achievements.manual'), true), col('auto', key('report.achievements.auto'), true), col('removed', key('report.achievements.removed'), true)],
        rows: scope.students.map((s) => {
          const mine = all.filter((a) => a.studentId === s.id);
          const inClass = scope.lessons.some((l) => scope.enrolledOn(s.id, l.localDate)) || mine.length > 0;
          const liveMine = mine.filter((a) => a.revokedAt === null);
          return {
            key: s.id,
            cells: inClass ? [student(s), n(liveMine.filter((a) => a.source === 'manual').length), n(liveMine.filter((a) => a.source !== 'manual').length), n(mine.length - liveMine.length)] : [student(s), NA, NA, NA],
          };
        }),
      }),
      table({
        key: 'categories',
        title: key('report.achievements.byCategory'),
        columns: [col('category', key('report.col.category')), col('manual', key('report.achievements.manual'), true), col('auto', key('report.achievements.auto'), true), col('removed', key('report.achievements.removed'), true)],
        rows: byCategory(ctx, all),
      }),
      table({
        key: 'teachers',
        title: key('report.achievements.byTeacher'),
        note: key('report.achievements.byTeacherNote'),
        columns: [col('teacher', key('report.achievements.teacher')), col('manual', key('report.achievements.manual'), true), col('removed', key('report.achievements.removed'), true)],
        rows: byTeacher(ctx, all),
      }),
    ],
    notes: [key('report.achievements.noRankingNote')],
  };
}

export function achievementsTimeline(ctx: RequestContext, scope: ReportScope, studentId: string): TimelineEvent[] {
  return awardsIn(ctx, scope)
    .filter((a) => a.studentId === studentId)
    .flatMap((a): TimelineEvent[] => {
      const ev: TimelineEvent[] = [{ date: a.date, at: a.awardedAt, module: 'achievements', what: key(a.source === 'manual' ? 'report.timeline.badgeGiven' : 'report.timeline.badgeEarned'), detail: text(a.nameSnapshot) }];
      if (a.revokedAt !== null) ev.push({ date: localDate(a.revokedAt, scope.timezone), at: a.revokedAt, module: 'achievements', what: key('report.timeline.badgeRemoved'), detail: text(a.nameSnapshot) });
      return ev;
    });
}
