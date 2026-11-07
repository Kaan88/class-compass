/** Counters: English reminder preset and custom counters (CNT-1..12). */
import { z } from 'zod';
import { defineServerModule } from '../manifest.ts';
import { countersSection, countersTimeline } from './report.ts';
import { counterCommands } from './commands.ts';
import { countersLessonState, registerCounterRoutes } from './routes.ts';

export const countersManifest = defineServerModule({
  key: 'counters',
  policyKey: 'counters',
  routes: registerCounterRoutes,
  commands: counterCommands,
  // Counter bars and weekly counts ride on the polled lesson state (D-045, CNT-2/3).
  lessonState: [countersLessonState],
  reports: [{ key: 'counters', order: 30, build: countersSection }],
  timeline: [{ key: 'counters', order: 30, build: countersTimeline }],
  // S13a: the English-reminder boxes on student cards are hidden unless the teacher shows them.
  config: { schema: z.object({ showReminderBoxes: z.boolean() }), defaults: { showReminderBoxes: false } },
});
