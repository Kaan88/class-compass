/**
 * Data exports (DAT-4, DAT-5, D-090). Administrator only, audited, one ZIP per request, downloaded
 * once through an unguessable token and deleted after the download or after EXPORT_TTL_MS.
 *
 * - Full export: one CSV per table of the database (read from the schema, so new tables are included
 *   without code changes), the uploaded files under `uploads/<storage key>`, and manifest.json (app
 *   version, migration level, row counts, SHA-256 of every entry, the column notes below).
 * - Student export (KVKK access request): every row that refers to the student (any column that
 *   holds a student id, the importer's matched/created ids, and the JSON lists of groups, roles,
 *   excluded absentees and missed assistant turns), the goal entries and teacher assessments of their
 *   goals, the audit events about them, the files they own, the files on their evidence and their
 *   photo. Other students' ids in those rows are blanked and JSON lists are cut down to this student.
 * Never exported: sign-in secrets (sessions, sign-in attempts, one-time tokens, Super Speakers pairing
 * codes; password/PIN/token/code hashes are blanked), the command log and Secret Student choices of rounds that were not revealed
 * (SEC-3: hidden from everyone, administrators included). Private teacher notes (GOL-6, D-086) are in
 * the FULL export since S13b2 (owner decision, D-114: one CSV for the notes table with author,
 * student and subject names), and stay out of the per-student export, whose manifest gives their count.
 * Teachers' notifications about a student (S14e3, D-155) are in the full export and, like the notes,
 * not in the per-student export (`STUDENT_EXPORT_EXCLUDED`).
 * Student link tokens are never exported: `token_cipher` is blanked like the hashes.
 * Prepared files are removed after one download, when they expire (start-up + a timer in main.ts,
 * and before each new export), and only the administrator who prepared one can download it. CSV cells are formula-escaped and UTF-8 with BOM like report CSVs (RPT-4).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Config } from '../../config.ts';
import { CSV_BOM, csvLine, toCsv, type CsvValue } from '../../../domain/csv.ts';
import { FULL_EXPORT_CONFIRM, type ExportReady } from '../../../shared/contracts/maintenance.ts';
import { openReadSnapshot, type Db } from '../../db/client.ts';
import { students, type GroupJson, type UnsatisfiedJson } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { randomToken } from '../../lib/crypto.ts';
import { yieldToEventLoop } from '../../lib/yield.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { appVersion, levelText, migrationLevel } from '../../ops/version.ts';
import { ZipWriter } from '../../ops/zip.ts';
import { storagePath } from '../files/storage.ts';
import { exportablePrivateNotes, PRIVATE_NOTES_EXPORT_COLUMNS, PRIVATE_NOTES_TABLE, privateNotesCount } from '../goals/history.ts';
import { exportableSelections, SELECTIONS_TABLE_NAME } from '../secret/service.ts';

/** How long a prepared export can be downloaded. */
export const EXPORT_TTL_MS = 60 * 60_000;
/**
 * Tables that hold sign-in secrets or request logs, never exported (S14h2: OAuth requests, codes and refresh
 * tokens too). Assistant chats (S19b, D-180) are private to their teacher (administrators see counts, never
 * content): they leave only through the teacher's own export, and stay in backups.
 */
export const NEVER_EXPORTED = ['sessions', 'auth_attempts', 'one_time_tokens', 'command_log', 'scorer_pairings', 'oauth_requests', 'oauth_codes', 'oauth_refresh_tokens', 'ai_oauth_states', 'assistant_chats', 'assistant_messages', '__drizzle_migrations'] as const;
/**
 * Columns blanked in every export (sign-in secrets: password/PIN/token/request/code hashes, and every
 * sealed `…_cipher` column: link tokens, AI connection keys since S19a, D-179).
 */
export const SECRET_COLUMN = /(^|_)(password|pin|token|request|code)_hash$|_cipher$/u;
/**
 * Teacher-side tables left out of the per-student export like the private notes (S14e3, D-155): a
 * teacher's notifications about the student hold ids only and are in the full export.
 */
export const STUDENT_EXPORT_EXCLUDED = ['notifications'] as const;
const STUDENT_COLUMNS = new Set(['student_id', 'owner_student_id', 'student_a', 'student_b', 'planned_student_id', 'actual_student_id', 'matched_student_id', 'created_student_id']);

