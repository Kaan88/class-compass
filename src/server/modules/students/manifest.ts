/** Students, enrolments and rosters (core). */
import { defineServerModule } from '../manifest.ts';
import { registerStudentRoutes } from './routes.ts';

export const studentsManifest = defineServerModule({ key: 'students', policyKey: null, routes: registerStudentRoutes });
