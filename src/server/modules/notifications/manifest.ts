/**
 * Teacher notifications (S14e3, D-155): a core module. Its sink (`notificationSink`) receives every
 * `notify()` event (lib/notify.ts) inside the writing transaction; its routes serve the bell, the page
 * and the settings; `runNotificationTick` (digest.ts, every 5 minutes from main.ts) sends the optional
 * daily digest and purges old rows.
 */
import { defineServerModule } from '../manifest.ts';
import { registerNotificationRoutes } from './routes.ts';
import { writeNotifications } from './writer.ts';

export const notificationsManifest = defineServerModule({ key: 'notifications', policyKey: null, routes: registerNotificationRoutes, notificationSink: writeNotifications });
