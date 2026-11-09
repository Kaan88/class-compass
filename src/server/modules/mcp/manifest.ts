/** AI tools over MCP (core, S14h1, D-160, D-161): personal tokens, the privacy switches and the `/mcp` endpoint. */
import { defineServerModule } from '../manifest.ts';
import { registerMcpRoutes } from './routes.ts';

export const mcpManifest = defineServerModule({ key: 'mcp', policyKey: null, routes: registerMcpRoutes });
