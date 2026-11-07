/**
 * Local backups, verification and restore (DAT-4, OPS-2, D-089).
 *
 * A backup is ONE tar file in `config.backupsDir`:
 *   class-compass.db      consistent online copy (better-sqlite3 `backup()`, safe while the server runs)
 *   uploads/<storage key> every uploaded file (not `uploads/tmp`)
 *   manifest.json         format, app version, migration level, row counts, SHA-256 of every entry
 * The file is written as `<name>.partial` and renamed when complete, so a crash never leaves a
 * half-written backup that looks finished.
 *
 * Restore = verify (checksums, `PRAGMA integrity_check`, row counts) → extract into a temporary
 * folder in DATA_DIR → move the current database and uploads aside into `pre-restore-<time>/` →
 * move the restored ones into place (renames on the same disk) → run migrations. Any failure
 * during the swap moves the previous data back.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupsToKeep, type RetentionPolicy } from '../../domain/retention.ts';
import type { Config } from '../config.ts';
import { openDatabase, runMigrations, type Db } from '../db/client.ts';
import { backupRuns, BACKUP_RUN_KINDS, BACKUP_RUN_TRIGGERS } from '../db/schema.ts';
import { newId } from '../lib/crypto.ts';
import { readTar, readTarEntry, TarWriter, type TarEntryInfo } from './tar.ts';
import { appVersion, hasAppTables, levelText, migrationLevel, tableCounts, type MigrationLevel } from './version.ts';

export const DB_ENTRY = 'class-compass.db';
export const MANIFEST_ENTRY = 'manifest.json';
export const UPLOADS_PREFIX = 'uploads/';
export const BACKUP_FORMAT = 'class-compass-backup';

export type BackupKind = 'local' | 'pre_migration';
const PREFIX: Record<BackupKind, string> = { local: 'cc-backup-', pre_migration: 'cc-premigration-' };
const NAME_RE = /^(cc-backup-|cc-premigration-)(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(-\d+)?\.tar$/u;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  kind: BackupKind;
  createdAt: string;
  appVersion: string;
  migration: MigrationLevel;
  uploadsIncluded: boolean;
  database: TarEntryInfo;
  uploads: { count: number; bytes: number; missingReferenced: number };
  files: TarEntryInfo[];
  tables: Record<string, number>;
}

export interface BackupResult {
  file: string;
  fileName: string;
  size: number;
  manifest: BackupManifest;
}

export interface BackupInfo {
  fileName: string;
  kind: BackupKind;
  at: number;
  size: number;
}

const stampOf = (ms: number) => new Date(ms).toISOString().replace(/[:.]/gu, '-');
const msOfStamp = (s: string) => Date.parse(s.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u, '$1:$2:$3.$4Z'));

/** Every file under the uploads folder except temporary parts, as storage keys ('xx/yy/uuid'). */
async function uploadKeys(uploadsDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (r === 'tmp') continue;
        await walk(path.join(dir, e.name), r);
      } else if (e.isFile()) out.push(r);
    }
  };
  await walk(uploadsDir, '');
  return out.sort();
}

async function freeName(dir: string, kind: BackupKind, now: number): Promise<string> {
  const base = `${PREFIX[kind]}${stampOf(now)}`;
  for (let i = 0; i < 1000; i++) {
    const name = `${base}${i ? `-${i}` : ''}.tar`;
    if (!fs.existsSync(path.join(dir, name)) && !fs.existsSync(path.join(dir, `${name}.partial`))) return name;
  }
  throw new Error('no free backup file name');
}

/**
 * Creates a backup of the open database `sqlite` (and the uploads folder when `includeUploads`).
 * Safe while the server is running: the database copy is an online SQLite backup.
 */
