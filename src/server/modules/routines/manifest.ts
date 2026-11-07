/** Routine templates (RTN-1..3). Stage commands are lesson commands (`lesson.setStage`). */
import { defineServerModule } from '../manifest.ts';
import { registerRoutineRoutes } from './routes.ts';

export const routinesManifest = defineServerModule({ key: 'routines', policyKey: 'routines', routes: registerRoutineRoutes });
