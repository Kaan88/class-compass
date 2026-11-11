/**
 * Daily Assistant (S7: AST-1..6, DSH-3, LES-1, D-063, D-065, D-066, D-068).
 *
 * - One assistant per teaching context and local day (unique row), shared by every lesson of that
 *   day (AST-1).
 * - Weekly plans are materialised rows (AST-2): generated once (automatically for the current week
 *   on first use, or by the teacher), never regenerated silently. The teacher may regenerate only
 *   future, unchanged days of an unannounced plan, with confirmation. Rotation is deterministic
 *   (domain/assistant.ts).
 * - Planned vs actual is always kept (AST-5): swaps, overrides and absence replacements set
 *   `actualStudentId`; the effective assistant is actual ?? planned and only effective turns count
 *   for the rotation, so an absent student's missed turn is not counted (AST-4).
 * - Absence (AST-4, D-065): when today's assistant is marked absent/excused, the earliest future
 *   planned assistant who is in class today takes today's turn and the absent student takes theirs
 *   (carry forward); when nobody is planned later, the next fair student in class does it and the
 *   absent student keeps priority in the next plan.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { z } from 'zod';
import { planAssistants, nextAssistant, weekDates, type TurnInfo } from '../../../domain/assistant.ts';
import { isAway } from '../../../domain/attendance.ts';
import { weekStartOfDate } from '../../../domain/counters.ts';
import { addDays, weekdayOf } from '../../../domain/dates.ts';
import type * as C from '../../../shared/contracts/assistant.ts';
import { DEFAULT_SCHOOL_DAYS, type AssistantPlan, type AssistantStudent, type AssistantToday } from '../../../shared/contracts/assistant.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { completeDefault, inLocales, seedLocales } from '../../../shared/classLanguage.ts';
import { initials, normaliseName, sortByName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { assistantAssignments, assistantPlans, assistantResponsibilities, students, teachingContexts, type AssistantAbsenceUndo } from '../../db/schema.ts';
import { emitStudentActivity } from '../../lib/activity.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId, sha256 } from '../../lib/crypto.ts';
import { AppError, invalid } from '../../lib/errors.ts';
import { dailyFor, type AttendanceChange } from '../attendance/service.ts';
import type { LessonRow } from '../lessons/endSteps.ts';
import { isModuleEnabled, mergeModuleConfig, moduleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, getClass, getSchoolSettings, getYear, todayFor, type ClassRow, type ContextRow } from '../school/policy.ts';
import { rosterRowsOn } from '../students/service.ts';
import { checksOn } from './duties.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type AssignmentRow = typeof assistantAssignments.$inferSelect;
type PlanRow = typeof assistantPlans.$inferSelect;
type StudentRow = typeof students.$inferSelect;

/** AST-6 defaults (EN + TR); editable per class+subject. */
export const DEFAULT_RESPONSIBILITIES: LocalizedTextValue[] = [
  { en: 'Remind classmates to prepare their English materials', tr: 'Arkadaşlarına İngilizce materyallerini hazırlamalarını hatırlat' },
  { en: 'Help organise the classroom', tr: 'Sınıfın düzenlenmesine yardım et' },
  { en: 'Keep extra materials ready', tr: 'Yedek materyalleri hazır tut' },
  { en: 'Tell the teacher about problems', tr: 'Sorunları öğretmene bildir' },
];

const effective = (a: Pick<AssignmentRow, 'actualStudentId' | 'plannedStudentId'>) => a.actualStudentId ?? a.plannedStudentId;
const studentDto = (s: StudentRow): AssistantStudent => ({ id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue });
const isWritable = (db: Db, cls: ClassRow) => !cls.archivedAt && !getYear(db, cls.schoolYearId).archivedAt;

function studentsById(db: Db, ids: Array<string | null>): Map<string, StudentRow> {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map();
  return new Map(db.select().from(students).where(inArray(students.id, list)).all().map((s) => [s.id, s]));
}

