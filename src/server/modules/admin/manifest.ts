/** Accounts and the audit log (core, admin only). */
import { defineServerModule } from '../manifest.ts';
import { registerAdminRoutes } from './routes.ts';

export const adminManifest = defineServerModule({ key: 'admin', policyKey: null, routes: registerAdminRoutes });
