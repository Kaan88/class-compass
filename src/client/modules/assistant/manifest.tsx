/** Daily assistant: dashboard slot, Start Lesson step, thank-you End Lesson step, weekly plan page (AST-1..6). */
import { AssistantPage } from '../../routes/teacher/Assistant.tsx';
import { IconStar } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { assistantDashboardSlot, assistantEndStepUi, assistantInvalidation, assistantStartStep } from './AssistantPanel.tsx';

export const assistantClientManifest = defineClientModule({
  key: 'assistant',
  policyKey: 'assistant',
  i18nNamespace: 'assistant',
  dashboardSlots: [assistantDashboardSlot],
  startSteps: [assistantStartStep],
  endSteps: [assistantEndStepUi],
  invalidations: [assistantInvalidation],
  teacherPages: [{ key: 'assistant', path: 'assistant', labelKey: 'teacher.assistant', Icon: IconStar, order: 70, Component: AssistantPage }],
});
