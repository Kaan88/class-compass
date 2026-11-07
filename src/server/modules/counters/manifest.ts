/** Counters: English reminder preset and custom counters (CNT-1..12). */
import { defineServerModule } from '../manifest.ts';
import { counterCommands } from './commands.ts';
import { countersLessonState, registerCounterRoutes } from './routes.ts';

export const countersManifest = defineServerModule({
  key: 'counters',
  policyKey: 'counters',
  routes: registerCounterRoutes,
  commands: counterCommands,
  // Counter bars and weekly counts ride on the polled lesson state (D-045, CNT-2/3).
  lessonState: [countersLessonState],
});
