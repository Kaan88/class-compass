/** Grouping (GRP-1..8, DSH-8): saved arrangements, levels, pair rules, groups in the lesson. */
import { z } from 'zod';
import { defineServerModule } from '../manifest.ts';
import { groupingCommands } from './commands.ts';
import { groupingLessonState, registerGroupingRoutes } from './routes.ts';
import { groupingHistorySection, groupingTimeline } from './report.ts';

export const groupingManifest = defineServerModule({
  key: 'grouping',
  policyKey: 'grouping',
  routes: registerGroupingRoutes,
  commands: groupingCommands,
  lessonState: [groupingLessonState],
  reports: [
    {
      key: 'groupingHistory',
      order: 80,
      meta: {
        title: 'report.section.grouping',
        tables: [
          { key: 'arrangements', title: 'report.grouping.arrangements' },
          { key: 'students', title: 'report.grouping.byStudent' },
        ],
      },
      build: groupingHistorySection,
    },
  ],
  timeline: [{ key: 'grouping', order: 80, build: groupingTimeline }],
  // Per class+subject display option (S13a): student names on the group screen in Turkish-correct upper case.
  config: { schema: z.object({ upperCaseNames: z.boolean() }), defaults: { upperCaseNames: false } },
});
