/** Assistant End Lesson step (optional thank-you, LES-3). Teacher edits are PIN-gated REST endpoints. */
import { AssistantCommands, AssistantEndStepInput } from '../../../shared/contracts/assistant.ts';
import { command } from '../../lib/commands.ts';
import { checkDuty } from './duties.ts';
import { endLessonStep } from '../lessons/endSteps.ts';
import { endStep } from './service.ts';

export const assistantEndStep = endLessonStep({ key: 'assistantThanks', module: 'assistant', order: 60, input: AssistantEndStepInput, apply: endStep });

/** Duty ticks on the classroom screen (S13a, D-100); listed in the manifest. */
export const assistantCommands = [command({ type: 'assistant.checkDuty', payload: AssistantCommands['assistant.checkDuty'], handle: (ctx, p, meta) => checkDuty(ctx, p, meta) })];
