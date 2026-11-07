/** Counters: class bar slot, student-card counts, settings page (CNT-1..12). */
import { CountersPage } from '../../routes/teacher/Counters.tsx';
import { IconPlus } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { countersCardAddon, countersDashboardSlot } from './CounterPanel.tsx';
import { counterInvalidation } from './countersClient.ts';

export const countersClientManifest = defineClientModule({
  key: 'counters',
  policyKey: 'counters',
  i18nNamespace: 'counters',
  dashboardSlots: [countersDashboardSlot],
  studentCardAddons: [countersCardAddon],
  teacherPages: [{ key: 'counters', path: 'counters', labelKey: 'teacher.counters', Icon: IconPlus, order: 60, Component: CountersPage }],
  invalidations: [counterInvalidation],
});
