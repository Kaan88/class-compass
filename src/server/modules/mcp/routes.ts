import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/mcp.ts';
import * as O from '../../../shared/contracts/oauth.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route, setMcpResolver } from '../../lib/http.ts';
import { accountView, adminRevoke, adminView, createToken, resolveBearer, revokeOwn, setSettings } from './tokens.ts';
import { setupView } from './setup.ts';
import { registerMcpTransport } from './transport.ts';
import { addDocumentedRedirectHost, adminDisconnect, adminRevokeClient, decide, disconnectOwn, requestView, setRedirectHosts } from './oauth/consent.ts';
import { registerOAuthProtocol } from './oauth/protocol.ts';

export function registerMcpRoutes(app: FastifyInstance, deps: AppDeps) {
  setMcpResolver(resolveBearer);
  // Profile → AI tools: `account` access, so a locked classroom device answers 423 (the PIN cannot be bypassed).
  route(app, deps, C.aiToolsAccount, (ctx) => accountView(ctx));
  // "Connect an AI app" (S19c, D-181): per app its return host and last successful call (from the call log, no new tracking).
  route(app, deps, C.aiToolsSetup, (ctx) => setupView(ctx));
  // Rate-limited like the other password checks (re-authentication); at most MCP_TOKENS_PER_USER live tokens per account.
  route(app, deps, C.createAiToken, (ctx, input) => createToken(ctx, input), { rateLimit: { max: 30, timeWindow: '15 minutes' } });
  route(app, deps, C.revokeAiToken, (ctx, input) => revokeOwn(ctx, input.tokenId));
  // Admin → AI tools.
  route(app, deps, C.aiToolsAdmin, (ctx) => adminView(ctx));
  route(app, deps, C.setAiToolsSettings, (ctx, input) => setSettings(ctx, input));
  route(app, deps, C.adminRevokeAiToken, (ctx, input) => adminRevoke(ctx, input.tokenId));
  registerMcpTransport(app, deps);

  // OAuth for AI apps (S14h2): the consent page (`account`: PIN-gated, password again for Allow) and connections.
  route(app, deps, O.getOAuthRequest, (ctx, input, http) => requestView(ctx, input.requestId, http.req));
  route(app, deps, O.decideOAuthRequest, (ctx, input, http) => decide(ctx, input, http.req), { rateLimit: { max: 100, timeWindow: '15 minutes' } });
  route(app, deps, O.revokeAiConnection, (ctx, input) => disconnectOwn(ctx, input.connectionId));
  route(app, deps, O.adminRevokeAiConnection, (ctx, input) => adminDisconnect(ctx, input.connectionId));
  route(app, deps, O.adminRevokeOAuthClient, (ctx, input) => adminRevokeClient(ctx, input.clientRowId));
  route(app, deps, O.setOAuthRedirectHosts, (ctx, input) => setRedirectHosts(ctx, input));
  route(app, deps, O.addDocumentedOAuthRedirectHost, (ctx, input) => addDocumentedRedirectHost(ctx, input));
  // The protocol endpoints (`oauth` access class): discovery, registration, authorize, token, revoke.
  registerOAuthProtocol(app, deps);
}
