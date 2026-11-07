/** Core teacher-area pages that every teacher has (profile, class settings, roster, list import, reports). */
import { ClassSettingsPage, TeacherStudentsPage } from '../../routes/teacher/Classes.tsx';
import { ImportPage } from '../../routes/teacher/Import.tsx';
import { ProfilePage } from '../../routes/teacher/Teacher.tsx';
import { TeacherReportsPage } from '../../reports/ReportsPage.tsx';
import { IconChart, IconList, IconSettings, IconUser, IconUsers } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';

export const coreClientManifest = defineClientModule({
  key: 'core',
  policyKey: null,
  i18nNamespace: 'teacher',
  teacherPages: [
    { key: 'profile', path: 'profile', labelKey: 'teacher.profile', Icon: IconUser, order: 10, Component: ProfilePage },
    { key: 'classes', path: 'classes', labelKey: 'teacher.classSettings', Icon: IconSettings, order: 20, Component: ClassSettingsPage },
    { key: 'students', path: 'students', labelKey: 'teacher.students', Icon: IconUsers, order: 30, Component: TeacherStudentsPage },
    { key: 'import', path: 'import', labelKey: 'teacher.import', Icon: IconList, order: 35, Component: ImportPage },
    // Statistics and reports of the teacher's own classes (S11, RPT-1..6).
    { key: 'reports', path: 'reports', labelKey: 'teacher.reports', Icon: IconChart, order: 120, Component: TeacherReportsPage },
  ],
});
