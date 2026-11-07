/**
 * Student list importer (S9: IMP-1..7, D-013). Teachers import into classes they teach, admins into
 * any class, so the endpoints use the `account` access class (PIN-gated in classroom mode) and the
 * service checks the role and the class.
 *
 * Workflow (IMP-2): paste text or upload a file (`POST /api/files?kind=import_source`) → create a
 * draft batch (rows extracted, columns detected, rows flagged and matched) → adjust the field mapping
 * and the rows in the preview → commit → report. A committed batch can be reverted (IMP-5).
 */
import { z } from 'zod';
import { endpoint } from './define.ts';
import { Id } from './school.ts';

export const IMPORT_SOURCE_TYPES = ['paste', 'csv', 'xlsx', 'xls', 'docx', 'pdf', 'image'] as const;
export const IMPORT_FLAGS = [
  'low_confidence',
  'duplicate_in_file',
  'possible_match',
  'number_match',
  'number_elsewhere',
  'missing_name',
  'missing_number',
  'heading_ignored',
  'class_mismatch',
  /** A generic heading word that may also be a name ("Page", "Öğretmen"): visible, skipped by default. */
  'possible_heading',
  /** The same name with a different student number elsewhere in the file: two children, both kept. */
  'same_name_in_file',
  /** A student with this name exists outside the caller's classes (count only, ACC-4): needs a choice. */
  'name_elsewhere',
  /** The number matches an existing student whose name differs: needs a choice (IMP-4). */
  'number_conflict',
] as const;
export type ImportFlag = (typeof IMPORT_FLAGS)[number];
export const IMPORT_DECISIONS = ['add', 'match', 'skip'] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];
export const IMPORT_FIELDS = ['fullName', 'givenNames', 'familyName', 'studentNumber', 'className'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const ImportMapping = z.object({
  headerRow: z.number().int().min(0).nullable(),
  fullName: z.number().int().min(0).max(200).nullable(),
  givenNames: z.number().int().min(0).max(200).nullable(),
  familyName: z.number().int().min(0).max(200).nullable(),
  studentNumber: z.number().int().min(0).max(200).nullable(),
  className: z.number().int().min(0).max(200).nullable(),
});
export type ImportMapping = z.infer<typeof ImportMapping>;

export const ImportParsed = z.object({
  fullName: z.string(),
  givenNames: z.string().nullable(),
  familyName: z.string().nullable(),
  studentNumber: z.string().nullable(),
  className: z.string().nullable(),
});

export const ImportCandidate = z.object({
  id: z.string(),
  fullName: z.string(),
  className: z.string().nullable(),
  studentNumber: z.string().nullable(),
  active: z.boolean(),
  /** Name similarity 0–1 (1 = same name after Turkish folding). */
  score: z.number(),
});

export const ImportRow = z.object({
  id: z.string(),
  idx: z.number().int(),
  raw: z.array(z.string()),
  page: z.number().int().nullable(),
  parsed: ImportParsed,
  edited: z.boolean(),
  ocrConfidence: z.number().int().nullable(),
  flags: z.array(z.enum(IMPORT_FLAGS)),
  candidates: z.array(ImportCandidate),
  decision: z.enum(IMPORT_DECISIONS),
  decisionSource: z.enum(['auto', 'teacher']),
  /** A possible match (similar name, no number match) that the teacher has not decided yet (IMP-4). */
  needsChoice: z.boolean(),
  matchedStudentId: z.string().nullable(),
  /** The matched student has no number and this row has one: fill it in only when confirmed (IMP-5). */
  canFillNumber: z.boolean(),
  fillNumber: z.boolean(),
  outcome: z.enum(['added', 'matched', 'skipped', 'failed']).nullable(),
  reason: z.string().nullable(),
  revertOutcome: z.string().nullable(),
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportBatchSummary = z.object({
  id: z.string(),
  sourceType: z.enum(IMPORT_SOURCE_TYPES),
  fileName: z.string().nullable(),
  classId: z.string(),
  className: z.string(),
  status: z.enum(['draft', 'committed', 'reverted']),
  counts: z.record(z.string(), z.number()),
  createdAt: z.number(),
  createdByName: z.string(),
  committedAt: z.number().nullable(),
  revertedAt: z.number().nullable(),
});
export type ImportBatchSummary = z.infer<typeof ImportBatchSummary>;

export const ImportBatch = ImportBatchSummary.extend({
  columns: z.array(z.string()),
  mapping: ImportMapping,
  notices: z.array(z.string()),
  rows: z.array(ImportRow),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

/** Create a draft from pasted text or an uploaded `import_source` file (exactly one of them). */
export const createImportBatch = endpoint({
  method: 'POST',
  path: '/api/import/batches',
  access: 'account',
  input: z
    .object({ classId: Id, text: z.string().max(200_000).optional(), fileId: Id.optional() })
    .refine((v) => (v.text !== undefined) !== (v.fileId !== undefined), 'Paste text or choose a file'),
  output: ImportBatch,
});

export const listImportBatches = endpoint({
  method: 'GET',
  path: '/api/import/batches',
  access: 'account',
  input: z.object({ classId: Id.optional() }),
  output: z.object({ batches: z.array(ImportBatchSummary) }),
});

export const getImportBatch = endpoint({
  method: 'GET',
  path: '/api/import/batches/:batchId',
  access: 'account',
  input: z.object({ batchId: Id }),
  output: ImportBatch,
});

/** Change the field mapping (IMP-2): rows not edited by hand are parsed again and re-checked. */
export const setImportMapping = endpoint({
  method: 'PUT',
  path: '/api/import/batches/:batchId/mapping',
  access: 'account',
  input: z.object({ batchId: Id, mapping: ImportMapping }),
  output: ImportBatch,
});

const EditName = z.string().trim().max(160);
/** Fix a row in the preview and/or choose what happens to it. */
export const updateImportRow = endpoint({
  method: 'PATCH',
  path: '/api/import/batches/:batchId/rows/:rowId',
  access: 'account',
  input: z.object({
    batchId: Id,
    rowId: Id,
    fullName: EditName.optional(),
    givenNames: EditName.nullable().optional(),
    familyName: EditName.nullable().optional(),
    studentNumber: z
      .string()
      .trim()
      .max(32)
      .regex(/^[\p{L}\p{N}-]*$/u, 'Student number: letters, digits and - only')
      .nullable()
      .optional(),
    decision: z.enum(IMPORT_DECISIONS).optional(),
    matchedStudentId: Id.nullable().optional(),
    fillNumber: z.boolean().optional(),
  }),
  output: ImportBatch,
});

/** The same decision for several rows ("match" uses each row's best candidate). */
export const setImportDecisions = endpoint({
  method: 'POST',
  path: '/api/import/batches/:batchId/decisions',
  access: 'account',
  input: z.object({ batchId: Id, rowIds: z.array(Id).min(1).max(2000), decision: z.enum(IMPORT_DECISIONS) }),
  output: ImportBatch,
});

/** Apply the batch: add / match / skip each row; the answer is the report (IMP-2). */
export const commitImportBatch = endpoint({
  method: 'POST',
  path: '/api/import/batches/:batchId/commit',
  access: 'account',
  input: z.object({ batchId: Id }),
  output: ImportBatch,
});

/**
 * Undo a committed batch (IMP-5, DAT-5): students and enrolments it created are removed when nothing
 * has been recorded for them since; otherwise the student is deactivated (the enrolment closed) and
 * the row says so. Numbers it filled in are cleared. Audited.
 */
export const revertImportBatch = endpoint({
  method: 'POST',
  path: '/api/import/batches/:batchId/revert',
  access: 'account',
  input: z.object({ batchId: Id, confirm: z.literal(true) }),
  output: ImportBatch,
});
