/**
 * Data exports (DAT-4, DAT-5, D-090). Administrator only, audited, one ZIP per request, downloaded
 * once through an unguessable token and deleted after the download or after EXPORT_TTL_MS.
 *
 * - Full export: one CSV per table of the database (read from the schema, so new tables are included
 *   without code changes), the uploaded files under `uploads/<storage key>`, and manifest.json (app
 *   version, migration level, row counts, SHA-256 of every entry, the column notes below).
 * - Student export (KVKK access request): every row that refers to the student (any column that
 *   holds a student id), the goal entries and teacher assessments of their goals, the audit events
 *   about them, and the files they own.
 * Never exported: sign-in secrets (sessions, sign-in attempts, one-time tokens, password/PIN/token
 * hashes are blanked), the command log, Secret Student choices of rounds that were not revealed
 * (SEC-3) and private teacher notes (GOL-6, readable only by their author; the student export says
 * how many exist). CSV cells are formula-escaped and UTF-8 with BOM like report CSVs (RPT-4).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { toCsv, type CsvValue } from '../../../domain/csv.ts';
import { FULL_EXPORT_CONFIRM, type ExportReady } from '../../../shared/contracts/maintenance.ts';
import type { Db } from '../../db/client.ts';
import { students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { randomToken } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { appVersion, levelText, migrationLevel } from '../../ops/version.ts';
import { ZipWriter } from '../../ops/zip.ts';
import { storagePath } from '../files/storage.ts';
import { PRIVATE_NOTES_TABLE, privateNotesCount } from '../goals/history.ts';
import { exportableSelections, SELECTIONS_TABLE_NAME } from '../secret/service.ts';

/** How long a prepared export can be downloaded. */
export const EXPORT_TTL_MS = 60 * 60_000;
/** Tables that hold sign-in secrets or request logs, never exported. */
export const NEVER_EXPORTED = ['sessions', 'auth_attempts', 'one_time_tokens', 'command_log', '__drizzle_migrations'] as const;
/** Columns blanked in every export. */
const SECRET_COLUMN = /(^|_)(password|pin|token|request)_hash$/u;
const STUDENT_COLUMNS = new Set(['student_id', 'owner_student_id', 'student_a', 'student_b', 'planned_student_id', 'actual_student_id']);

const exportsDir = (ctx: RequestContext) => path.join(path.dirname(ctx.config.dbPath), 'exports');

