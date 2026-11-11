/**
 * AI connections for the assistant (core, S19a, D-179): the school's and teachers' own connections to
 * model providers, sealed secrets, limits and usage, "Test connection", sign-in with OpenRouter, and
 * the provider adapters (`provider.ts` → `streamChat`) the assistant's agent loop (S19b) uses.
 */
import { defineServerModule } from '../manifest.ts';
import { registerAiConnectionRoutes } from './routes.ts';

export const aiConnectionsManifest = defineServerModule({ key: 'aiConnections', policyKey: null, routes: registerAiConnectionRoutes });