// ---------------------------------------------------------------- settings & responsibilities
/** The manifest default overlaid with schema-valid stored school days (D-069), deduplicated and sorted. */
export function schoolDaysOf(db: Db, contextId: string): number[] {
  const raw = moduleConfig(db, contextId, 'assistant').schoolDays;
  if (Array.isArray(raw)) {
    const days = [...new Set(raw.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort();
    if (days.length) return days;
  }
  return [...DEFAULT_SCHOOL_DAYS];
}

const weekStartFor = (db: Db, date: string) => weekStartOfDate(date, getSchoolSettings(db).weekStartsOn);

function responsibilityRows(db: Db, contextId: string) {
  return db
    .select()
    .from(assistantResponsibilities)
    .where(and(eq(assistantResponsibilities.contextId, contextId), isNull(assistantResponsibilities.archivedAt)))
    .orderBy(asc(assistantResponsibilities.sortOrder), asc(assistantResponsibilities.createdAt))
    .all();
}
export const responsibilities = (db: Db, contextId: string) => responsibilityRows(db, contextId).map((r) => ({ id: r.id, label: r.labelJson }));

/**
 * First use of the module in a context seeds the four default responsibilities (AST-6), once, in the
 * class's languages only (S20d, D-172).
 */
function ensureResponsibilities(ctx: RequestContext, context: ContextRow) {
  const any = ctx.db.select({ id: assistantResponsibilities.id }).from(assistantResponsibilities).where(eq(assistantResponsibilities.contextId, context.id)).limit(1).get();
  if (any) return;
  const now = ctx.now();
  const locales = seedLocales(getClass(ctx.db, context.classId));
  DEFAULT_RESPONSIBILITIES.forEach((label, i) => {
    ctx.db.insert(assistantResponsibilities).values({ id: newId(), contextId: context.id, labelJson: inLocales(label, locales), sortOrder: i, archivedAt: null, createdAt: now, updatedAt: now }).run();
  });
}

/**
 * `onClassLanguageChanged` listener (S20d, D-172): default responsibilities the teacher never changed
 * get the language just switched on; edited ones are left alone (the editor marks them "Needs translation").
 */
export function completeDefaultResponsibilities(ctx: RequestContext, cls: ClassRow): void {
  const locales = seedLocales(cls);
  let changed = 0;
  for (const context of ctx.db.select().from(teachingContexts).where(eq(teachingContexts.classId, cls.id)).all()) {
    for (const row of ctx.db.select().from(assistantResponsibilities).where(eq(assistantResponsibilities.contextId, context.id)).all()) {
      const filled = DEFAULT_RESPONSIBILITIES.map((d) => completeDefault(row.labelJson, d, locales)).find((x) => x !== null);
      if (!filled) continue;
      ctx.db.update(assistantResponsibilities).set({ labelJson: filled, updatedAt: ctx.now() }).where(eq(assistantResponsibilities.id, row.id)).run();
      changed++;
    }
  }
  if (changed) audit(ctx.db, ctx.actor, { action: 'assistant.defaults_translated', entity: 'class', entityId: cls.id, after: { responsibilities: changed, locales } }, ctx.now());
}

export function getSettings(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  if (isWritable(ctx.db, cls)) tx(ctx.db, () => ensureResponsibilities(ctx, context));
  return { schoolDays: schoolDaysOf(ctx.db, context.id), showPanel: moduleConfig(ctx.db, context.id, 'assistant').showPanel !== false, responsibilities: responsibilities(ctx.db, context.id) };
}

const cleanLabel = (t: LocalizedTextValue): LocalizedTextValue => ({ ...(t.en?.trim() ? { en: normaliseName(t.en) } : {}), ...(t.tr?.trim() ? { tr: normaliseName(t.tr) } : {}) });

export function setSettings(ctx: RequestContext, input: In<typeof C.setAssistantSettings>) {
  return tx(ctx.db, () => {
    const context = assertOwnsContext(ctx, input.contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
    ensureResponsibilities(ctx, context);
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    if (input.schoolDays) {
      const before = schoolDaysOf(ctx.db, context.id);
      const days = [...new Set(input.schoolDays)].sort();
      mergeModuleConfig(ctx.db, context.id, 'assistant', { schoolDays: days }, uid, now);
      audit(ctx.db, ctx.actor, { action: 'assistant.settings', entity: 'teaching_context', entityId: context.id, before: { schoolDays: before }, after: { schoolDays: days } }, now);
    }
    if (input.showPanel !== undefined) {
      mergeModuleConfig(ctx.db, context.id, 'assistant', { showPanel: input.showPanel }, uid, now);
      audit(ctx.db, ctx.actor, { action: 'assistant.settings', entity: 'teaching_context', entityId: context.id, after: { showPanel: input.showPanel } }, now);
    }
    if (input.responsibilities) {
      const before = responsibilities(ctx.db, context.id);
      const existing = new Map(responsibilityRows(ctx.db, context.id).map((r) => [r.id, r]));
      const kept = new Set<string>();
      input.responsibilities.forEach((r, i) => {
        const label = cleanLabel(r.label);
        if (r.id && existing.has(r.id) && !kept.has(r.id)) {
          kept.add(r.id);
          ctx.db.update(assistantResponsibilities).set({ labelJson: label, sortOrder: i, updatedAt: now }).where(eq(assistantResponsibilities.id, r.id)).run();
        } else {
          ctx.db.insert(assistantResponsibilities).values({ id: newId(), contextId: context.id, labelJson: label, sortOrder: i, archivedAt: null, createdAt: now, updatedAt: now }).run();
        }
      });
      for (const id of existing.keys()) {
        if (!kept.has(id)) ctx.db.update(assistantResponsibilities).set({ archivedAt: now, updatedAt: now }).where(eq(assistantResponsibilities.id, id)).run();
      }
      audit(ctx.db, ctx.actor, { action: 'assistant.responsibilities', entity: 'teaching_context', entityId: context.id, before, after: responsibilities(ctx.db, context.id) }, now);
    }
    return { schoolDays: schoolDaysOf(ctx.db, context.id), showPanel: moduleConfig(ctx.db, context.id, 'assistant').showPanel !== false, responsibilities: responsibilities(ctx.db, context.id) };
  });
}

// ---------------------------------------------------------------- rotation helpers
/** Effective turns per student in this context and school year, ignoring `exclude` dates (D-063). */
function turnCounts(db: Db, contextId: string, schoolYearId: string, exclude: ReadonlySet<string>): Map<string, TurnInfo> {
  const rows = db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, contextId), eq(assistantAssignments.schoolYearId, schoolYearId)))
    .all();
  const out = new Map<string, TurnInfo>();
  for (const r of rows) {
    if (exclude.has(r.localDate)) continue;
    const id = effective(r);
    if (!id) continue;
    const cur = out.get(id) ?? { count: 0, last: null };
    out.set(id, { count: cur.count + 1, last: cur.last && cur.last > r.localDate ? cur.last : r.localDate });
  }
  return out;
}

