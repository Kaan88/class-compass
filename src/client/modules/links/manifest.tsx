/** Personal student links (S10, STU-1..7): make, print (local QR) and revoke links per student or class. Core: always on. */
import { StudentLinksPage } from '../../routes/teacher/StudentLinks.tsx';
import { IconLink } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';

export const linksClientManifest = defineClientModule({
  key: 'links',
  policyKey: null,
  i18nNamespace: 'links',
  teacherPages: [{ key: 'studentLinks', path: 'student-links', labelKey: 'teacher.studentLinks', Icon: IconLink, order: 37, group: 'setup', setupTab: 'classes', Component: StudentLinksPage }],
});
