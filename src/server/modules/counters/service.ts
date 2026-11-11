/**
 * Counters (S6: CNT-1..12, CRD-2, D-003, D-004, D-057…D-060). Counters belong to a teaching context
 * (ACC-10). Every tap is an event whose id is the command's opId (CNT-5); undo voids it (CNT-4);
 * lesson totals, bars, threshold crossings and weekly counts are all derived from live events
 * (CNT-8, D-004). Threshold information sent to the classroom never names a student (CNT-9).
 */
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { isAway } from '../../../domain/attendance.ts';
import { crossingTransition, lessonCounts, levelFor, weekEndOf, weekStartOf, weekStartOfDate } from '../../../domain/counters.ts';
import { addDays, localDate } from '../../../domain/dates.ts';
import type * as C from '../../../shared/contracts/counters.ts';
import type { CounterConfig, CounterLessonState, CountersLessonState } from '../../../shared/contracts/counters.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { completeDefault, inLocales, seedLocales, type ClassLocale } from '../../../shared/classLanguage.ts';
import type { ClassroomCardItem } from '../../../shared/contracts/classroomCard.ts';
import {
  customLabels,
  ENGLISH_ACTIVE_RESPONSE,
  ENGLISH_LABELS,
  ENGLISH_RESPONSES,
  ENGLISH_THRESHOLDS,
  isEnglishSubject,
  RESET_UNDO_MS,
  type CounterColour,
} from '../../../shared/counters.ts';
import { initials, normaliseName, sortByName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import {
  counterEvents,
  counterLessonResets,
  counters,
  enrolments,
  lessons,
  students,
  subjects,
  teachingContexts,
  terms,
  thresholdCrossings,
  type CounterLabelsJson,
  type ThresholdResponseJson,
} from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { rosterWithAttendance } from '../attendance/service.ts';
import { getActiveLesson, lessonForCommand, updateLesson } from '../lessons/service.ts';
import { assertModuleEnabled, isModuleEnabled, moduleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, effectiveTimezone, getClass, getSchoolSettings, getYear, type ClassRow, type ContextRow } from '../school/policy.ts';
import { rosterRowsOn } from '../students/service.ts';
import type { ClassroomCardInput } from '../manifest.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type P<T extends keyof typeof C.CounterCommands> = z.infer<(typeof C.CounterCommands)[T]>;
export type CounterRow = typeof counters.$inferSelect;
type EventRow = typeof counterEvents.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;

// ---------------------------------------------------------------- helpers
const cleanText = (t: LocalizedTextValue | undefined): LocalizedTextValue => {
  const out: LocalizedTextValue = {};
  if (t?.en?.trim()) out.en = normaliseName(t.en);
  if (t?.tr?.trim()) out.tr = normaliseName(t.tr);
  return out;
};

const cleanLabels = (l: { main: LocalizedTextValue; supporting: LocalizedTextValue; individual: LocalizedTextValue }): CounterLabelsJson => ({
  main: cleanText(l.main),
  supporting: cleanText(l.supporting),
  individual: cleanText(l.individual),
});

/** Keep valid unique ids (so the active choice survives edits), give new responses fresh ids. */
function cleanResponses(input: Array<{ id?: string | undefined; label: LocalizedTextValue; message: LocalizedTextValue; mascot: boolean; kind: ThresholdResponseJson['kind'] }>): ThresholdResponseJson[] {
  const seen = new Set<string>();
  return input.map((r) => {
    const id = r.id && !seen.has(r.id) ? r.id : `r-${newId()}`;
    seen.add(id);
    return { id, label: cleanText(r.label), message: cleanText(r.message), mascot: r.mascot, kind: r.kind };
  });
}

function assertActiveResponse(responses: ThresholdResponseJson[], id: string | null) {
  if (id !== null && !responses.some((r) => r.id === id)) throw invalid('Choose one of the listed responses', { reason: 'RESPONSE_UNKNOWN' });
}

export function configDto(r: CounterRow): CounterConfig {
  return {
    id: r.id,
    contextId: r.contextId,
    kind: r.kind,
    labels: r.labelsJson,
    scope: r.scope,
    barSegments: r.barSegments,
    resetPeriod: r.studentResetPeriod,
    thresholds: r.studentThresholdsJson,
    responses: r.responsesJson,
    activeResponseId: r.activeResponseId,
    colour: r.colour as CounterColour,
    archived: r.archivedAt !== null,
    createdAt: r.createdAt,
  };
}

function subjectName(db: Db, context: ContextRow): LocalizedTextValue {
  return db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, context.subjectId)).get()?.name ?? {};
}

const countersOf = (db: Db, contextId: string, includeArchived = false) =>
  db
    .select()
    .from(counters)
    .where(includeArchived ? eq(counters.contextId, contextId) : and(eq(counters.contextId, contextId), isNull(counters.archivedAt)))
    .orderBy(asc(counters.sortOrder), asc(counters.createdAt))
    .all();

function nextSortOrder(db: Db, contextId: string): number {
  const row = db.select({ m: max(counters.sortOrder) }).from(counters).where(eq(counters.contextId, contextId)).get();
  return (row?.m ?? -1) + 1;
}

