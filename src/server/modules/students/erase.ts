/**
 * Permanent deletion of a student (S13b, D-109; KVKK erasure). Administrator only, only for a
 * deactivated student (an active one is refused with STUDENT_ACTIVE), typed confirmation (the student's
 * full name), with a dry-run summary first.
 *
 * Everything about the student is removed, read from the live schema so new tables are covered:
 * - rows whose student column is NOT NULL (enrolments, attendance, levels, goals and their entries,
 *   assessments and feedback, evidence, homework marks and changes, duty ticks, pair rules, links and
 *   their sessions …) are deleted; nullable student columns (class-only counter taps, assistant days,
 *   importer rows) are set to NULL so class totals stay correct without naming anyone;
 * - JSON lists that hold the id (group arrangements, lesson groupings, absentees) lose it;
 * - importer rows about the student are anonymised (their cells and parsed name are emptied);
 * - Secret Student selections and private teacher notes are removed by their owning modules
 *   (`eraseStudentSelections`, `erasePrivateNotesOf`), so those boundaries stay intact;
 * - files they own or that are on their evidence, their photo, and the uploaded class lists
 *   (`import_source`) of every import batch that had a row about them (the spreadsheet, PDF or photo
 *   holds their name and number) are deleted from the database and from disk; those batches keep
 *   their rows without the source file;
 * - audit events and command-log entries that mention the student are deleted.
 * The only trace is one audit event `student.erase` without any personal data: no id, no name, just
 * counts per table. Free text that teachers typed elsewhere (e.g. a lesson reflection that names the
 * child) cannot be found reliably and is not changed; DECISIONS D-109 records this.
 */
import { eq } from 'drizzle-orm';
import type { GroupJson, UnsatisfiedJson } from '../../db/schema.ts';
import { students } from '../../db/schema.ts';
import { tx, type Db } from '../../db/client.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { conflict, invalid, notFound } from '../../lib/errors.ts';
import { removeKey } from '../files/storage.ts';
import { erasePrivateNotesOf, privateNotesCount, PRIVATE_NOTES_TABLE } from '../goals/history.ts';
import { eraseStudentSelections, SELECTIONS_TABLE_NAME } from '../secret/service.ts';
import { scrubStudentFromChats } from '../assistantChat/store.ts';

type Row = Record<string, unknown>;
const STUDENT_COLUMNS = new Set(['student_id', 'owner_student_id', 'student_a', 'student_b', 'planned_student_id', 'actual_student_id', 'matched_student_id', 'created_student_id']);
/** Tables handled by their own step (owning module, JSON lists, files, the student row). */
const SPECIAL = new Set(['students', 'files', 'import_rows', 'sessions', 'audit_events', 'command_log', PRIVATE_NOTES_TABLE, SELECTIONS_TABLE_NAME]);
const q = (s: string) => `"${s.replace(/"/gu, '""')}"`;

