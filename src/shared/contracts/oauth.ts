/**
 * OAuth 2.1 for AI apps (S14h2, D-160): claude.ai, Claude Desktop and Claude Code connect to `/mcp`
 * after the teacher or administrator agrees on the consent page.
 *
 * - The protocol endpoints (`oauth` access class: discovery documents, registration, authorize, token,
 *   revoke) speak OAuth's own formats (form bodies, `{ error, error_description }`, redirects), so their
 *   contracts only name them for the permission matrix; the server registers them itself.
 * - The consent page uses two `account` endpoints (PIN-gated in classroom mode): read the waiting
 *   request, then allow (with the password again) or deny. The answer is the address to send the
 *   browser to (the app's registered redirect address with the code or the error, and the state).
 * - Connections (one per consent) are listed on Profile → AI tools and Admin → AI tools, where they can
 *   be ended; administrators also see registered apps and edit the redirect host allow-list.
 */
import { z } from 'zod';
import { AI_APP_RETURN_HOSTS, MCP_TOKEN_MAX_DAYS, OAUTH_PATHS, OAUTH_REDIRECT_HOSTS_MAX, OAUTH_WELL_KNOWN } from '../mcp.ts';
import { endpoint, Ok } from './define.ts';
import { AiPrivacyMode, McpScopeSchema } from './mcp.ts';
export { AdminAiConnection, AiConnection, OAuthClientView } from './mcp.ts';

const Protocol = { input: z.object({}), output: z.unknown() };
export const oauthResourceMetadata = endpoint({ method: 'GET', path: OAUTH_WELL_KNOWN.resource, access: 'oauth', ...Protocol });
export const oauthResourceMetadataMcp = endpoint({ method: 'GET', path: OAUTH_WELL_KNOWN.resourceMcp, access: 'oauth', ...Protocol });
export const oauthServerMetadata = endpoint({ method: 'GET', path: OAUTH_WELL_KNOWN.server, access: 'oauth', ...Protocol });
export const oauthRegister = endpoint({ method: 'POST', path: OAUTH_PATHS.register, access: 'oauth', ...Protocol });
export const oauthAuthorize = endpoint({ method: 'GET', path: OAUTH_PATHS.authorize, access: 'oauth', ...Protocol });
export const oauthToken = endpoint({ method: 'POST', path: OAUTH_PATHS.token, access: 'oauth', ...Protocol });
export const oauthRevoke = endpoint({ method: 'POST', path: OAUTH_PATHS.revoke, access: 'oauth', ...Protocol });

/** Why `/oauth/authorize` could not even send the browser back to the app (shown on our own page, never redirected). */
export const OAUTH_PAGE_ERRORS = ['MCP_DISABLED', 'UNKNOWN_CLIENT', 'CLIENT_METADATA', 'REDIRECT_URI', 'INVALID_REQUEST', 'REQUEST_GONE'] as const;
export type OAuthPageError = (typeof OAUTH_PAGE_ERRORS)[number];

// ---------------------------------------------------------------- the consent page
export const OAuthRequestView = z.object({
  requestId: z.string(),
  /** The app's own name: untrusted text, shown as written and never as markup. */
  clientName: z.string(),
  clientKind: z.enum(['dcr', 'cimd']),
  /** For a Client ID Metadata Document: the host of its address (which vouches for the name). */
  clientIdHost: z.string().nullable(),
  /** Where the browser will be sent with the code: shown prominently. */
  redirectHost: z.string(),
  /** The address is on this computer (http://localhost or 127.0.0.1): any program on it could receive the code. */
  redirectLoopback: z.boolean(),
  /** What may be granted (the app's request narrowed to this account's role); the person can narrow it further. */
  offered: z.array(McpScopeSchema),
  /** Ticked to start with. */
  preselected: z.array(McpScopeSchema),
  /** Asked for but not available to this account (administrator scopes for a teacher and the other way round). */
  notAvailable: z.array(McpScopeSchema),
  /** Asked for but unknown here (ignored). */
  unknown: z.array(z.string()),
  studentDataAllowed: z.boolean(),
  maxDays: z.number().int(),
  defaultDays: z.number().int(),
  expiresAt: z.number(),
});
export type OAuthRequestView = z.infer<typeof OAuthRequestView>;

export const getOAuthRequest = endpoint({ method: 'GET', path: '/api/account/oauth/requests/:requestId', access: 'account', input: z.object({ requestId: z.string().min(16).max(64) }), output: OAuthRequestView });

export const OAuthDecisionInput = z.object({
  requestId: z.string().min(16).max(64),
  allow: z.boolean(),
  scopes: z.array(McpScopeSchema).max(20).optional(),
  days: z.number().int().min(1).max(MCP_TOKEN_MAX_DAYS).optional(),
  privacy: AiPrivacyMode.optional(),
  /** Re-authentication for Allow (password accounts; email-link accounts need a fresh email sign-in). */
  currentPassword: z.string().min(1).max(200).optional(),
});
/** Allow or deny; the answer is where to send the browser (the app's redirect address with `code` or `error`, `state` and `iss`). */
export const decideOAuthRequest = endpoint({
  method: 'POST',
  path: '/api/account/oauth/requests/:requestId',
  access: 'account',
  input: OAuthDecisionInput,
  output: z.object({ redirectTo: z.string() }),
});

// ---------------------------------------------------------------- connections and registered apps
export const revokeAiConnection = endpoint({ method: 'POST', path: '/api/account/ai-tools/connections/:connectionId/revoke', access: 'account', input: z.object({ connectionId: z.string().uuid() }), output: Ok });
export const adminRevokeAiConnection = endpoint({ method: 'POST', path: '/api/admin/ai-tools/connections/:connectionId/revoke', access: 'admin', input: z.object({ connectionId: z.string().uuid() }), output: Ok });
export const adminRevokeOAuthClient = endpoint({ method: 'POST', path: '/api/admin/ai-tools/clients/:clientRowId/revoke', access: 'admin', input: z.object({ clientRowId: z.string().uuid() }), output: Ok });
/** The hosts an app's https redirect address may use (loopback is always allowed). Audited. */
export const setOAuthRedirectHosts = endpoint({
  method: 'PUT',
  path: '/api/admin/ai-tools/redirect-hosts',
  access: 'admin',
  input: z.object({ hosts: z.array(z.string().trim().min(1).max(253)).max(OAUTH_REDIRECT_HOSTS_MAX) }),
  output: z.object({ hosts: z.array(z.string()) }),
});
/**
 * Adds the documented return host of one app (`AI_APP_RETURN_HOSTS`: `claude.ai`, `chatgpt.com`) to the
 * allow-list on the server, inside one transaction, so the checklist's one-click button never sends the
 * whole list back (a host another administrator removed meanwhile stays removed). Audited (S19c, D-181).
 */
export const addDocumentedOAuthRedirectHost = endpoint({
  method: 'POST',
  path: '/api/admin/ai-tools/redirect-hosts/documented',
  access: 'admin',
  input: z.object({ app: z.enum(Object.keys(AI_APP_RETURN_HOSTS) as [keyof typeof AI_APP_RETURN_HOSTS, ...(keyof typeof AI_APP_RETURN_HOSTS)[]]) }),
  output: z.object({ hosts: z.array(z.string()) }),
});
