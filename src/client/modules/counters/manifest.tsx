/** Counters: class bar slot, student-card counts, settings page and its weekly history sub-page (CNT-1..12). */
import { CounterHistoryPage, CountersPage } from '../../routes/teacher/Counters.tsx';
import { IconCalendar, IconPlus } from '../../ui/icons.tsx';
import { defineClientModule, type TeacherPageSearch } from '../types.ts';
import { ModuleConfigToggle } from '../../ui/ModuleConfigToggle.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { countersCardAddon, countersDashboardSlot } from './CounterPanel.tsx';
import { counterInvalidation } from './countersClient.ts';

/** `/teacher/counter-history?counterId=…` opens the history with that counter preselected. */
function CounterHistoryRoute({ search }: { search: TeacherPageSearch }) {
  return <CounterHistoryPage key={search.counterId ?? 'none'} initialCounterId={search.counterId} />;
}

/** Class settings: the per-student reminder boxes on the student cards (S13a: off by default). */
function CountersSettingsPanel({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  return <ModuleConfigToggle contextId={contextId} module="counters" field="showReminderBoxes" defaultValue={false} label={t('counter.showReminderBoxes')} description={t('counter.showReminderBoxesHint')} />;
}

export const countersClientManifest = defineClientModule({
  key: 'counters',
  policyKey: 'counters',
  i18nNamespace: 'counters',
  dashboardSlots: [countersDashboardSlot],
  studentCardAddons: [countersCardAddon],
  teacherPages: [
    { key: 'counters', path: 'counters', labelKey: 'teacher.counters', Icon: IconPlus, order: 60, Component: CountersPage },
    // Reached from the counters page (`?counterId=` preselects a counter); no menu tile of its own.
    {
      key: 'counterHistory',
      path: 'counter-history',
      labelKey: 'counterHistory.title',
      Icon: IconCalendar,
      order: 65,
      menu: false,
      Component: CounterHistoryRoute,
    },
  ],
  invalidations: [counterInvalidation],
  settingsPanel: { Component: CountersSettingsPanel },
});
