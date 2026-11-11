/**
 * AI tools (S14h1, D-160, D-161): personal tokens for the `/mcp` endpoint and the school's privacy
 * switches. Tokens are made only through `account` endpoints (PIN-gated in classroom mode) with
 * re-authentication; the secret is returned once and only its HMAC is stored. Administrators see and
 * revoke every token (never a secret) and set the switches on Admin → AI tools (audited).
 */
import { z } from 'zod';
import { AI_APPS, AI_PRIVACY_MODES, MCP_SCOPES, MCP_TOKEN_MAX_DAYS, MCP_TOKEN_NAME_MAX } from '../mcp.ts';
import { endpoint, Empty, Ok } from './define.ts';
import { Id } from './school.ts';

export const McpScopeSchema = z.enum(MCP_SCOPES);
export const AiPrivacyMode = z.enum(AI_PRIVACY_MODES);
export const AI_TOKEN_STATUSES = ['active', 'expired', 'revoked'] as const;

/** A token as its owner sees it: never the secret or its hash. */
export const AiToken = z.object({
  id: z.string(),
  kind: z.enum(['pat', 'oauth']),
  name: z.string(),
  /** The first characters of the secret (`ccmcp_ab12`), to recognise it in a client's settings. */
  prefix: z.string(),
  scopes: z.array(McpScopeSchema),
  privacy: AiPrivacyMode,
  status: z.enum(AI_TOKEN_STATUSES),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
});
export type AiToken = z.infer<typeof AiToken>;

/** An OAuth connection (S14h2, D-160): what one account allowed one app on the consent page. */
export const AI_CONNECTION_STATUSES = ['active', 'expired', 'revoked'] as const;
export const AiConnection = z.object({
  id: z.string(),
  clientName: z.string(),
  redirectHost: z.string(),
  scopes: z.array(McpScopeSchema),
  privacy: AiPrivacyMode,
  status: z.enum(AI_CONNECTION_STATUSES),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
});
export type AiConnection = z.infer<typeof AiConnection>;
export const AdminAiConnection = AiConnection.extend({ userId: z.string(), userName: z.string(), userRole: z.enum(['admin', 'teacher']) });
export type AdminAiConnection = z.infer<typeof AdminAiConnection>;

export const OAuthClientView = z.object({
  id: z.string(),
  kind: z.enum(['dcr', 'cimd']),
  name: z.string(),
  /** For a metadata document its address, for a registration our id. */
  clientId: z.string(),
  redirectHosts: z.array(z.string()),
  status: z.enum(['active', 'expired', 'revoked']),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  activeConnections: z.number().int(),
});
export type OAuthClientView = z.infer<typeof OAuthClientView>;

export const AiToolsAccount = z.object({
  /** The administrator switched AI tools on. */
  enabled: z.boolean(),
  /** Names and student text may leave the school (otherwise every token is pseudonymous). */
  studentDataAllowed: z.boolean(),
  /** Longest lifetime the administrator allows (days) and the suggested one. */
  maxDays: z.number().int(),
  defaultDays: z.number().int(),
  /** The scopes this account can grant (by role). */
  scopes: z.array(McpScopeSchema),
  /** The address to give an AI client (`<PUBLIC_ORIGIN>/mcp`). */
  url: z.string(),
  /** Personal tokens (OAuth access tokens are not listed: their connection is). */
  tokens: z.array(AiToken),
  /** Apps connected through the consent page (S14h2). */
  connections: z.array(AiConnection),
});
export type AiToolsAccount = z.infer<typeof AiToolsAccount>;

export const aiToolsAccount = endpoint({ method: 'GET', path: '/api/account/ai-tools', access: 'account', input: Empty, output: AiToolsAccount });

export const CreateAiTokenInput = z.object({
  name: z.string().trim().min(1).max(MCP_TOKEN_NAME_MAX),
  scopes: z.array(McpScopeSchema).min(1).max(MCP_SCOPES.length),
  days: z.number().int().min(1).max(MCP_TOKEN_MAX_DAYS),
  privacy: AiPrivacyMode.default('pseudonymous'),
  /** Re-authentication: password accounts type their password; email-link accounts need a fresh email sign-in (D-108). */
  currentPassword: z.string().min(1).max(200).optional(),
});
/** Make a personal token. The secret is in this response only. */
export const createAiToken = endpoint({
  method: 'POST',
  path: '/api/account/ai-tools/tokens',
  access: 'account',
  input: CreateAiTokenInput,
  output: z.object({ secret: z.string(), token: AiToken }),
});
export const revokeAiToken = endpoint({ method: 'POST', path: '/api/account/ai-tools/tokens/:tokenId/revoke', access: 'account', input: z.object({ tokenId: Id }), output: Ok });

