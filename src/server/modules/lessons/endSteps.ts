/**
 * End Lesson step registry (LES-3, ARCHITECTURE §2 module manifests). End Lesson is assembled from
 * steps contributed by modules: a step with `module: null` is core (always runs), any other step
 * runs only while its module is enabled for the context, so ending a lesson works with every
 * optional module switched off. Steps are declared in module manifests (`endSteps`, D-069) and
 * registered once by `installModules()`; Secret Students (40) and the assistant (60) run before the
 * core reflection (100).
 *
 * Steps run synchronously inside the 'lesson.end' command transaction, in `order`, BEFORE the lesson
 * is marked ended. Their input arrives as `payload.steps[key]` and is validated by `input`.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ReflectionStepInput } from '../../../shared/contracts/lessons.ts';
import type { ContextModule } from '../../../shared/contracts/school.ts';
import type { Db } from '../../db/client.ts';
import { lessons } from '../../db/schema.ts';
import type { RequestContext } from '../../lib/context.ts';
import { isModuleEnabled } from '../school/modules.ts';

export type LessonRow = typeof lessons.$inferSelect;

export interface EndLessonStep<S extends z.ZodType = z.ZodType> {
  /** Stable key, also used by the client to find the step's screen. */
  key: string;
  /** Module that contributes the step; null = core step. */
  module: ContextModule | null;
  /** Lower runs (and is shown) first. Core reflection is 100. */
  order: number;
  input: S;
  /**
   * Optional: the step applies only when this returns true (e.g. a class setting, S13c "Well done!").
   * `lesson` is the lesson being ended (S25d, D-188: the goal review only when the lesson has a goal).
   */
  when?: (db: Db, contextId: string, lesson: LessonRow) => boolean;
  apply: (ctx: RequestContext, lesson: LessonRow, data: z.infer<S>) => void;
}

const steps: EndLessonStep[] = [];

export function registerEndLessonStep<S extends z.ZodType>(step: EndLessonStep<S>): void {
  if (steps.some((s) => s.key === step.key)) throw new Error(`Duplicate End Lesson step ${step.key}`);
  steps.push(step as unknown as EndLessonStep);
  steps.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** Steps that apply to this lesson of a context right now (core + enabled modules), in order. */
export function endStepsFor(db: Db, contextId: string, lesson: LessonRow): EndLessonStep[] {
  return steps.filter((s) => (s.module === null || isModuleEnabled(db, contextId, s.module)) && (!s.when || s.when(db, contextId, lesson)));
}

/** Declare a step for a manifest's `endSteps` (typed input, stored untyped). */
export const endLessonStep = <S extends z.ZodType>(step: EndLessonStep<S>): EndLessonStep => step as unknown as EndLessonStep;

/** Core step: a short reflection (how did the lesson go? + optional note). Listed by the lessons manifest. */
export const reflectionStep = endLessonStep({
  key: 'reflection',
  module: null,
  order: 100,
  input: ReflectionStepInput,
  apply: (ctx, lesson, data) => {
    const note = data.note?.trim() ? data.note.trim() : null;
    ctx.db
      .update(lessons)
      .set({ reflectionJson: { rating: data.rating ?? null, note } })
      .where(eq(lessons.id, lesson.id))
      .run();
  },
});

/** Every registered step in run order (core and module steps). */
export const allEndSteps = (): readonly EndLessonStep[] => [...steps];
