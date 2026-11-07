/**
 * Student list importer: review fixes (S9 review). Headings vs names, same-name children, names
 * outside the teacher's classes, number conflicts and list positions, date-aware matching, safe
 * revert (moved students, closed enrolments, history coverage). Fictional names only. A separate
 * file (own server) because batch creation is rate-limited per address.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrolments, students } from '../../src/server/db/schema.ts';
import { ENROLMENT_HISTORY_TABLES } from '../../src/server/modules/import/service.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';

type Row = {
  id: string;
  parsed: { fullName: string; studentNumber: string | null };
  flags: string[];
  decision: string;
  needsChoice: boolean;
  matchedStudentId: string | null;
  candidates: Array<{ id: string }>;
  outcome: string | null;
  reason: string | null;
  revertOutcome: string | null;
};
type Batch = { id: string; status: string; counts: Record<string, number>; rows: Row[] };

const paste = (c: Client, classId: string, text: string) => ok(c.post('/api/import/batches', { classId, text })) as Promise<Batch>;
const commit = (c: Client, id: string) => ok(c.post(`/api/import/batches/${id}/commit`, {})) as Promise<Batch>;
const studentRows = (b: Batch) => b.rows.filter((r) => !r.flags.includes('heading_ignored'));
const rosterNames = async (c: Client, classId: string) => (await ok(c.get(`/api/teacher/classes/${classId}/students`))).students.map((x: { fullName: string }) => x.fullName) as string[];

describe('student list importer review fixes (IMP-2..5, D-022, D-027)', () => {
  let env: TestEnv;
  let s: School;
  let root: string;
  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-import-review-'));
    env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
    s = await buildSchool(env);
  });
  afterAll(async () => {
    await env.app.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('two children with the same name and different numbers are both imported (IMP-2, IMP-5 review fix)', async () => {
    const b = await paste(s.teacherA, s.c3a.id, '1201 Ahmet Kurguoğlu\n1305 Ahmet Kurguoğlu\n1400 Zeynep Kurguoğlu\n');
    const st = studentRows(b);
    expect(st.map((r) => r.decision)).toEqual(['add', 'add', 'add']);
    expect(st[0]!.flags).toContain('same_name_in_file');
    expect(st[1]!.flags).toContain('same_name_in_file');
    expect(st.some((r) => r.flags.includes('duplicate_in_file'))).toBe(false);
    const done = await commit(s.teacherA, b.id);
    expect(done.counts).toMatchObject({ added: 3, skipped: 0 });
    expect((await rosterNames(s.teacherA, s.c3a.id)).filter((n) => n === 'Ahmet Kurguoğlu')).toHaveLength(2);
  });

  it('names containing generic heading words are kept visible, flagged and need only a choice (IMP-3 review fix)', async () => {
    const b = await paste(s.teacherA, s.c3a.id, '3-A Listesi\nEllen Page\nMehmet Öğretmen\nGrace Class\nAyşe Kurgucu\n');
    const heading = b.rows.filter((r) => r.flags.includes('heading_ignored'));
    expect(heading.map((r) => r.parsed.fullName)).toEqual(['3-A Listesi']);
    const st = studentRows(b);
    expect(st.map((r) => r.parsed.fullName)).toEqual(['Ellen Page', 'Mehmet Öğretmen', 'Grace Class', 'Ayşe Kurgucu']);
    expect(st.slice(0, 3).every((r) => r.flags.includes('possible_heading') && r.decision === 'skip')).toBe(true);
    expect(st[3]!.decision).toBe('add');
    // The teacher keeps a real name: it is added.
    await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${st[1]!.id}`, { decision: 'add' }));
    const done = await commit(s.teacherA, b.id);
    expect(done.counts).toMatchObject({ added: 2 });
    expect(studentRows(done).find((r) => r.parsed.fullName === 'Ellen Page')!.reason).toBe('POSSIBLE_HEADING');
    expect(await rosterNames(s.teacherA, s.c3a.id)).toEqual(expect.arrayContaining(['Mehmet Öğretmen', 'Ayşe Kurgucu']));
  });

  it('the same name in a class the teacher cannot see is flagged (count only) and needs a choice (D-022, ACC-4, IMP-4)', async () => {
    await addStudent(s.teacherB, s.c3b.id, { fullName: 'Ilgın Saklıkurgu' });
    const b = await paste(s.teacherA, s.c3a.id, 'Ilgın Saklıkurgu\nOzan Kurgulu\n');
    const [ilgin, ozan] = studentRows(b);
    expect(ilgin!.flags).toContain('name_elsewhere');
    expect(ilgin).toMatchObject({ needsChoice: true, candidates: [] });
    expect(ozan).toMatchObject({ needsChoice: false });
    expect(JSON.stringify(b)).not.toContain('3-B');
    const refused = await s.teacherA.post(`/api/import/batches/${b.id}/commit`, {});
    expect(refused.body.error.details.reason).toBe('IMPORT_DECISIONS_NEEDED');
    await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${ilgin!.id}`, { decision: 'add' }));
    expect((await commit(s.teacherA, b.id)).counts).toMatchObject({ added: 2 });
  });

  it('a number match whose name differs is a conflict for the teacher, not an automatic match (IMP-4)', async () => {
    const existing = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Ece Kurgusal', studentNumber: '9301' });
    const b = await paste(s.teacherA, s.c3a.id, 'Öğrenci No\tAdı Soyadı\n9301\tBarış Tamamenbaşka\n');
    const [row] = studentRows(b);
    expect(row!.flags).toEqual(expect.arrayContaining(['number_match', 'number_conflict']));
    expect(row).toMatchObject({ needsChoice: true, matchedStudentId: existing.id });
    expect((await s.teacherA.post(`/api/import/batches/${b.id}/commit`, {})).body.error.details.reason).toBe('IMPORT_DECISIONS_NEEDED');
    // A numbered list with a missing line keeps its positions as positions, not student numbers.
    await addStudent(s.teacherA, s.c3a.id, { fullName: 'Dört Kurgusal', studentNumber: '4' });
    const gaps = await paste(s.teacherA, s.c3a.id, '1 Ayla Kurgu\n2 Bahar Kurgu\n4 Cemre Kurgu\n5 Duru Kurgu\n');
    expect(studentRows(gaps).every((r) => r.parsed.studentNumber === null && !r.flags.includes('number_match'))).toBe(true);
  });

  it('a matched student with a future move out of the class still counts as in the class (D-027)', async () => {
    const st = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Gelecek Kurgu', studentNumber: '9401' });
    await ok(s.admin.post('/api/admin/students/move', { studentIds: [st.id], toClassId: s.c3b.id, date: '2026-12-01' }));
    const b = await commit(s.teacherA, (await paste(s.teacherA, s.c3a.id, 'Öğrenci No\tAdı Soyadı\n9401\tGelecek Kurgu\n')).id);
    expect(studentRows(b)[0]).toMatchObject({ outcome: 'matched', reason: 'ALREADY_IN_CLASS' });
    expect(env.db.select().from(enrolments).where(eq(enrolments.studentId, st.id)).all()).toHaveLength(2);
  });

  it('revert never deactivates a student who has moved to another teacher since (IMP-5, ACC-4)', async () => {
    const b = await commit(s.teacherA, (await paste(s.teacherA, s.c3a.id, 'Taşınan Kurgu\n')).id);
    const created = env.db.select().from(students).where(eq(students.fullName, 'Taşınan Kurgu')).get()!;
    await ok(s.admin.post('/api/admin/students/move', { studentIds: [created.id], toClassId: s.c3b.id }));
    const r = (await ok(s.teacherA.post(`/api/import/batches/${b.id}/revert`, { confirm: true }))) as Batch;
    expect(studentRows(r)[0]!.revertOutcome).toBe('moved_elsewhere');
    expect(env.db.select().from(students).where(eq(students.id, created.id)).get()!.deactivatedAt).toBeNull();
    expect(await rosterNames(s.teacherB, s.c3b.id)).toContain('Taşınan Kurgu');
  });

  it('revert closes (never deletes) an enrolment of a matched student with classroom history, e.g. assistant duty (IMP-5, DAT-5)', async () => {
    const sarp = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Sarp Kurgu', studentNumber: '9500' });
    const tuna = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Tunç Kurgu', studentNumber: '9501' });
    // Neither is enrolled anywhere this year (e.g. returning after a year away).
    env.db.delete(enrolments).where(eq(enrolments.studentId, sarp.id)).run();
    env.db.delete(enrolments).where(eq(enrolments.studentId, tuna.id)).run();
    const b = await commit(s.admin, (await ok(s.admin.post('/api/import/batches', { classId: s.c3a.id, text: 'Öğrenci No\tAdı Soyadı\n9500\tSarp Kurgu\n9501\tTunç Kurgu\n' }))).id);
    expect(studentRows(b).map((r) => r.reason)).toEqual(['ENROLLED', 'ENROLLED']);
    // Sarp was the daily assistant in the class after the import.
    const now = env.clock.now();
    env.db.$client
      .prepare(`INSERT INTO assistant_assignments (id, context_id, school_year_id, local_date, planned_student_id, status, absent_student_ids, created_at, updated_at) VALUES (?, ?, ?, '2026-11-09', ?, 'planned', '[]', ?, ?)`)
      .run('as-import-test', s.ctxA.id, s.year.id, sarp.id, now, now);
    const r = (await ok(s.admin.post(`/api/import/batches/${b.id}/revert`, { confirm: true }))) as Batch;
    expect(studentRows(r).map((x) => x.revertOutcome)).toEqual(['enrolment_closed', 'enrolment_removed']);
    expect(env.db.select().from(enrolments).where(eq(enrolments.studentId, sarp.id)).all()).toHaveLength(1);
    expect(env.db.select().from(enrolments).where(eq(enrolments.studentId, tuna.id)).all()).toHaveLength(0);
  });

  it('the revert history check covers every table that refers to students (IMP-5)', () => {
    const tables = (env.db.$client.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((t) => t.name);
    const referring = tables.filter((t) => (env.db.$client.prepare(`PRAGMA foreign_key_list("${t}")`).all() as Array<{ table: string }>).some((fk) => fk.table === 'students'));
    expect(referring.filter((t) => t !== 'enrolments').sort()).toEqual([...ENROLMENT_HISTORY_TABLES].sort());
  });
});
