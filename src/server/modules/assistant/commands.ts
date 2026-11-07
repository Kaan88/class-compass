/** Assistant End Lesson step (optional thank-you, LES-3). Teacher edits are PIN-gated REST endpoints. */
import { AssistantEndStepInput } from '../../../shared/contracts/assistant.ts';
import { endLessonStep } from '../lessons/endSteps.ts';
import { endStep } from './service.ts';

export const assistantEndStep = endLessonStep({ key: 'assistantThanks', module: 'assistant', order: 60, input: AssistantEndStepInput, apply: endStep });
