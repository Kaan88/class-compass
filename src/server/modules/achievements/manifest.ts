/**
 * Student achievements (S13c, D-121, D-122): effort-based badges, automatic (rule engine on student
 * activity) and given by the teacher (in class through the outbox, or in the teacher area), the
 * student page section with a private level path, the optional End Lesson "Well done!", reports and
 * the timeline.
 */
import { z } from 'zod';
import { ANNOUNCE_MODES } from '../../../shared/contracts/achievements.ts';
import { defineServerModule } from '../manifest.ts';
import { achievementsCommands, achievementsEndStep } from './commands.ts';
import { achievementsSection, achievementsTimeline } from './report.ts';
import { registerAchievementRoutes } from './routes.ts';
import { DEFAULT_SETTINGS, onActivity, studentSection } from './service.ts';

export const achievementsConfigSchema = z.object({
  autoEnabled: z.boolean(),
  levelsEnabled: z.boolean(),
  announce: z.enum(ANNOUNCE_MODES),
  startMode: z.enum(['quiet', 'fresh']).nullable(),
  autoSince: z.number().nullable(),
});

export const achievementsManifest = defineServerModule({
  key: 'achievements',
  policyKey: 'achievements',
  routes: registerAchievementRoutes,
  commands: achievementsCommands,
  endSteps: [achievementsEndStep],
  activityListeners: [onActivity],
  reports: [
    {
      key: 'achievements',
      order: 90,
      meta: {
        title: 'report.section.achievements',
        tables: [
          { key: 'students', title: 'report.achievements.byStudent' },
          { key: 'categories', title: 'report.achievements.byCategory' },
          { key: 'teachers', title: 'report.achievements.byTeacher' },
        ],
      },
      build: achievementsSection,
    },
  ],
  timeline: [{ key: 'achievements', order: 90, build: achievementsTimeline }],
  studentPage: [{ key: 'achievements', order: 30, build: studentSection }],
  config: { schema: achievementsConfigSchema, defaults: DEFAULT_SETTINGS },
});
