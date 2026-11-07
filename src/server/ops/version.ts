/**
 * App version and migration level (OPS, D-089): shown on the admin Maintenance page and written into
 * every backup manifest and backup run, so a restore can tell which code a snapshot belongs to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { MIGRATIONS_DIR } from '../db/client.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let cachedVersion: string | null = null;
/** `version` of package.json, plus `+<sha>` when the image was built with APP_COMMIT. */
export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  let v = '0.0.0';
  try {
    v = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? v;
  } catch {
    /* keep the fallback */
  }
  const commit = process.env.APP_COMMIT?.trim();
  cachedVersion = commit && /^[0-9a-f]{7,40}$/u.test(commit) ? `${v}+${commit.slice(0, 12)}` : v;
  return cachedVersion;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

/** Migrations shipped with this code (drizzle/meta/_journal.json), in order. */
export function shippedMigrations(): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

export interface MigrationLevel {
  /** Migrations recorded as applied in this database. */
  applied: number;
  /** Migrations shipped with the running code. */
  shipped: number;
  /** Tag of the newest applied migration (null for an empty database). */
  latestTag: string | null;
  pending: number;
}

/** Applied vs shipped migrations of an open database (raw better-sqlite3 handle). */
export function migrationLevel(sqlite: Database.Database): MigrationLevel {
  const shipped = shippedMigrations();
  const hasTable = sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  const applied = hasTable ? (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n : 0;
  return { applied, shipped: shipped.length, latestTag: applied > 0 ? (shipped[applied - 1] ?? `#${applied}`) : null, pending: Math.max(0, shipped.length - applied) };
}

/** Short text form, e.g. `10/10 0009_s11_backup_runs`. */
export const levelText = (l: MigrationLevel) => `${l.applied}/${l.shipped}${l.latestTag ? ` ${l.latestTag}` : ''}`;

/** True when the database already holds application tables (not a brand-new file). */
export function hasAppTables(sqlite: Database.Database): boolean {
  return Boolean(sqlite.prepare("select 1 from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' limit 1").get());
}

/** Row count of every application table (backup manifests, restore comparison). */
export function tableCounts(sqlite: Database.Database): Record<string, number> {
  const names = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
    .all()
    .map((r) => (r as { name: string }).name);
  return Object.fromEntries(names.map((n) => [n, (sqlite.prepare(`select count(*) as n from "${n.replaceAll('"', '""')}"`).get() as { n: number }).n]));
}
