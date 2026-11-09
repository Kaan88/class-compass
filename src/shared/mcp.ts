/**
 * AI tools over MCP (S14h1, D-160 and D-161): the shared vocabulary of the `/mcp` endpoint, the
 * personal tokens and the privacy gate. The server (`server/modules/mcp/`) and the Profile and Admin
 * screens read these lists, so a scope or a data category is named once.
 */

/** The path of the Streamable HTTP MCP endpoint on the main origin. */
export const MCP_PATH = '/mcp';

/**
 * What a token may do. Teacher scopes follow the teacher's own app permissions (every call still runs
 * the normal ownership checks); the last three are for administrator accounts only. Exports, erasure,
 * backups, credentials, link tokens and files are never reachable through any scope.
 */
export const MCP_SCOPES = [
  'classes:read',
  'reports:read',
  'goals:read',
  'goals:write',
  'homework:write',
  'classroom:command',
  'settings:write',
  'settings:admin',
  'themes:write',
  'school:read',
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const ADMIN_ONLY_SCOPES: readonly McpScope[] = ['settings:admin', 'themes:write', 'school:read'];
export const TEACHER_SCOPES: readonly McpScope[] = MCP_SCOPES.filter((s) => !ADMIN_ONLY_SCOPES.includes(s));

/** The scopes an account of this role can hold (an administrator has no classes of their own). */
export function scopesForRole(role: 'admin' | 'teacher'): McpScope[] {
  return role === 'admin' ? [...ADMIN_ONLY_SCOPES] : [...TEACHER_SCOPES];
}
/** Read-only scopes (the Profile form selects these by default). */
export const READ_SCOPES: readonly McpScope[] = ['classes:read', 'reports:read', 'goals:read', 'school:read'];

/** Personal tokens: `ccmcp_` + 43 URL-safe characters (256 bits), shown once. */
export const MCP_TOKEN_PREFIX = 'ccmcp_';
export const MCP_TOKEN_DEFAULT_DAYS = 30;
/** The administrator's cap on a token's lifetime can be at most this many days. */
export const MCP_TOKEN_MAX_DAYS = 90;
export const MCP_TOKEN_NAME_MAX = 60;
/** Live (not revoked, not expired) personal tokens per account. */
export const MCP_TOKENS_PER_USER = 10;

/**
 * Privacy modes (D-161). `pseudonymous`: students are "Student N" (stable per token family), student
 * text is withheld and names in teacher text are replaced. `named`: names and student text leave the
 * school (student text wrapped as `{ untrustedText }`); only while the administrator allows it.
 */
export const AI_PRIVACY_MODES = ['pseudonymous', 'named'] as const;
export type AiPrivacyMode = (typeof AI_PRIVACY_MODES)[number];

/**
 * What leaves the school with "student data to AI tools" on (D-161); listed on Admin → AI tools before
 * the typed confirmation, and in the AI tools guide. Labels are `aiTools.category.<key>`.
 */
export const AI_STUDENT_DATA_CATEGORIES = ['names', 'goalText', 'reflections', 'evidenceText', 'feedback', 'homeworkStatus', 'attendance', 'counts'] as const;
/** Never leaves the school in either mode (labels `aiTools.never.<key>`). */
export const AI_NEVER_SHARED = ['files', 'notes', 'secret', 'levels', 'links', 'credentials', 'exports'] as const;

/**
 * Personal-data classification of contract fields (D-161). Output schemas mark string fields with
 * `.meta(pii(kind))`; the MCP privacy filter acts on the marks and a test fails on any unmarked string
 * field of an MCP-exposed output.
 * - none: no personal data (keys, codes, mime types, school names, theme keys)
 * - label: a staff-editable label (class, category, preset, routine names); names inside are replaced
 * - teacherText: free text written by staff; names inside are replaced in pseudonymous mode
 * - staffName: a teacher's or administrator's name (kept)
 * - studentName / studentInitials: replaced by the pseudonym in pseudonymous mode
 * - studentText: withheld in pseudonymous mode, `{ untrustedText }` in named mode
 * - authoredText: student text when the sibling `authorType` (or `src`) is 'student', otherwise teacher text
 * - note, level, file, secret, linkToken: never leave the school (the field is removed in both modes)
 */
export const PII_KINDS = [
  'none',
  'label',
  'teacherText',
  'staffName',
  'studentName',
  'studentInitials',
  'studentText',
  'authoredText',
  'note',
  'level',
  'file',
  'secret',
  'linkToken',
] as const;
export type PiiKind = (typeof PII_KINDS)[number];
/** Kinds that are removed from every MCP result, whatever the privacy mode. */
export const NEVER_LEAVES: readonly PiiKind[] = ['note', 'level', 'file', 'secret', 'linkToken'];

/** The metadata object for `.meta()`: `z.string().meta(pii('studentName'))`. */
export const pii = (kind: PiiKind) => ({ cc: { pii: kind } });

/** Calls per minute per token (each call costs at least 1; heavy tools cost more). */
export const MCP_RATE_PER_MINUTE = 120;
/** Largest tool result (serialised); longer results are cut with a note. */
export const MCP_RESULT_MAX_BYTES = 256 * 1024;
