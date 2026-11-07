/**
 * Backups, restore, exports and the year rollover (S11: OPS-2..5, DAT-1..5, ENG-3). Works on a real
 * database file in a temporary data folder. Fictional data only.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.ts';
import { loadConfig } from '../../src/server/config.ts';
import { openDatabase, runMigrations } from '../../src/server/db/client.ts';
import type { AppDeps } from '../../src/server/lib/context.ts';
import { DEFAULT_RETENTION, backupsToKeep } from '../../src/domain/retention.ts';
import { createBackup, databaseInUse, LOCK_FILE, listBackups, recordRun, restoreBackup, RestoreRefused, verifyBackup, writeServerLock } from '../../src/server/ops/backup.ts';
import { cleanupExpiredExports, EXPORT_TTL_MS } from '../../src/server/modules/maintenance/exports.ts';
import { offsiteBackup, offsiteProblems, redact, repositoryKind, type ResticRunner } from '../../src/server/ops/restic.ts';
import { tableCounts } from '../../src/server/ops/version.ts';
import { Client, Clock, seedUser, type TestEnv } from '../helpers.ts';
import { cmd, endLesson, startLesson } from '../lesson-helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');
let dir: string;
let env: TestEnv;
let s: School;

async function fileEnv(dataDir: string): Promise<TestEnv> {
  const config = loadConfig({ NODE_ENV: 'test', SECRET_PEPPER: 'test-pepper-0123456789abcdef', PUBLIC_ORIGIN: 'http://localhost:5173', DATA_DIR: dataDir });
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const clock = new Clock();
  const deps: AppDeps = { db, config, now: clock.now, mailer: null };
  const app = await buildApp(deps, {});
  await app.ready();
  return { app, db, clock, config, deps };
}

const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function uploadHashes(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!p.includes(`${path.sep}tmp${path.sep}`)) out[path.relative(root, p).replaceAll('\\', '/')] = sha(p);
    }
  };
  walk(root);
  return out;
}

async function upload(c: any, studentId: string, body: Buffer, name: string, type: string) {
  const boundary = '----cc' + crypto.randomUUID();
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return c.req('POST', `/api/files?kind=document&ownerStudentId=${studentId}`, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-backup-'));
  env = await fileEnv(path.join(dir, 'data'));
  s = await buildSchool(env);
});
afterEach(async () => {
  await env.app.close();
  env.db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('backup and restore (OPS-2, OPS-4, ENG-3)', () => {
  it('backup → change → restore gives back the same row counts and upload hashes, and keeps a pre-restore copy', async () => {
    const kid = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Deniz Kaya' });
    const up = await upload(s.teacherA, kid.id, Buffer.from('A fictional poem about autumn.\n'), 'poem.txt', 'text/plain');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const countsBefore = tableCounts(env.db.$client);
    const hashesBefore = uploadHashes(env.config.uploadsDir);
    expect(Object.keys(hashesBefore).length).toBeGreaterThan(0);

    const b = await createBackup({ config: env.config, sqlite: env.db.$client, now: env.clock.now(), kind: 'local', includeUploads: true });
    expect(b.manifest.tables.students).toBe(1);
    expect(b.manifest.uploads.count).toBe(Object.keys(hashesBefore).length);
    expect((await verifyBackup(b.file)).ok).toBe(true);

    // Change things after the backup.
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Arda Yıldız' });
    for (const f of Object.keys(hashesBefore)) fs.writeFileSync(path.join(env.config.uploadsDir, f), 'changed');
    expect(tableCounts(env.db.$client).students).toBe(2);

    // Stop the app (the database must not be open while it is replaced).
    await env.app.close();
    env.db.$client.close();
    const r = await restoreBackup({ config: env.config, file: b.file, now: Date.UTC(2026, 10, 9, 8), force: false, probe: async () => false });
    expect(fs.existsSync(r.preRestoreDir)).toBe(true);
    expect(fs.existsSync(path.join(r.preRestoreDir, 'class-compass.db'))).toBe(true);

    env = await fileEnv(path.join(dir, 'data'));
    const after = tableCounts(env.db.$client);
    // backup_runs gains the restore record; everything else is as it was.
    expect({ ...after, backup_runs: 0 }).toEqual({ ...countsBefore, backup_runs: 0 });
    expect(after.backup_runs).toBe((countsBefore.backup_runs ?? 0) + 1);
    expect(uploadHashes(env.config.uploadsDir)).toEqual(hashesBefore);
  });

  it('refuses a corrupted or truncated backup and leaves the data untouched', async () => {
    const b = await createBackup({ config: env.config, sqlite: env.db.$client, now: env.clock.now(), kind: 'local', includeUploads: true });
    const bytes = fs.readFileSync(b.file);
    // Flip a byte inside the database entry (after the first 512-byte header).
    const bad = Buffer.from(bytes);
    bad[2048] = bad[2048]! ^ 0xff;
    const badFile = path.join(env.config.backupsDir, 'corrupt.tar');
    fs.writeFileSync(badFile, bad);
    const v = await verifyBackup(badFile);
    expect(v.ok).toBe(false);
    const truncated = path.join(env.config.backupsDir, 'truncated.tar');
    fs.writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect((await verifyBackup(truncated)).ok).toBe(false);

    await env.app.close();
    env.db.$client.close();
    const dbHash = sha(env.config.dbPath);
    await expect(restoreBackup({ config: env.config, file: badFile, now: Date.now(), force: false, probe: async () => false })).rejects.toBeInstanceOf(RestoreRefused);
    expect(sha(env.config.dbPath)).toBe(dbHash);
    env = await fileEnv(path.join(dir, 'data'));
  });

  it('refuses to restore while the server holds the database; --force only helps when it cannot be checked', async () => {
    const b = await createBackup({ config: env.config, sqlite: env.db.$client, now: env.clock.now(), kind: 'local', includeUploads: false });
    // The app's connection is open: SQLite's lock shows it even without a lock file or /healthz
    // (an app in another container sharing the data folder), and --force does not override it.
    expect(databaseInUse(env.config.dbPath)).toBe(true);
    const dbHash = sha(env.config.dbPath);
    await expect(restoreBackup({ config: env.config, file: b.file, now: Date.now(), force: true, probe: async () => false })).rejects.toThrow(/running/u);
    expect(sha(env.config.dbPath)).toBe(dbHash);
    await env.app.close();
    env.db.$client.close();
    expect(databaseInUse(env.config.dbPath)).toBe(false);
    const release = writeServerLock(env.config, Date.now());
    expect(fs.existsSync(path.join(path.dirname(env.config.dbPath), LOCK_FILE))).toBe(true);
    const lockFile = path.join(path.dirname(env.config.dbPath), LOCK_FILE);
    // A lock this process cannot check (here: its own) needs --force.
    await expect(restoreBackup({ config: env.config, file: b.file, now: Date.now(), force: false, probe: async () => false })).rejects.toThrow(/--force/u);
    // A server answering /healthz, or a live server process on this machine: refused even with --force.
    await expect(restoreBackup({ config: env.config, file: b.file, now: Date.now(), force: true, probe: async () => true })).rejects.toThrow(/running/u);
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    fs.writeFileSync(lockFile, JSON.stringify({ ...lock, pid: process.ppid }));
    await expect(restoreBackup({ config: env.config, file: b.file, now: Date.now(), force: true, probe: async () => false })).rejects.toThrow(/running/u);
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    release();
    expect(fs.existsSync(path.join(path.dirname(env.config.dbPath), LOCK_FILE))).toBe(false);
    env = await fileEnv(path.join(dir, 'data'));
  });

  it('backup:create never migrates: a database with pending migrations is backed up as it is (OPS, DAT-4)', async () => {
    // Pretend the running code ships one more migration than the database has (another image version).
    const last = env.db.$client.prepare('select rowid as id from __drizzle_migrations order by created_at desc, rowid desc limit 1').get() as { id: number };
    env.db.$client.prepare('delete from __drizzle_migrations where rowid = ?').run(last.id);
    const before = (env.db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'server', 'cli.ts'), 'backup:create'], {
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', NODE_ENV: 'test', SECRET_PEPPER: 'test-pepper-0123456789abcdef', PUBLIC_ORIGIN: 'http://localhost:5173', DATA_DIR: path.join(dir, 'data') },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.status, `${r.stdout}
${r.stderr}`).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Backing it up as it is/u);
    expect((env.db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n).toBe(before);
    expect(listBackups(env.config).filter((x) => x.kind === 'local')).toHaveLength(1);
    expect(listBackups(env.config).filter((x) => x.kind === 'pre_migration')).toHaveLength(0);
  });

  it('retention keeps the newest per hour, day and month', () => {
    const H = 3600_000;
    const t0 = Date.UTC(2026, 10, 9, 0);
    const backups = Array.from({ length: 24 * 70 }, (_, i) => ({ name: `b${i}`, at: t0 - i * H }));
    const keep = backupsToKeep(backups, DEFAULT_RETENTION);
    expect(keep.has('b0')).toBe(true);
    expect(keep.size).toBeLessThanOrEqual(48 + 30 + 12);
    expect(keep.size).toBeGreaterThanOrEqual(48);
    // Monthly buckets keep the newest backup of each month (here 30 Sep 23:00 UTC), not the oldest.
    expect(keep.has('b937')).toBe(true);
    expect(keep.has(`b${24 * 69 + 23}`)).toBe(false);
    expect(listBackups(env.config)).toEqual([]);
  });
});

describe('off-site with restic (D-017)', () => {
  it('validates the repository, needs credentials and never prints them', async () => {
    expect(repositoryKind('s3:https://abc123.r2.cloudflarestorage.com/cc-backups')).toEqual({ ok: true, kind: 'r2' });
    expect(repositoryKind('b2:cc-backups:school')).toEqual({ ok: true, kind: 'b2' });
    expect(repositoryKind('s3:http://insecure.example/x').ok).toBe(false);
    const e = { RESTIC_REPOSITORY: 'b2:cc-backups:school', RESTIC_PASSWORD: 'fictional-restic-pass', B2_ACCOUNT_ID: 'fictional-id', B2_ACCOUNT_KEY: 'fictional-key-123' };
    expect(offsiteProblems({ RESTIC_REPOSITORY: 'b2:x:y' })).toHaveLength(2);
    expect(offsiteProblems(e)).toEqual([]);
    expect(redact('auth failed for fictional-id with fictional-key-123', e)).not.toMatch(/fictional-(id|key)/u);
    const calls: string[][] = [];
    const runner: ResticRunner = async (_bin, args, runEnv) => {
      calls.push(args);
      expect(runEnv.RESTIC_PASSWORD).toBe('fictional-restic-pass');
      expect(runEnv.SECRET_PEPPER).toBeUndefined();
      if (args[0] === 'backup') return { code: 0, stdout: '{"message_type":"summary","snapshot_id":"abc123"}\n', stderr: '' };
      return { code: 1, stdout: '', stderr: 'Fatal: wrong key fictional-key-123' };
    };
    const file = path.join(dir, 'x.tar');
    fs.writeFileSync(file, 'x');
    const r = await offsiteBackup(file, { daily: 30, weekly: 8, monthly: 12 }, { env: e, runner });
    expect(r.snapshotId).toBe('abc123');
    expect(r.ok).toBe(false); // forget/prune failed
    expect(r.message).not.toContain('fictional-key-123');
    expect(calls[1]!.slice(0, 1)).toEqual(['forget']);
    // Each backup file has its own name: without grouping by host + tags every snapshot would be a
    // group of one and the keep-* rules would never remove anything (D-017 retention).
    const forget = calls[1]!;
    expect(forget[forget.indexOf('--group-by') + 1]).toBe('host,tags');
    expect(forget).toContain('--prune');
  });
});

describe('maintenance page and exports (OPS-3, DAT-4, DAT-5)', () => {
  it('shows backup state and runs a backup only with the administrator’s PIN', async () => {
    const st = await ok(s.admin.get('/api/admin/maintenance'));
    expect(st).toMatchObject({ lastLocal: null, offsiteStale: true, migration: { pending: 0 } });
    expect(st.migration.applied).toBe(st.migration.shipped);
    expect((await s.admin.post('/api/admin/maintenance/backup', { pin: '2468' })).body.error.details.reason).toBe('PIN_NOT_SET');
    await ok(s.admin.post('/api/auth/pin', { currentPassword: 'correct-horse-battery', pin: '2468' }));
    expect((await s.admin.post('/api/admin/maintenance/backup', { pin: '1111' })).status).toBe(401);
    const run = await ok(s.admin.post('/api/admin/maintenance/backup', { pin: '2468' }));
    expect(run.run).toMatchObject({ kind: 'local', trigger: 'admin', status: 'ok' });
    const verified = await ok(s.admin.post('/api/admin/maintenance/verify', { pin: '2468' }));
    expect(verified.run).toMatchObject({ kind: 'verify', status: 'ok' });
    const after = await ok(s.admin.get('/api/admin/maintenance'));
    expect(after.backups).toHaveLength(1);
    // The off-site state comes from the recorded runs (the app never holds the restic credentials).
    expect(st.offsiteSetup).toBe('unknown');
    recordRun(env.db, { kind: 'offsite', trigger: 'timer', status: 'failed', startedAt: env.clock.now(), finishedAt: env.clock.now(), details: { error: 'RESTIC_REPOSITORY is not set', notConfigured: true } });
    expect((await ok(s.admin.get('/api/admin/maintenance'))).offsiteSetup).toBe('not_configured');
    recordRun(env.db, { kind: 'offsite', trigger: 'timer', status: 'ok', startedAt: env.clock.now() + 1, finishedAt: env.clock.now() + 1, fileName: 'cc-backup-x.tar', details: { snapshotId: 'abc' } });
    expect((await ok(s.admin.get('/api/admin/maintenance'))).offsiteSetup).toBe('configured');
    expect(after.lastLocalOk.fileName).toBe(after.backups[0].name);
    expect((await s.teacherA.get('/api/admin/maintenance')).status).toBe(403);
  });

  it('the full export is admin-only, typed-confirmed, one CSV per table with BOM, no secrets, downloaded once', async () => {
    const kid = await addStudent(s.teacherA, s.c3a.id, { fullName: '=Işıl Çınar' });
    expect((await s.teacherA.post('/api/admin/exports/full', { confirm: 'EXPORT' })).status).toBe(403);
    expect((await s.teacherA.post(`/api/admin/students/${kid.id}/export`)).status).toBe(403);
    expect((await s.admin.post('/api/admin/exports/full', { confirm: 'yes' })).body.error.details.reason).toBe('CONFIRMATION_MISMATCH');
    const ready = await ok(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT' }));
    expect((await s.teacherA.get(`/api/admin/exports/${ready.token}`)).status).toBe(403);
    const res = await env.app.inject({ method: 'GET', url: `/api/admin/exports/${ready.token}`, headers: { cookie: [...s.admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const entries = unzip(res.rawPayload);
    const names = Object.keys(entries);
    expect(names).toContain('manifest.json');
    expect(names).toContain('tables/students.csv');
    expect(names).toContain('tables/users.csv');
    expect(names.some((n) => /sessions|auth_attempts|one_time_tokens|command_log|private_teacher_notes/u.test(n))).toBe(false);
    const studentsCsv = entries['tables/students.csv']!.toString('utf8');
    expect(studentsCsv.startsWith('﻿')).toBe(true);
    expect(studentsCsv).toContain("'=Işıl Çınar");
    const usersCsv = entries['tables/users.csv']!.toString('utf8');
    expect(usersCsv).not.toContain('$argon2');
    const manifest = JSON.parse(entries['manifest.json']!.toString('utf8'));
    expect(manifest.tables.students).toBe(1);
    expect(manifest.privateNotesNotIncluded).toBe(0);
    expect(manifest.files.find((f: any) => f.name === 'tables/students.csv').sha256).toBe(crypto.createHash('sha256').update(entries['tables/students.csv']!).digest('hex'));
    // Once only.
    expect((await s.admin.get(`/api/admin/exports/${ready.token}`)).status).toBe(404);
    const audits = env.db.$client.prepare("select action from audit_events where action like 'export.%' order by at").all() as Array<{ action: string }>;
    expect(audits.map((a) => a.action)).toEqual(['export.full', 'export.download']);
  });

  it('an export can be downloaded only by the administrator who prepared it, and an expired one is deleted without a download (D-090)', async () => {
    await seedUser(env, 'admin', 'second.admin');
    const other = new Client(env);
    await other.login('second.admin');
    const ready = await ok(s.admin.post('/api/admin/exports/full', { confirm: 'EXPORT', includeUploads: false }));
    expect((await other.get(`/api/admin/exports/${ready.token}`)).status).toBe(404);
    const exportsDir = path.join(path.dirname(env.config.dbPath), 'exports');
    expect(fs.existsSync(path.join(exportsDir, `${ready.token}.zip`))).toBe(true);
    // Not yet expired: kept. After the hour: removed by the sweep the server runs on a timer.
    expect(await cleanupExpiredExports(env.config, env.clock.now())).toBe(0);
    expect(await cleanupExpiredExports(env.config, env.clock.now() + EXPORT_TTL_MS + 1)).toBe(1);
    expect(fs.readdirSync(exportsDir)).toEqual([]);
    expect((await s.admin.get(`/api/admin/exports/${ready.token}`)).status).toBe(404);
  });

  it('the student export holds only that student’s rows and their files', async () => {
    const a = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Deniz Kaya' });
    const b = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Arda Yıldız' });
    await ok(upload(s.teacherA, a.id, Buffer.from('Ece’s fictional poem\n'), 'poem.txt', 'text/plain'));
    const l = await startLesson(s.teacherA, s.ctxA.id, { othersPresent: true });
    expect((await cmd(s.teacherA, 'attendance.setDaily', { contextId: s.ctxA.id, lessonId: l, studentId: b.id, status: 'absent' })).ok).toBe(true);
    await endLesson(s.teacherA, s.ctxA.id, l);
    const ready = await ok(s.admin.post(`/api/admin/students/${a.id}/export`));
    const res = await env.app.inject({ method: 'GET', url: `/api/admin/exports/${ready.token}`, headers: { cookie: [...s.admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    const entries = unzip(res.rawPayload);
    const all = Object.entries(entries)
      .filter(([n]) => n.endsWith('.csv'))
      .map(([, v]) => v.toString('utf8'))
      .join('\n');
    expect(all).toContain('Ece Deniz Kaya');
    expect(all).not.toContain('Arda Yıldız');
    expect(all).not.toContain(b.id);
    expect(Object.keys(entries).some((n) => n.startsWith('uploads/'))).toBe(true);
    expect(entries['tables/enrolments.csv']).toBeDefined();
    const manifest = JSON.parse(entries['manifest.json']!.toString('utf8'));
    expect(manifest).toMatchObject({ kind: 'student', studentId: a.id, privateNotesNotIncluded: 0 });
  });

  it('the student export finds the student inside JSON lists (groups, roles, absentees, missed assistant turns) without other students (KVKK)', async () => {
    const a = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Deniz Kaya' });
    const b = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Arda Yıldız' });
    const now = env.clock.now();
    const groups = [
      { id: 'g1', name: { en: 'Owls' }, icon: 'owl', memberIds: [a.id, b.id], roles: [{ studentId: a.id, label: { en: 'Reader' } }, { studentId: b.id, label: { en: 'Writer' } }] },
      { id: 'g2', name: { en: 'Foxes' }, icon: 'fox', memberIds: [], roles: [] },
    ];
    env.db.$client
      .prepare('insert into group_templates (id, context_id, name, mode, sizing_json, seed, version, groups_json, unsatisfied_json, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)')
      .run('00000000-0000-7000-8000-0000000000a1', s.ctxA.id, JSON.stringify({ en: 'Fictional pairs' }), 'custom', JSON.stringify({ groupCount: 2 }), 'seed', JSON.stringify(groups), '[]', now, now);
    env.db.$client
      .prepare('insert into assistant_assignments (id, context_id, school_year_id, local_date, planned_student_id, actual_student_id, status, absent_student_ids, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('00000000-0000-7000-8000-0000000000a2', s.ctxA.id, s.year.id, '2026-11-09', a.id, b.id, 'replaced_absent', JSON.stringify([a.id]), now, now);
    const ready = await ok(s.admin.post(`/api/admin/students/${a.id}/export`));
    const res = await env.app.inject({ method: 'GET', url: `/api/admin/exports/${ready.token}`, headers: { cookie: [...s.admin.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    const entries = unzip(res.rawPayload);
    const templates = entries['tables/group_templates.csv']?.toString('utf8') ?? '';
    expect(templates).toContain('Owls');
    expect(templates).toContain('Reader');
    expect(templates).not.toContain('Foxes');
    expect(templates).not.toContain('Writer');
    const assistant = entries['tables/assistant_assignments.csv']?.toString('utf8') ?? '';
    expect(assistant).toContain('2026-11-09');
    const all = Object.entries(entries)
      .filter(([n]) => n.endsWith('.csv'))
      .map(([, v]) => v.toString('utf8'))
      .join('\n');
    expect(all).not.toContain(b.id);
    expect(all).not.toContain('Arda Yıldız');
  });
});

describe('school-year rollover (DAT-1, DAT-2)', () => {
  it('creates the next year, copies classes and assignments, promotes students with history and archives the old year', async () => {
    const kid = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Deniz Kaya' });
    const body = { fromYearId: s.year.id, name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30', copyClasses: true, copyAssignments: true, promote: true, archiveOld: true };
    const preview = await ok(s.admin.post('/api/admin/rollover/preview', body));
    expect(preview.classes.map((c: any) => [c.name, c.newName])).toEqual([
      ['3-A', '4-A'],
      ['3-B', '4-B'],
    ]);
    expect(preview.problems).toEqual([]);
    expect((await s.admin.post('/api/admin/rollover/apply', { ...body, confirm: 'wrong' })).body.error.details.reason).toBe('CONFIRMATION_MISMATCH');
    expect((await s.teacherA.post('/api/admin/rollover/apply', { ...body, confirm: '2026–2027' })).status).toBe(403);
    const r = await ok(s.admin.post('/api/admin/rollover/apply', { ...body, confirm: '2026–2027' }));
    expect(r).toMatchObject({ classesCreated: 2, assignmentsCreated: 2, studentsPromoted: 1, archivedOld: true });
    const hist = env.db.$client.prepare('select reason, to_date from enrolments where student_id = ? order by from_date').all(kid.id) as Array<{ reason: string; to_date: string | null }>;
    expect(hist).toEqual([
      { reason: 'added', to_date: '2027-07-01' },
      { reason: 'promotion', to_date: null },
    ]);
    // The old year is read-only, its reports stay available.
    expect((await s.admin.patch(`/api/admin/classes/${s.c3a.id}`, { name: '3-Z' })).status).toBe(409);
    expect((await s.teacherA.get(`/api/teacher/contexts/${s.ctxA.id}/report`)).status).toBe(200);
    const audit = env.db.$client.prepare("select count(*) as n from audit_events where action = 'school_year.rollover'").get() as { n: number };
    expect(audit.n).toBe(1);
  });

  it('leaves out a class that ends with the year (graduating) and uses the names typed in the preview', async () => {
    const kid = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Deniz Kaya' });
    const body = { fromYearId: s.year.id, name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30', copyClasses: true, copyAssignments: true, promote: true, archiveOld: true, excludeClassIds: [s.c3b.id], classNames: { [s.c3a.id]: '4-Owls' } };
    const preview = await ok(s.admin.post('/api/admin/rollover/preview', body));
    expect(preview.classes.map((c: any) => [c.name, c.newName, c.included])).toEqual([
      ['3-A', '4-Owls', true],
      ['3-B', '4-B', false],
    ]);
    const r = await ok(s.admin.post('/api/admin/rollover/apply', { ...body, confirm: '2026–2027' }));
    expect(r).toMatchObject({ classesCreated: 1, classesNotContinued: 1, assignmentsCreated: 1, studentsPromoted: 1 });
    const names = (env.db.$client.prepare('select c.name from classes c join school_years y on y.id = c.school_year_id where y.name = ?').all('2027–2028') as Array<{ name: string }>).map((x) => x.name);
    expect(names).toEqual(['4-Owls']);
    expect((env.db.$client.prepare('select count(*) as n from enrolments where student_id = ?').get(kid.id) as { n: number }).n).toBe(2);
  });
});

/** Tiny ZIP reader for the tests (stored + deflate). */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nlen).toString('utf8');
    const data = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    i += 30 + nlen + xlen + csize;
  }
  return out;
}
