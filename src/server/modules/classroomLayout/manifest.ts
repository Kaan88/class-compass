/** Classroom board layouts (S14b, D-148): each teacher's own board layout per class+subject or for all of them. Core. */
import { defineServerModule } from '../manifest.ts';
import { registerClassroomLayoutRoutes } from './routes.ts';

export const classroomLayoutManifest = defineServerModule({ key: 'classroomLayout', policyKey: null, routes: registerClassroomLayoutRoutes });