/** The English reminder preset, written in the class's languages only (S20d, D-172). */
const presetLabels = (locales: readonly ClassLocale[]): CounterLabelsJson => ({
  main: inLocales(ENGLISH_LABELS.main, locales),
  supporting: inLocales(ENGLISH_LABELS.supporting, locales),
  individual: inLocales(ENGLISH_LABELS.individual, locales),
});
const presetResponses = (locales: readonly ClassLocale[]): ThresholdResponseJson[] =>
  ENGLISH_RESPONSES.map((r) => ({ ...structuredClone(r), label: inLocales(r.label, locales), message: inLocales(r.message, locales) })) as ThresholdResponseJson[];

function englishPresetRow(contextId: string, uid: string, now: number, sortOrder: number, locales: readonly ClassLocale[]): CounterRow {
  return {
    id: newId(),
    contextId,
    kind: 'english_reminders',
    labelsJson: presetLabels(locales),
    scope: 'both',
    barSegments: 10,
    studentResetPeriod: 'week',
    studentThresholdsJson: [...ENGLISH_THRESHOLDS],
    responsesJson: presetResponses(locales),
    activeResponseId: ENGLISH_ACTIVE_RESPONSE,
    colour: 'accent',
    sortOrder,
    archivedAt: null,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * First use of the Counters module in an English class+subject creates the English reminder preset
 * (CNT-1). It happens once: as soon as the context has any counter row (even archived), nothing is
 * created again, so archiving the preset is respected. Other subjects start without counters and
 * can add the preset on request (createEnglishPreset). Nothing is created in an archived class or
 * school year, so polling a read-only year never writes (assertClassWritable rule, DAT-1).
 */
export function ensureDefaultCounters(ctx: RequestContext, context: ContextRow, cls: ClassRow): void {
  if (!isModuleEnabled(ctx.db, context.id, 'counters')) return;
  const any = ctx.db.select({ id: counters.id }).from(counters).where(eq(counters.contextId, context.id)).limit(1).get();
  if (any) return;
  if (!isEnglishSubject(subjectName(ctx.db, context))) return;
  // Archived classes and archived school years are read-only (DAT-1): reads never create the preset there.
  if (cls.archivedAt || getYear(ctx.db, cls.schoolYearId).archivedAt) return;
  tx(ctx.db, () => {
    if (ctx.db.select({ id: counters.id }).from(counters).where(eq(counters.contextId, context.id)).limit(1).get()) return;
    const now = ctx.now();
    const row = englishPresetRow(context.id, context.teacherId, now, 0, seedLocales(cls));
    ctx.db.insert(counters).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'counter.create', entity: 'counter', entityId: row.id, after: { contextId: context.id, kind: row.kind, auto: true } }, now);
  });
}

/**
 * `onClassLanguageChanged` listener (S20d, D-172): labels and threshold responses of the English
 * reminder preset that the teacher never changed get the language just switched on; edited ones are
 * left alone (the editor marks them "Needs translation").
 */
export function completePresetLabels(ctx: RequestContext, cls: ClassRow): void {
  const locales = seedLocales(cls);
  let changed = 0;
  for (const context of ctx.db.select().from(teachingContexts).where(eq(teachingContexts.classId, cls.id)).all()) {
    for (const row of ctx.db.select().from(counters).where(and(eq(counters.contextId, context.id), eq(counters.kind, 'english_reminders'))).all()) {
      let dirty = false;
      const fill = (stored: LocalizedTextValue, seeded: LocalizedTextValue) => {
        const done = completeDefault(stored, seeded, locales);
        if (!done) return stored;
        dirty = true;
        return done;
      };
      const labelsJson: CounterLabelsJson = {
        main: fill(row.labelsJson.main, ENGLISH_LABELS.main),
        supporting: fill(row.labelsJson.supporting, ENGLISH_LABELS.supporting),
        individual: fill(row.labelsJson.individual, ENGLISH_LABELS.individual),
      };
      const responsesJson = row.responsesJson.map((r) => {
        const seeded = ENGLISH_RESPONSES.find((d) => d.id === r.id);
        return seeded ? { ...r, label: fill(r.label, seeded.label), message: fill(r.message, seeded.message) } : r;
      });
      if (!dirty) continue;
      ctx.db.update(counters).set({ labelsJson, responsesJson, updatedAt: ctx.now() }).where(eq(counters.id, row.id)).run();
      changed++;
    }
  }
  if (changed) audit(ctx.db, ctx.actor, { action: 'counter.defaults_translated', entity: 'class', entityId: cls.id, after: { counters: changed, locales } }, ctx.now());
}

function ownCounter(ctx: RequestContext, counterId: string): { counter: CounterRow; context: ContextRow } {
  const counter = ctx.db.select().from(counters).where(eq(counters.id, counterId)).get();
  if (!counter) throw notFound('Counter');
  const context = assertOwnsContext(ctx, counter.contextId);
  return { counter, context };
}

const getCounter = (db: Db, id: string) => db.select().from(counters).where(eq(counters.id, id)).get()!;

// ---------------------------------------------------------------- periods & counts
interface Period {
  from: string;
  to: string;
}