const rosterOn = (db: Db, classId: string) => (date: string) => rosterRowsOn(db, classId, date).map(({ student }) => ({ id: student.id, fullName: student.fullName }));

function getAssignment(db: Db, contextId: string, date: string): AssignmentRow | undefined {
  return db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, contextId), eq(assistantAssignments.localDate, date)))
    .get();
}

function getPlan(db: Db, contextId: string, weekStart: string): PlanRow | undefined {
  return db
    .select()
    .from(assistantPlans)
    .where(and(eq(assistantPlans.contextId, contextId), eq(assistantPlans.weekStart, weekStart)))
    .get();
}

/** Create assignments for `dates` that have none yet (fair, deterministic). Inside a transaction. */
function fillDates(ctx: RequestContext, context: ContextRow, cls: ClassRow, planId: string | null, dates: string[]): void {
  const missing = dates.filter((d) => !getAssignment(ctx.db, context.id, d));
  if (!missing.length) return;
  const plan = planAssistants(missing, rosterOn(ctx.db, cls.id), turnCounts(ctx.db, context.id, cls.schoolYearId, new Set(missing)));
  const now = ctx.now();
  for (const date of missing) {
    ctx.db
      .insert(assistantAssignments)
      .values({ id: newId(), contextId: context.id, planId, schoolYearId: cls.schoolYearId, localDate: date, plannedStudentId: plan.get(date) ?? null, actualStudentId: null, status: 'planned', reason: null, thankedAt: null, createdAt: now, updatedAt: now, updatedBy: ctx.user?.id ?? null })
      .run();
  }
}

/** The week's plan, created once (unannounced) with assignments for its school days from today on. */
function ensurePlan(ctx: RequestContext, context: ContextRow, cls: ClassRow, weekStart: string, today: string): PlanRow {
  const existing = getPlan(ctx.db, context.id, weekStart);
  if (existing) return existing;
  const year = getYear(ctx.db, cls.schoolYearId);
  const row: PlanRow = { id: newId(), contextId: context.id, weekStart, generatedAt: ctx.now(), generatedBy: ctx.user?.id ?? null, announcedAt: null, announcedBy: null };
  ctx.db.insert(assistantPlans).values(row).run();
  const dates = weekDates(weekStart, schoolDaysOf(ctx.db, context.id), year.startsOn, year.endsOn).filter((d) => d >= today);
  fillDates(ctx, context, cls, row.id, dates);
  audit(ctx.db, ctx.actor, { action: 'assistant.plan_generate', entity: 'assistant_plan', entityId: row.id, after: { contextId: context.id, weekStart, days: dates.length } }, ctx.now());
  return row;
}

// ---------------------------------------------------------------- absence (AST-4, D-065, D-068)
/** Students on the class roster on `date` (enrolment-aware, D-027). */
const enrolledOn = (db: Db, classId: string, date: string) => new Set(rosterRowsOn(db, classId, date).map(({ student }) => student.id));

/**
 * Today's assistant is away, no longer in the class, or nobody is assigned: carry forward or pick
 * the next fair student who is in class. Only a real absence is recorded as a missed turn
 * (`absentStudentIds`, kept even if the day is swapped or overridden later) and can be undone by a
 * same-day attendance correction (`absenceUndo`, D-068).
 */
