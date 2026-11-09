/**
 * AI tools (S14h1, D-160, D-161): personal tokens for the `/mcp` endpoint and the school's privacy
 * switches. Tokens are made only through `account` endpoints (PIN-gated in classroom mode) with
 * re-authentication; the secret is returned once and only its HMAC is stored. Administrators see and
 * revoke every token (never a secret) and set the switches on Admin → AI tools (audited).
 */
import { z } from 'zod';
import { AI_PRIVACY_MODES, MCP_SCOPES, MCP_TOKEN_MAX_DAYS, MCP_TOKEN_NAME_MAX } from '../mcp.ts';
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
  tokens: z.array(AiToken),
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
  /** Calls in the last 7 days (counts only; arguments are never logged). */
  calls: z.object({ total: z.number().int(), errors: z.number().int(), denied: z.number().int() }),
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