/** The current counting period of individual counts for local day `today` (CNT-6/7, CNT-12). */
function periodFor(db: Db, counter: CounterRow, cls: ClassRow, today: string, weekStartsOn: number): Period | null {
  if (counter.studentResetPeriod === 'never') return null;
  if (counter.studentResetPeriod === 'week') {
    const from = weekStartOfDate(today, weekStartsOn);
    return { from, to: weekEndOf(from) };
  }
  // Term: the term of the class's school year containing today; without one, the whole school year.
  const yearTerms = db.select().from(terms).where(eq(terms.schoolYearId, cls.schoolYearId)).all();
  const term = yearTerms.find((t) => t.startsOn <= today && today <= t.endsOn);
  if (term) return { from: term.startsOn, to: term.endsOn };
  const year = getYear(db, cls.schoolYearId);
  return { from: year.startsOn, to: year.endsOn };
}

/** Live counts per student of one counter in a period (week periods use the stored weekStart). */
function studentCounts(db: Db, counter: CounterRow, period: Period | null, weekStartsOn: number, studentIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (studentIds.length === 0) return out;
  const conds = [eq(counterEvents.counterId, counter.id), isNull(counterEvents.voidedAt), inArray(counterEvents.studentId, studentIds)];
  if (period) {
    if (counter.studentResetPeriod === 'week' && period.from === weekStartOfDate(period.from, weekStartsOn)) conds.push(eq(counterEvents.weekStart, period.from));
    else conds.push(sql`${counterEvents.localDate} between ${period.from} and ${period.to}`);
  }
  const rows = db
    .select({ studentId: counterEvents.studentId, n: sql<number>`count(*)` })
    .from(counterEvents)
    .where(and(...conds))
    .groupBy(counterEvents.studentId)
    .all();
  for (const r of rows) if (r.studentId) out.set(r.studentId, Number(r.n));
  return out;
}

/**
 * The classroom student card (S14e2, D-154): the student's counts of the per-student counters in their
 * current periods, the same numbers the card's reminder boxes show, and only while those boxes are on
 * (D-143). Nothing when the boxes are off or the class+subject has no per-student counter.
 */
export function countersCard(ctx: RequestContext, input: ClassroomCardInput): Extract<ClassroomCardItem, { key: 'counters' }>['data'] | null {
  if (moduleConfig(ctx.db, input.context.id, 'counters').showReminderBoxes === false) return null;
  const weekStartsOn = getSchoolSettings(ctx.db).weekStartsOn;
  const list = countersOf(ctx.db, input.context.id)
    .filter((c) => c.scope !== 'lesson')
    .map((c) => ({
      id: c.id,
      labels: c.labelsJson,
      colour: c.colour as CounterColour,
      count: studentCounts(ctx.db, c, periodFor(ctx.db, c, input.cls, input.today, weekStartsOn), weekStartsOn, [input.studentId]).get(input.studentId) ?? 0,
    }));
  return list.length ? { counters: list } : null;
}

interface BarState {
  lessonTotal: number;
  barValue: number;
  openSeq: number | null;
  openCrossedAt: number | null;
  lastSeq: number;
  maxEventSeq: number;
}

function barState(db: Db, counterId: string, lessonId: string): BarState {
  const events = db
    .select({ seq: counterEvents.seq, voidedAt: counterEvents.voidedAt })
    .from(counterEvents)
    .where(and(eq(counterEvents.counterId, counterId), eq(counterEvents.lessonId, lessonId)))
    .all();
  const reset = db
    .select({ afterSeq: counterLessonResets.afterSeq })
    .from(counterLessonResets)
    .where(and(eq(counterLessonResets.counterId, counterId), eq(counterLessonResets.lessonId, lessonId), isNull(counterLessonResets.undoneAt)))
    .orderBy(desc(counterLessonResets.afterSeq), desc(counterLessonResets.resetAt))
    .limit(1)
    .get();
  const { lessonTotal, barValue } = lessonCounts(
    events.map((e) => ({ seq: e.seq, voided: e.voidedAt !== null })),
    reset ? reset.afterSeq : null,
  );
  const crossings = db
    .select()
    .from(thresholdCrossings)
    .where(and(eq(thresholdCrossings.counterId, counterId), eq(thresholdCrossings.lessonId, lessonId)))
    .all();
  const open = crossings.find((c) => c.clearedAt === null) ?? null;
  return {
    lessonTotal,
    barValue,
    openSeq: open?.crossingSeq ?? null,
    openCrossedAt: open?.crossedAt ?? null,
    lastSeq: crossings.reduce((m, c) => Math.max(m, c.crossingSeq), 0),
    maxEventSeq: events.reduce((m, e) => Math.max(m, e.seq), 0),
  };
}

/**
 * Bring the lesson's threshold state in line with its bar (D-004): open a crossing when the bar
 * reached the limit, clear the open one when it fell below. Returns whether a crossing opened.
 */
