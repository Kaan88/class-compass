/** Homework: current assignments panel on the classroom display + assignments / checking / settings page (HW-1..4, DSH-8). */
import { HomeworkPage, HomeworkSettingsPanel } from '../../routes/teacher/Homework.tsx';
import { IconBook } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { homeworkDashboardSlot } from './HomeworkPanel.tsx';

export const homeworkClientManifest = defineClientModule({
  key: 'homework',
  policyKey: 'homework',
  i18nNamespace: 'homework',
  dashboardSlots: [homeworkDashboardSlot],
  teacherPages: [{ key: 'homework', path: 'homework', labelKey: 'teacher.homework', Icon: IconBook, order: 100, Component: HomeworkPage }],
  settingsPanel: { Component: HomeworkSettingsPanel },
});
