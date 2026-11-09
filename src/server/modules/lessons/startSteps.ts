/**
 * Start Lesson step registry (S14b, D-149; LES-1). A module adds its part of the one 'lesson.start'
 * command as `payload.steps[key]` (the client's start step `useContribution` puts it there) and
 * declares the server side here, in its manifest's `startSteps`. Steps run inside the start command's
 * transaction, in `order`, after the lesson row and the start-screen attendance are written (so a step
 * sees today's attendance, e.g. the assistant whose turn moved to another student).
 *
 * When the lesson was already running (the start resumes it, LES-2), only steps with `onResume` run:
 * per-day data that the teacher confirmed on the start screen (like attendance, D-053) is applied,
 * never dropped. A step runs only while its module is enabled for the context; a missing input skips
 * it; an input its schema refuses fails the command (VALIDATION, START_STEP_INVALID).
 */
import type { z } from 'zod';
import type { StartStepNotes } from '../../../shared/contracts/lessons.ts';
import type { ContextModule } from '../../../shared/contracts/school.ts';
import type { Db } from '../../db/client.ts';
import type { RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { isModuleEnabled } from '../school/modules.ts';
import type { LessonRow } from './endSteps.ts';

export interface StartLessonStep<S extends z.ZodType = z.ZodType> {
  /** Stable key: the key of the client start step whose `useContribution` sends `steps[key]`. */
  key: string;
  /** Module that contributes the step; null = core step. */
  module: ContextModule | null;
  order: number;
  input: S;
  /** Also run when the start resumes a lesson that was already running. */
  onResume?: boolean;
  apply: (ctx: RequestContext, lesson: LessonRow, data: z.infer<S>, info: { resumed: boolean; opId: string }) => StartStepNotes | void;
}

const steps: StartLessonStep[] = [];

export function registerStartLessonStep(step: StartLessonStep): void {
  if (steps.some((s) => s.key === step.key)) throw new Error(`Duplicate Start Lesson step ${step.key}`);
  steps.push(step);
  steps.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** Declare a step for a manifest's `startSteps` (typed input, stored untyped). */
export const startLessonStep = <S extends z.ZodType>(step: StartLessonStep<S>): StartLessonStep => step as unknown as StartLessonStep;

/** Every registered start step in run order. */
export const allStartSteps = (): readonly StartLessonStep[] => [...steps];

const enabledFor = (db: Db, contextId: string, s: StartLessonStep) => s.module === null || isModuleEnabled(db, contextId, s.module);

/** Run the start steps that have an input (only `onResume` ones for a resumed lesson); merges their notes. */
export function runStartSteps(ctx: RequestContext, lesson: LessonRow, inputs: Readonly<Record<string, unknown>> | undefined, info: { resumed: boolean; opId: string }): StartStepNotes {
  const notes: StartStepNotes = {};
  for (const step of steps) {
    if (!inputs || !(step.key in inputs) || (info.resumed && !step.onResume) || !enabledFor(ctx.db, lesson.contextId, step)) continue;
    const parsed = step.input.safeParse(inputs[step.key]);
    if (!parsed.success) throw new AppError('VALIDATION', `Invalid input for start step ${step.key}`, { reason: 'START_STEP_INVALID', step: step.key });
    const r = step.apply(ctx, lesson, parsed.data, info);
    if (r?.dutiesDropped) notes.dutiesDropped = (notes.dutiesDropped ?? 0) + r.dutiesDropped;
    if (r?.dutiesSkipped) notes.dutiesSkipped = (notes.dutiesSkipped ?? 0) + r.dutiesSkipped;
  }
  return notes;
}