function reconcileCrossing(ctx: RequestContext, counter: CounterRow, lessonId: string, reason: 'void' | 'limit', eventId: string | null): { state: BarState; fired: boolean } {
  const state = barState(ctx.db, counter.id, lessonId);
  if (counter.scope === 'student') return { state, fired: false };
  const action = crossingTransition(state.barValue, counter.barSegments, state.openSeq, state.lastSeq);
  const now = ctx.now();
  if (action.kind === 'open') {
    const lastLive =
      eventId ??
      ctx.db
        .select({ id: counterEvents.id })
        .from(counterEvents)
        .where(and(eq(counterEvents.counterId, counter.id), eq(counterEvents.lessonId, lessonId), isNull(counterEvents.voidedAt)))
        .orderBy(desc(counterEvents.seq))
        .limit(1)
        .get()?.id ??
      '';
    ctx.db
      .insert(thresholdCrossings)
      .values({ id: newId(), counterId: counter.id, lessonId, crossingSeq: action.seq, crossedAt: now, clearedAt: null, clearedReason: null, eventId: lastLive, responseId: counter.activeResponseId })
      .run();
    return { state: { ...state, openSeq: action.seq, openCrossedAt: now, lastSeq: action.seq }, fired: true };
  }
  if (action.kind === 'clear') {
    clearOpenCrossing(ctx, counter.id, lessonId, reason);
    return { state: { ...state, openSeq: null, openCrossedAt: null }, fired: false };
  }
  return { state, fired: false };
}

type ResetRow = typeof counterLessonResets.$inferSelect;

/** The latest class reset of the lesson that was not undone (the one the bar starts from). */
function latestReset(db: Db, counterId: string, lessonId: string): ResetRow | null {
  return (
    db
      .select()
      .from(counterLessonResets)
      .where(and(eq(counterLessonResets.counterId, counterId), eq(counterLessonResets.lessonId, lessonId), isNull(counterLessonResets.undoneAt)))
      .orderBy(desc(counterLessonResets.afterSeq), desc(counterLessonResets.resetAt))
      .limit(1)
      .get() ?? null
  );
}

/**
 * Why a class reset can no longer be undone (S22a, D-175), or null when it still can: it must be the
 * latest live reset of the lesson, younger than RESET_UNDO_MS, written by S22a or later (it stored the
 * bar it took away), and nothing may have been tapped or undone on the counter since.
 */
function resetUndoRefusal(db: Db, reset: ResetRow, now: number): 'RESET_UNDO_PASSED' | 'RESET_UNDO_AFTER_TAP' | null {
  if (reset.barValueBefore === null || now - reset.resetAt > RESET_UNDO_MS) return 'RESET_UNDO_PASSED';
  const latest = latestReset(db, reset.counterId, reset.lessonId);
  if (!latest || latest.id !== reset.id) return 'RESET_UNDO_AFTER_TAP';
  const sameLesson = and(eq(counterEvents.counterId, reset.counterId), eq(counterEvents.lessonId, reset.lessonId));
  // A tap after the reset (live or already undone) ends the Undo.
  const later = db.select({ id: counterEvents.id }).from(counterEvents).where(and(sameLesson, sql`${counterEvents.seq} > ${reset.afterSeq}`)).limit(1).get();
  if (later) return 'RESET_UNDO_AFTER_TAP';
  // So does undoing a tap that was on the bar the reset took away: Undo must bring back exactly that bar.
  const prev = db
    .select({ afterSeq: counterLessonResets.afterSeq })
    .from(counterLessonResets)
    .where(
      and(
        eq(counterLessonResets.counterId, reset.counterId),
        eq(counterLessonResets.lessonId, reset.lessonId),
        isNull(counterLessonResets.undoneAt),
        sql`${counterLessonResets.id} <> ${reset.id}`,
        sql`${counterLessonResets.afterSeq} <= ${reset.afterSeq}`,
      ),
    )
    .orderBy(desc(counterLessonResets.afterSeq))
    .limit(1)
    .get();
  const bar = db
    .select({ n: sql<number>`count(*)` })
    .from(counterEvents)
    .where(and(sameLesson, isNull(counterEvents.voidedAt), sql`${counterEvents.seq} > ${prev?.afterSeq ?? 0}`, sql`${counterEvents.seq} <= ${reset.afterSeq}`))
    .get();
  return Number(bar?.n ?? 0) === reset.barValueBefore ? null : 'RESET_UNDO_AFTER_TAP';
}

/** What the classroom needs to offer Undo for the lesson's latest class reset (null when it cannot be undone). */
function resetUndoState(db: Db, counterId: string, lessonId: string, now: number): CounterLessonState['resetUndo'] {
  const reset = latestReset(db, counterId, lessonId);
  if (!reset || reset.barValueBefore === null || resetUndoRefusal(db, reset, now)) return null;
  return { resetId: reset.id, until: reset.resetAt + RESET_UNDO_MS, barValue: reset.barValueBefore };
}

function clearOpenCrossing(ctx: RequestContext, counterId: string, lessonId: string, reason: 'void' | 'reset' | 'limit') {
  ctx.db
    .update(thresholdCrossings)
    .set({ clearedAt: ctx.now(), clearedReason: reason })
    .where(and(eq(thresholdCrossings.counterId, counterId), eq(thresholdCrossings.lessonId, lessonId), isNull(thresholdCrossings.clearedAt)))
    .run();
}

// ---------------------------------------------------------------- lesson state (classroom)
/** Changes whenever counter settings change (taps bump the lesson version instead). */
export function countersStamp(db: Db, contextId: string): string {
  const row = db
    .select({ n: sql<number>`count(*)`, m: max(counters.updatedAt) })
    .from(counters)
    .where(eq(counters.contextId, contextId))
    .get();
  return `${row?.n ?? 0}-${row?.m ?? 0}`;
}

