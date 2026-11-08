/**
 * Server-side administration CLI. Run on the server only (never exposed over HTTP).
 *   node src/server/cli.ts migrate                       pending migrations (database snapshot first)
 *   node src/server/cli.ts admin:create --login <login> --name "<Display Name>" [--email x]   (password via stdin)
 *   node src/server/cli.ts admin:reset-password --login <login>                                (password via stdin)
 *   node src/server/cli.ts seed:demo [--force-demo]      fictional demo school (never in production)
 *     CC_DEMO_PASSWORD=<pw> (NODE_ENV=test only) gives every demo account that password — for E2E tests
 *   node src/server/cli.ts seed:demo-history [--weeks 9]   fictional past weeks for the demo school (after seed:demo; test VM only)
 *   node src/server/cli.ts backup:create [--trigger timer]   local backup (DB + uploads + manifest) + retention; never migrates
 *   node src/server/cli.ts backup:list
 *   node src/server/cli.ts backup:verify [<file>|latest]
 *   node src/server/cli.ts backup:restore <file> [--force]   service must be stopped
 *   node src/server/cli.ts backup:offsite [<file>|latest] [--trigger timer]   restic copy + forget/prune
 *   node src/server/cli.ts backup:offsite-init | backup:offsite-check [--read-data-subset 5%] | backup:offsite-snapshots
 * Initial administrator setup (ACC-3): there is no web registration and no default password.
 * Off-site credentials (RESTIC_*, B2_*, AWS_*) are read from the environment only and never printed.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config.ts';
import { openDatabase, type Db } from './db/client.ts';
import { users } from './db/schema.ts';
import { audit } from './lib/audit.ts';
import { hashPassword } from './lib/crypto.ts';
import { createUser, normaliseLogin, revokeAllUserSessions } from './modules/auth/service.ts';
import { backupNow, errorSummary, listBackups, migrateWithSnapshot, recordRun, resolveBackupFile, restoreBackup, RestoreRefused, verifyBackup, type RunRecord } from './ops/backup.ts';
import { offsiteBackup, offsiteCheck, offsiteInit, offsiteProblems, offsiteSnapshots, tail } from './ops/restic.ts';
import { appVersion, hasAppTables, levelText, migrationLevel } from './ops/version.ts';
import { SeedRefused, seedDemo } from './seed/demo.ts';
import { seedDemoHistory } from './seed/history.ts';

async function readSecret(prompt: string): Promise<string> {
  if (process.env.CC_PASSWORD) return process.env.CC_PASSWORD;
  process.stderr.write(prompt);
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

const [cmd, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  options: {
    login: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    'force-demo': { type: 'boolean' },
    force: { type: 'boolean' },
    trigger: { type: 'string' },
    'read-data-subset': { type: 'string' },
    weeks: { type: 'string' },
  },
  allowPositionals: true,
});
const config = loadConfig();
const system = { type: 'system' as const, id: null };
const trigger: RunRecord['trigger'] = values.trigger === 'timer' ? 'timer' : 'cli';
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** The database is opened only by the commands that need it (restore must not hold it open). */
let opened: Db | null = null;
const db = (): Db => (opened ??= openDatabase(config.dbPath));
const migrate = async () => {
  const snap = await migrateWithSnapshot(db(), config, Date.now, trigger);
  if (snap) console.log(`Database snapshot before migrating: ${snap}`);
};

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