export async function createBackup(opts: { config: Pick<Config, 'backupsDir' | 'uploadsDir'>; sqlite: Database.Database; now: number; kind: BackupKind; includeUploads: boolean }): Promise<BackupResult> {
  const { config, sqlite, kind } = opts;
  await fsp.mkdir(config.backupsDir, { recursive: true });
  const fileName = await freeName(config.backupsDir, kind, opts.now);
  const final = path.join(config.backupsDir, fileName);
  const partial = `${final}.partial`;
  const work = await fsp.mkdtemp(path.join(config.backupsDir, '.work-'));
  let writer: TarWriter | null = null;
  try {
    const dbCopy = path.join(work, DB_ENTRY);
    await sqlite.backup(dbCopy);
    const copy = new Database(dbCopy, { readonly: true });
    let migration: MigrationLevel;
    let tables: Record<string, number>;
    let referenced: string[];
    try {
      migration = migrationLevel(copy);
      tables = tableCounts(copy);
      const hasFiles = copy.prepare("select 1 from sqlite_master where type = 'table' and name = 'files'").get();
      referenced = hasFiles
        ? copy
            .prepare('select storage_key as k, thumb_storage_key as t from files where deleted_at is null')
            .all()
            .flatMap((r) => [(r as { k: string }).k, (r as { t: string | null }).t])
            .filter((k): k is string => Boolean(k))
        : [];
    } finally {
      copy.close();
    }
    writer = await TarWriter.create(partial);
    const files: TarEntryInfo[] = [];
    const database = await writer.addFile(DB_ENTRY, dbCopy);
    files.push(database);
    let count = 0;
    let bytes = 0;
    let missingReferenced = 0;
    if (opts.includeUploads) {
      const keys = await uploadKeys(config.uploadsDir);
      for (const key of keys) {
        let info: TarEntryInfo;
        try {
          info = await writer.addFile(`${UPLOADS_PREFIX}${key}`, path.join(config.uploadsDir, key));
        } catch (err) {
          // A file removed between listing and copying (deleted upload): its row is gone too, skip it.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
        files.push(info);
        count += 1;
        bytes += info.size;
      }
      const present = new Set(keys);
      missingReferenced = referenced.filter((k) => !present.has(k)).length;
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      kind,
      createdAt: new Date(opts.now).toISOString(),
      appVersion: appVersion(),
      migration,
      uploadsIncluded: opts.includeUploads,
      database,
      uploads: { count, bytes, missingReferenced },
      files,
      tables,
    };
    await writer.addBuffer(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), opts.now);
    await writer.finish();
    writer = null;
    await fsp.rename(partial, final);
    const size = (await fsp.stat(final)).size;
    return { file: final, fileName, size, manifest };
  } catch (err) {
    await writer?.abort();
    await fsp.rm(partial, { force: true });
    throw err;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

/** Local backups, newest first (unfinished `.partial` files are ignored). */
export function listBackups(config: Pick<Config, 'backupsDir'>): BackupInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(config.backupsDir);
  } catch {
    return [];
  }
  return names
    .map((n) => {
      const m = NAME_RE.exec(n);
      if (!m) return null;
      const st = fs.statSync(path.join(config.backupsDir, n));
      const at = msOfStamp(m[2]!);
      return { fileName: n, kind: m[1] === PREFIX.local ? ('local' as const) : ('pre_migration' as const), at: Number.isFinite(at) ? at : st.mtimeMs, size: st.size };
    })
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => b.at - a.at || b.fileName.localeCompare(a.fileName));
}

/**
 * Deletes local backups outside the retention policy (regular backups only). Pre-migration
 * snapshots are kept until there are more than `keepPreMigration` of them.
 */
export async function applyRetention(config: Pick<Config, 'backupsDir'>, policy: RetentionPolicy, keepPreMigration = 10): Promise<string[]> {
  const all = listBackups(config);
  const local = all.filter((b) => b.kind === 'local');
  const keep = backupsToKeep(
    local.map((b) => ({ name: b.fileName, at: b.at })),
    policy,
  );
  const pre = all.filter((b) => b.kind === 'pre_migration');
  const doomed = [...local.filter((b) => !keep.has(b.fileName)), ...pre.slice(keepPreMigration)].map((b) => b.fileName);
  for (const n of doomed) await fsp.rm(path.join(config.backupsDir, n), { force: true });
  return doomed;
}

