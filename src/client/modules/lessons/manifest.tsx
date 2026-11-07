/** Lesson lifecycle on the classroom device: the core reflection step and lesson command refreshes. */
import { defineClientModule } from '../types.ts';
import { reflectionStepUi } from './ReflectionStep.tsx';
import { lessonInvalidation } from './lessonClient.ts';

export const lessonsClientManifest = defineClientModule({
  key: 'lessons',
  policyKey: null,
  i18nNamespace: 'lesson',
  endSteps: [reflectionStepUi],
  invalidations: [lessonInvalidation],
});
