/**
 * Achievements (S13c, D-121, D-122): the classroom "Give a badge" panel with the Celebrate moment and
 * undo, the optional End Lesson "Well done!" step and the teacher Achievements page. The student page
 * screen lives in src/client/student (separate bundle, D-085).
 */
import { AchievementsPage } from '../../routes/teacher/Achievements.tsx';
import { IconTrophy } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { achievementsDashboardSlot, achievementsEndStepUi, achievementsInvalidation } from './AchievementsPanel.tsx';

export const achievementsClientManifest = defineClientModule({
  key: 'achievements',
  policyKey: 'achievements',
  i18nNamespace: 'achievements',
  dashboardSlots: [achievementsDashboardSlot],
  endSteps: [achievementsEndStepUi],
  invalidations: [achievementsInvalidation],
  teacherPages: [{ key: 'achievements', path: 'achievements', labelKey: 'teacher.achievements', Icon: IconTrophy, order: 115, Component: AchievementsPage }],
});
