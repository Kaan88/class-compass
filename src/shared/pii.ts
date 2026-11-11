/**
 * The personal-data marks of contract fields (D-161), apart from the rest of the AI tools vocabulary in
 * `mcp.ts` (S26c, D-191): every shared contract imports `pii`, so this file is part of every client entry,
 * the student page included; `mcp.ts` (scopes, OAuth, AI apps) is loaded only by the screens that use it.
 */
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