/** Where prepared exports wait for their download. */
export const exportsDirOf = (config: Pick<Config, 'dbPath'>) => path.join(path.dirname(config.dbPath), 'exports');
const exportsDir = (ctx: RequestContext) => exportsDirOf(ctx.config);

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

export interface Builder {
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

/** Rows per piece of a streamed table, and the longest the export works before it lets requests run. */
export const EXPORT_BATCH_ROWS = 2000;
const EXPORT_SLICE_MS = 25;

/**
 * One table as a CSV entry, read row by row and written in pieces (S15a, D-162): never the whole
 * table in memory, and the event loop gets a turn at least every EXPORT_SLICE_MS (or
 * EXPORT_BATCH_ROWS rows), so the classroom screens keep answering during a big export. The bytes are
 * exactly those of `rowsCsv` over the same rows. `onRow` sees every row (the uploads list).
 */
export async function streamTable(b: Builder, table: string, columns: string[], rows: Iterable<Record<string, unknown>>, onRow?: (r: Record<string, unknown>) => void) {
  const blank = columns.map((c) => SECRET_COLUMN.test(c));
  let count = 0;
  const name = `tables/${table}.csv`;
  const entry = await b.zip.addStream(name, async (write) => {
    let piece = CSV_BOM + csvLine(columns) + '\r\n';
    let inPiece = 0;
    let sliceStart = performance.now();
    for (const r of rows) {
      onRow?.(r);
      piece += csvLine(columns.map((c, i) => (blank[i] ? '' : cell(r[c])))) + '\r\n';
      count += 1;
      inPiece += 1;
      if (inPiece >= EXPORT_BATCH_ROWS || (inPiece % 64 === 0 && performance.now() - sliceStart > EXPORT_SLICE_MS)) {
        await write(Buffer.from(piece, 'utf8'));
        piece = '';
        inPiece = 0;
        await yieldToEventLoop();
        sliceStart = performance.now();
      }
    }
    await write(Buffer.from(piece, 'utf8'));
  });
  b.tables[table] = count;
  b.files.push({ name, size: entry.size, sha256: entry.sha256 });
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

async function cleanupExpired(dir: string, now: number): Promise<number> {
  let names: string[] = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  const live = new Set<string>();
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    const token = n.replace(/\.json$/u, '');
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8')) as { expiresAt: number };
      if (meta.expiresAt >= now) {
        live.add(token);
        continue;
      }
    } catch {
      /* unreadable: removed below */
    }
    await removeExport(dir, token);
    removed += 1;
  }
  // Files without a valid registration (a crash while preparing or sending), once older than the TTL.
  for (const n of names.filter((x) => !x.endsWith('.json'))) {
    const token = n.split('.')[0]!;
    if (live.has(token)) continue;
    const st = await fsp.stat(path.join(dir, n)).catch(() => null);
    if (st?.isFile() && now - st.mtimeMs > EXPORT_TTL_MS) {
      await fsp.rm(path.join(dir, n), { force: true });
      removed += 1;
    }
  }
  return removed;
}

/**
 * Deletes prepared exports that expired without being downloaded (they hold student data). Run at
 * start-up and every few minutes by the server (main.ts), and before each new export.
 */
export const cleanupExpiredExports = (config: Pick<Config, 'dbPath'>, now: number) => cleanupExpired(exportsDirOf(config), now);

async function removeExport(dir: string, token: string) {
  await fsp.rm(path.join(dir, `${token}.zip`), { force: true });
  await fsp.rm(path.join(dir, `${token}.json`), { force: true });
}