export function countersLessonState(ctx: RequestContext, context: ContextRow, cls: ClassRow, lesson: LessonRow): CountersLessonState {
  const tz = effectiveTimezone(ctx.db, cls);
  const weekStartsOn = getSchoolSettings(ctx.db).weekStartsOn;
  const today = localDate(ctx.now(), tz);
  const weekStart = weekStartOf(ctx.now(), tz, weekStartsOn);
  const roster = rosterRowsOn(ctx.db, cls.id, lesson.localDate).map((r) => r.student.id);
  const list: CounterLessonState[] = countersOf(ctx.db, context.id).map((c) => {
    const st = barState(ctx.db, c.id, lesson.id);
    const reached = c.scope !== 'student' && st.barValue >= c.barSegments;
    const period = periodFor(ctx.db, c, cls, today, weekStartsOn);
    const counts = c.scope === 'lesson' ? new Map<string, number>() : studentCounts(ctx.db, c, period, weekStartsOn, roster);
    const active = c.responsesJson.find((r) => r.id === c.activeResponseId) ?? null;
    return {
      id: c.id,
      kind: c.kind,
      labels: c.labelsJson,
      scope: c.scope,
      barSegments: c.barSegments,
      colour: c.colour as CounterColour,
      resetPeriod: c.studentResetPeriod,
      thresholds: c.studentThresholdsJson,
      lessonTotal: st.lessonTotal,
      barValue: st.barValue,
      reached,
      crossingSeq: reached ? st.openSeq : null,
      crossingCount: st.lastSeq,
      crossedAt: reached ? st.openCrossedAt : null,
      activeResponse: active,
      resetUndo: c.scope === 'student' ? null : resetUndoState(ctx.db, c.id, lesson.id, ctx.now()),
      period,
      students:
        c.scope === 'lesson'
          ? []
          : roster.map((id) => {
              const count = counts.get(id) ?? 0;
              return { studentId: id, count, level: levelFor(count, c.studentThresholdsJson) };
            }),
    };
  });
  return { weekStart, weekEnd: weekEndOf(weekStart), counters: list, showReminderBoxes: moduleConfig(ctx.db, context.id, 'counters').showReminderBoxes !== false };
}

// ---------------------------------------------------------------- commands
function counterForLesson(ctx: RequestContext, contextId: string, counterId: string): CounterRow {
  const counter = ctx.db.select().from(counters).where(eq(counters.id, counterId)).get();
  if (!counter || counter.contextId !== contextId) throw new AppError('CONFLICT', 'This counter belongs to another class', { reason: 'WRONG_COUNTER' });
  if (counter.archivedAt) throw new AppError('CONFLICT', 'This counter is archived', { reason: 'COUNTER_ARCHIVED' });
  return counter;
}

export function tap(ctx: RequestContext, p: P<'counter.tap'>, meta: CommandMeta) {
  const { context, cls, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'counters');
  const counter = counterForLesson(ctx, context.id, p.counterId);
  const studentId = p.studentId ?? null;
  if (counter.scope === 'student' && !studentId) throw invalid('Choose a student for this counter', { reason: 'STUDENT_REQUIRED' });
  if (counter.scope === 'lesson' && studentId) throw invalid('This counter counts for the whole class only', { reason: 'CLASS_ONLY_COUNTER' });
  if (studentId) {
    const attendanceOn = isModuleEnabled(ctx.db, context.id, 'attendance');
    const s = rosterWithAttendance(ctx.db, cls.id, lesson.localDate, lesson.id, attendanceOn).find((x) => x.id === studentId);
    if (!s) throw new AppError('CONFLICT', 'This student is not in the class on this day', { reason: 'STUDENT_NOT_IN_CLASS' });
    // Absent (or excused) students are not in the room and cannot receive taps.
    if (isAway(s.effective)) throw new AppError('CONFLICT', 'This student is marked absent for this lesson', { reason: 'STUDENT_ABSENT' });
  }
  const now = ctx.now();
  const tz = effectiveTimezone(ctx.db, cls);
  const weekStartsOn = getSchoolSettings(ctx.db).weekStartsOn;
  const before = barState(ctx.db, counter.id, lesson.id);
  const event: EventRow = {
    id: meta.opId,
    counterId: counter.id,
    contextId: context.id,
    lessonId: lesson.id,
    studentId,
    seq: before.maxEventSeq + 1,
    occurredAt: now,
    localDate: localDate(now, tz),
    weekStart: weekStartOf(now, tz, weekStartsOn),
    recordedBy: requireUser(ctx).id,
    voidedAt: null,
    voidedBy: null,
    voidOpId: null,
    labelSnapshotJson: { main: counter.labelsJson.main, individual: counter.labelsJson.individual },
  };
  ctx.db.insert(counterEvents).values(event).run();
  const { state, fired } = reconcileCrossing(ctx, counter, lesson.id, 'void', event.id);
  updateLesson(ctx, lesson, {});
  let studentCount: number | null = null;
  if (studentId) {
    const period = periodFor(ctx.db, counter, cls, localDate(now, tz), weekStartsOn);
    studentCount = studentCounts(ctx.db, counter, period, weekStartsOn, [studentId]).get(studentId) ?? 0;
  }
  return { eventId: event.id, lessonTotal: state.lessonTotal, barValue: state.barValue, reached: counter.scope !== 'student' && state.barValue >= counter.barSegments, fired, studentCount };
}

