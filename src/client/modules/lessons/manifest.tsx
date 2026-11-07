/**
 * Lesson lifecycle on the classroom device: the core reflection step, lesson command refreshes and
 * (S13a) lesson topics: the "Today's topic" start step, "Today's focus" on the dashboard and the
 * teacher's topic page (weekly plan, custom topics and icons).
 */
import { TopicsPage } from '../../routes/teacher/Topics.tsx';
import { IconBook } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { reflectionStepUi } from './ReflectionStep.tsx';
import { lessonInvalidation } from './lessonClient.ts';
import { focusDashboardSlot, topicStartStep } from './TopicsClassroom.tsx';

export const lessonsClientManifest = defineClientModule({
  key: 'lessons',
  policyKey: null,
  i18nNamespace: 'lesson',
  endSteps: [reflectionStepUi],
  startSteps: [topicStartStep],
  dashboardSlots: [focusDashboardSlot],
  teacherPages: [{ key: 'topics', path: 'topics', labelKey: 'teacher.topics', Icon: IconBook, order: 45, Component: TopicsPage }],
  invalidations: [lessonInvalidation],
});
