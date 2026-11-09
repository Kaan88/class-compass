/** Counters: English reminder preset and custom counters (CNT-1..12). */
import { z } from 'zod';
import { defineServerModule } from '../manifest.ts';
import { countersSection, countersTimeline } from './report.ts';
import { counterCommands } from './commands.ts';
import { countersLessonState, registerCounterRoutes } from './routes.ts';
import { countersCard } from './service.ts';

export const countersManifest = defineServerModule({
  key: 'counters',
  policyKey: 'counters',
  routes: registerCounterRoutes,
  commands: counterCommands,
  // Counter bars and weekly counts ride on the polled lesson state (D-045, CNT-2/3).
  lessonState: [countersLessonState],
  reports: [
    {
      key: 'counters',
      order: 30,
      // One set of tables per counter (`lessons-<counterId>` …).
      meta: {
        title: 'report.section.counters',
        tables: [
          { key: 'lessons', title: 'report.counters.perLesson', perItem: true },
          { key: 'weeks', title: 'report.counters.perWeek', perItem: true },
          { key: 'students', title: 'report.counters.perStudent', perItem: true },
        ],
      },
      build: countersSection,
    },
  ],
  timeline: [{ key: 'counters', order: 30, build: countersTimeline }],
  // The student's counts on the classroom student card, only while the reminder boxes are on (S14e2, D-154).
  classroomCard: [{ key: 'counters', order: 40, build: countersCard }],
  // The English-reminder boxes on student cards are shown unless the teacher hides them (S14a, D-143; supersedes D-102).
  config: { schema: z.object({ showReminderBoxes: z.boolean() }), defaults: { showReminderBoxes: true } },
});
