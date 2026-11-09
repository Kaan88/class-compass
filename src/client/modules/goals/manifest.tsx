/**
 * Goals, reflections and evidence (S10, GOL-1..6): the teacher Goals page and the outcome-label
 * settings panel. The student page screens live in src/client/student (separate bundle, D-085).
 */
import { GoalsPage, GoalsSettingsPanel } from '../../routes/teacher/Goals.tsx';
import { IconTarget } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';

export const goalsClientManifest = defineClientModule({
  key: 'goals',
  policyKey: 'goals',
  i18nNamespace: 'goals',
  teacherPages: [{ key: 'goals', path: 'goals', labelKey: 'teacher.goals', Icon: IconTarget, order: 110, group: 'today', module: 'goals', Component: GoalsPage }],
  settingsPanel: { Component: GoalsSettingsPanel },
});
