import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/aiConnections.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { finishOAuth, startOAuth } from './oauth.ts';
import { adminView, createConnection, deleteConnection, loadManaged, ownView, setSettings, updateConnection } from './service.ts';
import { testConnection } from './testConnection.ts';

/** A test reaches the provider (and costs tokens): 20 per 15 minutes per address. */
const TEST_LIMIT = { rateLimit: { max: 20, timeWindow: '15 minutes' } };
const OAUTH_LIMIT = { rateLimit: { max: 20, timeWindow: '15 minutes' } };

export function registerAiConnectionRoutes(app: FastifyInstance, deps: AppDeps) {
  // Administrators: the school's connections, the default and the "own connections" switch.
  route(app, deps, C.aiConnectionsAdmin, (ctx) => adminView(ctx));
  route(app, deps, C.createAiConnection, (ctx, input) => createConnection(ctx, input, 'school'));
  route(app, deps, C.updateAiConnection, (ctx, input) => updateConnection(ctx, input, 'school'));
  route(app, deps, C.deleteAiConnection, (ctx, input) => deleteConnection(ctx, input.connectionId, 'school'));
  route(app, deps, C.testAiConnection, (ctx, input) => testConnection(ctx, loadManaged(ctx, input.connectionId, 'school'), input.model), TEST_LIMIT);
  route(app, deps, C.startAiConnectionOAuth, (ctx, input) => startOAuth(ctx, input.connectionId, 'school'), OAUTH_LIMIT);
  route(app, deps, C.setAiConnectionSettings, (ctx, input) => setSettings(ctx, input));
  // Teachers: their own connections, only while allowed, visible to nobody else.
  route(app, deps, C.ownAiConnections, (ctx) => ownView(ctx));
  route(app, deps, C.createOwnAiConnection, (ctx, input) => createConnection(ctx, { ...input, localNetwork: false }, 'personal'));
  route(app, deps, C.updateOwnAiConnection, (ctx, input) => updateConnection(ctx, input, 'personal'));
  route(app, deps, C.deleteOwnAiConnection, (ctx, input) => deleteConnection(ctx, input.connectionId, 'personal'));
  route(app, deps, C.testOwnAiConnection, (ctx, input) => testConnection(ctx, loadManaged(ctx, input.connectionId, 'personal'), input.model), TEST_LIMIT);
  route(app, deps, C.startOwnAiConnectionOAuth, (ctx, input) => startOAuth(ctx, input.connectionId, 'personal'), OAUTH_LIMIT);
  // The provider's return (both roles).
  route(app, deps, C.finishAiConnectionOAuth, (ctx, input) => finishOAuth(ctx, input), OAUTH_LIMIT);
}
