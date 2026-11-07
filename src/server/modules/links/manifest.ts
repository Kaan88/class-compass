/**
 * Personal student links (S10: STU-1..7). A core module (always on): the student page shows the
 * sections of the modules enabled for each of the student's classes and subjects.
 */
import { setStudentResolver } from '../../lib/http.ts';
import { defineServerModule } from '../manifest.ts';
import { registerLinkRoutes } from './routes.ts';
import { resolveStudent } from './service.ts';

export const linksManifest = defineServerModule({
  key: 'links',
  policyKey: null,
  routes: (app, deps) => {
    // Every student request re-checks its link (revocation and regeneration act at once, STU-3).
    setStudentResolver(resolveStudent);
    registerLinkRoutes(app, deps);
  },
});
