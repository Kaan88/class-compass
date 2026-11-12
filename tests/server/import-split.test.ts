/**
 * Several classes in one file (S20c, D-171; IMP-1, IMP-2, IMP-5, D-163): a school-wide list with a
 * class column is split into all its classes in one preview (per-class counts, Turkish-aware class
 * names, unknown classes with a choice); confirm, report, history, audit and undo stay per class.
 * Admins may use every open class, teachers only the classes they teach. Fictional names only.
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents, files } from '../../src/server/db/schema.ts';
import { storagePath } from '../../src/server/modules/files/storage.ts';
import { makeEnv, type Client, type TestEnv } from '../helpers.ts';
import { buildSchool, ok, type School } from '../school-fixture.ts';
import { htmlTableXls, multiClassCsv, multiClassRows, multiClassXlsx, multipart } from '../import-fixtures.ts';

type Group = {
  key: string;
  labels: string[];
  rows: number;
  status: string;
  classId: string | null;
  className: string | null;
  candidateIds: string[];
  candidates: Array<{ id: string; name: string; yearName: string }>;
  alsoElsewhere: number;
  sameNameElsewhere: number;
};
type Split = { sourceType: string; fileName: string | null; notices: string[]; classColumn: string; scope: string; groups: Group[] };
type Summary = { id: string; classId: string; className: string; status: string; counts: Record<string, number>; split: { id: string; labels: string[] } | null };
type Row = { parsed: { fullName: string; studentNumber: string | null; className: string | null }; flags: string[]; decision: string; revertOutcome: string | null };
type Batch = Summary & { rows: Row[]; mapping: Record<string, number | null> };

async function uploadList(c: Client, buf: Buffer, name: string, type: string): Promise<string> {
  const m = multipart(buf, name, type);
  const up = await c.req('POST', '/api/files?kind=import_source', m.body, m.headers);
  expect(up.status).toBe(200);
  return up.body.id as string;
}
const studentRows = (b: Batch) => b.rows.filter((r) => !r.flags.includes('heading_ignored'));
const pick = (groups: Group[]) => Object.fromEntries(groups.map((g) => [g.key, { rows: g.rows, status: g.status, className: g.className }]));
const rosterNames = async (c: Client, classId: string) => (await ok(c.get(`/api/teacher/classes/${classId}/students`))).students.map((x: { fullName: string }) => x.fullName) as string[];

describe('several classes in one file (IMP-2, D-171)', () => {
  let env: TestEnv;
  let s: School;
  let root: string;
  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-import-split-'));
    env = await makeEnv({ uploadsDir: path.join(root, 'uploads'), ocrCacheDir: path.join(root, 'ocr') });
    s = await buildSchool(env);
  });
  afterAll(async () => {
    await env.app.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('admin: a multi-class xlsx is split into all its classes in one preview; nothing is saved by the preview', async () => {
    const fileId = await uploadList(s.admin, multiClassXlsx(), 'okul-listesi.xlsx', 'application/octet-stream');
    const before = env.db.select().from(auditEvents).all().length;
    const split = (await ok(s.admin.post('/api/import/split/preview', { fileId }))) as Split;
    expect(split).toMatchObject({ sourceType: 'xlsx', fileName: 'okul-listesi.xlsx', classColumn: 'Sınıfı/Şubesi' });
    // "3/A", "3-A", "3 A" are one class; "3. Sınıf / B Şubesi" is 3-B; 5/C is unknown; one row has no class.
    expect(pick(split.groups)).toEqual({
      '3a': { rows: 4, status: 'matched', className: '3-A' },
      '3b': { rows: 2, status: 'matched', className: '3-B' },
      '5c': { rows: 2, status: 'unknown', className: null },
      '': { rows: 1, status: 'none', className: null },
    });
    expect(split.groups.find((g) => g.key === '3a')!.labels).toEqual(['3/A', '3-A', '3 A']);
    expect(env.db.select().from(auditEvents).all().length).toBe(before);
  });

  it('admin: per-class batches with their own preview, confirm, report, history, audit and undo; unknown classes go where chosen (IMP-5)', async () => {
    const fileId = await uploadList(s.admin, multiClassXlsx(), 'okul-listesi.xlsx', 'application/octet-stream');
    // 5/C is put into 3-B; rows without a class are skipped (left out of the assignment = keep the match = skip).
    const made = await ok(s.admin.post('/api/import/split', { fileId, assign: [{ key: '5c', classId: s.c3b.id }] }));
    expect(made.skippedRows).toBe(1);
    const batches = made.batches as Summary[];
    expect(batches.map((b) => b.className).sort()).toEqual(['3-A', '3-B']);
    expect(new Set(batches.map((b) => b.split!.id))).toEqual(new Set([made.splitId]));
    expect(batches.find((b) => b.className === '3-B')!.split!.labels).toEqual(['3. Sınıf / B Şubesi', '3/B', '5/C']);
    const a = (await ok(s.admin.get(`/api/import/batches/${batches.find((b) => b.className === '3-A')!.id}`))) as Batch;
    const b = (await ok(s.admin.get(`/api/import/batches/${batches.find((b) => b.className === '3-B')!.id}`))) as Batch;
    // Each batch holds only its own rows, none flagged as "another class"; titles, page headers and footers stay headings.
    expect(studentRows(a).map((r) => r.parsed.studentNumber)).toEqual(['5101', '5102', '5103', '5104']);
    expect(studentRows(b).map((r) => r.parsed.studentNumber)).toEqual(['5201', '5202', '5301', '5302']);
    expect([...studentRows(a), ...studentRows(b)].every((r) => r.decision === 'add' && !r.flags.includes('class_mismatch'))).toBe(true);
    // A mapping change keeps the split's class labels (still no "another class" flags).
    const remapped = (await ok(s.admin.put(`/api/import/batches/${b.id}/mapping`, { mapping: b.mapping }))) as Batch;
    expect(studentRows(remapped).some((r) => r.flags.includes('class_mismatch'))).toBe(false);
    expect(remapped.split).toEqual(b.split);
    // History for the split: both batches; audit per batch and once for the split.
    const listed = (await ok(s.admin.get(`/api/import/batches?splitId=${made.splitId}`))).batches as Summary[];
    expect(listed.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    const audits = env.db.select().from(auditEvents).all();
    expect(audits.filter((e) => e.action === 'import.create' && (e.entityId === a.id || e.entityId === b.id))).toHaveLength(2);
    expect(audits.find((e) => e.action === 'import.split' && e.entityId === made.splitId)).toBeTruthy();
    // Confirm per class: each has its own report.
    const ca = (await ok(s.admin.post(`/api/import/batches/${a.id}/commit`, {}))) as Batch;
    const cb = (await ok(s.admin.post(`/api/import/batches/${b.id}/commit`, {}))) as Batch;
    expect(ca.counts).toMatchObject({ added: 4, failed: 0 });
    expect(cb.counts).toMatchObject({ added: 4, failed: 0 });
    expect(await rosterNames(s.teacherA, s.c3a.id)).toEqual(expect.arrayContaining(['Defne Kurguoğlu', 'Umut Taslakçı']));
    expect(await rosterNames(s.teacherB, s.c3b.id)).toEqual(expect.arrayContaining(['Işıl Hayali', 'Öykü Kurmaca']));
    // Undo one class: the other class keeps its students.
    const reverted = (await ok(s.admin.post(`/api/import/batches/${b.id}/revert`, { confirm: true }))) as Batch;
    expect(reverted.status).toBe('reverted');
    expect(await rosterNames(s.teacherB, s.c3b.id)).not.toContain('Işıl Hayali');
    expect(await rosterNames(s.teacherA, s.c3a.id)).toContain('Defne Kurguoğlu');
    expect(((await ok(s.admin.get(`/api/import/batches/${a.id}`))) as Batch).status).toBe('committed');
    await ok(s.admin.post(`/api/import/batches/${a.id}/revert`, { confirm: true }));
  });

  it('teacher scope: only the classes they teach match; other classes are unknown and cannot be chosen (ACC-10)', async () => {
    const fileId = await uploadList(s.teacherA, multiClassCsv(), 'okul.csv', 'text/csv');
    const split = (await ok(s.teacherA.post('/api/import/split/preview', { fileId }))) as Split;
    expect(split.sourceType).toBe('csv');
    // Teacher A teaches 3-A only: 3-B is "unknown" to them (its name is not revealed as a match).
    expect(pick(split.groups)).toMatchObject({ '3a': { status: 'matched', className: '3-A' }, '3b': { status: 'unknown', className: null }, '5c': { status: 'unknown' } });
    const refused = await s.teacherA.post('/api/import/split', { fileId, assign: [{ key: '3b', classId: s.c3b.id }] });
    expect(refused.status).toBe(403);
    const made = await ok(s.teacherA.post('/api/import/split', { fileId, assign: [] }));
    expect((made.batches as Summary[]).map((b) => b.className)).toEqual(['3-A']);
    expect(made.skippedRows).toBe(5);
    // Teacher B cannot read teacher A's file; teacher A's split batches are not in teacher B's history.
    expect((await s.teacherB.post('/api/import/split/preview', { fileId })).status).toBe(404);
    const theirs = (await ok(s.teacherB.get(`/api/import/batches?splitId=${made.splitId}`))).batches;
    expect(theirs).toEqual([]);
  });

  it('pasted text and an HTML-table .xls split the same way', async () => {
    const text = multiClassRows()
      .map((r) => r.join('\t'))
      .join('\n');
    const pasted = (await ok(s.admin.post('/api/import/split/preview', { text }))) as Split;
    expect(pasted.groups.map((g) => [g.key, g.rows])).toEqual([
      ['3a', 4],
      ['3b', 2],
      ['5c', 2],
      ['', 1],
    ]);
    const fileId = await uploadList(s.admin, htmlTableXls(), 'liste.xls', 'application/vnd.ms-excel');
    const html = (await ok(s.admin.post('/api/import/split/preview', { fileId }))) as Split;
    expect(html.notices).toContain('HTML_TABLE');
    expect(html.groups.map((g) => [g.key, g.rows])).toEqual(pasted.groups.map((g) => [g.key, g.rows]));
  });

  it('refusals: no class column, a group that is not in the file, nothing chosen', async () => {
    const none = await s.admin.post('/api/import/split/preview', { text: 'Ada Kurgu\nCan Örnek\n' });
    expect(none.body.error.details.reason).toBe('IMPORT_NO_CLASS_COLUMN');
    const text = 'Adı Soyadı\tSınıfı\nAda Kurgu\t5/C\nCan Örnek\t5/C\n';
    expect((await s.admin.post('/api/import/split', { text, assign: [{ key: '9z', classId: s.c3a.id }] })).body.error.details.reason).toBe('IMPORT_SPLIT_CHANGED');
    expect((await s.admin.post('/api/import/split', { text, assign: [] })).body.error.details.reason).toBe('IMPORT_SPLIT_NOTHING');
    expect((await s.admin.post('/api/import/split', { text, assign: [{ key: '5c', classId: null }] })).body.error.details.reason).toBe('IMPORT_SPLIT_NOTHING');
    // Two groups into one class become one batch.
    const two = 'Adı Soyadı\tSınıfı\nAda Kurgu\t5/C\nCan Örnek\t5/D\n';
    const made = await ok(s.admin.post('/api/import/split', { text: two, assign: [{ key: '5c', classId: s.c3a.id }, { key: '5d', classId: s.c3a.id }] }));
    expect(made.batches).toHaveLength(1);
    const batch = (await ok(s.admin.get(`/api/import/batches/${made.batches[0].id}`))) as Batch;
    expect(studentRows(batch).map((r) => r.parsed.fullName)).toEqual(['Ada Kurgu', 'Can Örnek']);
    expect(env.db.select().from(auditEvents).where(eq(auditEvents.entityId, made.splitId)).all()).toHaveLength(1);
  });

  // ---------------------------------------------------------------- review fixes (S20c)
  it('a list longer than one batch (2000 rows) is split in full; a list past the split limit or a class past 2000 is refused, never cut (D-079, D-171)', async () => {
    const letters = (n: number) => {
      let s = '';
      do {
        s = String.fromCharCode(97 + (n % 26)) + s;
        n = Math.floor(n / 26);
      } while (n > 0);
      return s;
    };
    const list = (counts: Array<[string, number]>) => {
      const lines = ['Adı Soyadı\tSınıfı'];
      let i = 0;
      for (const [cls, n] of counts) for (let k = 0; k < n; k++) lines.push(`Elif${letters(i++)} Kurgulu\t${cls}`);
      return lines.join('\n');
    };
    // 2600 rows over two classes: both whole, no "only the first 2000 rows" notice.
    const text = list([
      ['3/A', 1300],
      ['3/B', 1300],
    ]);
    const split = (await ok(s.admin.post('/api/import/split/preview', { text }))) as Split;
    expect(split.notices).not.toContain('TOO_MANY_ROWS');
    expect(split.groups.map((g) => [g.key, g.rows])).toEqual([
      ['3a', 1300],
      ['3b', 1300],
    ]);
    const made = await ok(s.admin.post('/api/import/split', { text, assign: [] }));
    for (const b of made.batches as Summary[]) {
      const batch = (await ok(s.admin.get(`/api/import/batches/${b.id}`))) as Batch & { notices: string[] };
      expect(studentRows(batch)).toHaveLength(1300);
      expect(batch.notices).not.toContain('TOO_MANY_ROWS');
    }
    // The same list as a workbook and as an HTML-table .xls (read further in the parser worker).
    const grid = text.split('\n').map((l) => l.split('\t'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'Okul');
    for (const [buf, name, type] of [
      [XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'uzun.xlsx', 'application/octet-stream'],
      [htmlTableXls(grid), 'uzun.xls', 'application/vnd.ms-excel'],
    ] as const) {
      const fileId = await uploadList(s.admin, buf, name, type);
      const fromFile = (await ok(s.admin.post('/api/import/split/preview', { fileId }))) as Split;
      expect(fromFile.notices).not.toContain('TOO_MANY_ROWS');
      expect(fromFile.groups.map((g) => [g.key, g.rows])).toEqual(split.groups.map((g) => [g.key, g.rows]));
    }
    // Past the split limit: refused with a reason (no partial last class).
    const tooLong = await s.admin.post('/api/import/split/preview', { text: list([['3/A', 2600], ['3/B', 2500]]) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.details.reason).toBe('IMPORT_SPLIT_TOO_MANY_ROWS');
    // One class with more than 2000 rows: refused when the drafts are made.
    const big = list([['3/A', 2001], ['3/B', 1]]);
    expect(((await ok(s.admin.post('/api/import/split/preview', { text: big }))) as Split).groups[0]!.rows).toBe(2001);
    const refused = await s.admin.post('/api/import/split', { text: big, assign: [] });
    expect(refused.body.error.details.reason).toBe('IMPORT_SPLIT_CLASS_TOO_BIG');
  }, 60_000);

  it('the same child or the same name under two classes is shown in the split preview and on the rows; a stale draft refreshes on confirm (IMP-4, D-171)', async () => {
    const text = [
      'Adı Soyadı\tOkul No\tSınıfı',
      'Nehir Uydurmaca\t\t3/A',
      'Ece Hayalperest\t7001\t3/A',
      'Nehir Uydurmaca\t\t3/B',
      'Ece Hayalperest\t7002\t3/B',
      'Yağmur Örnekçi\t7003\t3/B',
    ].join('\n');
    const split = (await ok(s.admin.post('/api/import/split/preview', { text }))) as Split;
    expect(split.groups.map((g) => [g.key, g.alsoElsewhere, g.sameNameElsewhere])).toEqual([
      ['3a', 1, 1],
      ['3b', 1, 1],
    ]);
    const made = await ok(s.admin.post('/api/import/split', { text, assign: [] }));
    const idOf = (name: string) => (made.batches as Summary[]).find((b) => b.className === name)!.id;
    type FullRow = Row & { id: string; needsChoice: boolean };
    const rowsOf = async (id: string) => studentRows((await ok(s.admin.get(`/api/import/batches/${id}`))) as Batch) as FullRow[];
    const byName = (rows: FullRow[], n: string) => rows.find((r) => r.parsed.fullName === n)!;
    const a = await rowsOf(idOf('3-A'));
    const b = await rowsOf(idOf('3-B'));
    // One child under both classes: the first copy needs a choice, the later copy is skipped by default.
    expect(byName(a, 'Nehir Uydurmaca')).toMatchObject({ decision: 'add', needsChoice: true });
    expect(byName(a, 'Nehir Uydurmaca').flags).toContain('duplicate_other_class');
    expect(byName(b, 'Nehir Uydurmaca')).toMatchObject({ decision: 'skip', needsChoice: false });
    expect(byName(b, 'Nehir Uydurmaca').flags).toContain('duplicate_other_class');
    // Two children with the same name and different numbers: both kept, both marked.
    expect(byName(a, 'Ece Hayalperest').flags).toContain('same_name_in_file');
    expect(byName(b, 'Ece Hayalperest').flags).toContain('same_name_in_file');
    expect(byName(b, 'Ece Hayalperest')).toMatchObject({ decision: 'add', needsChoice: false });
    // 3-A: refused until the flagged row is decided, then confirmed.
    expect((await s.admin.post(`/api/import/batches/${idOf('3-A')}/commit`, {})).body.error.details.reason).toBe('IMPORT_DECISIONS_NEEDED');
    await ok(s.admin.patch(`/api/import/batches/${idOf('3-A')}/rows/${byName(a, 'Nehir Uydurmaca').id}`, { decision: 'add' }));
    expect(((await ok(s.admin.post(`/api/import/batches/${idOf('3-A')}/commit`, {}))) as Batch).counts).toMatchObject({ added: 2, failed: 0 });
    // 3-B was previewed before 3-A was confirmed: its Ece is now a possible match. The refused confirm
    // keeps the re-check, so the preview shows the row that needs a choice (not the stale preview).
    const refused = await s.admin.post(`/api/import/batches/${idOf('3-B')}/commit`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('IMPORT_DECISIONS_NEEDED');
    const fresh = await rowsOf(idOf('3-B'));
    expect(byName(fresh, 'Ece Hayalperest')).toMatchObject({ needsChoice: true });
    expect(byName(fresh, 'Ece Hayalperest').flags).toContain('possible_match');
    await ok(s.admin.patch(`/api/import/batches/${idOf('3-B')}/rows/${byName(fresh, 'Ece Hayalperest').id}`, { decision: 'add' }));
    const cb = (await ok(s.admin.post(`/api/import/batches/${idOf('3-B')}/commit`, {}))) as Batch;
    // Skipped: the header row and the later copy of Nehir.
    expect(cb.counts).toMatchObject({ added: 2, skipped: 2, failed: 0 });
    for (const id of [idOf('3-A'), idOf('3-B')]) await ok(s.admin.post(`/api/import/batches/${id}/revert`, { confirm: true }));
  });

  it('audit finding 4: the uploaded whole-school file is deleted once the split batches are made, so children of skipped classes are not kept in it (D-109)', async () => {
    const fileId = await uploadList(s.admin, multiClassXlsx(), 'okul-listesi.xlsx', 'application/octet-stream');
    const stored = env.db.select().from(files).where(eq(files.id, fileId)).get()!;
    const abs = storagePath(env.config, stored.storageKey);
    await fsp.access(abs);
    // 5/C and the row without a class are skipped: no batch row names those children.
    const made = await ok(s.admin.post('/api/import/split', { fileId, assign: [] }));
    expect(made.skippedRows).toBe(3);
    const after = env.db.select().from(files).where(eq(files.id, fileId)).get()!;
    expect(after.deletedAt).not.toBeNull();
    await expect(fsp.access(abs)).rejects.toThrow();
    expect((await s.admin.req('GET', `/api/files/${fileId}`)).status).toBe(404);
    expect(env.db.select().from(auditEvents).where(eq(auditEvents.entityId, fileId)).all().map((e) => e.action)).toContain('file.delete');
    // Each batch keeps its own rows and the history still shows the file's name.
    for (const b of made.batches as Summary[]) {
      const batch = (await ok(s.admin.get(`/api/import/batches/${b.id}`))) as Batch & { fileName: string | null };
      expect(batch.fileName).toBe('okul-listesi.xlsx');
      expect(studentRows(batch).length).toBeGreaterThan(0);
    }
    // The same file cannot be read again: it is gone.
    expect((await s.admin.post('/api/import/split/preview', { fileId })).status).toBe(404);
  });

  it('admin wording and same-named classes: "3-A" in two open school years is ambiguous, with both classes and their years (D-171)', async () => {
    const text = 'Adı Soyadı\tSınıfı\nDeniz Kurgusal\t3/A\nAras Taslak\t9/Z\n';
    const teacherView = (await ok(s.teacherA.post('/api/import/split/preview', { text }))) as Split;
    expect(teacherView.scope).toBe('taught');
    const year2 = await ok(s.admin.post('/api/admin/years', { name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30' }));
    try {
      const other3a = await ok(s.admin.post('/api/admin/classes', { schoolYearId: year2.id, name: '3-A', grade: 3 }));
      const split = (await ok(s.admin.post('/api/import/split/preview', { text }))) as Split;
      expect(split.scope).toBe('school');
      const g = split.groups.find((x) => x.key === '3a')!;
      expect(g.status).toBe('ambiguous');
      expect(g.candidateIds.sort()).toEqual([s.c3a.id, other3a.id].sort());
      expect(g.candidates.map((c) => `${c.name} ${c.yearName}`).sort()).toEqual(['3-A 2026–2027', '3-A 2027–2028']);
      expect(split.groups.find((x) => x.key === '9z')!.status).toBe('unknown');
      // The chosen year's class gets the rows.
      const made = await ok(s.admin.post('/api/import/split', { text, assign: [{ key: '3a', classId: other3a.id }] }));
      expect((made.batches as Summary[]).map((b) => b.classId)).toEqual([other3a.id]);
    } finally {
      await ok(s.admin.post(`/api/admin/years/${year2.id}/archive`, {}));
    }
  });
});
