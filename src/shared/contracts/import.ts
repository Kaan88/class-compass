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
  /**
   * Made from a file with several classes (S20c, D-171): the split's id (shared by the batches made
   * from the same file) and the class labels of the file that were read into this class.
   */
  split: z.object({ id: z.string(), labels: z.array(z.string()) }).nullable(),
});
export type ImportBatchSummary = z.infer<typeof ImportBatchSummary>;

export const ImportBatch = ImportBatchSummary.extend({
  columns: z.array(z.string()),
  mapping: ImportMapping,
  notices: z.array(z.string()),
  /** Workbooks: the sheets read (S13b). */
  sheets: z.array(z.string()).nullable(),
  rows: z.array(ImportRow),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

/** A sheet of an uploaded workbook (S13b sheet picker): name, rows with content, the first rows. */
export const ImportSheet = z.object({ name: z.string(), rows: z.number().int(), preview: z.array(z.array(z.string())) });
export type ImportSheet = z.infer<typeof ImportSheet>;

/** The sheets of an uploaded `import_source` workbook (empty for other files), read before extraction. */
export const listImportSheets = endpoint({
  method: 'POST',
  path: '/api/import/sheets',
  access: 'account',
  input: z.object({ fileId: Id }),
  output: z.object({ sheets: z.array(ImportSheet) }),
});

/**
 * Create a draft from pasted text or an uploaded `import_source` file (exactly one of them). A
 * workbook with several sheets needs `sheets` (names from listImportSheets); the choice is stored on the batch.
 */
export const createImportBatch = endpoint({
  method: 'POST',
  path: '/api/import/batches',
  access: 'account',
  input: z
    .object({ classId: Id, text: z.string().max(200_000).optional(), fileId: Id.optional(), sheets: z.array(z.string().max(200)).min(1).max(20).optional() })
    .refine((v) => (v.text !== undefined) !== (v.fileId !== undefined), 'Paste text or choose a file'),
  output: ImportBatch,
});

// ---------------------------------------------------------------- several classes in one file (S20c, D-171)
const ImportSource = z.object({ text: z.string().max(200_000).optional(), fileId: Id.optional(), sheets: z.array(z.string().max(200)).min(1).max(20).optional() });
const oneSource = (v: { text?: string | undefined; fileId?: string | undefined }) => (v.text !== undefined) !== (v.fileId !== undefined);

/**
 * One class of the file: `matched` = exactly one of the caller's classes has this name (Turkish-aware:
 * "3-A", "3/A", "3 A", "3. Sınıf / A Şubesi"); `unknown` = none of the caller's classes (for a
 * teacher: none they teach); `ambiguous` = several of them (`candidateIds`); `none` = rows without a class.
 */
export const IMPORT_GROUP_STATUSES = ['matched', 'unknown', 'ambiguous', 'none'] as const;
export const ImportClassGroup = z.object({
  /** Stable key of the class label ('' for rows without a class); `createImportSplit` assigns by it. */
  key: z.string(),
  /** The label(s) as written in the file. */
  labels: z.array(z.string()),
  rows: z.number().int(),
  status: z.enum(IMPORT_GROUP_STATUSES),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  candidateIds: z.array(z.string()),
});
export type ImportClassGroup = z.infer<typeof ImportClassGroup>;

export const ImportSplit = z.object({
  sourceType: z.enum(IMPORT_SOURCE_TYPES),
  fileName: z.string().nullable(),
  notices: z.array(z.string()),
  sheets: z.array(z.string()).nullable(),
  /** The label of the class column the rows were split by. */
  classColumn: z.string(),
  groups: z.array(ImportClassGroup),
});
export type ImportSplit = z.infer<typeof ImportSplit>;

/**
 * Read a file (or pasted text) with a class column and group its rows by class, without saving
 * anything: the per-class counts and how each class name matches the caller's classes. Refused with
 * IMPORT_NO_CLASS_COLUMN when no class column is found.
 */
export const previewImportSplit = endpoint({
  method: 'POST',
  path: '/api/import/split/preview',
  access: 'account',
  input: ImportSource.refine(oneSource, 'Paste text or choose a file'),
  output: ImportSplit,
});

/**
 * Create one draft batch per chosen class from the same source: `assign` gives the class for a
 * group key (null = skip those rows); a group not named keeps its match (unmatched groups are
 * skipped). Every class must be one the caller may import into. Each batch then has its own preview,
 * confirm, report, history entry, audit and undo, exactly like a one-class import.
 */
export const createImportSplit = endpoint({
  method: 'POST',
  path: '/api/import/split',
  access: 'account',
  input: ImportSource.extend({ assign: z.array(z.object({ key: z.string().max(200), classId: Id.nullable() })).max(200) }).refine(oneSource, 'Paste text or choose a file'),
  output: z.object({ splitId: z.string(), batches: z.array(ImportBatchSummary), skippedRows: z.number().int() }),
});

export const listImportBatches = endpoint({
  method: 'GET',
  path: '/api/import/batches',
  access: 'account',
  /** `splitId`: only the batches made from one file with several classes (S20c). */
  input: z.object({ classId: Id.optional(), splitId: Id.optional() }),
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
