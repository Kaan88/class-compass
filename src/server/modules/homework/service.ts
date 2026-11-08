/**
 * Homework (S8: HW-1..4, ATT-1, DSH-8, RPT-5, D-074, D-075).
 *
 * - Assignments per class+subject with title, details, assigned and due dates, private notes and a
 *   snapshot of the context's status list (HW-2/3). Archived, never deleted.
 * - Marks: one row per reviewed student. NO ROW = NOT CHECKED, never "missing" (HW-4, RPT-5).
 * - Every change is part of a batch (one correction, "mark selected as …", "mark all remaining as …")
 *   recorded in `homework_mark_changes` and the audit log, so a batch can be undone (UX-9) unless the
 *   mark was changed again since. A client `batchId` makes a retried request harmless (UX-11).
 * - Attendance appears in the checking grid but is read from the attendance tables on the due date;
 *   nothing here writes attendance and attendance never writes homework (ATT-1).
 * - Checking is teacher-area by default; a class+subject may allow it on the classroom screen, where
 *   notes are never shown or written (D-075).
 */
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { z } from 'zod';
import { weekStartOfDate } from '../../../domain/counters.ts';
import { addDays } from '../../../domain/dates.ts';
import type * as C from '../../../shared/contracts/homework.ts';
import {
  DEFAULT_HOMEWORK_STATUSES,
  HomeworkStatusSet,
  NOT_CHECKED,
  type HomeworkAssignment,
  type HomeworkCheck,
  type HomeworkSettings,
  type HomeworkStatusDef,
} from '../../../shared/contracts/homework.ts';
import { initials, normaliseName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { homeworkAssignments, homeworkMarkChanges, homeworkMarks, students, teachingContexts } from '../../db/schema.ts';
import { emitStudentActivity } from '../../lib/activity.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { dailyFor } from '../attendance/service.ts';
import { assertModuleEnabled, isModuleEnabled, mergeModuleConfig, moduleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, effectiveTimezone, getClass, getSchoolSettings, getYear, todayFor, type ContextRow } from '../school/policy.ts';
import { rosterRowsOn, type StudentRow } from '../students/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type AssignmentRow = typeof homeworkAssignments.$inferSelect;
type MarkRow = typeof homeworkMarks.$inferSelect;

// ---------------------------------------------------------------- settings
export function settingsOf(db: Db, contextId: string): HomeworkSettings {
  const cfg = moduleConfig(db, contextId, 'homework');
  const parsed = HomeworkStatusSet.safeParse(cfg.statuses);
  return { statuses: parsed.success ? parsed.data : DEFAULT_HOMEWORK_STATUSES, checkingInClassroom: cfg.checkingInClassroom === true };
}

export function getSettings(ctx: RequestContext, contextId: string): HomeworkSettings {
  const context = assertOwnsContext(ctx, contextId);
  return settingsOf(ctx.db, context.id);
}

export function setSettings(ctx: RequestContext, input: In<typeof C.setHomeworkSettings>): HomeworkSettings {
  return tx(ctx.db, () => {
    const context = assertOwnsContext(ctx, input.contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
    const before = settingsOf(ctx.db, context.id);
    const patch: Record<string, unknown> = {};
    if (input.statuses) {
      const statuses = input.statuses.map((s) => ({ key: s.key, kind: s.kind, label: { ...(s.label.en?.trim() ? { en: normaliseName(s.label.en) } : {}), ...(s.label.tr?.trim() ? { tr: normaliseName(s.label.tr) } : {}) } }));
      const ok = HomeworkStatusSet.safeParse(statuses);
      if (!ok.success) throw new AppError('VALIDATION', ok.error.issues[0]?.message ?? 'Invalid statuses', { reason: 'INVALID_STATUS_LIST' });
      patch.statuses = ok.data;
    }
    if (input.checkingInClassroom !== undefined) patch.checkingInClassroom = input.checkingInClassroom;
    if (Object.keys(patch).length) {
      mergeModuleConfig(ctx.db, context.id, 'homework', patch, requireUser(ctx).id, ctx.now());
      audit(ctx.db, ctx.actor, { action: 'homework.settings', entity: 'teaching_context', entityId: context.id, before, after: settingsOf(ctx.db, context.id) }, ctx.now());
    }
    return settingsOf(ctx.db, context.id);
  });
}

// ---------------------------------------------------------------- reads
const studentDto = (s: StudentRow) => ({ id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue });

export function marksOf(db: Db, assignmentId: string): Map<string, MarkRow> {
  return new Map(db.select().from(homeworkMarks).where(eq(homeworkMarks.assignmentId, assignmentId)).all().map((m) => [m.studentId, m]));
}

/** Students expected to hand it in: enrolled on the due date, plus anyone already marked. */
export function expectedStudents(db: Db, a: AssignmentRow, classId: string, marks: ReadonlyMap<string, MarkRow>) {
  const roster = rosterRowsOn(db, classId, a.dueOn).map((r) => r.student);
  const inRoster = new Set(roster.map((s) => s.id));
  const extraIds = [...marks.keys()].filter((id) => !inRoster.has(id));
  const extra = extraIds.length ? db.select().from(students).where(inArray(students.id, extraIds)).all() : [];
  return { roster, extra };
}

function assignmentClass(db: Db, a: AssignmentRow): string {
  return ctxRow(db, a.contextId).classId;
}
function ctxRow(db: Db, contextId: string) {
  const row = db.select().from(teachingContexts).where(eq(teachingContexts.id, contextId)).get();
  if (!row) throw notFound('Class and subject');
  return row;
}

function counts(db: Db, a: AssignmentRow, classId: string) {
  const marks = marksOf(db, a.id);
  const { roster, extra } = expectedStudents(db, a, classId, marks);
  const byStatus: Record<string, number> = Object.fromEntries(a.statusSetJson.map((s) => [s.key, 0]));
  const all = [...roster, ...extra];
  for (const s of all) {
    const st = marks.get(s.id)?.status ?? NOT_CHECKED;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }
  return { total: all.length, byStatus };
}

function toDto(db: Db, a: AssignmentRow, classId: string): HomeworkAssignment {
  return {
    id: a.id,
    contextId: a.contextId,
    title: a.title,
    details: a.details,
    assignedOn: a.assignedOn,
    dueOn: a.dueOn,
    notes: a.notes,
    statuses: a.statusSetJson as HomeworkStatusDef[],
    archived: a.archivedAt !== null,
    updatedAt: a.updatedAt,
    counts: counts(db, a, classId),
  };
}

/** Day / week (school week start) / calendar month around `date` (HW-1). */
export function rangeFor(view: 'day' | 'week' | 'month', date: string, weekStartsOn: number): { from: string; to: string } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') {
    const from = weekStartOfDate(date, weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 7)}-01`;
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

export function listHomework(ctx: RequestContext, input: In<typeof C.listHomework>) {
  const context = assertOwnsContext(ctx, input.contextId);
  const cls = getClass(ctx.db, context.classId);
  const today = todayFor(ctx, cls);
  const range = rangeFor(input.view, input.date ?? today, getSchoolSettings(ctx.db).weekStartsOn);
  const col = input.by === 'due' ? homeworkAssignments.dueOn : homeworkAssignments.assignedOn;
  const rows = ctx.db
    .select()
    .from(homeworkAssignments)
    .where(and(eq(homeworkAssignments.contextId, context.id), gte(col, range.from), lte(col, range.to), input.includeArchived === '1' ? undefined : isNull(homeworkAssignments.archivedAt)))
    .orderBy(asc(col), asc(homeworkAssignments.createdAt))
    .all();
  return {
    today,
    timezone: effectiveTimezone(ctx.db, cls),
    range: { view: input.view, by: input.by, ...range },
    assignments: rows.map((a) => toDto(ctx.db, a, cls.id)),
  };
}

// ---------------------------------------------------------------- assignments
function checkDates(db: Db, context: ContextRow, assignedOn: string, dueOn: string) {
  if (dueOn < assignedOn) throw new AppError('VALIDATION', 'The due date is before the assigned date', { reason: 'DUE_BEFORE_ASSIGNED' });
  const y = getYear(db, getClass(db, context.classId).schoolYearId);
  if (assignedOn < y.startsOn || dueOn > y.endsOn) throw new AppError('VALIDATION', 'Dates must be inside the school year', { reason: 'DATE_OUTSIDE_YEAR' });
}

const clean = (s: string | null | undefined) => (s === undefined ? undefined : s?.trim() ? s.trim() : null);

export function createHomework(ctx: RequestContext, input: In<typeof C.createHomework>): HomeworkAssignment {
  return tx(ctx.db, () => {
    const context = assertOwnsContext(ctx, input.contextId);
    const cls = getClass(ctx.db, context.classId);
    assertClassWritable(ctx.db, cls);
    assertModuleEnabled(ctx.db, context.id, 'homework');
    const assignedOn = input.assignedOn ?? todayFor(ctx, cls);
    checkDates(ctx.db, context, assignedOn, input.dueOn);
    const now = ctx.now();
    const id = newId();
    const uid = requireUser(ctx).id;
    const row = {
      id,
      contextId: context.id,
      title: input.title.trim(),
      details: clean(input.details) ?? null,
      assignedOn,
      dueOn: input.dueOn,
      notes: clean(input.notes) ?? null,
      statusSetJson: settingsOf(ctx.db, context.id).statuses,
      archivedAt: null,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    };
    ctx.db.insert(homeworkAssignments).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'homework.create', entity: 'homework_assignment', entityId: id, after: { title: row.title, assignedOn, dueOn: row.dueOn } }, now);
    return toDto(ctx.db, ctx.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.id, id)).get()!, cls.id);
  });
}

/** The assignment, its context (owned by the teacher, ACC-10) and class. */
function owned(ctx: RequestContext, assignmentId: string) {
  const a = ctx.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.id, assignmentId)).get();
  if (!a) throw notFound('Homework');
  const context = assertOwnsContext(ctx, a.contextId);
  return { a, context, cls: getClass(ctx.db, context.classId) };
}
function ownedForWrite(ctx: RequestContext, assignmentId: string) {
  const o = owned(ctx, assignmentId);
  assertClassWritable(ctx.db, o.cls);
  assertModuleEnabled(ctx.db, o.context.id, 'homework');
  return o;
}

export function updateHomework(ctx: RequestContext, input: In<typeof C.updateHomework>): HomeworkAssignment {
  return tx(ctx.db, () => {
    const { a, context, cls } = ownedForWrite(ctx, input.assignmentId);
    const next = {
      title: input.title?.trim() ?? a.title,
      details: clean(input.details) === undefined ? a.details : (clean(input.details) ?? null),
      assignedOn: input.assignedOn ?? a.assignedOn,
      dueOn: input.dueOn ?? a.dueOn,
      notes: clean(input.notes) === undefined ? a.notes : (clean(input.notes) ?? null),
    };
    checkDates(ctx.db, context, next.assignedOn, next.dueOn);
    const now = ctx.now();
    ctx.db.update(homeworkAssignments).set({ ...next, updatedAt: now, updatedBy: requireUser(ctx).id }).where(eq(homeworkAssignments.id, a.id)).run();
    const pick = (o: typeof next) => ({ title: o.title, assignedOn: o.assignedOn, dueOn: o.dueOn, hasDetails: Boolean(o.details), hasNotes: Boolean(o.notes) });
    audit(ctx.db, ctx.actor, { action: 'homework.update', entity: 'homework_assignment', entityId: a.id, before: pick(a), after: pick(next) }, now);
    return toDto(ctx.db, ctx.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.id, a.id)).get()!, cls.id);
  });
}

export function archiveHomework(ctx: RequestContext, input: In<typeof C.archiveHomework>): HomeworkAssignment {
  return tx(ctx.db, () => {
    const { a, cls } = ownedForWrite(ctx, input.assignmentId);
    const now = ctx.now();
    ctx.db.update(homeworkAssignments).set({ archivedAt: input.archived ? (a.archivedAt ?? now) : null, updatedAt: now, updatedBy: requireUser(ctx).id }).where(eq(homeworkAssignments.id, a.id)).run();
    audit(ctx.db, ctx.actor, { action: input.archived ? 'homework.archive' : 'homework.restore', entity: 'homework_assignment', entityId: a.id }, now);
    return toDto(ctx.db, ctx.db.select().from(homeworkAssignments).where(eq(homeworkAssignments.id, a.id)).get()!, cls.id);
  });
}

// ---------------------------------------------------------------- checking grid
function checkView(db: Db, a: AssignmentRow, context: ContextRow): HomeworkCheck {
  const cls = getClass(db, context.classId);
  const marks = marksOf(db, a.id);
  const { roster, extra } = expectedStudents(db, a, cls.id, marks);
  const attendanceEnabled = isModuleEnabled(db, context.id, 'attendance');
  // ATT-1: read from the attendance tables (daily attendance on the due date), never stored here.
  const daily = attendanceEnabled ? dailyFor(db, cls.id, a.dueOn) : new Map();
  const row = (s: StudentRow, enrolled: boolean) => {
    const m = marks.get(s.id);
    return {
      student: studentDto(s),
      status: m?.status ?? NOT_CHECKED,
      reviewed: Boolean(m),
      updatedAt: m?.updatedAt ?? null,
      note: m?.note ?? null,
      attendance: attendanceEnabled ? (daily.get(s.id)?.status ?? 'not_recorded') : null,
      enrolled,
    };
  };
  return {
    assignment: toDto(db, a, cls.id),
    attendanceDate: a.dueOn,
    attendanceEnabled,
    rows: [...roster.map((s) => row(s, true)), ...extra.map((s) => row(s as StudentRow, false))],
  };
}

export function teacherCheck(ctx: RequestContext, assignmentId: string): HomeworkCheck {
  const { a, context } = owned(ctx, assignmentId);
  return checkView(ctx.db, a, context);
}

/** Classroom checking only when the class+subject allows it (D-075); otherwise teacher area. */
function classroomOwned(ctx: RequestContext, assignmentId: string) {
  const o = owned(ctx, assignmentId);
  assertModuleEnabled(ctx.db, o.context.id, 'homework');
  if (!settingsOf(ctx.db, o.context.id).checkingInClassroom) throw new AppError('FORBIDDEN', 'Homework is checked in the teacher area', { reason: 'CHECKING_TEACHER_ONLY' });
  if (o.a.archivedAt) throw notFound('Homework');
  return o;
}

export function classroomCheck(ctx: RequestContext, assignmentId: string) {
  const { a, context } = classroomOwned(ctx, assignmentId);
  return checkView(ctx.db, a, context);
}

interface Change {
  studentId: string;
  status: string;
  /** undefined = keep the current note. */
  note?: string | null | undefined;
}

function replayed(db: Db, batchId: string, assignmentId: string): number | null {
  const rows = db.select().from(homeworkMarkChanges).where(eq(homeworkMarkChanges.batchId, batchId)).all();
  if (!rows.length) return null;
  if (rows.some((r) => r.assignmentId !== assignmentId)) throw new AppError('CONFLICT', 'Operation id reused with different content', { reason: 'OP_ID_REUSED' });
  return rows.length;
}

/**
 * Apply one batch of mark changes inside a transaction. Setting "not checked" removes the mark (no
 * row = not checked); the change table keeps the history. Unchanged students are skipped.
 */
function applyChanges(ctx: RequestContext, a: AssignmentRow, cls: { id: string }, batchId: string, changes: readonly Change[], kind: string, classroom: boolean): number {
  const keys = new Set(a.statusSetJson.map((s) => s.key));
  const marks = marksOf(ctx.db, a.id);
  const allowed = new Set([...rosterRowsOn(ctx.db, cls.id, a.dueOn).map((r) => r.student.id), ...marks.keys()]);
  const now = ctx.now();
  const uid = requireUser(ctx).id;
  const log: Array<{ studentId: string; before: string | null; after: string | null }> = [];
  const seen = new Set<string>();
  for (const c of changes) {
    if (!keys.has(c.status)) throw new AppError('VALIDATION', 'Unknown homework status', { reason: 'UNKNOWN_STATUS' });
    if (!allowed.has(c.studentId)) throw new AppError('FORBIDDEN', 'Student is not in this class', { reason: 'STUDENT_NOT_IN_CLASS' });
    if (seen.has(c.studentId)) continue;
    seen.add(c.studentId);
    const cur = marks.get(c.studentId) ?? null;
    const afterStatus = c.status === NOT_CHECKED ? null : c.status;
    // Classroom checking never shows or changes notes (D-075): "not checked" deletes the mark row, so for a
    // mark with a private note that correction is refused there and is made in the teacher area.
    if (classroom && afterStatus === null && cur?.note) throw new AppError('CONFLICT', 'This mark has a private note', { reason: 'MARK_HAS_NOTE' });
    const afterNote = afterStatus === null ? null : c.note === undefined ? (cur?.note ?? null) : c.note?.trim() || null;
    if ((cur?.status ?? null) === afterStatus && (cur?.note ?? null) === afterNote) continue;
    if (afterStatus === null) ctx.db.delete(homeworkMarks).where(and(eq(homeworkMarks.assignmentId, a.id), eq(homeworkMarks.studentId, c.studentId))).run();
    else
      ctx.db
        .insert(homeworkMarks)
        .values({ assignmentId: a.id, studentId: c.studentId, status: afterStatus, note: afterNote, updatedBy: uid, updatedAt: now })
        .onConflictDoUpdate({ target: [homeworkMarks.assignmentId, homeworkMarks.studentId], set: { status: afterStatus, note: afterNote, updatedBy: uid, updatedAt: now } })
        .run();
    ctx.db
      .insert(homeworkMarkChanges)
      .values({ id: newId(), batchId, assignmentId: a.id, studentId: c.studentId, beforeStatus: cur?.status ?? null, beforeNote: cur?.note ?? null, afterStatus, afterNote, changedAt: now, changedBy: uid, undoneAt: null, undoneBy: null })
      .run();
    log.push({ studentId: c.studentId, before: cur?.status ?? null, after: afterStatus });
  }
  if (log.length) audit(ctx.db, ctx.actor, { action: `homework.${kind}`, entity: 'homework_assignment', entityId: a.id, opId: batchId, after: { changes: log } }, now);
  emitStudentActivity(ctx, { source: 'homework', studentIds: log.map((l) => l.studentId), contextId: a.contextId });
  return log.length;
}

function runMarks(ctx: RequestContext, assignmentId: string, batchId: string | undefined, classroom: boolean, build: (a: AssignmentRow) => { changes: Change[]; kind: string }) {
  return tx(ctx.db, () => {
    const { a, context, cls } = classroom ? classroomOwned(ctx, assignmentId) : ownedForWrite(ctx, assignmentId);
    assertClassWritable(ctx.db, cls);
    const id = batchId ?? newId();
    const prev = replayed(ctx.db, id, a.id);
    if (prev !== null) return { batchId: id, changed: prev, replayed: true, check: checkView(ctx.db, a, context) };
    const { changes, kind } = build(a);
    const changed = applyChanges(ctx, a, cls, id, changes, kind, classroom);
    return { batchId: id, changed, replayed: false, check: checkView(ctx.db, a, context) };
  });
}

export function setMarks(ctx: RequestContext, input: In<typeof C.setHomeworkMarks>, classroom = false) {
  // Classroom corrections never touch notes (D-075).
  return runMarks(ctx, input.assignmentId, input.batchId, classroom, () => ({
    changes: input.changes.map((c) => ({ studentId: c.studentId, status: c.status, note: classroom ? undefined : c.note })),
    kind: 'marks_set',
  }));
}

/** "Mark all remaining as …" (HW-4): only students still NOT CHECKED change. */
export function markRemaining(ctx: RequestContext, input: In<typeof C.markRemainingHomework>, classroom = false) {
  return runMarks(ctx, input.assignmentId, input.batchId, classroom, (a) => {
    if (input.status === NOT_CHECKED) throw new AppError('VALIDATION', 'Choose a status', { reason: 'UNKNOWN_STATUS' });
    const marks = marksOf(ctx.db, a.id);
    const remaining = rosterRowsOn(ctx.db, assignmentClass(ctx.db, a), a.dueOn)
      .map((r) => r.student.id)
      .filter((id) => !marks.has(id));
    return { changes: remaining.map((studentId) => ({ studentId, status: input.status })), kind: 'marks_remaining' };
  });
}

/** Undo a batch (UX-9): restore each student's previous mark unless it was changed again since. */
export function undoMarks(ctx: RequestContext, input: In<typeof C.undoHomeworkMarks>, classroom = false) {
  return tx(ctx.db, () => {
    const { a, context, cls } = classroom ? classroomOwned(ctx, input.assignmentId) : ownedForWrite(ctx, input.assignmentId);
    assertClassWritable(ctx.db, cls);
    const rows = ctx.db.select().from(homeworkMarkChanges).where(and(eq(homeworkMarkChanges.batchId, input.batchId), eq(homeworkMarkChanges.assignmentId, a.id))).all();
    if (!rows.length) throw new AppError('NOT_FOUND', 'Nothing to undo', { reason: 'NOTHING_TO_UNDO' });
    // Classroom writes never change notes, so a batch that changed one was made in the teacher area and
    // is undone there only (D-075).
    if (classroom && rows.some((r) => r.undoneAt === null && (r.beforeNote ?? null) !== (r.afterNote ?? null))) throw new AppError('FORBIDDEN', 'Undo this in the teacher area', { reason: 'MARK_HAS_NOTE' });
    const marks = marksOf(ctx.db, a.id);
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    let undone = 0;
    let skipped = 0;
    const log: Array<{ studentId: string; restored: string | null }> = [];
    for (const r of rows) {
      if (r.undoneAt !== null) continue;
      const cur = marks.get(r.studentId) ?? null;
      if ((cur?.status ?? null) !== r.afterStatus || (cur?.note ?? null) !== r.afterNote) {
        skipped++;
        continue;
      }
      if (r.beforeStatus === null) ctx.db.delete(homeworkMarks).where(and(eq(homeworkMarks.assignmentId, a.id), eq(homeworkMarks.studentId, r.studentId))).run();
      else
        ctx.db
          .insert(homeworkMarks)
          .values({ assignmentId: a.id, studentId: r.studentId, status: r.beforeStatus, note: r.beforeNote, updatedBy: uid, updatedAt: now })
          .onConflictDoUpdate({ target: [homeworkMarks.assignmentId, homeworkMarks.studentId], set: { status: r.beforeStatus, note: r.beforeNote, updatedBy: uid, updatedAt: now } })
          .run();
      ctx.db.update(homeworkMarkChanges).set({ undoneAt: now, undoneBy: uid }).where(eq(homeworkMarkChanges.id, r.id)).run();
      log.push({ studentId: r.studentId, restored: r.beforeStatus });
      undone++;
    }
    audit(ctx.db, ctx.actor, { action: 'homework.marks_undo', entity: 'homework_assignment', entityId: a.id, opId: input.batchId, after: { restored: log, skipped } }, now);
    return { undone, skipped, check: checkView(ctx.db, a, context) };
  });
}

// ---------------------------------------------------------------- outstanding work
const OUTSTANDING_KINDS = new Set(['missing', 'partly_completed']);

export function outstanding(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const today = todayFor(ctx, cls);
  const rows = ctx.db
    .select()
    .from(homeworkAssignments)
    .where(and(eq(homeworkAssignments.contextId, context.id), isNull(homeworkAssignments.archivedAt), lte(homeworkAssignments.dueOn, today)))
    .orderBy(asc(homeworkAssignments.dueOn))
    .all();
  const items = rows
    .map((a) => {
      const marks = marksOf(ctx.db, a.id);
      const { roster, extra } = expectedStudents(ctx.db, a, cls.id, marks);
      const kindOf = new Map(a.statusSetJson.map((s) => [s.key, s.kind]));
      const all = [...roster, ...(extra as StudentRow[])];
      const open = all.filter((s) => OUTSTANDING_KINDS.has(kindOf.get(marks.get(s.id)?.status ?? '') ?? ''));
      return {
        assignment: { id: a.id, title: a.title, dueOn: a.dueOn },
        statuses: a.statusSetJson as HomeworkStatusDef[],
        students: open.map((s) => ({ student: studentDto(s), status: marks.get(s.id)!.status })),
        notChecked: all.filter((s) => !marks.has(s.id)).length,
        total: all.length,
      };
    })
    .filter((i) => i.students.length > 0 || i.notChecked > 0);
  return { today, items };
}

// ---------------------------------------------------------------- classroom panel (DSH-8)
/** Current homework for the display: due from today to a week ahead, or set today. No statuses, no notes. */
export function classroomCurrent(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  assertModuleEnabled(ctx.db, context.id, 'homework');
  const cls = getClass(ctx.db, context.classId);
  const today = todayFor(ctx, cls);
  const rows = ctx.db
    .select()
    .from(homeworkAssignments)
    .where(
      and(
        eq(homeworkAssignments.contextId, context.id),
        isNull(homeworkAssignments.archivedAt),
        or(and(gte(homeworkAssignments.dueOn, today), lte(homeworkAssignments.dueOn, addDays(today, 7))), eq(homeworkAssignments.assignedOn, today)),
      ),
    )
    .orderBy(asc(homeworkAssignments.dueOn), asc(homeworkAssignments.createdAt))
    .all();
  return {
    today,
    checkingInClassroom: settingsOf(ctx.db, context.id).checkingInClassroom,
    assignments: rows.map((a) => ({ id: a.id, title: a.title, details: a.details, assignedOn: a.assignedOn, dueOn: a.dueOn })),
  };
}

