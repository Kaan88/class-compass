/** Core teacher-area pages that every teacher has (profile, class settings, roster). */
import { ClassSettingsPage, TeacherStudentsPage } from '../../routes/teacher/Classes.tsx';
import { ProfilePage } from '../../routes/teacher/Teacher.tsx';
import { IconSettings, IconUser, IconUsers } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';

export const coreClientManifest = defineClientModule({
  key: 'core',
  policyKey: null,
  i18nNamespace: 'teacher',
  teacherPages: [
    { key: 'profile', path: 'profile', labelKey: 'teacher.profile', Icon: IconUser, order: 10, Component: ProfilePage },
    { key: 'classes', path: 'classes', labelKey: 'teacher.classSettings', Icon: IconSettings, order: 20, Component: ClassSettingsPage },
    { key: 'students', path: 'students', labelKey: 'teacher.students', Icon: IconUsers, order: 30, Component: TeacherStudentsPage },
  ],
});
