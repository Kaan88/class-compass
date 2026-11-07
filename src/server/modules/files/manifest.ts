/** Uploads and protected file access (core, S9: STU-8, D-014, CRD-1). */
import { defineServerModule } from '../manifest.ts';
import { registerFileRoutes } from './routes.ts';

export const filesManifest = defineServerModule({ key: 'files', policyKey: null, routes: registerFileRoutes });