function tableNames(db: Db): string[] {
  return (db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((n) => !(NEVER_EXPORTED as readonly string[]).includes(n) && n !== PRIVATE_NOTES_TABLE);
}

const columnsOf = (db: Db, table: string) => (db.$client.prepare(`select name from pragma_table_info(?)`).all(table) as Array<{ name: string }>).map((c) => c.name);
const quote = (id: string) => `"${id.replace(/"/gu, '""')}"`;
const snake = (k: string) => k.replace(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`);

function cell(v: unknown): CsvValue {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v.toString('base64');
  return JSON.stringify(v);
}

function rowsCsv(columns: string[], rows: Array<Record<string, unknown>>): Buffer {
  const blank = columns.map((c) => SECRET_COLUMN.test(c));
  return Buffer.from(toCsv(columns, rows.map((r) => columns.map((c, i) => (blank[i] ? '' : cell(r[c]))))), 'utf8');
}

interface Builder {
  zip: ZipWriter;
  files: Array<{ name: string; size: number; sha256: string }>;
  tables: Record<string, number>;
}

async function addEntry(b: Builder, name: string, data: Buffer, compress = true) {
  await b.zip.add(name, data, compress);
  b.files.push({ name, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
}

async function addTable(b: Builder, table: string, columns: string[], rows: Array<Record<string, unknown>>) {
  b.tables[table] = rows.length;
  await addEntry(b, `tables/${table}.csv`, rowsCsv(columns, rows));
}

async function addUploads(ctx: RequestContext, b: Builder, fileRows: Array<Record<string, unknown>>): Promise<{ count: number; missing: number }> {
  let count = 0;
  let missing = 0;
  for (const f of fileRows) {
    for (const key of [f.storage_key, f.thumb_storage_key]) {
      if (typeof key !== 'string') continue;
      let data: Buffer;
      try {
        data = await fsp.readFile(storagePath(ctx.config, key));
      } catch {
        missing += 1;
        continue;
      }
      await addEntry(b, `uploads/${key}`, data, false);
      count += 1;
    }
  }
  return { count, missing };
}

async function cleanupExpired(dir: string, now: number) {
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8')) as { expiresAt: number };
      if (meta.expiresAt < now) await removeExport(dir, n.replace(/\.json$/u, ''));
    } catch {
      await removeExport(dir, n.replace(/\.json$/u, ''));
    }
  }
}

async function removeExport(dir: string, token: string) {
  await fsp.rm(path.join(dir, `${token}.zip`), { force: true });
  await fsp.rm(path.join(dir, `${token}.json`), { force: true });
}

/** Writes a ZIP through `fill`, then registers it for one download. */
async function prepare(ctx: RequestContext, fileName: string, fill: (b: Builder) => Promise<Record<string, unknown>>): Promise<ExportReady> {
  const dir = exportsDir(ctx);
  await fsp.mkdir(dir, { recursive: true });
  await cleanupExpired(dir, ctx.now());
  const token = randomToken(24);
  const zipPath = path.join(dir, `${token}.zip`);
  const b: Builder = { zip: await ZipWriter.create(`${zipPath}.partial`, ctx.now()), files: [], tables: {} };
  try {
    const extra = await fill(b);
    const manifest = {
      format: 'class-compass-export',
      formatVersion: 1,
      createdAt: new Date(ctx.now()).toISOString(),
      appVersion: appVersion(),
      migrationLevel: levelText(migrationLevel(ctx.db.$client)),
      csv: 'UTF-8 with BOM, comma separated, CRLF; cells starting with = + - @ tab or CR are prefixed with an apostrophe',
      neverExported: [...NEVER_EXPORTED, 'private teacher notes', 'Secret Student choices of rounds not revealed', 'password, PIN and token hashes (blank)'],
      tables: b.tables,
      ...extra,
      files: b.files,
    };
    await b.zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    await b.zip.finish();
  } catch (err) {
    await b.zip.abort();
    await fsp.rm(`${zipPath}.partial`, { force: true });
    throw err;
  }
  await fsp.rename(`${zipPath}.partial`, zipPath);
  const expiresAt = ctx.now() + EXPORT_TTL_MS;
  await fsp.writeFile(path.join(dir, `${token}.json`), JSON.stringify({ fileName, expiresAt, createdBy: requireUser(ctx).id }));
  return { token, fileName, sizeBytes: (await fsp.stat(zipPath)).size, expiresAt };
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[:T]/gu, '-');

export async function fullExport(ctx: RequestContext, input: { confirm: string; includeUploads?: boolean | undefined }): Promise<ExportReady> {
  if (input.confirm.trim() !== FULL_EXPORT_CONFIRM) throw invalid(`Type ${FULL_EXPORT_CONFIRM} to confirm`, { reason: 'CONFIRMATION_MISMATCH' });
  const includeUploads = input.includeUploads ?? true;
  const ready = await prepare(ctx, `class-compass-export-${stamp(ctx.now())}.zip`, async (b) => {
    let uploads = { count: 0, missing: 0 };
    let hiddenSelections = 0;
    for (const t of tableNames(ctx.db)) {
      const columns = columnsOf(ctx.db, t);
      let rows: Array<Record<string, unknown>>;
      if (t === SELECTIONS_TABLE_NAME) {
        const sel = exportableSelections(ctx.db);
        hiddenSelections = sel.hidden;
        rows = sel.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v])));
      } else {
        rows = ctx.db.$client.prepare(`select * from ${quote(t)}`).all() as Array<Record<string, unknown>>;
      }
      await addTable(b, t, columns, rows);
      if (t === 'files' && includeUploads) uploads = await addUploads(ctx, b, rows.filter((r) => r.deleted_at === null));
    }
    return { kind: 'full', uploadsIncluded: includeUploads, uploads, secretStudentChoicesNotRevealed: hiddenSelections };
  });
  audit(ctx.db, ctx.actor, { action: 'export.full', entity: 'export', entityId: null, after: { fileName: ready.fileName, sizeBytes: ready.sizeBytes, includeUploads } }, ctx.now());
  return ready;
}

export async function studentExport(ctx: RequestContext, studentId: string): Promise<ExportReady> {
  const st = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!st) throw notFound('Student');
  const ready = await prepare(ctx, `student-export-${studentId.slice(0, 8)}-${stamp(ctx.now())}.zip`, async (b) => {
    let hiddenSelections = 0;
    let fileRows: Array<Record<string, unknown>> = [];
    const goalIds: string[] = [];
    for (const t of tableNames(ctx.db)) {
      const columns = columnsOf(ctx.db, t);
      let rows: Array<Record<string, unknown>> = [];
      if (t === 'students') rows = ctx.db.$client.prepare('select * from students where id = ?').all(studentId) as Array<Record<string, unknown>>;
      else if (t === SELECTIONS_TABLE_NAME) {
        const sel = exportableSelections(ctx.db, studentId);
        hiddenSelections = sel.hidden;
        rows = sel.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v])));
      } else if (t === 'audit_events') rows = ctx.db.$client.prepare('select * from audit_events where entity_id = ? order by at').all(studentId) as Array<Record<string, unknown>>;
      else {
        const cols = columns.filter((c) => STUDENT_COLUMNS.has(c));
        if (cols.length) rows = ctx.db.$client.prepare(`select * from ${quote(t)} where ${cols.map((c) => `${quote(c)} = ?`).join(' or ')}`).all(...cols.map(() => studentId)) as Array<Record<string, unknown>>;
      }
      if (t === 'goals') goalIds.push(...rows.map((r) => String(r.id)));
      if (t === 'files') fileRows = rows;
      if (rows.length) await addTable(b, t, columns, rows);
    }
    // Rows that belong to the student's goals (no student column of their own).
    for (const t of tableNames(ctx.db)) {
      const columns = columnsOf(ctx.db, t);
      if (!columns.includes('goal_id') || columns.some((c) => STUDENT_COLUMNS.has(c)) || !goalIds.length) continue;
      const rows = ctx.db.$client.prepare(`select * from ${quote(t)} where goal_id in (${goalIds.map(() => '?').join(',')})`).all(...goalIds) as Array<Record<string, unknown>>;
      if (rows.length) await addTable(b, t, columns, rows);
    }
    const uploads = await addUploads(ctx, b, fileRows.filter((r) => r.deleted_at === null));
    return { kind: 'student', studentId, uploads, secretStudentChoicesNotRevealed: hiddenSelections, privateNotesNotIncluded: privateNotesCount(ctx.db, studentId) };
  });
  audit(ctx.db, ctx.actor, { action: 'export.student', entity: 'student', entityId: studentId, after: { fileName: ready.fileName, sizeBytes: ready.sizeBytes } }, ctx.now());
  return ready;
}

/** Sends a prepared export once, then deletes it. */
export async function sendExport(ctx: RequestContext, reply: FastifyReply, token: string) {
  const dir = exportsDir(ctx);
  const metaPath = path.join(dir, `${token}.json`);
  let meta: { fileName: string; expiresAt: number };
  try {
    meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')) as typeof meta;
  } catch {
    throw notFound('Export');
  }
  if (meta.expiresAt < ctx.now()) {
    await removeExport(dir, token);
    throw new AppError('NOT_FOUND', 'This export has expired; prepare it again', { reason: 'EXPORT_EXPIRED' });
  }
  const zipPath = path.join(dir, `${token}.zip`);
  // Claim the download first so it cannot be fetched twice.
  const claimed = `${zipPath}.sending`;
  try {
    await fsp.rename(zipPath, claimed);
  } catch {
    throw notFound('Export');
  }
  await fsp.rm(metaPath, { force: true });
  const stream = fs.createReadStream(claimed);
  stream.on('close', () => void fsp.rm(claimed, { force: true }));
  audit(ctx.db, ctx.actor, { action: 'export.download', entity: 'export', entityId: null, after: { fileName: meta.fileName } }, ctx.now());
  return reply
    .header('content-type', 'application/zip')
    .header('content-disposition', `attachment; filename="${meta.fileName.replace(/[^A-Za-z0-9._-]/gu, '_')}"`)
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .send(stream);
}

/** For tests and the CLI: whether any prepared export is waiting. */
export const pendingExports = (ctx: RequestContext) => (fs.existsSync(exportsDir(ctx)) ? fs.readdirSync(exportsDir(ctx)).filter((n) => n.endsWith('.zip')).length : 0);
