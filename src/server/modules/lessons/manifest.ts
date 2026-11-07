/** Lesson lifecycle, polling, timer and the core reflection step (core, LES-1..4). */
import { defineServerModule } from '../manifest.ts';
import { lessonCommands } from './commands.ts';
import { reflectionStep } from './endSteps.ts';
import { registerLessonRoutes } from './routes.ts';

export const lessonsManifest = defineServerModule({
  key: 'lessons',
  policyKey: null,
  routes: registerLessonRoutes,
  commands: lessonCommands,
  endSteps: [reflectionStep],
});