function replaceIfAway(ctx: RequestContext, context: ContextRow, cls: ClassRow, row: AssignmentRow): AssignmentRow {
  // Replaced earlier with nobody left to choose: the day is vacant, not "the absent student again".
  const vacant = row.status === 'replaced_absent' && row.actualStudentId === null;
  const who = vacant ? null : effective(row);
  const daily = dailyFor(ctx.db, cls.id, row.localDate);
  const statusOf = (id: string) => daily.get(id)?.status ?? null;
  const away = (id: string) => {
    const st = statusOf(id);
    return st !== null && isAway(st);
  };
  const roster = rosterOn(ctx.db, cls.id)(row.localDate);
  if (!roster.length) return row;
  const gone = who !== null && !roster.some((st) => st.id === who);
  if (who !== null && !gone && !away(who)) return row;
  const inClass = roster.filter((st) => statusOf(st.id) === 'present' || statusOf(st.id) === 'late');
  const pool = inClass.length ? inClass : roster.filter((st) => !away(st.id));
  const now = ctx.now();
  const uid = ctx.user?.id ?? null;
  const turns = () => turnCounts(ctx.db, context.id, cls.schoolYearId, new Set([row.localDate]));

  if (who === null) {
    // Planned while the class had no students, or vacant after a replacement: fill today now.
    const pick = nextAssistant(pool.filter((st) => !row.absentStudentIds.includes(st.id)), turns())?.id ?? null;
    if (!pick) return row;
    const patch = vacant ? { actualStudentId: pick, updatedAt: now, updatedBy: uid } : { plannedStudentId: pick, updatedAt: now, updatedBy: uid };
    ctx.db.update(assistantAssignments).set(patch).where(eq(assistantAssignments.id, row.id)).run();
    audit(ctx.db, ctx.actor, { action: 'assistant.fill_day', entity: 'assistant_assignment', entityId: row.id, after: { date: row.localDate, assistant: pick } }, now);
    return { ...row, ...patch };
  }

  if (gone) {
    // Left or moved class: not a missed turn, and nobody keeps a later day for them.
    const replacement = nextAssistant(pool.filter((st) => st.id !== who), turns())?.id ?? null;
    const patch = { actualStudentId: replacement, status: 'replaced_absent' as const, reason: 'not_in_class', absenceUndo: null, updatedAt: now, updatedBy: uid };
    ctx.db.update(assistantAssignments).set(patch).where(eq(assistantAssignments.id, row.id)).run();
    audit(ctx.db, ctx.actor, { action: 'assistant.replace_not_in_class', entity: 'assistant_assignment', entityId: row.id, before: { date: row.localDate, assistant: who }, after: { date: row.localDate, assistant: replacement } }, now);
    return { ...row, ...patch };
  }

  // 1) Carry forward: the earliest later planned assistant who is in class today swaps turns.
  const later = ctx.db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, context.id), gt(assistantAssignments.localDate, row.localDate), eq(assistantAssignments.status, 'planned')))
    .orderBy(asc(assistantAssignments.localDate))
    .all()
    .find((a) => {
      const id = effective(a);
      return id !== null && id !== who && pool.some((st) => st.id === id) && enrolledOn(ctx.db, cls.id, a.localDate).has(who);
    });
  let replacement: string | null;
  if (later) {
    replacement = effective(later);
    ctx.db.update(assistantAssignments).set({ actualStudentId: who, status: 'swapped', reason: 'carry_forward', updatedAt: now, updatedBy: uid }).where(eq(assistantAssignments.id, later.id)).run();
  } else {
    replacement = nextAssistant(pool.filter((st) => st.id !== who), turns())?.id ?? null;
  }
  const absenceUndo: AssistantAbsenceUndo = {
    absentId: who,
    replacement,
    prev: { actualStudentId: row.actualStudentId, status: row.status, reason: row.reason },
    partner: later ? { id: later.id, actualStudentId: later.actualStudentId, status: later.status, reason: later.reason } : null,
  };
  const patch = { actualStudentId: replacement, status: 'replaced_absent' as const, reason: 'absent', absentStudentIds: [...row.absentStudentIds, who], absenceUndo, updatedAt: now, updatedBy: uid };
  ctx.db.update(assistantAssignments).set(patch).where(eq(assistantAssignments.id, row.id)).run();
  audit(
    ctx.db,
    ctx.actor,
    { action: 'assistant.replace_absent', entity: 'assistant_assignment', entityId: row.id, before: { date: row.localDate, assistant: who }, after: { date: row.localDate, assistant: replacement, carriedTo: later?.localDate ?? null } },
    now,
  );
  return { ...row, ...patch };
}

/**
 * The absent assistant was marked present again (or the record was cleared) the same day: undo the
 * latest replacement and its carry-forward partner, but only while neither day was changed since
 * (no swap, override, thank-you or later replacement) (D-068).
 */
function restoreIfBack(ctx: RequestContext, row: AssignmentRow, studentId: string): void {
  const undo = row.absenceUndo;
  if (!undo || undo.absentId !== studentId) return;
  if (row.status !== 'replaced_absent' || row.actualStudentId !== undo.replacement || row.thankedAt !== null) return;
  const partner = undo.partner ? ctx.db.select().from(assistantAssignments).where(eq(assistantAssignments.id, undo.partner.id)).get() : undefined;
  if (undo.partner && (!partner || partner.actualStudentId !== studentId || partner.status !== 'swapped' || partner.reason !== 'carry_forward' || partner.thankedAt !== null)) return;
  const now = ctx.now();
  const uid = ctx.user?.id ?? null;
  const absent = [...row.absentStudentIds];
  const i = absent.lastIndexOf(studentId);
  if (i >= 0) absent.splice(i, 1);
  ctx.db
    .update(assistantAssignments)
    .set({ actualStudentId: undo.prev.actualStudentId, status: undo.prev.status, reason: undo.prev.reason, absentStudentIds: absent, absenceUndo: null, updatedAt: now, updatedBy: uid })
    .where(eq(assistantAssignments.id, row.id))
    .run();
  if (partner && undo.partner) {
    ctx.db
      .update(assistantAssignments)
      .set({ actualStudentId: undo.partner.actualStudentId, status: undo.partner.status, reason: undo.partner.reason, updatedAt: now, updatedBy: uid })
      .where(eq(assistantAssignments.id, partner.id))
      .run();
  }
  audit(
    ctx.db,
    ctx.actor,
    { action: 'assistant.restore_after_absence', entity: 'assistant_assignment', entityId: row.id, before: { date: row.localDate, assistant: undo.replacement }, after: { date: row.localDate, assistant: studentId, restoredDay: partner?.localDate ?? null } },
    now,
  );
}

/**
 * Attendance listener (AST-4): today's assistant marked absent/excused in daily attendance is
 * replaced; a same-day correction back to present (or "not recorded") restores the day (D-068).
 */
