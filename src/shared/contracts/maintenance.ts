/**
 * Maintenance, exports and the school-year rollover (S11: OPS-2..5, DAT-1..5, ENG-3). Admin only.
 * - Maintenance: backup/off-site/verify status, disk usage, versions; "back up now" needs the
 *   administrator's PIN (OPS-3).
 * - Exports: the full school export (one CSV per table, uploads, manifest.json) and the per-student
 *   export (KVKK access request) are ZIP files made on request and downloaded once.
 * - Rollover: preview, then apply with the old year's name typed as confirmation (DAT-1/2).
 */
import { z } from 'zod';
import { PinString } from './auth.ts';
import { Empty, endpoint } from './define.ts';
import { Id, IsoDate } from './school.ts';

export const BackupRunDto = z.object({
  kind: z.string(),
  trigger: z.string(),
  status: z.enum(['ok', 'failed']),
  startedAt: z.number(),
  finishedAt: z.number(),
  fileName: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  appVersion: z.string(),
  migrationLevel: z.string(),
  /** Error summary or counts; never credentials. */
  details: z.record(z.string(), z.unknown()).nullable(),
});
export type BackupRunDto = z.infer<typeof BackupRunDto>;

export const MaintenanceStatus = z.object({
  appVersion: z.string(),
  migration: z.object({ applied: z.number(), shipped: z.number(), latestTag: z.string().nullable(), pending: z.number() }),
  lastLocal: BackupRunDto.nullable(),
  lastLocalOk: BackupRunDto.nullable(),
  lastOffsite: BackupRunDto.nullable(),
  lastOffsiteOk: BackupRunDto.nullable(),
  lastVerify: BackupRunDto.nullable(),
  lastRestore: BackupRunDto.nullable(),
  /** Off-site copy older than OFFSITE_STALE_HOURS (or none at all). */
  offsiteStale: z.boolean(),
  offsiteStaleHours: z.number(),
  /** S13b (D-108): active email-link accounts that cannot sign in because SMTP is not configured (0 when it is). */
  emailLinkAccountsWithoutSmtp: z.number().int(),
  /**
   * Off-site setup as the last off-site run reported it (the app itself never holds the restic
   * credentials): `unknown` = no off-site run recorded yet.
   */
  offsiteSetup: z.enum(['configured', 'not_configured', 'unknown']),
  disk: z.object({ totalBytes: z.number().nullable(), freeBytes: z.number().nullable(), databaseBytes: z.number(), uploadsBytes: z.number(), backupsBytes: z.number() }),
  backups: z.array(z.object({ name: z.string(), kind: z.string(), at: z.number(), size: z.number() })),
  retention: z.object({ hourly: z.number(), daily: z.number(), monthly: z.number() }),
  now: z.number(),
});
export type MaintenanceStatus = z.infer<typeof MaintenanceStatus>;

export const maintenanceStatus = endpoint({ method: 'GET', path: '/api/admin/maintenance', access: 'admin', input: Empty, output: MaintenanceStatus });
export const runBackupNow = endpoint({ method: 'POST', path: '/api/admin/maintenance/backup', access: 'admin', input: z.object({ pin: PinString }), output: z.object({ run: BackupRunDto }) });
export const verifyLatestBackup = endpoint({ method: 'POST', path: '/api/admin/maintenance/verify', access: 'admin', input: z.object({ pin: PinString }), output: z.object({ run: BackupRunDto }) });

// ---------------------------------------------------------------- exports (DAT-4, DAT-5)
export const ExportReady = z.object({ token: z.string(), fileName: z.string(), sizeBytes: z.number(), expiresAt: z.number() });
export type ExportReady = z.infer<typeof ExportReady>;
/** The typed confirmation for a full export (it contains every student's data). */
export const FULL_EXPORT_CONFIRM = 'EXPORT';
export const createFullExport = endpoint({ method: 'POST', path: '/api/admin/exports/full', access: 'admin', input: z.object({ confirm: z.string().max(40), includeUploads: z.boolean().optional() }), output: ExportReady });
export const createStudentExport = endpoint({ method: 'POST', path: '/api/admin/students/:studentId/export', access: 'admin', input: z.object({ studentId: Id }), output: ExportReady });
/** Raw route: the ZIP, once; the file is deleted after it was sent (or when it expires). */
export const downloadExport = endpoint({ method: 'GET', path: '/api/admin/exports/:token', access: 'admin', input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u) }), output: z.unknown() });

// ---------------------------------------------------------------- rollover (DAT-1, DAT-2)
export const RolloverInput = z.object({
  fromYearId: Id,
  name: z.string().trim().min(1).max(40),
  startsOn: IsoDate,
  endsOn: IsoDate,
  /** Create the new year's classes from the old ones (names, themes, grade + 1 where a grade is set). */
  copyClasses: z.boolean(),
  /** Assign the same teachers and subjects to the new classes (needs copyClasses). */
  copyAssignments: z.boolean(),
  /** Promote each old class's active students into its new class on the first day of the new year. */
  promote: z.boolean(),
  /** Archive the old year (read-only) at the end. */
  archiveOld: z.boolean(),
  /** New names per old class id (default: the old name with its grade number raised, e.g. 3-A → 4-A). */
  classNames: z.record(z.string(), z.string().trim().min(1).max(40)).optional(),
  /** Old classes that end with the old year (e.g. a graduating final grade): not re-created, nobody promoted from them. */
  excludeClassIds: z.array(Id).max(500).optional(),
});
export type RolloverInputValue = z.infer<typeof RolloverInput>;
export const RolloverPlan = z.object({
  fromYear: z.object({ id: z.string(), name: z.string(), startsOn: z.string(), endsOn: z.string(), archived: z.boolean() }),
  classes: z.array(z.object({ id: z.string(), name: z.string(), newName: z.string(), grade: z.number().nullable(), newGrade: z.number().nullable(), activeStudents: z.number(), assignments: z.number(), included: z.boolean() })),
  problems: z.array(z.object({ reason: z.string(), classId: z.string().nullable() })),
});
export type RolloverPlan = z.infer<typeof RolloverPlan>;
export const rolloverPreview = endpoint({ method: 'POST', path: '/api/admin/rollover/preview', access: 'admin', input: RolloverInput, output: RolloverPlan });
export const rolloverApply = endpoint({
  method: 'POST',
  path: '/api/admin/rollover/apply',
  access: 'admin',
  input: RolloverInput.extend({ confirm: z.string().max(80) }),
  output: z.object({ yearId: z.string(), classesCreated: z.number(), classesNotContinued: z.number(), assignmentsCreated: z.number(), studentsPromoted: z.number(), studentsSkipped: z.number(), archivedOld: z.boolean() }),
});