// ---------------------------------------------------------------- "Connect an AI app" (S19c, D-181)
/**
 * The last successful call of one app for this account, from the call log (`mcp_calls`: method, time,
 * outcome; never arguments or results) joined with the token or connection that made it. `name` is the
 * connection's app name (the app's own, untrusted text) or the personal token's name.
 */
export const AiAppCall = z.object({
  at: z.number(),
  /** The tool's name (`list_my_classes`), our own vocabulary. */
  tool: z.string(),
  via: z.enum(['connection', 'token']),
  name: z.string(),
  /** The connection or token still works (not ended, expired or revoked). */
  live: z.boolean(),
});
export type AiAppCall = z.infer<typeof AiAppCall>;
export const AiAppStatus = z.object({
  app: z.enum(AI_APPS),
  /** The return host this app's sign-in needs (null: none). */
  returnHost: z.string().nullable(),
  /** The administrator has allowed that host (true when none is needed). */
  returnHostAllowed: z.boolean(),
  /** The last successful tool call from this app (null: none in the call log, which is kept 180 days). */
  lastToolCall: AiAppCall.nullable(),
  /** The last successful request of any kind (connecting, listing tools), to tell "connected, no tool used yet". */
  lastSeenAt: z.number().nullable(),
});
export type AiAppStatus = z.infer<typeof AiAppStatus>;
export const AiToolsSetup = z.object({
  enabled: z.boolean(),
  studentDataAllowed: z.boolean(),
  /** `<PUBLIC_ORIGIN>/mcp`, from the server's configuration. */
  url: z.string(),
  apps: z.array(AiAppStatus),
});
export type AiToolsSetup = z.infer<typeof AiToolsSetup>;
/** Profile → AI tools → "Connect an AI app" and its "Check connection" (`account`: PIN-gated in classroom mode). */
export const aiToolsSetup = endpoint({ method: 'GET', path: '/api/account/ai-tools/setup', access: 'account', input: Empty, output: AiToolsSetup });

// ---------------------------------------------------------------- administrators
/** Typed to switch on "student data to AI tools" (D-161). */
export const AI_STUDENT_DATA_CONFIRM = 'STUDENT DATA';

export const AiToolsSettings = z.object({ mcpEnabled: z.boolean(), aiStudentDataAllowed: z.boolean(), mcpTokenMaxDays: z.number().int() });
export type AiToolsSettings = z.infer<typeof AiToolsSettings>;

export const AdminAiToken = AiToken.extend({ userId: z.string(), userName: z.string(), userRole: z.enum(['admin', 'teacher']) });
export type AdminAiToken = z.infer<typeof AdminAiToken>;

export const AiToolsAdmin = z.object({
  settings: AiToolsSettings,
  url: z.string(),
  tokens: z.array(AdminAiToken),
  /** OAuth (S14h2): every connection, the registered apps and the redirect host allow-list. */
  connections: z.array(AdminAiConnection),
  clients: z.array(OAuthClientView),
  redirectHosts: z.array(z.string()),
  /** Calls in the last 7 days (counts only; arguments are never logged). */
  calls: z.object({ total: z.number().int(), errors: z.number().int(), denied: z.number().int() }),
  /** The last successful tool call by anyone at the school (S19c setup checklist: "a first call worked"). */
  lastToolCallAt: z.number().nullable(),
});
export type AiToolsAdmin = z.infer<typeof AiToolsAdmin>;

export const aiToolsAdmin = endpoint({ method: 'GET', path: '/api/admin/ai-tools', access: 'admin', input: Empty, output: AiToolsAdmin });
/** Change the switches (audited). Turning student data on needs `confirm` = AI_STUDENT_DATA_CONFIRM. */
export const setAiToolsSettings = endpoint({
  method: 'PUT',
  path: '/api/admin/ai-tools',
  access: 'admin',
  input: z.object({
    mcpEnabled: z.boolean().optional(),
    aiStudentDataAllowed: z.boolean().optional(),
    mcpTokenMaxDays: z.number().int().min(1).max(MCP_TOKEN_MAX_DAYS).optional(),
    confirm: z.string().max(40).optional(),
  }),
  output: AiToolsSettings,
});
export const adminRevokeAiToken = endpoint({ method: 'POST', path: '/api/admin/ai-tools/tokens/:tokenId/revoke', access: 'admin', input: z.object({ tokenId: Id }), output: Ok });

// ---------------------------------------------------------------- the MCP transport (JSON-RPC; not JSON contracts)
/** POST `/mcp`: one JSON-RPC message (or a batch on 2025-03-26). Bearer token only. */
export const mcpPost = endpoint({ method: 'POST', path: '/mcp', access: 'mcp', input: z.object({}), output: z.unknown() });
/** DELETE `/mcp`: ends the session named in `Mcp-Session-Id`. */
export const mcpDelete = endpoint({ method: 'DELETE', path: '/mcp', access: 'mcp', input: z.object({}), output: z.unknown() });
