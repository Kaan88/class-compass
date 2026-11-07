/**
 * Admin Maintenance page (OPS-2..5, D-089): the state of local backups, the off-site copy and the
 * last verification, disk usage, versions and migration level. "Back up now" and "verify" need the
 * administrator's PIN and are recorded in `backup_runs` and the audit log. Off-site runs stay on the
 * command line / timer (restic credentials live only in the service environment, never in the app).
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import type { BackupRunDto, MaintenanceStatus } from '../../../shared/contracts/maintenance.ts';
import { backupRuns, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { backupNow, errorSummary, listBackups, recordRun, resolveBackupFile, verifyBackup } from '../../ops/backup.ts';
import { offsiteProblems } from '../../ops/restic.ts';
import { appVersion, migrationLevel } from '../../ops/version.ts';
import { unlockPin } from '../auth/service.ts';

type RunRow = typeof backupRuns.$inferSelect;
type Kind = RunRow['kind'];

const dto = (r: RunRow | undefined): BackupRunDto | null =>
  r
    ? {
        kind: r.kind,
        trigger: r.trigger,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
        appVersion: r.appVersion,
        migrationLevel: r.migrationLevel,
        details: r.detailsJson ?? null,
      }
    : null;

function lastRun(ctx: RequestContext, kind: Kind, okOnly = false): RunRow | undefined {
  const where = okOnly ? and(eq(backupRuns.kind, kind), eq(backupRuns.status, 'ok')) : eq(backupRuns.kind, kind);
  return ctx.db.select().from(backupRuns).where(where).orderBy(desc(backupRuns.finishedAt)).limit(1).get();
}

/** Total size of the files under a folder (0 when it does not exist). */
export function folderBytes(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += fs.statSync(p, { throwIfNoEntry: false })?.size ?? 0;
    }
  };
  walk(dir);
  return total;
}

const fileBytes = (f: string) => fs.statSync(f, { throwIfNoEntry: false })?.size ?? 0;

export function maintenanceStatus(ctx: RequestContext): MaintenanceStatus {
  const now = ctx.now();
  const cfg = ctx.config;
  const offsiteOk = lastRun(ctx, 'offsite', true);
  const staleMs = cfg.OFFSITE_STALE_HOURS * 3600_000;
  let totalBytes: number | null = null;
  let freeBytes: number | null = null;
  try {
    const st = fs.statfsSync(path.dirname(cfg.dbPath));
    totalBytes = st.blocks * st.bsize;
    freeBytes = st.bavail * st.bsize;
  } catch {
    // Not available on this platform/filesystem: shown as unknown.
  }
  return {
    appVersion: appVersion(),
    migration: migrationLevel(ctx.db.$client),
    lastLocal: dto(lastRun(ctx, 'local')),
    lastLocalOk: dto(lastRun(ctx, 'local', true)),
    lastOffsite: dto(lastRun(ctx, 'offsite')),
    lastOffsiteOk: dto(offsiteOk),
    lastVerify: dto(lastRun(ctx, 'verify')),
    lastRestore: dto(lastRun(ctx, 'restore')),
    offsiteStale: !offsiteOk || now - offsiteOk.finishedAt > staleMs,
    offsiteStaleHours: cfg.OFFSITE_STALE_HOURS,
    offsiteConfigured: offsiteProblems(process.env).length === 0,
    disk: {
      totalBytes,
      freeBytes,
      databaseBytes: fileBytes(cfg.dbPath) + fileBytes(`${cfg.dbPath}-wal`),
      uploadsBytes: folderBytes(cfg.uploadsDir),
      backupsBytes: folderBytes(cfg.backupsDir),
    },
    backups: listBackups(cfg)
      .slice(0, 12)
      .map((b) => ({ name: b.fileName, kind: b.kind, at: b.at, size: b.size })),
    retention: { hourly: cfg.BACKUP_KEEP_HOURLY, daily: cfg.BACKUP_KEEP_DAILY, monthly: cfg.BACKUP_KEEP_MONTHLY },
    now,
  };
}

/** The administrator re-enters their PIN for maintenance actions (wrong PINs count towards the lockout). */
async function requirePin(ctx: RequestContext, pin: string) {
  const user = requireUser(ctx);
  const row = ctx.db.select().from(users).where(eq(users.id, user.id)).get();
  if (!row?.pinHash) throw new AppError('VALIDATION', 'Set a PIN in your profile first', { reason: 'PIN_NOT_SET' });
  await unlockPin(ctx, row, ctx.session!, pin);
}

let running = false;

export async function runBackup(ctx: RequestContext, pin: string): Promise<{ run: BackupRunDto }> {
  await requirePin(ctx, pin);
  if (running) throw new AppError('CONFLICT', 'A backup is already running', { reason: 'BACKUP_RUNNING' });
  running = true;
  try {
    const r = await backupNow({ db: ctx.db, config: ctx.config, now: ctx.now, trigger: 'admin', actorId: requireUser(ctx).id });
    audit(ctx.db, ctx.actor, { action: 'backup.create', entity: 'backup', entityId: r.ok ? r.result.fileName : null, after: r.ok ? { size: r.result.size, pruned: r.pruned.length } : { error: r.error } }, ctx.now());
    return { run: dto(lastRun(ctx, 'local'))! };
  } finally {
    running = false;
  }
}

export async function verifyLatest(ctx: RequestContext, pin: string): Promise<{ run: BackupRunDto }> {
  await requirePin(ctx, pin);
  const started = ctx.now();
  let file: string;
  try {
    file = resolveBackupFile(ctx.config, 'latest');
  } catch {
    throw new AppError('NOT_FOUND', 'There is no local backup yet', { reason: 'NO_BACKUP' });
  }
  const name = path.basename(file);
  try {
    const v = await verifyBackup(file);
    recordRun(ctx.db, { kind: 'verify', trigger: 'admin', status: v.ok ? 'ok' : 'failed', startedAt: started, finishedAt: ctx.now(), fileName: name, sizeBytes: fileBytes(file), details: v.ok ? { tables: Object.keys(v.manifest?.tables ?? {}).length } : { problems: v.problems.slice(0, 10) }, actorId: requireUser(ctx).id });
  } catch (err) {
    recordRun(ctx.db, { kind: 'verify', trigger: 'admin', status: 'failed', startedAt: started, finishedAt: ctx.now(), fileName: name, details: { error: errorSummary(err) }, actorId: requireUser(ctx).id });
  }
  const run = dto(lastRun(ctx, 'verify'))!;
  audit(ctx.db, ctx.actor, { action: 'backup.verify', entity: 'backup', entityId: name, after: { status: run.status } }, ctx.now());
  return { run };
}
