/** School structure, module policies and per-context module switches (core). */
import { defineServerModule } from '../manifest.ts';
import { registerSchoolRoutes } from './routes.ts';

export const schoolManifest = defineServerModule({ key: 'school', policyKey: null, routes: registerSchoolRoutes });
