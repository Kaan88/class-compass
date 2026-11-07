/** Data and maintenance (S11: OPS-2..5, DAT-1..5): backup status, exports and the year rollover. */
import { defineServerModule } from '../manifest.ts';
import { registerMaintenanceRoutes } from './routes.ts';

export const maintenanceManifest = defineServerModule({ key: 'maintenance', policyKey: null, routes: registerMaintenanceRoutes });