export function onAttendanceChange(ctx: RequestContext, ch: AttendanceChange): void {
  if (ch.lessonId !== null) return;
  const cls = getClass(ctx.db, ch.classId);
  if (!isWritable(ctx.db, cls) || ch.date !== todayFor(ctx, cls)) return;
  const nowAway = ch.status !== null && isAway(ch.status);
  const contexts = ctx.db
    .select()
    .from(teachingContexts)
    .where(and(eq(teachingContexts.classId, cls.id), isNull(teachingContexts.endedAt)))
    .all();
  for (const context of contexts) {
    if (!isModuleEnabled(ctx.db, context.id, 'assistant')) continue;
    const row = getAssignment(ctx.db, context.id, ch.date);
    if (!row) continue;
    if (nowAway) {
      if (effective(row) === ch.studentId) replaceIfAway(ctx, context, cls, row);
    } else restoreIfBack(ctx, row, ch.studentId);
  }
}

/**
 * Later days whose assistant is no longer in the class (left or moved, D-068), or that have no
 * assistant although the class now has students, get the next fair student. A day still `planned`
 * is planned again; a day already changed by hand keeps its planned student and records the new one
 * as actual (`not_in_class`). Inside a transaction.
 */
function refreshLaterDays(ctx: RequestContext, context: ContextRow, cls: ClassRow, today: string): void {
  const rows = ctx.db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, context.id), gt(assistantAssignments.localDate, today)))
    .orderBy(asc(assistantAssignments.localDate))
    .all();
  for (const r of rows) {
    const who = effective(r);
    const roster = rosterOn(ctx.db, cls.id)(r.localDate);
    if (!roster.length || (who !== null && roster.some((st) => st.id === who))) continue;
    const pick = nextAssistant(roster, turnCounts(ctx.db, context.id, cls.schoolYearId, new Set([r.localDate])))?.id ?? null;
    if (!pick) continue;
    const now = ctx.now();
    const patch = r.status === 'planned' ? { plannedStudentId: pick, actualStudentId: null } : { actualStudentId: pick, status: 'replaced_absent' as const, reason: 'not_in_class' };
    ctx.db
      .update(assistantAssignments)
      .set({ ...patch, updatedAt: now, updatedBy: ctx.user?.id ?? null })
      .where(eq(assistantAssignments.id, r.id))
      .run();
    audit(ctx.db, ctx.actor, { action: 'assistant.replace_not_in_class', entity: 'assistant_assignment', entityId: r.id, before: { date: r.localDate, assistant: who }, after: { date: r.localDate, assistant: pick } }, now);
  }
}

// ---------------------------------------------------------------- today
/**
 * Today's assignment, created on first use (the current week's plan is generated if missing) and
 * checked for absence and for students who left the class (later days too). Nothing is written in
 * an archived class or year (DAT-1) or on a day that is not a school day.
 */
export function ensureToday(ctx: RequestContext, context: ContextRow): { today: string; schoolDay: boolean; row: AssignmentRow | null } {
  const cls = getClass(ctx.db, context.classId);
  const today = todayFor(ctx, cls);
  const year = getYear(ctx.db, cls.schoolYearId);
  const schoolDay = schoolDaysOf(ctx.db, context.id).includes(weekdayOf(today)) && today >= year.startsOn && today <= year.endsOn;
  if (!isWritable(ctx.db, cls)) return { today, schoolDay, row: getAssignment(ctx.db, context.id, today) ?? null };
  const row = tx(ctx.db, () => {
    ensureResponsibilities(ctx, context);
    let r: AssignmentRow | null = getAssignment(ctx.db, context.id, today) ?? null;
    if (schoolDay) {
      if (!r) {
        const plan = ensurePlan(ctx, context, cls, weekStartFor(ctx.db, today), today);
        fillDates(ctx, context, cls, plan.id, [today]);
        r = getAssignment(ctx.db, context.id, today)!;
      }
      r = replaceIfAway(ctx, context, cls, r);
    }
    // Today first, so later days continue the rotation after it.
    refreshLaterDays(ctx, context, cls, today);
    return r;
  });
  return { today, schoolDay, row };
}

export function todayDto(ctx: RequestContext, context: ContextRow): AssistantToday {
  const { today, schoolDay, row } = ensureToday(ctx, context);
  const who = row ? effective(row) : null;
  const s = who ? studentsById(ctx.db, [who]).get(who) : undefined;
  const checked = who ? checksOn(ctx.db, context.id, [today]).filter((c) => c.studentId === who).map((c) => c.responsibilityId) : [];
  return {
    localDate: today,
    schoolDay,
    assistant: s ? studentDto(s) : null,
    responsibilities: responsibilities(ctx.db, context.id),
    thanked: Boolean(row?.thankedAt),
    checked,
    showPanel: moduleConfig(ctx.db, context.id, 'assistant').showPanel !== false,
  };
}

export function todayAssistant(ctx: RequestContext, contextId: string): AssistantToday {
  const context = assertOwnsContext(ctx, contextId);
  if (!isModuleEnabled(ctx.db, context.id, 'assistant')) throw new AppError('FEATURE_DISABLED', 'Module assistant is turned off', { module: 'assistant' });
  return todayDto(ctx, context);
}

/** ETag part of the lesson state: today's assignment and the responsibilities. */
export function assistantStamp(ctx: RequestContext, context: ContextRow): string {
  const { row } = ensureToday(ctx, context);
  const resp = responsibilityRows(ctx.db, context.id).map((r) => `${r.id}:${r.updatedAt}`);
  const ticks = row ? checksOn(ctx.db, context.id, [row.localDate]).map((c) => `${c.id}:${c.checkedAt}`) : [];
  const show = moduleConfig(ctx.db, context.id, 'assistant').showPanel !== false;
  return sha256(`${row ? `${row.id}:${row.updatedAt}:${effective(row)}:${row.thankedAt}` : '-'}|${resp.join(',')}|${ticks.join(',')}|${show}`).slice(0, 12);
}

