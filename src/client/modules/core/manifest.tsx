/** Core teacher-area pages that every teacher has (profile, the Class setup hub, class settings, roster, list import, reports). */
import { ClassSettingsPage, TeacherStudentsPage } from '../../routes/teacher/Classes.tsx';
import { ImportPage } from '../../routes/teacher/Import.tsx';
import { ProfilePage } from '../../routes/teacher/Teacher.tsx';
import { SetupHub } from '../../routes/teacher/Setup.tsx';
import { TeacherReportsPage } from '../../reports/ReportsPage.tsx';
import { IconChart, IconSettings, IconSliders, IconUpload, IconUser, IconUsers } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { registerCoreTopBar } from './topBar.tsx';

// Quote of the day and weather on the classroom top bar (S13b).
registerCoreTopBar();

export const coreClientManifest = defineClientModule({
  key: 'core',
  policyKey: null,
  i18nNamespace: 'teacher',
  teacherPages: [
    // Profile is in the menu's small row and the nav (S14e3, D-156), not a tile.
    { key: 'profile', path: 'profile', labelKey: 'teacher.profile', Icon: IconUser, order: 10, menu: false, Component: ProfilePage },
    // The Class setup hub (S14e3, D-156): one tile on the menu, tabs of the setup pages.
    { key: 'setup', path: 'setup', labelKey: 'teacher.setup', Icon: IconSliders, order: 15, menu: false, Component: SetupHub },
    { key: 'classes', path: 'classes', labelKey: 'teacher.classSettings', Icon: IconSettings, order: 20, group: 'setup', setupTab: 'classes', Component: ClassSettingsPage },
    { key: 'students', path: 'students', labelKey: 'teacher.students', Icon: IconUsers, order: 30, group: 'setup', setupTab: 'classes', Component: TeacherStudentsPage },
    { key: 'import', path: 'import', labelKey: 'teacher.import', Icon: IconUpload, order: 35, group: 'setup', setupTab: 'classes', Component: ImportPage },
    // Statistics and reports of the teacher's own classes (S11, RPT-1..6).
    { key: 'reports', path: 'reports', labelKey: 'teacher.reports', Icon: IconChart, order: 120, group: 'today', Component: TeacherReportsPage },
  ],
});
