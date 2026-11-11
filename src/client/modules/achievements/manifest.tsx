/**
 * Achievements (S13c, D-121, D-122): the classroom "Give a badge" panel with the Celebrate moment and
 * undo, the optional End Lesson "Well done!" step and the teacher Achievements page. The student page
 * screen lives in src/client/student (separate bundle, D-085). S22c (D-177): this lesson's achievements
 * as a mark on the classroom student cards.
 */
import { AchievementsPage } from '../../routes/teacher/Achievements.tsx';
import { IconTrophy } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { achievementsCardAddon, achievementsDashboardSlot, achievementsEndStepUi, achievementsInvalidation } from './AchievementsPanel.tsx';

export const achievementsClientManifest = defineClientModule({
  key: 'achievements',
  policyKey: 'achievements',
  i18nNamespace: 'achievements',
  dashboardSlots: [achievementsDashboardSlot],
  studentCardAddons: [achievementsCardAddon],
  endSteps: [achievementsEndStepUi],
  invalidations: [achievementsInvalidation],
  teacherPages: [{ key: 'achievements', path: 'achievements', labelKey: 'teacher.achievements', Icon: IconTrophy, order: 115, group: 'setup', setupTab: 'progress', module: 'achievements', Component: AchievementsPage }],
});
