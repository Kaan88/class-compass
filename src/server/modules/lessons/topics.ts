/**
 * Lesson topics / skill focus (S13a, D-101; owner request 2026-11-07).
 *
 * - Topics are the skill categories of the subject (goals library: the defaults Reading, Writing,
 *   Grammar, Vocabulary, Listening, Speaking, Phonics plus the teacher's own, each with an icon).
 * - A weekly plan per class+subject (weekday → topic ids) gives the default topic(s) at Start Lesson;
 *   the teacher confirms or changes them, and can change them during the lesson ('lesson.setTopics').
 * - The lesson stores ids with name + icon snapshots (DAT-6), so renaming a category later never
 *   changes what an old lesson says; reports count lessons per topic from these snapshots.
 */
import { eq } from 'drizzle-orm';
import { weekdayOf } from '../../../domain/dates.ts';
import type { LessonTopic, TopicPlan } from '../../../shared/contracts/lessons.ts';
import { TOPIC_ICONS, type TopicIcon } from '../../../shared/lessons.ts';
import type { Db } from '../../db/client.ts';
import { contextLessonSettings, type LessonTopicJson } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { tx } from '../../db/client.ts';
import { categoriesFor, categoryName, categoryNamesOf, getCategory, inScope } from '../goals/library.ts';
import { assertClassWritable, assertOwnsContext, getClass, todayFor, type ContextRow } from '../school/policy.ts';
import { DEFAULT_ROUTINE_ID } from '../../../shared/lessons.ts';

const iconOf = (v: string | null): TopicIcon | null => ((TOPIC_ICONS as readonly string[]).includes(v ?? '') ? (v as TopicIcon) : null);

/** Topics a lesson of this context can have: the subject's live categories for its teacher. */
export function topicChoices(db: Db, context: ContextRow): LessonTopic[] {
  // A default the teacher renamed shows (and is remembered with) the teacher's name (S22b, D-176).
  const names = categoryNamesOf(db, context.teacherId, context.subjectId);
  return categoriesFor(db, context.subjectId, [context.teacherId], false).map((c) => ({ id: c.id, name: categoryName(c, names), icon: iconOf(c.icon) }));
}

export function topicPlanOf(db: Db, contextId: string): TopicPlan {
  const row = db.select().from(contextLessonSettings).where(eq(contextLessonSettings.contextId, contextId)).get();
  return (row?.topicPlanJson ?? {}) as TopicPlan;
}

/**
 * Snapshots for these topic ids (DAT-6): each must be a category usable in this context (archived
 * ones are refused for new choices). Duplicates are dropped; the order is kept.
 */
export function topicSnapshots(db: Db, context: ContextRow, ids: readonly string[]): LessonTopicJson[] {
  const out: LessonTopicJson[] = [];
  const names = categoryNamesOf(db, context.teacherId, context.subjectId);
  for (const id of [...new Set(ids)]) {
    const c = getCategory(db, id);
    if (!c || c.archivedAt !== null || !inScope(c, context.subjectId, [context.teacherId])) throw new AppError('VALIDATION', 'Unknown topic', { reason: 'UNKNOWN_TOPIC' });
    out.push({ id: c.id, name: categoryName(c, names), icon: iconOf(c.icon) });
  }
  return out;
}

/**
 * Like `topicSnapshots`, but for outbox commands ('lesson.start', 'lesson.setTopics'): a topic that is
 * no longer usable (archived since the device cached its choices, or unknown) is dropped instead of
 * rejecting the whole command, and returned in `dropped` so the caller can audit it.
 */
export function usableTopicSnapshots(db: Db, context: ContextRow, ids: readonly string[]): { topics: LessonTopicJson[]; dropped: string[] } {
  const topics: LessonTopicJson[] = [];
  const dropped: string[] = [];
  const names = categoryNamesOf(db, context.teacherId, context.subjectId);
  for (const id of [...new Set(ids)]) {
    const c = getCategory(db, id);
    if (!c || c.archivedAt !== null || !inScope(c, context.subjectId, [context.teacherId])) dropped.push(id);
    else topics.push({ id: c.id, name: categoryName(c, names), icon: iconOf(c.icon) });
  }
  return { topics, dropped };
}

/** The plan's topics for a local date (ids still usable; archived ones are skipped quietly). */
export function plannedTopics(db: Db, context: ContextRow, date: string): string[] {
  const live = new Set(topicChoices(db, context).map((t) => t.id));
  return (topicPlanOf(db, context.id)[String(isoWeekday(date)) as keyof TopicPlan] ?? []).filter((id) => live.has(id));
}

/** ISO weekday 1 (Monday) … 7 (Sunday) of a 'YYYY-MM-DD'. */
export const isoWeekday = (date: string) => {
  const d = weekdayOf(date);
  return d === 0 ? 7 : d;
};

export function classroomTopics(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const today = todayFor(ctx, getClass(ctx.db, context.classId));
  return { topics: topicChoices(ctx.db, context), plannedToday: plannedTopics(ctx.db, context, today), weekday: isoWeekday(today) };
}

export function getPlan(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  return { topics: topicChoices(ctx.db, context), plan: topicPlanOf(ctx.db, context.id) };
}

export function setPlan(ctx: RequestContext, contextId: string, plan: TopicPlan) {
  return tx(ctx.db, () => {
    const context = assertOwnsContext(ctx, contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
    const clean: TopicPlan = {};
    for (const [day, ids] of Object.entries(plan)) {
      const snap = topicSnapshots(ctx.db, context, ids ?? []);
      if (snap.length) clean[day as keyof TopicPlan] = snap.map((t) => t.id);
    }
    const before = topicPlanOf(ctx.db, context.id);
    const now = ctx.now();
    ctx.db
      .insert(contextLessonSettings)
      .values({ contextId: context.id, defaultTemplateId: DEFAULT_ROUTINE_ID, topicPlanJson: clean, updatedAt: now, updatedBy: requireUser(ctx).id })
      .onConflictDoUpdate({ target: contextLessonSettings.contextId, set: { topicPlanJson: clean, updatedAt: now, updatedBy: requireUser(ctx).id } })
      .run();
    audit(ctx.db, ctx.actor, { action: 'lesson.topic_plan', entity: 'teaching_context', entityId: context.id, before, after: clean }, now);
    return { topics: topicChoices(ctx.db, context), plan: clean };
  });
}