/** End Lesson step 'assistantThanks' (optional). */
export function endStep(ctx: RequestContext, lesson: LessonRow, data: z.infer<typeof C.AssistantEndStepInput>): void {
  if (!data.thanked) return;
  const row = getAssignment(ctx.db, lesson.contextId, lesson.localDate);
  if (!row || !effective(row) || row.thankedAt) return;
  const now = ctx.now();
  ctx.db
    .update(assistantAssignments)
    .set({ thankedAt: now, status: row.status === 'planned' ? 'confirmed' : row.status, updatedAt: now, updatedBy: ctx.user?.id ?? null })
    .where(eq(assistantAssignments.id, row.id))
    .run();
  audit(ctx.db, ctx.actor, { action: 'assistant.thank', entity: 'assistant_assignment', entityId: row.id, after: { date: row.localDate, assistant: effective(row) } }, now);
  emitStudentActivity(ctx, { source: 'assistant', studentIds: [effective(row)!], contextId: row.contextId });
}

// ---------------------------------------------------------------- week views
function weekOf(ctx: RequestContext, context: ContextRow, cls: ClassRow, weekStart: string | undefined) {
  const today = todayFor(ctx, cls);
  const ws = weekStartFor(ctx.db, weekStart ?? today);
  if (weekStart && ws !== weekStart) throw invalid('Not the first day of a week', { reason: 'NOT_WEEK_START' });
  const year = getYear(ctx.db, cls.schoolYearId);
  const schoolDays = schoolDaysOf(ctx.db, context.id);
  const dates = weekDates(ws, schoolDays, year.startsOn, year.endsOn);
  const rows = ctx.db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, context.id), gte(assistantAssignments.localDate, ws), lte(assistantAssignments.localDate, dates[dates.length - 1] ?? ws)))
    .all();
  const byDate = new Map(rows.map((r) => [r.localDate, r]));
  // A day that stopped being a school day but already has an assignment stays visible.
  const all = [...new Set([...dates, ...rows.map((r) => r.localDate)])].sort();
  return { today, weekStart: ws, schoolDays, dates: all, byDate, plan: getPlan(ctx.db, context.id, ws) ?? null };
}

/**
 * Classroom-safe week (D-066, D-068): only the current week or the next one, and names only once the
 * teacher has announced that week. Drafts and past weeks are teacher-area (PIN-1/PIN-8).
 */
export function classroomWeek(ctx: RequestContext, input: In<typeof C.assistantWeek>) {
  const context = assertOwnsContext(ctx, input.contextId);
  if (!isModuleEnabled(ctx.db, context.id, 'assistant')) throw new AppError('FEATURE_DISABLED', 'Module assistant is turned off', { module: 'assistant' });
  const cls = getClass(ctx.db, context.classId);
  const current = weekStartFor(ctx.db, todayFor(ctx, cls));
  const next = weekStartFor(ctx.db, addDays(current, 7));
  if (input.weekStart && input.weekStart !== current && input.weekStart !== next) {
    throw new AppError('FORBIDDEN', 'Only this week and next week can be shown in the classroom', { reason: 'WEEK_NOT_IN_CLASSROOM' });
  }
  const w = weekOf(ctx, context, cls, input.weekStart);
  if (!w.plan?.announcedAt) return { weekStart: w.weekStart, announced: false, days: [], responsibilities: responsibilities(ctx.db, context.id) };
  const byId = studentsById(ctx.db, [...w.byDate.values()].map(effective));
  return {
    weekStart: w.weekStart,
    announced: true,
    days: w.dates.map((d) => {
      const r = w.byDate.get(d);
      const s = r ? byId.get(effective(r) ?? '') : undefined;
      return { date: d, weekday: weekdayOf(d), assistant: s ? studentDto(s) : null };
    }),
    responsibilities: responsibilities(ctx.db, context.id),
  };
}

function planDto(ctx: RequestContext, context: ContextRow, cls: ClassRow, weekStart: string | undefined): AssistantPlan {
  const w = weekOf(ctx, context, cls, weekStart);
  const rows = [...w.byDate.values()];
  const roster = rosterRowsOn(ctx.db, cls.id, w.today).map(({ student }) => student);
  const byId = studentsById(ctx.db, rows.flatMap((r) => [r.plannedStudentId, r.actualStudentId]));
  const dto = (id: string | null) => {
    const s = id ? byId.get(id) : undefined;
    return s ? studentDto(s) : null;
  };
  return {
    contextId: context.id,
    weekStart: w.weekStart,
    today: w.today,
    schoolDays: w.schoolDays,
    plan: w.plan ? { generatedAt: w.plan.generatedAt, announcedAt: w.plan.announcedAt } : null,
    days: w.dates.map((d) => {
      const r = w.byDate.get(d);
      return {
        date: d,
        weekday: weekdayOf(d),
        assignmentId: r?.id ?? null,
        planned: dto(r?.plannedStudentId ?? null),
        actual: dto(r?.actualStudentId ?? null),
        assistant: dto(r ? effective(r) : null),
        status: r?.status ?? null,
        reason: r?.reason ?? null,
        past: d < w.today,
        today: d === w.today,
      };
    }),
    roster: sortByName(roster, (s) => s.fullName).map(studentDto),
  };
}