function tableNames(db: Db): string[] {
  return (db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name").all() as Array<{ name: string }>).map((r) => r.name);
}
function columnsOf(db: Db, table: string): Array<{ name: string; notnull: number }> {
  return db.$client.prepare('select name, "notnull" as "notnull" from pragma_table_info(?)').all(table) as Array<{ name: string; notnull: number }>;
}
const count = (db: Db, sqlText: string, ...args: unknown[]) => (db.$client.prepare(`select count(*) as n from ${sqlText}`).get(...args) as { n: number }).n;
const inJson = (sid: string) => `%"${sid}"%`;

/**
 * Tables and their rows in delete order: children of the student's goals first, then rows with a
 * NOT NULL student column (rows that reference evidence/goals before those), so foreign keys hold.
 */
const ORDER_FIRST = ['goal_entries', 'teacher_assessments', 'teacher_feedback', 'evidence'];
const ORDER_LAST = ['goals', 'student_links', 'enrolments'];

interface Plan {
  goalIds: string[];
  fileIds: string[];
  /** table → rows deleted (or cleared) */
  deletes: Map<string, number>;
  nulls: Map<string, number>;
}

/** Import batches whose rows are about the student (matched, created, or the parsed name). */
const IMPORT_ROWS_OF = 'matched_student_id = ? or created_student_id = ? or parsed_json like ?';
const importArgs = (sid: string, fullName: string) => [sid, sid, `%${JSON.stringify(fullName).slice(1, -1)}%`];

function planFor(db: Db, sid: string, fullName: string, photoFileId: string | null): Plan {
  const goalIds = (db.$client.prepare('select id from goals where student_id = ?').all(sid) as Array<{ id: string }>).map((r) => r.id);
  const fileIds = [
    ...new Set([
      // The uploaded class list the student was imported from (or matched against) names them.
      ...(
        db.$client
          .prepare(`select distinct b.file_id as id from import_batches b where b.file_id is not null and b.id in (select batch_id from import_rows where ${IMPORT_ROWS_OF})`)
          .all(...importArgs(sid, fullName)) as Array<{ id: string }>
      ).map((r) => r.id),
      ...(db.$client.prepare('select id from files where owner_student_id = ?').all(sid) as Array<{ id: string }>).map((r) => r.id),
      ...(db.$client.prepare('select file_id as id from evidence where student_id = ? and file_id is not null').all(sid) as Array<{ id: string }>).map((r) => r.id),
      ...(photoFileId ? [photoFileId] : []),
    ]),
  ];
  const deletes = new Map<string, number>();
  const nulls = new Map<string, number>();
  for (const t of tableNames(db)) {
    if (SPECIAL.has(t)) continue;
    const cols = columnsOf(db, t);
    const studentCols = cols.filter((c) => STUDENT_COLUMNS.has(c.name));
    const required = studentCols.filter((c) => c.notnull);
    const optional = studentCols.filter((c) => !c.notnull);
    let n = 0;
    if (required.length) n += count(db, `${q(t)} where ${required.map((c) => `${q(c.name)} = ?`).join(' or ')}`, ...required.map(() => sid));
    if (!required.length && goalIds.length && cols.some((c) => c.name === 'goal_id')) n += count(db, `${q(t)} where goal_id in (${goalIds.map(() => '?').join(',')})`, ...goalIds);
    if (n) deletes.set(t, n);
    if (optional.length) {
      const m = count(db, `${q(t)} where ${optional.map((c) => `${q(c.name)} = ?`).join(' or ')}`, ...optional.map(() => sid));
      if (m) nulls.set(t, m);
    }
  }
  return { goalIds, fileIds, deletes, nulls };
}

/** Only a deactivated student can be erased (D-109): an active one is refused, also through the API. */
function erasable(ctx: RequestContext, studentId: string) {
  const st = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!st) throw notFound('Student');
  if (st.deactivatedAt === null) throw conflict('Deactivate the student before deleting them permanently', { reason: 'STUDENT_ACTIVE' });
  return st;
}

/** What a permanent deletion would remove (dry run): counts only. */
export function erasePreview(ctx: RequestContext, studentId: string) {
  const st = erasable(ctx, studentId);
  const plan = planFor(ctx.db, studentId, st.fullName, st.photoFileId);
  const importRows = count(ctx.db, 'import_rows where matched_student_id = ? or created_student_id = ?', studentId, studentId);
  // Secret Student selections are erased too but never counted here: a per-student count would tell
  // whether the child is in a round that has not been revealed (SEC-3).
  return {
    studentId: st.id,
    fullName: st.fullName,
    tables: [...plan.deletes].map(([table, rows]) => ({ table, rows })).sort((a, b) => a.table.localeCompare(b.table)),
    clearedReferences: [...plan.nulls].reduce((a, [, n]) => a + n, 0),
    importRows,
    files: plan.fileIds.length,
    privateNotes: privateNotesCount(ctx.db, studentId),
    auditEvents: count(ctx.db, 'audit_events where entity_id = ? or actor_id = ? or before_json like ? or after_json like ?', studentId, studentId, `%${studentId}%`, `%${studentId}%`),
  };
}

