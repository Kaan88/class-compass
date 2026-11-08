/**
 * Student text checks (S13c item 12, D-123): a core module (always on). Admin block/allow lists and
 * goal limits, teacher words, the optional blocked-words notice (counts only) and hiding a student
 * entry from the student page. The checks themselves run inside the goals module's student writes.
 */
import { defineServerModule } from '../manifest.ts';
import { registerTextCheckRoutes } from './routes.ts';

export const textChecksManifest = defineServerModule({ key: 'textChecks', policyKey: null, routes: registerTextCheckRoutes });