function ownWritable(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  return { context, cls };
}

export function getPlanView(ctx: RequestContext, input: In<typeof C.getAssistantPlan>): AssistantPlan {
  const { context, cls } = ownWritable(ctx, input.contextId);
  return planDto(ctx, context, cls, input.weekStart);
}

export function generate(ctx: RequestContext, input: In<typeof C.generateAssistantPlan>): AssistantPlan {
  return tx(ctx.db, () => {
    const { context, cls } = ownWritable(ctx, input.contextId);
    assertClassWritable(ctx.db, cls);
    const today = todayFor(ctx, cls);
    const ws = weekStartFor(ctx.db, input.weekStart ?? today);
    if (input.weekStart && ws !== input.weekStart) throw invalid('Not the first day of a week', { reason: 'NOT_WEEK_START' });
    ensureResponsibilities(ctx, context);
    ensurePlan(ctx, context, cls, ws, today);
    return planDto(ctx, context, cls, ws);
  });
}

/** Re-plan future, still-planned days of an unannounced week (confirmed by the teacher). */
export function regenerate(ctx: RequestContext, input: In<typeof C.regenerateAssistantPlan>): AssistantPlan {
  return tx(ctx.db, () => {
    const { context, cls } = ownWritable(ctx, input.contextId);
    assertClassWritable(ctx.db, cls);
    const plan = getPlan(ctx.db, context.id, input.weekStart);
    if (!plan) throw new AppError('NOT_FOUND', 'No plan for this week', { reason: 'PLAN_MISSING' });
    if (plan.announcedAt) throw new AppError('CONFLICT', 'This week was announced and stays as it is', { reason: 'PLAN_ANNOUNCED' });
    const today = todayFor(ctx, cls);
    const year = getYear(ctx.db, cls.schoolYearId);
    const dates = weekDates(input.weekStart, schoolDaysOf(ctx.db, context.id), year.startsOn, year.endsOn).filter((d) => d > today);
    const changeable = dates.filter((d) => {
      const r = getAssignment(ctx.db, context.id, d);
      return !r || r.status === 'planned';
    });
    const before = changeable.map((d) => ({ date: d, student: getAssignment(ctx.db, context.id, d)?.plannedStudentId ?? null }));
    const next = planAssistants(changeable, rosterOn(ctx.db, cls.id), turnCounts(ctx.db, context.id, cls.schoolYearId, new Set(changeable)));
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    for (const d of changeable) {
      const r = getAssignment(ctx.db, context.id, d);
      const student = next.get(d) ?? null;
      if (r) ctx.db.update(assistantAssignments).set({ plannedStudentId: student, actualStudentId: null, updatedAt: now, updatedBy: uid }).where(eq(assistantAssignments.id, r.id)).run();
      else {
        ctx.db
          .insert(assistantAssignments)
          .values({ id: newId(), contextId: context.id, planId: plan.id, schoolYearId: cls.schoolYearId, localDate: d, plannedStudentId: student, actualStudentId: null, status: 'planned', reason: null, thankedAt: null, createdAt: now, updatedAt: now, updatedBy: uid })
          .run();
      }
    }
    audit(ctx.db, ctx.actor, { action: 'assistant.plan_regenerate', entity: 'assistant_plan', entityId: plan.id, before, after: changeable.map((d) => ({ date: d, student: next.get(d) ?? null })) }, now);
    return planDto(ctx, context, cls, input.weekStart);
  });
}

export function announce(ctx: RequestContext, input: In<typeof C.announceAssistantPlan>): AssistantPlan {
  return tx(ctx.db, () => {
    const { context, cls } = ownWritable(ctx, input.contextId);
    assertClassWritable(ctx.db, cls);
    const plan = getPlan(ctx.db, context.id, input.weekStart);
    if (!plan) throw new AppError('NOT_FOUND', 'No plan for this week', { reason: 'PLAN_MISSING' });
    if (!plan.announcedAt) {
      const now = ctx.now();
      ctx.db.update(assistantPlans).set({ announcedAt: now, announcedBy: requireUser(ctx).id }).where(eq(assistantPlans.id, plan.id)).run();
      audit(ctx.db, ctx.actor, { action: 'assistant.plan_announce', entity: 'assistant_plan', entityId: plan.id, after: { weekStart: plan.weekStart } }, now);
    }
    return planDto(ctx, context, cls, input.weekStart);
  });
}

function editableAssignment(ctx: RequestContext, context: ContextRow, cls: ClassRow, date: string): AssignmentRow {
  if (date < todayFor(ctx, cls)) throw new AppError('CONFLICT', 'Past days are history', { reason: 'DAY_IN_PAST' });
  const r = getAssignment(ctx.db, context.id, date);
  if (!r) throw new AppError('NOT_FOUND', 'No assistant planned for this day', { reason: 'DAY_NOT_PLANNED' });
  return r;
}

