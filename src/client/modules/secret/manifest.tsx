/** Secret Students: dashboard slot (counts only), reveal step, settings + history page (SEC-1..7). */
import { SecretPage, SecretSettingsPanel } from '../../routes/teacher/Secret.tsx';
import { IconFlag } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { secretDashboardSlot, secretEndStepUi, secretInvalidation } from './SecretPanel.tsx';

export const secretClientManifest = defineClientModule({
  key: 'secret',
  policyKey: 'secretStudents',
  i18nNamespace: 'secret',
  dashboardSlots: [secretDashboardSlot],
  endSteps: [secretEndStepUi],
  teacherPages: [{ key: 'secret', path: 'secret', labelKey: 'teacher.secret', Icon: IconFlag, order: 80, Component: SecretPage }],
  settingsPanel: { Component: SecretSettingsPanel },
  invalidations: [secretInvalidation],
});
