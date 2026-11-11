/**
 * Lesson goals (S25d, D-188): opt-in per class+subject. Start Lesson step, board box, End Lesson review
 * and a short explanation under the module switch in Class settings. The report section is the server's.
 */
import { defineClientModule } from '../types.ts';
import { LessonGoalsSettingsPanel, lessonGoalDashboardSlot, lessonGoalEndStepUi, lessonGoalInvalidation, lessonGoalStartStep } from './LessonGoalsPanel.tsx';

export const lessonGoalsClientManifest = defineClientModule({
  key: 'lessonGoals',
  policyKey: 'lessonGoals',
  i18nNamespace: 'lessonGoals',
  startSteps: [lessonGoalStartStep],
  dashboardSlots: [lessonGoalDashboardSlot],
  endSteps: [lessonGoalEndStepUi],
  settingsPanel: { Component: LessonGoalsSettingsPanel },
  invalidations: [lessonGoalInvalidation],
});
