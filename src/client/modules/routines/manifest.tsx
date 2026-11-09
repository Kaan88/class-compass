/** Routines: Start Lesson routine choice, stage stepper beside the timer, templates page (RTN-1..3). */
import { RoutinesPage } from '../../routes/teacher/Routines.tsx';
import { IconList } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { routineDashboardSlot, routineStartStep } from './RoutineClassroom.tsx';

export const routinesClientManifest = defineClientModule({
  key: 'routines',
  policyKey: 'routines',
  i18nNamespace: 'routines',
  dashboardSlots: [routineDashboardSlot],
  startSteps: [routineStartStep],
  teacherPages: [{ key: 'routines', path: 'routines', labelKey: 'teacher.routines', Icon: IconList, order: 50, group: 'setup', setupTab: 'lessons', module: 'routines', Component: RoutinesPage }],
});
