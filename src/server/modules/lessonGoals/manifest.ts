/**
 * Lesson goals (S25d, D-188): an optional goal sentence for a lesson, opt-in per class+subject (the
 * catalogue's `contextDefault: 'off'`). Start Lesson step, board box (lesson state), End Lesson review
 * and a report section. Only this folder writes `lesson_goals`.
 */
import { defineServerModule } from '../manifest.ts';
import { lessonGoalEndStep, lessonGoalStartStep, lessonGoalsCommands } from './commands.ts';
import { lessonGoalsSection } from './report.ts';
import { lessonGoalLessonState } from './routes.ts';

export const lessonGoalsManifest = defineServerModule({
  key: 'lessonGoals',
  policyKey: 'lessonGoals',
  commands: lessonGoalsCommands,
  lessonState: [lessonGoalLessonState],
  startSteps: [lessonGoalStartStep],
  endSteps: [lessonGoalEndStep],
  reports: [
    {
      key: 'lessonGoals',
      order: 16,
      meta: {
        title: 'report.section.lessonGoals',
        tables: [
          { key: 'outcomes', title: 'report.lessonGoals.outcomes' },
          { key: 'lessons', title: 'report.lessonGoals.lessons' },
        ],
      },
      build: lessonGoalsSection,
    },
  ],
});
