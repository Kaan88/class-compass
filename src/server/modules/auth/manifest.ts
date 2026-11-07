/** Sign-in, sessions, PIN lock, preferences and the command endpoint (core, always on). */
import { defineServerModule } from '../manifest.ts';
import { registerAuthRoutes } from './routes.ts';

export const authManifest = defineServerModule({ key: 'auth', policyKey: null, routes: registerAuthRoutes });