/** Resolves a backup argument: a path, or a file name inside the backups folder; 'latest' = newest regular backup. */
export function resolveBackupFile(config: Pick<Config, 'backupsDir'>, arg: string | undefined): string {
  if (!arg || arg === 'latest') {
    const newest = listBackups(config).find((b) => b.kind === 'local') ?? listBackups(config)[0];
    if (!newest) throw new Error(`No backups in ${config.backupsDir}`);
    return path.join(config.backupsDir, newest.fileName);
  }
  if (fs.existsSync(arg)) return path.resolve(arg);
  const inDir = path.join(config.backupsDir, path.basename(arg));
  if (fs.existsSync(inDir)) return inDir;
  throw new Error(`Backup not found: ${arg}`);
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  manifest: BackupManifest | null;
  /** Where the bundle was extracted (only with `extractTo`). */
  extractedTo: string | null;
}

function parseManifest(buf: Buffer | null): BackupManifest | null {
  if (!buf) return null;
  try {
    const m = JSON.parse(buf.toString('utf8')) as BackupManifest;
    return m.format === BACKUP_FORMAT && m.formatVersion === 1 && Array.isArray(m.files) ? m : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a backup: manifest present, every entry's size and SHA-256 as listed, the database opens
 * and passes `PRAGMA integrity_check`, and its row counts match the manifest. With `extractTo`, the
 * entries are also written there (used by restore), otherwise into a temporary folder that is removed.
 */
export async function verifyBackup(file: string, opts: { extractTo?: string } = {}): Promise<VerifyResult> {
  const problems: string[] = [];
  let manifest: BackupManifest | null = null;
  const target = opts.extractTo ?? (await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-verify-')));
  try {
    manifest = parseManifest(await readTarEntry(file, MANIFEST_ENTRY));
    if (!manifest) return { ok: false, problems: ['manifest missing or not a Class Compass backup'], manifest: null, extractedTo: null };
    const listed = new Map(manifest.files.map((f) => [f.name, f]));
    const entries = await readTar(file, (name) => (listed.has(name) ? path.join(target, ...name.split('/')) : null));
    const seen = new Map(entries.map((e) => [e.name, e]));
    for (const f of manifest.files) {
      const e = seen.get(f.name);
      if (!e) problems.push(`missing entry ${f.name}`);
      else if (e.size !== f.size || e.sha256 !== f.sha256) problems.push(`checksum mismatch ${f.name}`);
    }
    if (!problems.length) {
      const dbFile = path.join(target, DB_ENTRY);
      let copy: Database.Database | null = null;
      try {
        copy = new Database(dbFile, { readonly: true, fileMustExist: true });
        const check = copy.pragma('integrity_check') as Array<{ integrity_check: string }>;
        if (check.length !== 1 || check[0]?.integrity_check !== 'ok') problems.push(`integrity_check: ${check.map((c) => c.integrity_check).slice(0, 3).join('; ')}`);
        const counts = tableCounts(copy);
        for (const [t, n] of Object.entries(manifest.tables)) if (counts[t] !== n) problems.push(`row count of ${t}: ${counts[t]} instead of ${n}`);
      } catch (err) {
        problems.push(`database does not open: ${(err as Error).message}`);
      } finally {
        copy?.close();
      }
    }
  } catch (err) {
    problems.push((err as Error).message);
  } finally {
    if (!opts.extractTo) await fsp.rm(target, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems, manifest, extractedTo: opts.extractTo && problems.length === 0 ? target : null };
}

// ---------------------------------------------------------------- server lock & restore

export const LOCK_FILE = 'server.lock';
interface LockInfo {
  pid: number;
  host: string;
  startedAt: number;
  port: number;
}

/** Written by the server at start (and removed on a clean stop) so restore can refuse while it runs. */
export function writeServerLock(config: Pick<Config, 'dbPath' | 'PORT'>, now: number): () => void {
  const file = path.join(path.dirname(config.dbPath), LOCK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const info: LockInfo = { pid: process.pid, host: os.hostname(), startedAt: now, port: config.PORT };
  fs.writeFileSync(file, JSON.stringify(info));
  return () => {
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo;
      if (cur.pid === process.pid && cur.host === os.hostname()) fs.rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  };
}

export type ServerState = 'stopped' | 'running' | 'unknown';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Is a server using this data folder? `running` when it answers /healthz or its lock names a live
 * process on this machine; `unknown` when a lock exists that cannot be checked (another container or
 * a crash); `stopped` otherwise.
 */
export async function serverState(config: Pick<Config, 'dbPath' | 'HOST' | 'PORT'>, probe: (url: string) => Promise<boolean> = httpProbe): Promise<ServerState> {
  if (await probe(`http://${config.HOST === '0.0.0.0' ? '127.0.0.1' : config.HOST}:${config.PORT}/healthz`)) return 'running';
  const file = path.join(path.dirname(config.dbPath), LOCK_FILE);
  if (!fs.existsSync(file)) return 'stopped';
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo;
    if (info.host === os.hostname() && info.pid !== process.pid) return pidAlive(info.pid) ? 'running' : 'unknown';
  } catch {
    /* unreadable lock */
  }
  return 'unknown';
}

async function httpProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export class RestoreRefused extends Error {}

export interface RestoreResult {
  restoredFrom: string;
  preRestoreDir: string;
  manifest: BackupManifest;
  migrationsAfter: MigrationLevel;
}

const exists = (p: string) => fs.existsSync(p);

/**
 * Restores a backup into `config.dbPath` / `config.uploadsDir`. Refuses while a server runs; a lock
 * that cannot be checked needs `force` (the operator confirms the service is stopped). The previous
 * database and uploads are kept in `DATA_DIR/pre-restore-<time>/`.
 */
export async function restoreBackup(opts: {
  config: Pick<Config, 'dbPath' | 'uploadsDir' | 'backupsDir' | 'HOST' | 'PORT'>;
  file: string;
  now: number;
  force: boolean;
  trigger?: (typeof BACKUP_RUN_TRIGGERS)[number];
  probe?: (url: string) => Promise<boolean>;
}): Promise<RestoreResult> {
  const { config } = opts;
  const state = await serverState(config, opts.probe);
  if (state === 'running') throw new RestoreRefused('The server is running on this data folder. Stop it first (docker compose stop app).');
  if (state === 'unknown' && !opts.force) {
    throw new RestoreRefused('A server lock exists that cannot be checked from here. Make sure the service is stopped, then run again with --force.');
  }
  const dataDir = path.dirname(config.dbPath);
  const stamp = stampOf(opts.now);
  const staging = path.join(dataDir, `.restore-${stamp}`);
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  const verified = await verifyBackup(opts.file, { extractTo: staging });
  if (!verified.ok || !verified.manifest) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw new RestoreRefused(`The backup did not verify: ${verified.problems.join('; ')}`);
  }
  const manifest = verified.manifest;
  const preDir = path.join(dataDir, `pre-restore-${stamp}`);
  await fsp.mkdir(preDir, { recursive: true });
  const moves: Array<[string, string]> = [];
  const move = async (from: string, to: string) => {
    await fsp.rename(from, to);
    moves.push([from, to]);
  };
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = `${config.dbPath}${suffix}`;
      if (exists(f)) await move(f, path.join(preDir, path.basename(f)));
    }
    if (manifest.uploadsIncluded && exists(config.uploadsDir)) await move(config.uploadsDir, path.join(preDir, 'uploads'));
    await move(path.join(staging, DB_ENTRY), config.dbPath);
    if (manifest.uploadsIncluded) {
      const restored = path.join(staging, 'uploads');
      if (exists(restored)) await move(restored, config.uploadsDir);
      else await fsp.mkdir(config.uploadsDir, { recursive: true });
    }
  } catch (err) {
    // Put everything back the way it was.
    for (const [from, to] of moves.reverse()) await fsp.rename(to, from).catch(() => undefined);
    await fsp.rm(staging, { recursive: true, force: true });
    throw err;
  }
  await fsp.rm(staging, { recursive: true, force: true });
  const db = openDatabase(config.dbPath);
  try {
    runMigrations(db);
    const after = migrationLevel(db.$client);
    recordRun(db, {
      kind: 'restore',
      trigger: opts.trigger ?? 'cli',
      status: 'ok',
      startedAt: opts.now,
      finishedAt: Date.now(),
      fileName: path.basename(opts.file),
      sizeBytes: fs.statSync(opts.file).size,
      details: { preRestoreDir: path.basename(preDir), backupCreatedAt: manifest.createdAt, backupMigration: manifest.migration.latestTag, migrationAfter: after.latestTag },
    });
    return { restoredFrom: opts.file, preRestoreDir: preDir, manifest, migrationsAfter: after };
  } finally {
    db.$client.close();
  }
}

// ---------------------------------------------------------------- backup runs

export interface RunRecord {
  kind: (typeof BACKUP_RUN_KINDS)[number];
  trigger: (typeof BACKUP_RUN_TRIGGERS)[number];
  status: 'ok' | 'failed';
  startedAt: number;
  finishedAt: number;
  fileName?: string | null;
  sizeBytes?: number | null;
  details?: Record<string, unknown> | null;
  actorId?: string | null;
}

/** Records a run in `backup_runs` (best effort when the table does not exist yet). */
export function recordRun(db: Db, r: RunRecord): void {
  db.insert(backupRuns)
    .values({
      id: newId(),
      kind: r.kind,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      fileName: r.fileName ?? null,
      sizeBytes: r.sizeBytes ?? null,
      appVersion: appVersion(),
      migrationLevel: levelText(migrationLevel(db.$client)),
      detailsJson: r.details ?? null,
      actorId: r.actorId ?? null,
    })
    .run();
}

/** A short, safe error text for `backup_runs` (no paths outside the data folder, no secrets). */
export const errorSummary = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 500);