/** Writes a ZIP through `fill`, then registers it for one download. */
async function prepare(ctx: RequestContext, fileName: string, neverExported: readonly string[], fill: (b: Builder) => Promise<Record<string, unknown>>): Promise<ExportReady> {
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
      neverExported: [...NEVER_EXPORTED, ...neverExported, 'Secret Student choices of rounds not revealed', 'password, PIN and token hashes and encrypted link tokens (blank)'],
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
  const ready = await prepare(ctx, `class-compass-export-${stamp(ctx.now())}.zip`, [], async (b) => {
    // Every table is read from one snapshot (S15a, D-162): the export yields between pieces, and the
    // writes the school makes meanwhile must not leave it half old, half new.
    const snap = await openReadSnapshot(ctx.db, path.join(exportsDir(ctx), `${randomToken(24)}.snapshot.db`));
    try {
      const db = snap.db;
      let uploads = { count: 0, missing: 0 };
      let hiddenSelections = 0;
      // Private teacher notes (owner decision, D-114): included, through the goals module's helper.
      const notes = exportablePrivateNotes(db);
      await addTable(b, PRIVATE_NOTES_TABLE, [...PRIVATE_NOTES_EXPORT_COLUMNS], notes);
      for (const t of tableNames(db)) {
        const columns = columnsOf(db, t);
        if (t === SELECTIONS_TABLE_NAME) {
          const sel = exportableSelections(db);
          hiddenSelections = sel.hidden;
          await addTable(b, t, columns, sel.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v]))));
          continue;
        }
        // Only what the uploads need is kept of the files rows.
        const liveFiles: Array<Record<string, unknown>> = [];
        const keep = t === 'files' && includeUploads ? (r: Record<string, unknown>) => void (r.deleted_at === null && liveFiles.push({ storage_key: r.storage_key, thumb_storage_key: r.thumb_storage_key })) : undefined;
        await streamTable(b, t, columns, db.$client.prepare(`select * from ${quote(t)}`).iterate() as Iterable<Record<string, unknown>>, keep);
        if (keep) uploads = await addUploads(ctx, b, liveFiles);
      }
      return { kind: 'full', uploadsIncluded: includeUploads, uploads, secretStudentChoicesNotRevealed: hiddenSelections, privateNotesIncluded: notes.length };
    } finally {
      await snap.close();
    }
  });
  audit(ctx.db, ctx.actor, { action: 'export.full', entity: 'export', entityId: null, after: { fileName: ready.fileName, sizeBytes: ready.sizeBytes, includeUploads, privateNotesIncluded: true } }, ctx.now());
  return ready;
}

type Row = Record<string, unknown>;

const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** Groups (of an arrangement or a lesson) cut down to the ones this student was in, with only their own role. */
function ownGroups(v: unknown, sid: string): string {
  const groups = parseJson(v);
  if (!Array.isArray(groups)) return '[]';
  return JSON.stringify(
    (groups as GroupJson[])
      .filter((g) => Array.isArray(g.memberIds) && g.memberIds.includes(sid))
      .map((g) => ({ id: g.id, name: g.name, icon: g.icon, memberIds: [sid], memberCount: g.memberIds.length, roles: (g.roles ?? []).filter((r) => r.studentId === sid) })),
  );
}

/** A JSON list of student ids reduced to this student (or empty). */
function ownIds(v: unknown, sid: string): string {
  const ids = parseJson(v);
  return JSON.stringify(Array.isArray(ids) && ids.includes(sid) ? [sid] : []);
}

/** Unsatisfied pair rules that involve this student, the other student blanked. */
function ownRules(v: unknown, sid: string): string {
  const rules = parseJson(v);
  if (!Array.isArray(rules)) return '[]';
  return JSON.stringify((rules as UnsatisfiedJson[]).filter((r) => r.a === sid || r.b === sid).map((r) => ({ ...r, a: r.a === sid ? sid : '', b: r.b === sid ? sid : '' })));
}

/** Blanks every other student's id in the plain student-id columns of a row. */
function blankOthers(row: Row, sid: string): Row {
  const out: Row = { ...row };
  for (const c of Object.keys(out)) if (STUDENT_COLUMNS.has(c) && typeof out[c] === 'string' && out[c] !== sid) out[c] = '';
  return out;
}

/** LIKE pattern for a quoted id inside a JSON text (ids are UUIDs: no LIKE wildcards). */
const inJson = (sid: string) => `%"${sid}"%`;

/**
 * Rows of tables that keep a student's id inside JSON (groups, roles, absentees) or in columns the
 * generic rule does not cover, selected for one student and reduced to what is about them.
 */
