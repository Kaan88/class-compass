/** Lesson lifecycle, polling, timer and the core reflection step (core, LES-1..4). */
import { defineServerModule } from '../manifest.ts';
import { lessonReflectionsSection, lessonTopicsSection, lessonTopicsTimeline, overviewSection } from './report.ts';
import { lessonCommands } from './commands.ts';
import { reflectionStep } from './endSteps.ts';
import { registerLessonRoutes } from './routes.ts';

export const lessonsManifest = defineServerModule({
  key: 'lessons',
  policyKey: null,
  routes: registerLessonRoutes,
  commands: lessonCommands,
  endSteps: [reflectionStep],
  reports: [
    { key: 'overview', order: 10, meta: { title: 'report.section.overview', tables: [{ key: 'lessonsPerWeek', title: 'report.overview.perWeek' }] }, build: overviewSection },
    { key: 'lessonTopics', order: 15, meta: { title: 'report.section.lessonTopics', tables: [{ key: 'topics', title: 'report.topics.perTopic' }] }, build: lessonTopicsSection },
    { key: 'lessonReflections', order: 60, meta: { title: 'report.section.lessonReflections', tables: [{ key: 'lessons', title: 'report.reflections.lessons' }] }, build: lessonReflectionsSection },
  ],
  timeline: [{ key: 'lessonTopics', order: 10, build: lessonTopicsTimeline }],
});