function scrubGroups(v: unknown, sid: string): string | null {
  if (typeof v !== 'string') return null;
  try {
    const groups = JSON.parse(v) as GroupJson[];
    if (!Array.isArray(groups)) return v;
    return JSON.stringify(groups.map((g) => ({ ...g, memberIds: (g.memberIds ?? []).filter((m) => m !== sid), roles: (g.roles ?? []).filter((r) => r.studentId !== sid) })));
  } catch {
    return v;
  }
}
function scrubIds(v: unknown, sid: string): string | null {
  if (typeof v !== 'string') return null;
  try {
    const ids = JSON.parse(v) as string[];
    return Array.isArray(ids) ? JSON.stringify(ids.filter((x) => x !== sid)) : v;
  } catch {
    return v;
  }
}
function scrubRules(v: unknown, sid: string): string | null {
  if (typeof v !== 'string') return null;
  try {
    const rules = JSON.parse(v) as UnsatisfiedJson[];
    return Array.isArray(rules) ? JSON.stringify(rules.filter((r) => r.a !== sid && r.b !== sid)) : v;
  } catch {
    return v;
  }
}

/** Removes the student's id from JSON lists (groups, roles, absentees, broken pair rules). */
function scrubJson(db: Db, sid: string): number {
  let n = 0;
  const like = inJson(sid);
  for (const r of db.$client.prepare('select id, groups_json, unsatisfied_json from group_templates where groups_json like ? or unsatisfied_json like ?').all(like, like) as Row[]) {
    db.$client.prepare('update group_templates set groups_json = ?, unsatisfied_json = ? where id = ?').run(scrubGroups(r.groups_json, sid), scrubRules(r.unsatisfied_json, sid), r.id);
    n++;
  }
  for (const r of db.$client
    .prepare('select id, effective_groups_json, excluded_absent_ids, unsatisfied_json from lesson_groupings where effective_groups_json like ? or excluded_absent_ids like ? or unsatisfied_json like ?')
    .all(like, like, like) as Row[]) {
    db.$client
      .prepare('update lesson_groupings set effective_groups_json = ?, excluded_absent_ids = ?, unsatisfied_json = ? where id = ?')
      .run(scrubGroups(r.effective_groups_json, sid), scrubIds(r.excluded_absent_ids, sid), scrubRules(r.unsatisfied_json, sid), r.id);
    n++;
  }
  for (const r of db.$client.prepare('select id, absent_student_ids, absence_undo from assistant_assignments where absent_student_ids like ? or absence_undo like ?').all(like, like) as Row[]) {
    const undo = typeof r.absence_undo === 'string' && r.absence_undo.includes(sid) ? null : r.absence_undo;
    db.$client.prepare('update assistant_assignments set absent_student_ids = ?, absence_undo = ? where id = ?').run(scrubIds(r.absent_student_ids, sid), undo, r.id);
    n++;
  }
  return n;
}

