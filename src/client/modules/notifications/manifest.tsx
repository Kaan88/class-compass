/** Teacher notifications (S14e3, D-155): a core module with one "Today" page; the bell is in the teacher navigation and menu. */
import { IconBell } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { NotificationsPage } from './NotificationsPage.tsx';

export const notificationsClientManifest = defineClientModule({
  key: 'notifications',
  policyKey: null,
  i18nNamespace: 'notifications',
  teacherPages: [{ key: 'notifications', path: 'notifications', labelKey: 'notifications.title', Icon: IconBell, order: 125, group: 'today', Component: NotificationsPage }],
});
