/** Routine templates page (RTN-2). The stage stepper is part of the lesson dashboard. */
import { RoutinesPage } from '../../routes/teacher/Routines.tsx';
import { IconList } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';

export const routinesClientManifest = defineClientModule({
  key: 'routines',
  policyKey: 'routines',
  i18nNamespace: 'routines',
  teacherPages: [{ key: 'routines', path: 'routines', labelKey: 'teacher.routines', Icon: IconList, order: 50, Component: RoutinesPage }],
});
