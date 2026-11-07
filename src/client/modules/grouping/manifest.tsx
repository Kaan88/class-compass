/** Grouping: groups panel on the classroom display + arrangements / levels / pair rules page (GRP-1..8, DSH-8). */
import { GroupingPage } from '../../routes/teacher/Grouping.tsx';
import { IconUsers } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { groupingInvalidation, groupsDashboardSlot } from './GroupsPanel.tsx';

export const groupingClientManifest = defineClientModule({
  key: 'grouping',
  policyKey: 'grouping',
  i18nNamespace: 'grouping',
  dashboardSlots: [groupsDashboardSlot],
  teacherPages: [{ key: 'grouping', path: 'grouping', labelKey: 'teacher.grouping', Icon: IconUsers, order: 90, Component: GroupingPage }],
  invalidations: [groupingInvalidation],
});
