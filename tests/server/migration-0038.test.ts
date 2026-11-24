/**
 * Migration 0038 (S37, D-218) on a database that already has notification rows: the table rebuild
 * that lets `student_id` be null keeps every row and index, and `lessons.last_activity_at` arrives
 * empty (read as the lesson's start; a lesson from an earlier day is abandoned on the first settle).
 * Fictional ids only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/server/db/client.ts';

const TAG = '0038_s37_lesson_auto_end';
let dir: string | null = null;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('migration 0038 (S37, D-218)', () => {
  it('keeps the notification rows and indexes and adds an empty last_activity_at', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mig-0038-'));
    const before = path.join(dir, 'before');
    fs.cpSync(MIGRATIONS_DIR, before, { recursive: true });
    const journalFile = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as { entries: Array<{ tag: string }> };
    expect(journal.entries.at(-1)!.tag).toBe(TAG);
    journal.entries = journal.entries.filter((e) => e.tag !== TAG);
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    fs.rmSync(path.join(before, `${TAG}.sql`));

    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: before });
    const indexes = () => (sqlite.prepare("select name, sql from sqlite_master where type = 'index' and tbl_name = 'notifications' order by name").all() as Array<{ name: string; sql: string }>);
    const indexesBefore = indexes();
    // As the server runs it (openDatabase): foreign keys on, so the rebuilt rows are checked against
    // their parents. The parents get only their required columns (their own references are not checked here).
    sqlite.pragma('foreign_keys = OFF');
    const parent = (table: string, id: string) => {
      const cols = (sqlite.prepare(`pragma table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>).filter((c) => c.name === 'id' || (c.notnull && c.dflt_value === null));
      const values = cols.map((c) => (c.name === 'id' ? id : c.type.toUpperCase().includes('INT') ? 0 : `${c.name}-${id}`));
      sqlite.prepare(`insert into ${table} (${cols.map((c) => `"${c.name}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})`).run(...values);
    };
    parent('users', 'u-ayse');
    parent('students', 's-ece');
    parent('students', 's-arda');
    parent('subjects', 'sub-en');
    parent('teaching_contexts', 'ctx-3a');
    const insert = sqlite.prepare(
      'insert into notifications (id, user_id, student_id, subject_id, context_id, category, entity, entity_id, count, digested_count, local_date, created_at, updated_at, read_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('n-1', 'u-ayse', 's-ece', 'sub-en', 'ctx-3a', 'textBlocked', 'student', null, 3, 1, '2026-11-20', 10, 20, null);
    insert.run('n-2', 'u-ayse', 's-arda', null, null, 'avatarPicture', 'student', 'pic-1', 1, 0, '2026-11-21', 30, 40, 50);
    const rowsBefore = sqlite.prepare('select * from notifications order by id').all();
    sqlite.pragma('foreign_keys = ON');
    expect(sqlite.pragma('foreign_key_check(notifications)')).toEqual([]);

    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(sqlite.prepare('select * from notifications order by id').all()).toEqual(rowsBefore);
    expect(indexes()).toEqual(indexesBefore);
    const cols = sqlite.prepare('pragma table_info(notifications)').all() as Array<{ name: string; notnull: number }>;
    expect(cols.find((c) => c.name === 'student_id')!.notnull).toBe(0);
    const lessonCols = sqlite.prepare('pragma table_info(lessons)').all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    expect(lessonCols.find((c) => c.name === 'last_activity_at')).toMatchObject({ notnull: 0, dflt_value: null });
    expect(sqlite.pragma('foreign_key_check(notifications)')).toEqual([]);
    sqlite.close();
  });
});
