import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

export function openDatabase(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema }) as Db;
}

/** Apply pending migrations. Callers must take a backup first in production (see cli.ts). */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

export interface ReadSnapshot {
  /** A read-only connection inside one read transaction: every query sees the database as it was when the snapshot was taken. */
  db: Db;
  close(): Promise<void>;
}

/**
 * A consistent read-only view of the database for long reads that yield to the event loop (S15a,
 * D-162: the full export). A database file gets its own read-only connection holding one read
 * transaction: in WAL mode the server's connection keeps writing meanwhile, and the snapshot does not
 * see those writes. An in-memory database (tests) cannot be opened twice, so it is first copied with
 * SQLite's online backup to `tmpFile` (removed by `close`).
 */
export async function openReadSnapshot(db: Db, tmpFile: string): Promise<ReadSnapshot> {
  const main = db.$client;
  let file = main.name;
  let copy: string | null = null;
  if (main.memory) {
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    await main.backup(tmpFile);
    file = copy = tmpFile;
  }
  const conn = new Database(file, { readonly: true, fileMustExist: true });
  try {
    conn.pragma('busy_timeout = 5000');
    conn.exec('BEGIN');
    // The first read starts the read transaction: the snapshot is taken here.
    conn.prepare('select count(*) from sqlite_master').get();
  } catch (err) {
    conn.close();
    if (copy) fs.rmSync(copy, { force: true });
    throw err;
  }
  return {
    db: drizzle(conn, { schema }) as Db,
    async close() {
      try {
        if (conn.inTransaction) conn.exec('COMMIT');
      } finally {
        conn.close();
        if (copy) for (const f of [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`]) fs.rmSync(f, { force: true });
      }
    },
  };
}

/**
 * Run `fn` in a write transaction (BEGIN IMMEDIATE). better-sqlite3 is synchronous, so
 * services must not await inside `fn`.
 */
export function tx<T>(db: Db, fn: (t: Db) => T): T {
  return db.$client.transaction(() => fn(db)).immediate();
}