/** Manual swap of two days (AST-3): planned stays, actual records who does it. */
export function swap(ctx: RequestContext, input: In<typeof C.swapAssistants>): AssistantPlan {
  return tx(ctx.db, () => {
    const { context, cls } = ownWritable(ctx, input.contextId);
    assertClassWritable(ctx.db, cls);
    if (input.dateA === input.dateB) throw invalid('Choose two different days', { reason: 'SAME_DAY' });
    const a = editableAssignment(ctx, context, cls, input.dateA);
    const b = editableAssignment(ctx, context, cls, input.dateB);
    const ea = effective(a);
    const eb = effective(b);
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    ctx.db.update(assistantAssignments).set({ actualStudentId: eb, status: 'swapped', reason: 'teacher_swap', absenceUndo: null, updatedAt: now, updatedBy: uid }).where(eq(assistantAssignments.id, a.id)).run();
    ctx.db.update(assistantAssignments).set({ actualStudentId: ea, status: 'swapped', reason: 'teacher_swap', absenceUndo: null, updatedAt: now, updatedBy: uid }).where(eq(assistantAssignments.id, b.id)).run();
    audit(ctx.db, ctx.actor, { action: 'assistant.swap', entity: 'teaching_context', entityId: context.id, before: [{ date: a.localDate, student: ea }, { date: b.localDate, student: eb }], after: [{ date: a.localDate, student: eb }, { date: b.localDate, student: ea }] }, now);
    return planDto(ctx, context, cls, weekStartFor(ctx.db, input.dateA));
  });
}

/** Manual override of one day (AST-3). */
export function override(ctx: RequestContext, input: In<typeof C.overrideAssistant>): AssistantPlan {
  return tx(ctx.db, () => {
    const { context, cls } = ownWritable(ctx, input.contextId);
    assertClassWritable(ctx.db, cls);
    const r = editableAssignment(ctx, context, cls, input.date);
    if (!rosterRowsOn(ctx.db, cls.id, input.date).some(({ student }) => student.id === input.studentId)) {
      throw new AppError('CONFLICT', 'This student is not in the class on this day', { reason: 'STUDENT_NOT_IN_CLASS' });
    }
    const now = ctx.now();
    const reason = input.reason?.trim() ? input.reason.trim() : 'teacher_override';
    ctx.db.update(assistantAssignments).set({ actualStudentId: input.studentId, status: 'override', reason, absenceUndo: null, updatedAt: now, updatedBy: requireUser(ctx).id }).where(eq(assistantAssignments.id, r.id)).run();
    audit(ctx.db, ctx.actor, { action: 'assistant.override', entity: 'assistant_assignment', entityId: r.id, before: { date: r.localDate, student: effective(r) }, after: { date: r.localDate, student: input.studentId, reason } }, now);
    return planDto(ctx, context, cls, weekStartFor(ctx.db, input.date));
  });
}

// ---------------------------------------------------------------- history (AST-5)
export function history(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const today = todayFor(ctx, cls);
  const rows = ctx.db
    .select()
    .from(assistantAssignments)
    .where(and(eq(assistantAssignments.contextId, context.id), eq(assistantAssignments.schoolYearId, cls.schoolYearId)))
    .orderBy(asc(assistantAssignments.localDate))
    .all();
  const roster = rosterRowsOn(ctx.db, cls.id, today).map(({ student }) => student.id);
  const byId = studentsById(ctx.db, [...roster, ...rows.flatMap((r) => [r.plannedStudentId, r.actualStudentId, ...r.absentStudentIds])]);
  const dto = (id: string | null) => {
    const s = id ? byId.get(id) : undefined;
    return s ? studentDto(s) : null;
  };
  const stats = new Map<string, { turns: number; missed: number; last: string | null; next: string | null }>();
  const stat = (id: string) => stats.get(id) ?? stats.set(id, { turns: 0, missed: 0, last: null, next: null }).get(id)!;
  for (const id of roster) stat(id);
  for (const r of rows) {
    const who = effective(r);
    if (r.localDate <= today) {
      if (who) {
        const s = stat(who);
        s.turns += 1;
        s.last = r.localDate;
      }
      // Missed turns come from the recorded absences, never from planned vs actual (D-068).
      for (const id of new Set(r.absentStudentIds)) if (id !== who) stat(id).missed += 1;
    } else if (who) {
      const s = stat(who);
      if (!s.next) s.next = r.localDate;
    }
  }
  const allResp = new Map(ctx.db.select().from(assistantResponsibilities).where(eq(assistantResponsibilities.contextId, context.id)).all().map((r) => [r.id, r]));
  const ticks = checksOn(ctx.db, context.id, rows.filter((r) => r.localDate <= today).map((r) => r.localDate));
  const dutiesOn = (r: AssignmentRow) =>
    ticks
      .filter((c) => c.localDate === r.localDate && c.studentId === effective(r))
      .map((c) => allResp.get(c.responsibilityId))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({ id: x.id, label: x.labelJson }));
  return {
    students: sortByName([...stats.entries()].filter(([id]) => byId.has(id)), ([id]) => byId.get(id)!.fullName).map(([id, s]) => ({ student: dto(id)!, turns: s.turns, missed: s.missed, lastDate: s.last, nextDate: s.next })),
    days: rows
      .filter((r) => r.localDate <= today)
      .reverse()
      .map((r) => ({
        date: r.localDate,
        planned: dto(r.plannedStudentId),
        actual: dto(r.actualStudentId),
        absent: [...new Set(r.absentStudentIds)].map(dto).filter((x): x is AssistantStudent => x !== null),
        status: r.status,
        reason: r.reason,
        thanked: r.thankedAt !== null,
        duties: dutiesOn(r),
      })),
  };
}
