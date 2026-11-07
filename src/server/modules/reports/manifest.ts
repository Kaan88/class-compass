/** Statistics and reports (S11: RPT-1..6): sections come from every module manifest (`reports`, `timeline`). */
import { defineServerModule } from '../manifest.ts';
import { registerReportRoutes } from './routes.ts';

export const reportsManifest = defineServerModule({ key: 'reports', policyKey: null, routes: registerReportRoutes });
