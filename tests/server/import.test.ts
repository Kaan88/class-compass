/**
 * Student list importer over HTTP (S9: IMP-1..5, D-013, DAT-5, ENG-3 "import duplicates & uncertain
 * OCR"). Fictional names only.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents, enrolments, students } from '../../src/server/db/schema.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { addStudent, buildSchool, ok, type School } from '../school-fixture.ts';
import { eOkulRows, eOkulXlsx, EXPECTED_NAMES, multipart } from '../import-fixtures.ts';

type Row = {
  id: string;
  idx: number;
  parsed: { fullName: string; givenNames: string | null; familyName: string | null; studentNumber: string | null };
  flags: string[];
  decision: string;
  needsChoice: boolean;
  matchedStudentId: string | null;
  candidates: Array<{ id: string; score: number }>;
  canFillNumber: boolean;
  outcome: string | null;
  reason: string | null;
  revertOutcome: string | null;
};
type Batch = { id: string; status: string; counts: Record<string, number>; rows: Row[]; mapping: Record<string, number | null>; columns: string[]; notices: string[] };

const paste = (c: Client, classId: string, text: string) => ok(c.post('/api/import/batches', { classId, text })) as Promise<Batch>;
const commit = (c: Client, id: string) => ok(c.post(`/api/import/batches/${id}/commit`, {})) as Promise<Batch>;
const studentRows = (b: Batch) => b.rows.filter((r) => !r.flags.includes('heading_ignored'));
const rosterNames = async (c: Client, classId: string) => (await ok(c.get(`/api/teacher/classes/${classId}/students`))).students.map((x: { fullName: string }) => x.fullName) as string[];

describe('student list importer (IMP-1..5)', () => {
  let env: TestEnv;
  let s: School;
  let root: string;
  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-import-'));
    env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
    s = await buildSchool(env);
  });
  afterAll(async () => {
    await env.app.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('paste → preview → commit → report: headings and blank lines ignored, multi-part names kept whole (IMP-2, IMP-3)', async () => {
    const b = await paste(s.teacherA, s.c3a.id, '3-A Sınıf Listesi\n\n1. Ayşe Nur Kara Yılmaz\n2. Mehmet Ali Kaya\n\n3. ELİF SU DOĞAN\n');
    expect(b.status).toBe('draft');
    const st = studentRows(b);
    expect(st.map((r) => r.parsed.fullName)).toEqual(['Ayşe Nur Kara Yılmaz', 'Mehmet Ali Kaya', 'Elif Su Doğan']);
    expect(st.every((r) => r.parsed.givenNames === null && r.parsed.familyName === null && r.decision === 'add')).toBe(true);
    expect(b.rows.filter((r) => r.flags.includes('heading_ignored'))).toHaveLength(1);
    const done = await commit(s.teacherA, b.id);
    expect(done.status).toBe('committed');
    expect(done.counts).toMatchObject({ added: 3, matched: 0, skipped: 1, failed: 0 });
    expect(await rosterNames(s.teacherA, s.c3a.id)).toEqual(expect.arrayContaining(['Ayşe Nur Kara Yılmaz', 'Mehmet Ali Kaya', 'Elif Su Doğan']));
    // Created through the importer: enrolment reason "import", tied to the batch; initials avatar automatic (IMP-6).
    const created = env.db.select().from(students).where(eq(students.createdByImportBatchId, b.id)).all();
    expect(created).toHaveLength(3);
    expect(env.db.select().from(enrolments).where(eq(enrolments.importBatchId, b.id)).all().every((e) => e.reason === 'import')).toBe(true);
    const roster = await ok(s.teacherA.get(`/api/teacher/classes/${s.c3a.id}/students`));
    expect(roster.students.find((x: { fullName: string }) => x.fullName === 'Ayşe Nur Kara Yılmaz')).toMatchObject({ initials: 'AY', photoUrl: null });
    expect(env.db.select().from(auditEvents).where(eq(auditEvents.entityId, b.id)).all().map((a) => a.action)).toEqual(expect.arrayContaining(['import.create', 'import.commit']));
    // Committing twice is refused.
    expect((await s.teacherA.post(`/api/import/batches/${b.id}/commit`, {})).body.error.details.reason).toBe('IMPORT_NOT_DRAFT');
  });

  it('flags duplicates within the file and skips the second copy (IMP-2)', async () => {
    const b = await paste(s.teacherA, s.c3a.id, 'Öğrenci No\tAdı Soyadı\n401\tSelin Ay\n\tSelin Ay\n403\tTuna Er\n403\tTuna Erk\n');
    const st = studentRows(b);
    expect(st.filter((r) => r.flags.includes('duplicate_in_file')).map((r) => r.idx)).toHaveLength(4);
    expect(st.map((r) => r.decision)).toEqual(['add', 'skip', 'add', 'skip']);
  });


  it('student number match vs name-only possible match: never a silent merge (IMP-4)', async () => {
    const numbered = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Bora Yıldız', studentNumber: '5001' });
    const unnumbered = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Deniz Akın' });
    const b = await paste(s.teacherA, s.c3a.id, 'Öğrenci No\tAdı Soyadı\n5001\tBORA YILDIZ\n\tDeniz Akın\n\tDeniz Akim\n5002\tYeni Kurgu\n');
    const [bora, deniz, denizTypo, yeni] = studentRows(b);
    expect(bora).toMatchObject({ decision: 'match', matchedStudentId: numbered.id, needsChoice: false });
    expect(bora!.flags).toContain('number_match');
    // Same name, no number: suggested, but the teacher must decide.
    expect(deniz!.flags).toContain('possible_match');
    expect(deniz).toMatchObject({ needsChoice: true, decision: 'match', matchedStudentId: unnumbered.id });
    expect(deniz!.flags).toContain('missing_number');
    // A similar (not equal) name: offered as a candidate, suggestion is "add", still needs a choice.
    expect(denizTypo!.flags).toContain('possible_match');
    expect(denizTypo).toMatchObject({ needsChoice: true, decision: 'add' });
    expect(denizTypo!.candidates[0]).toMatchObject({ id: unnumbered.id });
    expect(denizTypo!.candidates[0]!.score).toBeLessThan(1);
    expect(yeni).toMatchObject({ decision: 'add', needsChoice: false });
    const refused = await s.teacherA.post(`/api/import/batches/${b.id}/commit`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('IMPORT_DECISIONS_NEEDED');
    await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${deniz!.id}`, { decision: 'match', matchedStudentId: unnumbered.id }));
    await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${denizTypo!.id}`, { decision: 'skip' }));
    const before = await rosterNames(s.teacherA, s.c3a.id);
    const done = await commit(s.teacherA, b.id);
    expect(done.counts).toMatchObject({ added: 1, matched: 2, skipped: 2 }); // header row + the skipped typo row;
    const after = await rosterNames(s.teacherA, s.c3a.id);
    expect(after.length).toBe(before.length + 1);
    expect(after.filter((n) => n === 'Bora Yıldız')).toHaveLength(1);
    expect(after.filter((n) => n === 'Deniz Akın')).toHaveLength(1);
  });

  it('a number belonging to a student the teacher cannot see is reported, not matched or leaked (ACC-4)', async () => {
    await addStudent(s.teacherB, s.c3b.id, { fullName: 'Gizli Kurgu', studentNumber: '7777' });
    const b = await paste(s.teacherA, s.c3a.id, '7777 Başka İsim\n');
    const [r] = studentRows(b);
    expect(r!.flags).toContain('number_elsewhere');
    expect(r!.decision).toBe('skip');
    expect(JSON.stringify(b)).not.toContain('Gizli');
  });

  it('re-import never duplicates and never overwrites; a missing number is filled only when confirmed (IMP-5)', async () => {
    const list = 'Öğrenci No;Adı;Soyadı\n6001;Kaan;Deniz\n6002;Lale;Ekin\n';
    const first = await commit(s.teacherA, (await paste(s.teacherA, s.c3a.id, list)).id);
    expect(first.counts.added).toBe(2);
    const count = (await rosterNames(s.teacherA, s.c3a.id)).length;
    const again = await paste(s.teacherA, s.c3a.id, list);
    expect(studentRows(again).every((r) => r.decision === 'match' && r.flags.includes('number_match'))).toBe(true);
    const report = await commit(s.teacherA, again.id);
    expect(report.counts).toMatchObject({ added: 0, matched: 2 });
    expect(studentRows(report).every((r) => r.outcome === 'matched' && r.reason === 'ALREADY_IN_CLASS')).toBe(true);
    expect((await rosterNames(s.teacherA, s.c3a.id)).length).toBe(count);

    // A student without a number, matched by name: the number is only saved when ticked.
    const noNum = await addStudent(s.teacherA, s.c3a.id, { fullName: 'Mira Taş' });
    const b = await paste(s.teacherA, s.c3a.id, '6100 Mira Taş\n');
    const [row] = studentRows(b);
    expect(row).toMatchObject({ needsChoice: true, canFillNumber: true });
    const edited = (await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${row!.id}`, { decision: 'match', matchedStudentId: noNum.id }))) as Batch;
    expect(studentRows(edited)[0]!.canFillNumber).toBe(true);
    await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${row!.id}`, { fillNumber: true }));
    const filled = await commit(s.teacherA, b.id);
    expect(filled.counts.matched).toBe(1);
    expect(env.db.select().from(students).where(eq(students.id, noNum.id)).get()!.studentNumber).toBe('6100');
    // Reverting clears the number again (only the batch's own change).
    const reverted = (await ok(s.teacherA.post(`/api/import/batches/${b.id}/revert`, { confirm: true }))) as Batch;
    expect(studentRows(reverted)[0]!.revertOutcome).toBe('number_cleared');
    expect(env.db.select().from(students).where(eq(students.id, noNum.id)).get()!.studentNumber).toBeNull();
  });

  it('fixing a row in the preview re-checks it (IMP-2)', async () => {
    const b = await paste(s.teacherA, s.c3a.id, 'Öğrenci No\tAdı Soyadı\n8001\tNEHİR KURGU\n8002\t\n');
    const missing = studentRows(b).find((r) => r.flags.includes('missing_name'))!;
    expect(missing.decision).toBe('skip');
    const fixed = (await ok(s.teacherA.patch(`/api/import/batches/${b.id}/rows/${missing.id}`, { fullName: 'ÖYKÜ KURGU' }))) as Batch;
    const row = fixed.rows.find((r) => r.id === missing.id)!;
    expect(row.parsed.fullName).toBe('Öykü Kurgu');
    expect(row.flags).not.toContain('missing_name');
    expect(row.decision).toBe('add');
    expect(studentRows(fixed)[0]!.parsed.fullName).toBe('Nehir Kurgu');
  });

  it('revert removes what the batch created unless something was recorded since; then it deactivates and reports (IMP-5, DAT-5)', async () => {
    const b = await commit(s.teacherA, (await paste(s.teacherA, s.c3a.id, 'Rüzgar Kurgu\nSu Kurgu\nTan Kurgu\n')).id);
    const created = studentRows(b).map((r) => env.db.select().from(students).where(eq(students.fullName, r.parsed.fullName)).get()!);
    // Attendance recorded for Tan since the import: history.
    await ok(s.teacherA.put(`/api/teacher/classes/${s.c3a.id}/attendance`, { classId: s.c3a.id, date: '2026-11-09', studentId: created[2]!.id, status: 'present' }));
    const mine = (await ok(s.teacherB.get('/api/import/batches'))).batches as Array<{ id: string }>;
    expect(mine.some((x) => x.id === b.id)).toBe(false);
    expect((await s.teacherB.post(`/api/import/batches/${b.id}/revert`, { confirm: true })).status).toBe(404);
    expect((await s.teacherA.post(`/api/import/batches/${b.id}/revert`, {})).status).toBe(400);
    const r = (await ok(s.teacherA.post(`/api/import/batches/${b.id}/revert`, { confirm: true }))) as Batch;
    expect(r.status).toBe('reverted');
    expect(studentRows(r).map((x) => x.revertOutcome)).toEqual(['removed', 'removed', 'deactivated']);
    expect(env.db.select().from(students).where(eq(students.id, created[0]!.id)).get()).toBeUndefined();
    expect(env.db.select().from(students).where(eq(students.id, created[2]!.id)).get()!.deactivatedAt).not.toBeNull();
    expect(r.counts).toMatchObject({ revert_removed: 2, revert_deactivated: 1 });
    const actions = env.db.select().from(auditEvents).all().map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['import.revert', 'student.remove_imported', 'student.deactivate']));
    expect((await s.teacherA.post(`/api/import/batches/${b.id}/revert`, { confirm: true })).body.error.details.reason).toBe('IMPORT_NOT_COMMITTED');
  });

  it('e-Okul .xlsx upload: header detected, page headers ignored, mapping editable, other classes flagged (D-013)', async () => {
    const m = multipart(eOkulXlsx(), 'sinif-listesi.xlsx', 'application/octet-stream');
    const up = await s.teacherA.req('POST', '/api/files?kind=import_source', m.body, m.headers);
    expect(up.status).toBe(200);
    const b = (await ok(s.teacherA.post('/api/import/batches', { classId: s.c3a.id, fileId: up.body.id }))) as Batch;
    expect(b).toMatchObject({ sourceType: 'xlsx', fileName: 'sinif-listesi.xlsx' });
    expect(studentRows(b).map((r) => r.parsed.fullName)).toEqual(EXPECTED_NAMES);
    expect(b.columns).toEqual(expect.arrayContaining(['Öğrenci No', 'Adı', 'Soyadı']));
    // Change the mapping: use the "Adı" column only as the full name → parts are cleared.
    const mapped = (await ok(s.teacherA.put(`/api/import/batches/${b.id}/mapping`, { mapping: { ...b.mapping, givenNames: null, familyName: null, fullName: b.mapping.givenNames } }))) as Batch;
    expect(studentRows(mapped)[0]!.parsed).toMatchObject({ fullName: 'Ayşe Nur', givenNames: null, familyName: null });
    // Into 3-B the class column says 3/A: rows are flagged and skipped.
    const other = (await ok(s.teacherB.post('/api/import/batches', { classId: s.c3b.id, text: eOkulRows().map((r) => r.join('\t')).join('\n') }))) as Batch;
    expect(studentRows(other).every((r) => r.flags.includes('class_mismatch') && r.decision === 'skip')).toBe(true);
    // Teacher B cannot read teacher A's upload or import into 3-A.
    expect((await s.teacherB.post('/api/import/batches', { classId: s.c3b.id, fileId: up.body.id })).status).toBe(404);
    expect((await s.teacherB.post('/api/import/batches', { classId: s.c3a.id, text: 'X Y' })).status).toBe(403);
  });

  it('admins can import into any class', async () => {
    const b = (await ok(s.admin.post('/api/import/batches', { classId: s.c3b.id, text: 'Yaz Kurgu\n' }))) as Batch;
    expect((await commit(s.admin, b.id)).counts.added).toBe(1);
    expect(await rosterNames(s.teacherB, s.c3b.id)).toContain('Yaz Kurgu');
  });
});