export function voidEvent(ctx: RequestContext, p: P<'counter.void'>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'counters');
  const event = ctx.db.select().from(counterEvents).where(eq(counterEvents.id, p.eventId)).get();
  // Only taps of THIS lesson of this class+subject can be undone from the classroom.
  if (!event || event.lessonId !== lesson.id || event.contextId !== context.id) {
    throw new AppError('CONFLICT', 'This tap does not belong to the current lesson', { reason: 'EVENT_NOT_IN_LESSON' });
  }
  const counter = getCounter(ctx.db, event.counterId);
  if (event.voidedAt !== null) {
    const st = barState(ctx.db, counter.id, lesson.id);
    return { eventId: event.id, alreadyVoided: true, lessonTotal: st.lessonTotal, barValue: st.barValue, reached: counter.scope !== 'student' && st.barValue >= counter.barSegments };
  }
  const now = ctx.now();
  const uid = requireUser(ctx).id;
  ctx.db.update(counterEvents).set({ voidedAt: now, voidedBy: uid, voidOpId: meta.opId }).where(eq(counterEvents.id, event.id)).run();
  audit(
    ctx.db,
    ctx.actor,
    { action: 'counter.void', entity: 'counter_event', entityId: event.id, before: { counterId: counter.id, lessonId: lesson.id, studentId: event.studentId, voided: false }, after: { voided: true }, opId: meta.opId },
    now,
  );
  const { state } = reconcileCrossing(ctx, counter, lesson.id, 'void', null);
  updateLesson(ctx, lesson, {});
  return { eventId: event.id, alreadyVoided: false, lessonTotal: state.lessonTotal, barValue: state.barValue, reached: counter.scope !== 'student' && state.barValue >= counter.barSegments };
}

export function resetLessonBar(ctx: RequestContext, p: P<'counter.resetLessonBar'>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'counters');
  const counter = counterForLesson(ctx, context.id, p.counterId);
  const active = counter.responsesJson.find((r) => r.id === counter.activeResponseId);
  if (counter.scope === 'student' || active?.kind !== 'class_reset') {
    throw new AppError('CONFLICT', 'Class reset is not the selected threshold response', { reason: 'RESET_NOT_ENABLED' });
  }
  const st = barState(ctx.db, counter.id, lesson.id);
  const now = ctx.now();
  // What the reset takes away is stored with it, so Undo can bring exactly that back (S22a, D-175).
  const open = ctx.db
    .select({ id: thresholdCrossings.id })
    .from(thresholdCrossings)
    .where(and(eq(thresholdCrossings.counterId, counter.id), eq(thresholdCrossings.lessonId, lesson.id), isNull(thresholdCrossings.clearedAt)))
    .get();
  ctx.db
    .insert(counterLessonResets)
    .values({ id: meta.opId, counterId: counter.id, lessonId: lesson.id, afterSeq: st.maxEventSeq, resetAt: now, resetBy: requireUser(ctx).id, barValueBefore: st.barValue, clearedCrossingId: open?.id ?? null })
    .run();
  clearOpenCrossing(ctx, counter.id, lesson.id, 'reset');
  audit(ctx.db, ctx.actor, { action: 'counter.reset_bar', entity: 'counter', entityId: counter.id, before: { lessonId: lesson.id, barValue: st.barValue }, after: { barValue: 0 }, opId: meta.opId }, now);
  updateLesson(ctx, lesson, {});
  return { counterId: counter.id, lessonTotal: st.lessonTotal, barValue: 0 };
}

/**
 * Undo a class reset (S22a, D-175; refines D-058): the reset marker is kept but marked undone, so the
 * bar counts from the previous marker again, and the crossing the reset cleared is open again (the
 * same crossing number, so no device shows the overlay or plays the sound a second time). Only the
 * lesson's latest reset, within RESET_UNDO_MS and before any later tap or tap undo on the counter.
 * A repeated Undo of the same reset changes nothing.
 */