export async function eraseStudent(ctx: RequestContext, studentId: string, confirm: string) {
  const st = erasable(ctx, studentId);
  if (confirm.trim().normalize('NFC') !== st.fullName.normalize('NFC')) throw invalid('Type the student’s full name to confirm', { reason: 'CONFIRMATION_MISMATCH' });
  const db = ctx.db;
  const sid = st.id;
  const removedKeys: string[] = [];
  const counts = tx(db, () => {
    const plan = planFor(db, sid, st.fullName, st.photoFileId);
    const tables: Record<string, number> = {};
    const del = (t: string, where: string, ...args: unknown[]) => {
      const n = db.$client.prepare(`delete from ${q(t)} where ${where}`).run(...args).changes;
      if (n) tables[t] = (tables[t] ?? 0) + n;
    };
    // Owning modules first (boundaries): Secret Student selections, private notes.
    eraseStudentSelections(db, sid);
    // Assistant chats (S19b, D-180): the name and the pseudonyms become [name], before the pseudonyms go.
    const chats = scrubStudentFromChats(db, st);
    if (chats) tables.assistant_messages = chats;
    const notes = erasePrivateNotesOf(db, sid);
    if (notes) tables.private_notes = notes;
    // Children of the student's goals, then evidence, then the other tables, then goals/links/enrolments.
    const ordered = [...ORDER_FIRST, ...[...plan.deletes.keys()].filter((t) => !ORDER_FIRST.includes(t) && !ORDER_LAST.includes(t)), ...ORDER_LAST];
    for (const t of ordered) {
      if (!plan.deletes.has(t)) continue;
      const cols = columnsOf(db, t);
      const required = cols.filter((c) => c.notnull && STUDENT_COLUMNS.has(c.name));
      if (required.length) del(t, required.map((c) => `${q(c.name)} = ?`).join(' or '), ...required.map(() => sid));
      else if (plan.goalIds.length) del(t, `goal_id in (${plan.goalIds.map(() => '?').join(',')})`, ...plan.goalIds);
    }
    // Nullable references: cleared, the rows stay (class totals, other students' history).
    let cleared = 0;
    for (const t of plan.nulls.keys()) {
      for (const c of columnsOf(db, t).filter((x) => !x.notnull && STUDENT_COLUMNS.has(x.name))) {
        cleared += db.$client.prepare(`update ${q(t)} set ${q(c.name)} = null where ${q(c.name)} = ?`).run(sid).changes;
      }
    }
    const json = scrubJson(db, sid);
    // Importer rows about the student: anonymised (no cells, no parsed name or number).
    const empty = JSON.stringify({ fullName: '', givenNames: null, familyName: null, studentNumber: null, className: null });
    const imports = db.$client
      .prepare(
        "update import_rows set raw_json = '[]', parsed_json = ?, candidates_json = '[]', matched_student_id = case when matched_student_id = ? then null else matched_student_id end, created_student_id = case when created_student_id = ? then null else created_student_id end where matched_student_id = ? or created_student_id = ? or parsed_json like ?",
      )
      .run(empty, sid, sid, ...importArgs(sid, st.fullName)).changes;
    db.$client.prepare("update import_rows set candidates_json = '[]' where candidates_json like ?").run(`%${sid}%`);
    // Student-link sessions, then files (rows + bytes after the commit).
    del('sessions', `kind = 'student' and student_link_id not in (select id from student_links)`);
    if (plan.fileIds.length) {
      for (const f of db.$client.prepare(`select storage_key, thumb_storage_key from files where id in (${plan.fileIds.map(() => '?').join(',')})`).all(...plan.fileIds) as Row[]) {
        removedKeys.push(String(f.storage_key));
        if (f.thumb_storage_key) removedKeys.push(String(f.thumb_storage_key));
      }
      // Import batches whose class list named the student keep their rows, without the source file.
      db.$client.prepare(`update import_batches set file_id = null where file_id in (${plan.fileIds.map(() => '?').join(',')})`).run(...plan.fileIds);
      del('files', `id in (${plan.fileIds.map(() => '?').join(',')})`, ...plan.fileIds);
    }
    // Audit events and command-log entries that mention the student.
    const like = `%${sid}%`;
    del('audit_events', 'entity_id = ? or actor_id = ? or before_json like ? or after_json like ?', sid, sid, like, like);
    del('command_log', 'actor_key = ? or result_json like ?', `student:${sid}`, like);
    db.delete(students).where(eq(students.id, sid)).run();
    tables.students = 1;
    const summary = { tables, clearedReferences: cleared, jsonLists: json, importRows: imports, files: plan.fileIds.length };
    // The only trace: counts, no id, no name (D-109).
    audit(db, ctx.actor, { action: 'student.erase', entity: 'student', entityId: null, after: summary }, ctx.now());
    return summary;
  });
  for (const k of removedKeys) await removeKey(ctx.config, k);
  return counts;
}
