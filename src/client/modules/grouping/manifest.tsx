/**
 * Grouping: groups panel on the classroom display + arrangements / levels / pair rules page (GRP-1..8,
 * DSH-8); S22c (D-177): the group number as a mark on the classroom student cards.
 */
import { GroupingPage } from '../../routes/teacher/Grouping.tsx';
import { IconGroups } from '../../ui/icons.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { ModuleConfigToggle } from '../../ui/ModuleConfigToggle.tsx';
import { defineClientModule } from '../types.ts';
import { groupingInvalidation, groupsCardAddon, groupsDashboardSlot } from './GroupsPanel.tsx';

/** Class settings: names in Turkish-correct upper case on the group screen (S13a). */
function GroupingSettingsPanel({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  return <ModuleConfigToggle contextId={contextId} module="grouping" field="upperCaseNames" defaultValue={false} label={t('grouping.upperCaseNames')} description={t('grouping.upperCaseNamesHint')} />;
}

export const groupingClientManifest = defineClientModule({
  key: 'grouping',
  policyKey: 'grouping',
  i18nNamespace: 'grouping',
  dashboardSlots: [groupsDashboardSlot],
  studentCardAddons: [groupsCardAddon],
  teacherPages: [{ key: 'grouping', path: 'grouping', labelKey: 'teacher.grouping', Icon: IconGroups, order: 90, group: 'setup', setupTab: 'lessons', module: 'grouping', Component: GroupingPage }],
  invalidations: [groupingInvalidation],
  settingsPanel: { Component: GroupingSettingsPanel },
});
