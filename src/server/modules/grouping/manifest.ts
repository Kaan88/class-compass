/** Grouping (GRP-1..8, DSH-8): saved arrangements, levels, pair rules, groups in the lesson. */
import { defineServerModule } from '../manifest.ts';
import { groupingCommands } from './commands.ts';
import { groupingLessonState, registerGroupingRoutes } from './routes.ts';
import { groupingReport } from './service.ts';

export const groupingManifest = defineServerModule({
  key: 'grouping',
  policyKey: 'grouping',
  routes: registerGroupingRoutes,
  commands: groupingCommands,
  lessonState: [groupingLessonState],
  reports: [{ key: 'groupingHistory', order: 70, build: groupingReport }],
});