export function undoResetLessonBar(ctx: RequestContext, p: P<'counter.undoReset'>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'counters');
  const counter = counterForLesson(ctx, context.id, p.counterId);
  const reset = ctx.db.select().from(counterLessonResets).where(eq(counterLessonResets.id, p.resetId)).get();
  if (!reset || reset.counterId !== counter.id || reset.lessonId !== lesson.id) {
    throw new AppError('CONFLICT', 'This reset does not belong to the current lesson', { reason: 'RESET_NOT_IN_LESSON' });
  }
  const result = (alreadyUndone: boolean) => {
    const st = barState(ctx.db, counter.id, lesson.id);
    return { counterId: counter.id, alreadyUndone, lessonTotal: st.lessonTotal, barValue: st.barValue, reached: counter.scope !== 'student' && st.barValue >= counter.barSegments };
  };
  if (reset.undoneAt !== null) return result(true);
  const now = ctx.now();
  const refusal = resetUndoRefusal(ctx.db, reset, now);
  if (refusal === 'RESET_UNDO_PASSED') throw new AppError('CONFLICT', 'The class reset can only be undone for 10 minutes', { reason: refusal });
  if (refusal) throw new AppError('CONFLICT', 'The counter was used after the reset, so the reset stays', { reason: refusal });
  ctx.db.update(counterLessonResets).set({ undoneAt: now, undoneBy: requireUser(ctx).id, undoOpId: meta.opId }).where(eq(counterLessonResets.id, reset.id)).run();
  if (reset.clearedCrossingId) {
    ctx.db
      .update(thresholdCrossings)
      .set({ clearedAt: null, clearedReason: null })
      .where(and(eq(thresholdCrossings.id, reset.clearedCrossingId), eq(thresholdCrossings.clearedReason, 'reset')))
      .run();
  }
  // The limit may have changed since the reset: the crossing follows the bar as always (D-004).
  reconcileCrossing(ctx, counter, lesson.id, 'limit', null);
  const after = result(false);
  audit(
    ctx.db,
    ctx.actor,
    { action: 'counter.reset_undo', entity: 'counter', entityId: counter.id, before: { lessonId: lesson.id, resetId: reset.id, barValue: 0 }, after: { barValue: after.barValue }, opId: meta.opId },
    now,
  );
  updateLesson(ctx, lesson, {});
  return after;
}

// ---------------------------------------------------------------- teacher settings
export function listCounters(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  ensureDefaultCounters(ctx, context, getClass(ctx.db, context.classId));
  return {
    englishSubject: isEnglishSubject(subjectName(ctx.db, context)),
    enabled: isModuleEnabled(ctx.db, context.id, 'counters'),
    counters: countersOf(ctx.db, context.id, true).map(configDto),
  };
}

function writableContext(ctx: RequestContext, contextId: string): ContextRow {
  const context = assertOwnsContext(ctx, contextId);
  assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
  return context;
}

export function createCounter(ctx: RequestContext, input: In<typeof C.createCounter>) {
  return tx(ctx.db, () => {
    const context = writableContext(ctx, input.contextId);
    // The English preset comes first in an English class+subject, even if a custom counter is made before any lesson.
    ensureDefaultCounters(ctx, context, getClass(ctx.db, context.classId));
    const now = ctx.now();
    const name = cleanText(input.name);
    const responses = cleanResponses(input.responses);
    const activeResponseId = input.activeResponseId ?? null;
    assertActiveResponse(responses, activeResponseId);
    const row: CounterRow = {
      id: newId(),
      contextId: context.id,
      kind: 'custom',
      labelsJson: customLabels(name) as CounterLabelsJson,
      scope: input.scope,
      barSegments: input.barSegments,
      studentResetPeriod: input.resetPeriod,
      studentThresholdsJson: input.thresholds,
      responsesJson: responses,
      activeResponseId,
      colour: input.colour,
      sortOrder: nextSortOrder(ctx.db, context.id),
      archivedAt: null,
      createdBy: requireUser(ctx).id,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.insert(counters).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'counter.create', entity: 'counter', entityId: row.id, after: { contextId: context.id, kind: row.kind, name, scope: row.scope } }, now);
    return configDto(row);
  });
}

export function createEnglishPreset(ctx: RequestContext, contextId: string) {
  return tx(ctx.db, () => {
    const context = writableContext(ctx, contextId);
    const existing = countersOf(ctx.db, context.id).find((c) => c.kind === 'english_reminders');
    if (existing) throw new AppError('CONFLICT', 'This class already has the English reminder counter', { reason: 'ENGLISH_PRESET_EXISTS' });
    const now = ctx.now();
    const row = englishPresetRow(context.id, requireUser(ctx).id, now, nextSortOrder(ctx.db, context.id), seedLocales(getClass(ctx.db, context.classId)));
    ctx.db.insert(counters).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'counter.create', entity: 'counter', entityId: row.id, after: { contextId: context.id, kind: row.kind } }, now);
    return configDto(row);
  });
}

export function updateCounter(ctx: RequestContext, input: In<typeof C.updateCounter>) {
  return tx(ctx.db, () => {
    const { counter, context } = ownCounter(ctx, input.counterId);
    const cls = getClass(ctx.db, context.classId);
    assertClassWritable(ctx.db, cls);
    if (counter.archivedAt) throw new AppError('CONFLICT', 'This counter is archived', { reason: 'COUNTER_ARCHIVED' });
    const patch: Partial<CounterRow> = { updatedAt: ctx.now() };
    if (input.labels) patch.labelsJson = cleanLabels(input.labels);
    if (input.scope) patch.scope = input.scope;
    if (input.barSegments !== undefined) patch.barSegments = input.barSegments;
    if (input.resetPeriod) patch.studentResetPeriod = input.resetPeriod;
    if (input.thresholds) patch.studentThresholdsJson = input.thresholds;
    if (input.colour) patch.colour = input.colour;
    const responses = input.responses ? cleanResponses(input.responses) : counter.responsesJson;
    if (input.responses) patch.responsesJson = responses;
    if (input.activeResponseId !== undefined) {
      assertActiveResponse(responses, input.activeResponseId);
      patch.activeResponseId = input.activeResponseId;
    } else if (counter.activeResponseId && !responses.some((r) => r.id === counter.activeResponseId)) {
      patch.activeResponseId = null;
    }
    ctx.db.update(counters).set(patch).where(eq(counters.id, counter.id)).run();
    const after = getCounter(ctx.db, counter.id);
    // A new limit or scope applies to the running lesson right away; its threshold state follows (D-004).
    const lesson = getActiveLesson(ctx.db, context.id);
    if (lesson && (after.barSegments !== counter.barSegments || after.scope !== counter.scope)) {
      if (after.scope === 'student') clearOpenCrossing(ctx, after.id, lesson.id, 'limit');
      else reconcileCrossing(ctx, after, lesson.id, 'limit', null);
      updateLesson(ctx, lesson, {});
    }
    audit(ctx.db, ctx.actor, { action: 'counter.update', entity: 'counter', entityId: counter.id, before: configDto(counter), after: configDto(after) }, ctx.now());
    return configDto(after);
  });
}