switch (cmd) {
  case 'migrate':
    await migrate();
    console.log(`Migrations applied (${levelText(migrationLevel(db().$client))}).`);
    break;
  case 'admin:create': {
    await migrate();
    if (!values.login || !values.name) throw new Error('--login and --name are required');
    const password = await readSecret('Password (min 10 chars): ');
    const u = await createUser(db(), { login: values.login, displayName: values.name, role: 'admin', password, email: values.email ?? null }, system, Date.now());
    console.log(`Administrator created: ${u.login}`);
    break;
  }
  case 'admin:reset-password': {
    if (!values.login) throw new Error('--login is required');
    const u = db().select().from(users).where(eq(users.login, normaliseLogin(values.login))).get();
    if (!u) throw new Error('No such user');
    const password = await readSecret('New password (min 10 chars): ');
    if (password.length < 10) throw new Error('Password too short');
    const now = Date.now();
    db().update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: now }).where(eq(users.id, u.id)).run();
    revokeAllUserSessions(db(), u.id, now);
    audit(db(), system, { action: 'auth.password_reset_cli', entity: 'user', entityId: u.id }, now);
    console.log(`Password reset for ${u.login}; they must change it at next sign-in.`);
    break;
  }
  case 'seed:demo': {
    await migrate();
    try {
      const fixed = process.env.CC_DEMO_PASSWORD;
      const r = await seedDemo({ db: db(), config, now: Date.now }, { force: values['force-demo'] === true, ...(fixed ? { fixedPassword: fixed } : {}) });
      console.log(`Demo school created (fictional data). School year ${r.schoolYear}.`);
      for (const c of r.classes) console.log(`  class ${c.name}: ${c.students} students`);
      console.log('');
      console.log('Demo accounts. These passwords are shown ONCE; store them now:');
      for (const a of r.accounts) console.log(`  ${a.role.padEnd(7)} ${a.login.padEnd(12)} ${a.password}`);
    } catch (err) {
      if (!(err instanceof SeedRefused)) throw err;
      fail(err.message);
    }
    break;
  }
  case 'seed:demo-history': {
    await migrate();
    try {
      const r = seedDemoHistory({ db: db(), config, now: Date.now }, values.weeks === undefined ? {} : { weeks: Number(values.weeks) });
      console.log(`Demo history created (fictional data): ${r.from} to ${r.to}, ${r.weeks} weeks, ${r.schoolDays} school days, ${r.lessons} lessons in ${r.contexts} classes and subjects (${r.abandoned} left running and abandoned), in ${(r.elapsedMs / 1000).toFixed(1)} s.`);
      for (const [key, what] of Object.entries(r.counts)) console.log(`  ${key}: ${Object.entries(what).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    } catch (err) {
      if (!(err instanceof SeedRefused)) throw err;
      fail(err.message);
    }
    break;
  }
  case 'backup:create': {
    // Never migrates: a backup job (sidecar, timer) may run another image version than the app and
    // must not change the schema of a database the app owns. The database is backed up as it is.
    const level = migrationLevel(db().$client);
    if (!hasAppTables(db().$client)) {
      fail(`Nothing to back up: ${config.dbPath} holds no Class Compass data yet (start the app or run migrate first).`);
      break;
    }
    if (level.pending > 0) console.warn(`Note: the database is at migration ${levelText(level)}; this code ships ${level.shipped}. Backing it up as it is (migrations are applied only by the app's start-up or 'migrate').`);
    const r = await backupNow({ db: db(), config, now: Date.now, trigger });
    if (!r.ok) fail(`Backup FAILED: ${r.error}`);
    else {
      console.log(`Backup written: ${r.result.file} (${mb(r.result.size)}, ${r.result.manifest.uploads.count} uploaded files, migration ${r.result.manifest.migration.latestTag})`);
      if (r.result.manifest.uploads.missingReferenced) console.warn(`Warning: ${r.result.manifest.uploads.missingReferenced} uploaded file(s) listed in the database were not found on disk.`);
      if (r.pruned.length) console.log(`Retention removed ${r.pruned.length} older backup(s).`);
    }
    break;
  }
  case 'backup:list': {
    const list = listBackups(config);
    if (!list.length) console.log(`No backups in ${config.backupsDir}`);
    for (const b of list) console.log(`${new Date(b.at).toISOString()}  ${b.kind.padEnd(13)} ${mb(b.size).padStart(10)}  ${b.fileName}`);
    break;
  }
  case 'backup:verify': {
    const file = resolveBackupFile(config, positionals[0]);
    const started = Date.now();
    const r = await verifyBackup(file);
    const details = r.ok ? { tables: Object.keys(r.manifest?.tables ?? {}).length, files: r.manifest?.files.length ?? 0, migration: r.manifest?.migration.latestTag ?? null } : { problems: r.problems.slice(0, 10) };
    try {
      recordRun(db(), { kind: 'verify', trigger, status: r.ok ? 'ok' : 'failed', startedAt: started, finishedAt: Date.now(), fileName: path.basename(file), details });
    } catch {
      /* the verify result is printed even when it cannot be recorded */
    }
    if (r.ok) console.log(`OK: ${path.basename(file)} — ${r.manifest!.files.length} entries, checksums match, integrity_check ok, row counts match (created ${r.manifest!.createdAt}, app ${r.manifest!.appVersion}).`);
    else fail(`Backup FAILED verification: ${path.basename(file)}\n  ${r.problems.join('\n  ')}`);
    break;
  }
  case 'backup:restore': {
    if (!positionals[0]) {
      fail('Usage: backup:restore <file> [--force]   (stop the service first)');
      break;
    }
    try {
      const file = resolveBackupFile(config, positionals[0]);
      console.log(`Verifying and restoring ${path.basename(file)} …`);
      const r = await restoreBackup({ config, file, now: Date.now(), force: values.force === true, trigger });
      console.log(`Restored. Previous data kept in ${r.preRestoreDir}. Migration level now ${r.migrationsAfter.latestTag}. Start the service again.`);
    } catch (err) {
      if (err instanceof RestoreRefused) fail(`Restore refused: ${err.message}`);
      else throw err;
    }
    break;
  }
  case 'backup:offsite': {
    const env = process.env;
    const problems = offsiteProblems(env);
    const started = Date.now();
    const record = (status: 'ok' | 'failed', fileName: string | null, details: Record<string, unknown>) => {
      try {
        recordRun(db(), { kind: 'offsite', trigger, status, startedAt: started, finishedAt: Date.now(), fileName, details });
      } catch {
        /* printed below */
      }
    };
    if (problems.length) {
      record('failed', null, { error: problems.join('; '), notConfigured: true });
      fail(`Off-site backup not configured: ${problems.join('; ')}`);
      break;
    }
    let file: string;
    try {
      file = resolveBackupFile(config, positionals[0]);
    } catch (err) {
      record('failed', null, { error: errorSummary(err) });
      fail(errorSummary(err));
      break;
    }
    const r = await offsiteBackup(file, { daily: config.OFFSITE_KEEP_DAILY, weekly: config.OFFSITE_KEEP_WEEKLY, monthly: config.OFFSITE_KEEP_MONTHLY }, { env });
    record(r.ok ? 'ok' : 'failed', path.basename(file), r.ok ? { snapshotId: r.snapshotId } : { error: r.message, snapshotId: r.snapshotId });
    if (r.ok) console.log(`Off-site copy stored (snapshot ${r.snapshotId ?? 'unknown'}) of ${path.basename(file)}.`);
    else fail(`Off-site backup FAILED: ${r.message}`);
    break;
  }
  case 'backup:offsite-init': {
    const r = await offsiteInit({ env: process.env });
    if (r.code === 0) console.log('Repository initialised.');
    else fail(`restic init failed: ${tail(r.stderr || r.stdout)}`);
    break;
  }
  case 'backup:offsite-check':
  case 'restic:check': {
    const started = Date.now();
    const r = await offsiteCheck({ env: process.env }, values['read-data-subset']);
    try {
      recordRun(db(), { kind: 'offsite_check', trigger, status: r.code === 0 ? 'ok' : 'failed', startedAt: started, finishedAt: Date.now(), details: r.code === 0 ? { readDataSubset: values['read-data-subset'] ?? null } : { error: tail(r.stderr || r.stdout) } });
    } catch {
      /* printed below */
    }
    if (r.code === 0) console.log('restic check: no errors were found.');
    else fail(`restic check FAILED: ${tail(r.stderr || r.stdout)}`);
    break;
  }
  case 'backup:offsite-snapshots': {
    const r = await offsiteSnapshots({ env: process.env });
    if (r.code === 0) console.log(r.stdout);
    else fail(`restic snapshots failed: ${tail(r.stderr || r.stdout)}`);
    break;
  }
  case 'version':
    console.log(`Class Compass ${appVersion()}`);
    break;
  default:
    fail(
      'Commands: migrate | admin:create | admin:reset-password | seed:demo [--force-demo] | seed:demo-history [--weeks 9] | backup:create | backup:list | backup:verify [file] | backup:restore <file> [--force] | backup:offsite [file] | backup:offsite-init | backup:offsite-check [--read-data-subset 5%] | backup:offsite-snapshots | version',
    );
}
(opened as Db | null)?.$client.close();
