import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/mcp.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route, setMcpResolver } from '../../lib/http.ts';
import { accountView, adminRevoke, adminView, createToken, resolveBearer, revokeOwn, setSettings } from './tokens.ts';
import { registerMcpTransport } from './transport.ts';

export function registerMcpRoutes(app: FastifyInstance, deps: AppDeps) {
  setMcpResolver(resolveBearer);
  // Profile → AI tools: `account` access, so a locked classroom device answers 423 (the PIN cannot be bypassed).
  route(app, deps, C.aiToolsAccount, (ctx) => accountView(ctx));
  // Rate-limited like the other password checks (re-authentication); at most MCP_TOKENS_PER_USER live tokens per account.
  route(app, deps, C.createAiToken, (ctx, input) => createToken(ctx, input), { rateLimit: { max: 30, timeWindow: '15 minutes' } });
  route(app, deps, C.revokeAiToken, (ctx, input) => revokeOwn(ctx, input.tokenId));
  // Admin → AI tools.
  route(app, deps, C.aiToolsAdmin, (ctx) => adminView(ctx));
  route(app, deps, C.setAiToolsSettings, (ctx, input) => setSettings(ctx, input));
  route(app, deps, C.adminRevokeAiToken, (ctx, input) => adminRevoke(ctx, input.tokenId));
  registerMcpTransport(app, deps);
}