export function setCounterArchived(ctx: RequestContext, counterId: string, archived: boolean) {
  return tx(ctx.db, () => {
    const { counter, context } = ownCounter(ctx, counterId);
    assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
    if ((counter.archivedAt !== null) !== archived) {
      const now = ctx.now();
      ctx.db.update(counters).set({ archivedAt: archived ? now : null, updatedAt: now }).where(eq(counters.id, counter.id)).run();
      audit(ctx.db, ctx.actor, { action: archived ? 'counter.archive' : 'counter.unarchive', entity: 'counter', entityId: counter.id }, now);
    }
    return configDto(getCounter(ctx.db, counter.id));
  });
}

// ---------------------------------------------------------------- history (teacher area)
export function counterHistory(ctx: RequestContext, input: In<typeof C.counterHistory>) {
  const { counter, context } = ownCounter(ctx, input.counterId);
  const cls = getClass(ctx.db, context.classId);
  const tz = effectiveTimezone(ctx.db, cls);
  const weekStartsOn = getSchoolSettings(ctx.db).weekStartsOn;
  const until = input.until ?? localDate(ctx.now(), tz);
  const last = weekStartOfDate(until, weekStartsOn);
  const weekStarts = Array.from({ length: input.weeks }, (_, i) => addDays(last, -7 * i));
  const events = ctx.db
    .select()
    .from(counterEvents)
    .where(and(eq(counterEvents.counterId, counter.id), inArray(counterEvents.weekStart, weekStarts)))
    .all();
  const first = weekStarts[weekStarts.length - 1]!;
  const lessonRows = ctx.db
    .select({ localDate: lessons.localDate })
    .from(lessons)
    .where(and(eq(lessons.contextId, context.id), sql`${lessons.localDate} between ${first} and ${weekEndOf(last)}`))
    .all();

  // Who was in the class during each week (date-aware enrolments, D-027): a student outside the class
  // that week is "not enrolled", not 0 (RPT-5). Students enrolled in any listed week are shown.
  const classEnrolments = ctx.db
    .select({ studentId: enrolments.studentId, fromDate: enrolments.fromDate, toDate: enrolments.toDate })
    .from(enrolments)
    .where(and(eq(enrolments.classId, cls.id), sql`${enrolments.fromDate} <= ${weekEndOf(last)}`, sql`(${enrolments.toDate} is null or ${enrolments.toDate} > ${first})`))
    .all();
  const enrolledIn = (ws: string) => {
    const we = weekEndOf(ws);
    return [...new Set(classEnrolments.filter((r) => r.fromDate <= we && (r.toDate === null || r.toDate > ws)).map((r) => r.studentId))];
  };
  const ids = new Set(rosterRowsOn(ctx.db, cls.id, until).map((r) => r.student.id));
  for (const r of classEnrolments) ids.add(r.studentId);
  for (const e of events) if (e.studentId) ids.add(e.studentId);
  const people = ids.size ? ctx.db.select().from(students).where(inArray(students.id, [...ids])).all() : [];

  const weeks = weekStarts.map((ws) => {
    const we = weekEndOf(ws);
    const inWeek = events.filter((e) => e.weekStart === ws);
    const live = inWeek.filter((e) => e.voidedAt === null);
    const counts: Record<string, number> = {};
    for (const e of live) if (e.studentId) counts[e.studentId] = (counts[e.studentId] ?? 0) + 1;
    const labels = new Map<string, LocalizedTextValue>();
    for (const e of inWeek) labels.set(JSON.stringify(e.labelSnapshotJson.individual), e.labelSnapshotJson.individual);
    return {
      weekStart: ws,
      weekEnd: we,
      lessons: lessonRows.filter((l) => l.localDate >= ws && l.localDate <= we).length,
      total: live.length,
      classOnly: live.filter((e) => e.studentId === null).length,
      voided: inWeek.length - live.length,
      counts,
      enrolled: enrolledIn(ws),
      labelsUsed: [...labels.values()],
    };
  });
  return {
    counter: { id: counter.id, labels: counter.labelsJson, archived: counter.archivedAt !== null, resetPeriod: counter.studentResetPeriod, thresholds: counter.studentThresholdsJson },
    timezone: tz,
    weekStartsOn,
    students: sortByName(people, (s) => s.fullName).map((s) => ({ id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue })),
    weeks,
  };
}
