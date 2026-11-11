/**
 * Lesson goals (S25d, D-188): the optional goal sentence of a lesson and its review at End Lesson.
 * The module is opt-in per class+subject (catalogue `contextDefault: 'off'`). Only this folder reads or
 * writes `lesson_goals`. Every change is audited with the lesson as the entity; the goal text is the
 * teacher's and is shown to the class, so it is neither a private note nor student text.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { LessonGoalCommands, LessonGoalEndInput, LessonGoalStartInput, LessonGoalState } from '../../../shared/contracts/lessonGoals.ts';
import type { Db } from '../../db/client.ts';
import { lessonGoals } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import type { RequestContext } from '../../lib/context.ts';
import type { LessonRow } from '../lessons/endSteps.ts';
import { lessonForCommand } from '../lessons/service.ts';
import { assertModuleEnabled } from '../school/modules.ts';

export type LessonGoalRow = typeof lessonGoals.$inferSelect;

export const goalOf = (db: Db, lessonId: string): LessonGoalRow | undefined => db.select().from(lessonGoals).where(eq(lessonGoals.lessonId, lessonId)).get();

/** The running lesson's goal for the polled lesson state (classroom-safe: the sentence the class sees). */
export function goalState(db: Db, lesson: LessonRow): LessonGoalState {
  const row = goalOf(db, lesson.id);
  return { text: row?.text ?? null, outcome: row?.outcome ?? null };
}

/** Changes whenever the goal does (its `updatedAt`), so the lesson state's ETag follows it. */
export function goalStamp(db: Db, lesson: LessonRow | null): string {
  if (!lesson) return 'g-none';
  const row = goalOf(db, lesson.id);
  return row ? `g${row.updatedAt}` : 'g0';
}

/** Write the goal of a lesson: a text sets or replaces it, an empty one removes it. Audited when it changes. */
function writeGoal(ctx: RequestContext, lesson: LessonRow, text: string, opId: string): boolean {
  const before = goalOf(ctx.db, lesson.id);
  const now = ctx.now();
  if (!text) {
    if (!before) return false;
    ctx.db.delete(lessonGoals).where(eq(lessonGoals.lessonId, lesson.id)).run();
  } else {
    if (before?.text === text) return false;
    ctx.db
      .insert(lessonGoals)
      .values({ lessonId: lesson.id, contextId: lesson.contextId, text, outcome: null, createdAt: now, updatedAt: now, reviewedAt: null })
      .onConflictDoUpdate({ target: lessonGoals.lessonId, set: { text, updatedAt: now } })
      .run();
  }
  audit(ctx.db, ctx.actor, { action: 'lesson_goal.set', entity: 'lesson', entityId: lesson.id, opId, before: before ? { text: before.text } : null, after: text ? { text } : null }, now);
  return true;
}

/** Start Lesson step `lessonGoal`: the goal typed on the start screen (a new lesson only, never a resume). */
export function applyStartGoal(ctx: RequestContext, lesson: LessonRow, data: z.infer<typeof LessonGoalStartInput>, info: { opId: string }): void {
  writeGoal(ctx, lesson, data.text, info.opId);
}

/** 'lessonGoals.set': set, change or clear the running lesson's goal from the classroom board. */
export function setGoal(ctx: RequestContext, p: z.infer<(typeof LessonGoalCommands)['lessonGoals.set']>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'lessonGoals');
  const changed = writeGoal(ctx, lesson, p.text, meta.opId);
  return { changed, text: p.text || null };
}

/** End Lesson step `lessonGoal` (only when the lesson has a goal): did we reach it? */
export function applyEndGoal(ctx: RequestContext, lesson: LessonRow, data: z.infer<typeof LessonGoalEndInput>): void {
  const before = goalOf(ctx.db, lesson.id);
  if (!before || before.outcome === data.outcome) return;
  const now = ctx.now();
  ctx.db
    .update(lessonGoals)
    .set({ outcome: data.outcome, reviewedAt: data.outcome ? now : null, updatedAt: now })
    .where(eq(lessonGoals.lessonId, lesson.id))
    .run();
  audit(ctx.db, ctx.actor, { action: 'lesson_goal.review', entity: 'lesson', entityId: lesson.id, before: { outcome: before.outcome }, after: { outcome: data.outcome } }, now);
}

/** The review step applies only to a lesson that has a goal. */
export const lessonHasGoal = (db: Db, _contextId: string, lesson: LessonRow): boolean => Boolean(goalOf(db, lesson.id));