function jsonAwareRows(db: Db, table: string, sid: string): Row[] | null {
  const q = (sql: string, ...args: string[]) => db.$client.prepare(sql).all(...args) as Row[];
  switch (table) {
    case 'group_templates':
      return q('select * from group_templates where groups_json like ?', inJson(sid)).map((r) => ({ ...r, groups_json: ownGroups(r.groups_json, sid), unsatisfied_json: ownRules(r.unsatisfied_json, sid) }));
    case 'lesson_groupings':
      return q('select * from lesson_groupings where effective_groups_json like ? or excluded_absent_ids like ?', inJson(sid), inJson(sid)).map((r) => ({
        ...r,
        effective_groups_json: ownGroups(r.effective_groups_json, sid),
        excluded_absent_ids: ownIds(r.excluded_absent_ids, sid),
        unsatisfied_json: ownRules(r.unsatisfied_json, sid),
      }));
    case 'assistant_assignments':
      return q('select * from assistant_assignments where planned_student_id = ? or actual_student_id = ? or absent_student_ids like ?', sid, sid, inJson(sid)).map((r) => ({
        ...blankOthers(r, sid),
        absent_student_ids: ownIds(r.absent_student_ids, sid),
        absence_undo: null,
      }));
    case 'import_rows':
      // Only the rows about this student; the other candidates the importer suggested are not theirs.
      return q('select * from import_rows where matched_student_id = ? or created_student_id = ?', sid, sid).map((r) => ({ ...r, candidates_json: '[]' }));
    default:
      return null;
  }
}

export async function studentExport(ctx: RequestContext, studentId: string): Promise<ExportReady> {
  const st = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!st) throw notFound('Student');
  const ready = await prepare(ctx, `student-export-${studentId.slice(0, 8)}-${stamp(ctx.now())}.zip`, ['private teacher notes (count only, D-114)', ...STUDENT_EXPORT_EXCLUDED.map((t) => `${t} (teacher-side, D-155)`)], async (b) => {
    let hiddenSelections = 0;
    const goalIds: string[] = [];
    // Files about the student: their own uploads, the files on their evidence (also ones a teacher
    // uploaded) and their photo.
    const fileIds = [
      ...new Set([...(ctx.db.$client.prepare('select file_id as id from evidence where student_id = ? and file_id is not null').all(studentId) as Array<{ id: string }>).map((r) => r.id), ...(st.photoFileId ? [st.photoFileId] : [])]),
    ];
    let fileRows: Row[] = [];
    for (const t of tableNames(ctx.db)) {
      if ((STUDENT_EXPORT_EXCLUDED as readonly string[]).includes(t)) continue;
      const columns = columnsOf(ctx.db, t);
      let rows: Row[] = [];
      const special = jsonAwareRows(ctx.db, t, studentId);
      if (special) rows = special;
      else if (t === 'students') rows = ctx.db.$client.prepare('select * from students where id = ?').all(studentId) as Row[];
      else if (t === SELECTIONS_TABLE_NAME) {
        const sel = exportableSelections(ctx.db, studentId);
        hiddenSelections = sel.hidden;
        rows = sel.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v])));
      } else if (t === 'audit_events') rows = ctx.db.$client.prepare('select * from audit_events where entity_id = ? order by at').all(studentId) as Row[];
      else if (t === 'files') {
        rows = ctx.db.$client.prepare(`select * from files where owner_student_id = ?${fileIds.length ? ` or id in (${fileIds.map(() => '?').join(',')})` : ''}`).all(studentId, ...fileIds) as Row[];
        fileRows = rows;
      } else {
        const cols = columns.filter((c) => STUDENT_COLUMNS.has(c));
        if (cols.length) rows = (ctx.db.$client.prepare(`select * from ${quote(t)} where ${cols.map((c) => `${quote(c)} = ?`).join(' or ')}`).all(...cols.map(() => studentId)) as Row[]).map((r) => blankOthers(r, studentId));
      }
      if (t === 'goals') goalIds.push(...rows.map((r) => String(r.id)));
      if (rows.length) await addTable(b, t, columns, rows);
    }
    // Rows that belong to the student's goals (no student column of their own).
    for (const t of tableNames(ctx.db)) {
      const columns = columnsOf(ctx.db, t);
      if (!columns.includes('goal_id') || columns.some((c) => STUDENT_COLUMNS.has(c)) || !goalIds.length) continue;
      const rows = ctx.db.$client.prepare(`select * from ${quote(t)} where goal_id in (${goalIds.map(() => '?').join(',')})`).all(...goalIds) as Row[];
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
  let meta: { fileName: string; expiresAt: number; createdBy?: string };
  try {
    meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')) as typeof meta;
  } catch {
    throw notFound('Export');
  }
  // Only the administrator who prepared it can download it (a token seen by another account is useless).
  if (meta.createdBy !== requireUser(ctx).id) throw notFound('Export');
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
