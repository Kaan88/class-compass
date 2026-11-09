/** Assistant End Lesson step (optional thank-you, LES-3). Teacher edits are PIN-gated REST endpoints. */
import { AssistantCommands, AssistantEndStepInput, AssistantStartStepInput } from '../../../shared/contracts/assistant.ts';
import { command } from '../../lib/commands.ts';
import { assistantStartStep as applyStartStep, checkDuty } from './duties.ts';
import { endLessonStep } from '../lessons/endSteps.ts';
import { startLessonStep } from '../lessons/startSteps.ts';
import { endStep } from './service.ts';

export const assistantEndStep = endLessonStep({ key: 'assistantThanks', module: 'assistant', order: 60, input: AssistantEndStepInput, apply: endStep });

/** Duty ticks given on the Start Lesson screen (S14b, D-149); per-day data, so also on a resumed lesson. */
export const assistantStartStep = startLessonStep({ key: 'assistant', module: 'assistant', order: 20, input: AssistantStartStepInput, onResume: true, apply: (ctx, lesson, data, info) => applyStartStep(ctx, lesson, data, info) });

/** Duty ticks on the classroom screen (S13a, D-100); listed in the manifest. */
export const assistantCommands = [command({ type: 'assistant.checkDuty', payload: AssistantCommands['assistant.checkDuty'], handle: (ctx, p, meta) => checkDuty(ctx, p, meta) })];
