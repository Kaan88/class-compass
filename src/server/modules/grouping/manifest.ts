/** Grouping (GRP-1..8, DSH-8): saved arrangements, levels, pair rules, groups in the lesson. */
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
  reports: [{ key: 'groupingHistory', order: 80, build: groupingHistorySection }],
  timeline: [{ key: 'grouping', order: 80, build: groupingTimeline }],
});