/** Runs a local backup + retention and records it. Used by the CLI and the admin "back up now" button. */
export async function backupNow(opts: {
  db: Db;
  config: Pick<Config, 'backupsDir' | 'uploadsDir' | 'BACKUP_KEEP_HOURLY' | 'BACKUP_KEEP_DAILY' | 'BACKUP_KEEP_MONTHLY'>;
  now: () => number;
  trigger: RunRecord['trigger'];
  actorId?: string | null;
}): Promise<{ ok: true; result: BackupResult; pruned: string[] } | { ok: false; error: string }> {
  const started = opts.now();
  try {
    const result = await createBackup({ config: opts.config, sqlite: opts.db.$client, now: started, kind: 'local', includeUploads: true });
    const pruned = await applyRetention(opts.config, { hourly: opts.config.BACKUP_KEEP_HOURLY, daily: opts.config.BACKUP_KEEP_DAILY, monthly: opts.config.BACKUP_KEEP_MONTHLY });
    recordRun(opts.db, {
      kind: 'local',
      trigger: opts.trigger,
      status: 'ok',
      startedAt: started,
      finishedAt: opts.now(),
      fileName: result.fileName,
      sizeBytes: result.size,
      details: { uploads: result.manifest.uploads.count, uploadBytes: result.manifest.uploads.bytes, missingReferenced: result.manifest.uploads.missingReferenced, pruned: pruned.length },
      actorId: opts.actorId ?? null,
    });
    return { ok: true, result, pruned };
  } catch (err) {
    const error = errorSummary(err);
    recordRun(opts.db, { kind: 'local', trigger: opts.trigger, status: 'failed', startedAt: started, finishedAt: opts.now(), details: { error }, actorId: opts.actorId ?? null });
    return { ok: false, error };
  }
}

/**
 * Applies pending migrations, taking a database-only snapshot first when the database already holds
 * data (safe schema migrations, DAT-4). The snapshot is recorded once the migrations (which may create
 * `backup_runs`) have run. Returns the snapshot file name, or null when nothing was pending.
 */
export async function migrateWithSnapshot(db: Db, config: Pick<Config, 'backupsDir' | 'uploadsDir'>, now: () => number, trigger: RunRecord['trigger']): Promise<string | null> {
  const before = migrationLevel(db.$client);
  if (before.pending === 0) return null;
  const started = now();
  let snapshot: BackupResult | null = null;
  if (hasAppTables(db.$client)) snapshot = await createBackup({ config, sqlite: db.$client, now: started, kind: 'pre_migration', includeUploads: false });
  runMigrations(db);
  if (snapshot) {
    recordRun(db, {
      kind: 'pre_migration',
      trigger,
      status: 'ok',
      startedAt: started,
      finishedAt: now(),
      fileName: snapshot.fileName,
      sizeBytes: snapshot.size,
      details: { from: before.latestTag, applied: before.pending },
    });
  }
  return snapshot?.fileName ?? null;
}
