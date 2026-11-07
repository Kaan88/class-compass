/**
 * Secret Students (S7: SEC-1..7, LES-2/3, D-007, D-010, D-062, D-064).
 *
 * SECRECY BOUNDARY (SEC-3): this file is the only code that reads `secret_selections.studentId`
 * (tests/server/secret-boundary.test.ts enforces it). Before a round is revealed, every value that
 * leaves this module is a count: the classroom state, command results, audit entries and the ETag
 * stamp never depend on WHO was chosen. A chosen student marked absent is withdrawn and replaced
 * silently inside the attendance transaction (D-007): no audit row, no version bump, no change to
 * `selectedCount`; the replacement is reported only at the reveal.
 *
 * Fair rotation (SEC-2, D-062): the fewest counted selections in this class+subject this school year
 * first, then the longest since the last one, then a random order. The tie-break seed is fresh
 * server-side randomness (`randomToken`) that is never stored, logged or returned, so nothing a
 * client knows (the round id = its own opId, the roster) can reproduce or steer the draw (SEC-3).
 * Replays stay stable without it: a replayed command returns its stored result and a lesson has
 * one live round. Counted:
 * sealed (live), revealed and unrevealed_abandoned (D-010). Not counted: withdrawn_absent and
 * withdrawn_redraw (the student never had the turn).
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { isAway } from '../../../domain/attendance.ts';
import { pickFair, seededRank } from '../../../domain/rotation.ts';
import type * as C from '../../../shared/contracts/secret.ts';
import { SECRET_DEFAULT_COUNT, SECRET_MAX_COUNT, type RevealedSelection, type SecretDrawResult, type SecretLessonState, type SecretReveal } from '../../../shared/contracts/secret.ts';
import { initials, sortByName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { lessons, secretRounds, secretSelections, students, teachingContexts } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId, randomToken } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { rosterWithAttendance, type AttendanceChange } from '../attendance/service.ts';
import type { LessonRow } from '../lessons/endSteps.ts';
import { lessonForCommand, updateLesson } from '../lessons/service.ts';
import { assertModuleEnabled, isModuleEnabled, mergeModuleConfig, moduleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, getClass, todayFor, type ContextRow } from '../school/policy.ts';

type P<T extends keyof typeof C.SecretCommands> = z.infer<(typeof C.SecretCommands)[T]>;
type RoundRow = typeof secretRounds.$inferSelect;
type SelectionRow = typeof secretSelections.$inferSelect;
type StudentRow = typeof students.$inferSelect;

/** Statuses that count as "had a secret turn" for the rotation (D-062). */
export const FAIRNESS_STATUSES = ['sealed', 'revealed', 'unrevealed_abandoned'] as const;

// ---------------------------------------------------------------- settings
/** The manifest default overlaid with a schema-valid stored count (D-069); an invalid stored value falls back to the default. */
export function configuredCount(db: Db, contextId: string): number {
  const n = moduleConfig(db, contextId, 'secretStudents').count;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= SECRET_MAX_COUNT ? n : SECRET_DEFAULT_COUNT;
}

export function getSettings(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  return { count: configuredCount(ctx.db, context.id) };
}

export function setSettings(ctx: RequestContext, contextId: string, count: number) {
  return tx(ctx.db, () => {
    const context = assertOwnsContext(ctx, contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
    const before = configuredCount(ctx.db, context.id);
    mergeModuleConfig(ctx.db, context.id, 'secretStudents', { count }, requireUser(ctx).id, ctx.now());
    audit(ctx.db, ctx.actor, { action: 'secret.settings', entity: 'teaching_context', entityId: context.id, before: { count: before }, after: { count } }, ctx.now());
    return { count };
  });
}

// ---------------------------------------------------------------- reads (counts only before the reveal)
export function liveRound(db: Db, lessonId: string): RoundRow | undefined {
  return db
    .select()
    .from(secretRounds)
    .where(and(eq(secretRounds.lessonId, lessonId), eq(secretRounds.status, 'live')))
    .get();
}

export function secretLessonState(db: Db, contextId: string, lesson: LessonRow | null): SecretLessonState {
  const round = lesson ? liveRound(db, lesson.id) : undefined;
  return {
    roundExists: Boolean(round),
    requestedCount: round?.requestedCount ?? 0,
    selectedCount: round?.selectedCount ?? 0,
    shortfall: round?.shortfallReason ?? null,
    revealed: Boolean(round?.revealedAt),
    configuredCount: configuredCount(db, contextId),
  };
}

/** ETag part: changes on draw/redraw/reveal and settings; never on a silent replacement. */
export function secretStamp(db: Db, contextId: string, lesson: LessonRow | null): string {
  const round = lesson ? liveRound(db, lesson.id) : undefined;
  return `${round?.id ?? '-'}:${round?.revealedAt ?? '-'}:${configuredCount(db, contextId)}`;
}

// ---------------------------------------------------------------- the draw
interface Candidate {
  id: string;
  count: number;
  last: number | null;
}

/** Students in the room for this lesson: present or late (D-062); everyone enrolled when attendance is off. */
function eligibleIds(db: Db, lesson: LessonRow): string[] {
  const attendanceOn = isModuleEnabled(db, lesson.contextId, 'attendance');
  const roster = rosterWithAttendance(db, lesson.classId, lesson.localDate, lesson.id, attendanceOn);
  return roster.filter((s) => !attendanceOn || s.effective === 'present' || s.effective === 'late').map((s) => s.id);
}

/** Counted selections per student in this context and school year (D-062). */
export function fairnessCounts(db: Db, contextId: string, schoolYearId: string): Map<string, { count: number; last: number }> {
  const rows = db
    .select({ studentId: secretSelections.studentId, selectedAt: secretSelections.selectedAt })
    .from(secretSelections)
    .innerJoin(secretRounds, eq(secretRounds.id, secretSelections.roundId))
    .where(and(eq(secretRounds.contextId, contextId), eq(secretRounds.schoolYearId, schoolYearId), inArray(secretSelections.status, [...FAIRNESS_STATUSES])))
    .all();
  const out = new Map<string, { count: number; last: number }>();
  for (const r of rows) {
    const cur = out.get(r.studentId) ?? { count: 0, last: 0 };
    out.set(r.studentId, { count: cur.count + 1, last: Math.max(cur.last, r.selectedAt) });
  }
  return out;
}

/** Secret tie-break seed: server-only randomness, never derived from client-visible values (SEC-3). */
const freshSeed = () => randomToken(16);

function choose(db: Db, contextId: string, schoolYearId: string, ids: string[], n: number): string[] {
  const seed = freshSeed();
  const counts = fairnessCounts(db, contextId, schoolYearId);
  const cands: Candidate[] = ids.map((id) => ({ id, count: counts.get(id)?.count ?? 0, last: counts.get(id)?.last ?? null }));
  return pickFair(cands, n, { count: (c) => c.count, last: (c) => c.last, tie: (a, b) => seededRank(seed, a.id) - seededRank(seed, b.id) || (a.id < b.id ? -1 : 1) }).map((c) => c.id);
}

const drawResult = (round: RoundRow, created: boolean): SecretDrawResult => ({
  roundId: round.id,
  created,
  requestedCount: round.requestedCount,
  selectedCount: round.selectedCount,
  shortfall: round.shortfallReason,
});

function createRound(ctx: RequestContext, context: ContextRow, lesson: LessonRow, roundId: string, opId: string): RoundRow {
  const cls = getClass(ctx.db, lesson.classId);
  const requested = configuredCount(ctx.db, context.id);
  const eligible = eligibleIds(ctx.db, lesson);
  const chosen = choose(ctx.db, context.id, cls.schoolYearId, eligible, requested);
  const now = ctx.now();
  const round: RoundRow = {
    id: roundId,
    contextId: context.id,
    lessonId: lesson.id,
    schoolYearId: cls.schoolYearId,
    localDate: lesson.localDate,
    status: 'live',
    requestedCount: requested,
    selectedCount: chosen.length,
    shortfallReason: eligible.length === 0 ? 'NO_ELIGIBLE' : chosen.length < requested ? 'NOT_ENOUGH_ELIGIBLE' : null,
    drawnAt: now,
    drawnBy: requireUser(ctx).id,
    revealedAt: null,
    withdrawnAt: null,
    opId,
  };
  ctx.db.insert(secretRounds).values(round).run();
  for (const studentId of chosen) {
    ctx.db.insert(secretSelections).values({ id: newId(), roundId, contextId: context.id, studentId, status: 'sealed', replacedSelectionId: null, outcome: null, note: null, celebration: false, selectedAt: now, updatedAt: now, outcomeBy: null }).run();
  }
  return round;
}

/** Counts only, never ids (SEC-3). */
const roundAudit = (r: RoundRow) => ({ lessonId: r.lessonId, roundId: r.id, requested: r.requestedCount, selected: r.selectedCount, shortfall: r.shortfallReason });

/**
 * 'secret.draw' (SEC-1/4): one live round per lesson. Drawing again (another device, a double tap,
 * a refresh) returns the existing round unchanged, so nothing is ever rerolled by accident (LES-2).
 */
export function draw(ctx: RequestContext, p: P<'secret.draw'>, meta: CommandMeta): SecretDrawResult {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'secretStudents');
  const existing = liveRound(ctx.db, lesson.id);
  if (existing) return drawResult(existing, false);
  const round = createRound(ctx, context, lesson, meta.opId, meta.opId);
  updateLesson(ctx, lesson, {});
  audit(ctx.db, ctx.actor, { action: 'secret.draw', entity: 'secret_round', entityId: round.id, after: roundAudit(round), opId: meta.opId }, ctx.now());
  return drawResult(round, true);
}

/** 'secret.redraw' (explicit + confirmed): withdraw the sealed round (audited) and draw a new one. */
export function redraw(ctx: RequestContext, p: P<'secret.redraw'>, meta: CommandMeta): SecretDrawResult {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'secretStudents');
  const old = liveRound(ctx.db, lesson.id);
  if (old?.revealedAt) throw new AppError('CONFLICT', 'The secret students were already revealed', { reason: 'SECRET_ALREADY_REVEALED' });
  const now = ctx.now();
  if (old) {
    ctx.db.update(secretRounds).set({ status: 'withdrawn', withdrawnAt: now }).where(eq(secretRounds.id, old.id)).run();
    ctx.db
      .update(secretSelections)
      .set({ status: 'withdrawn_redraw', updatedAt: now })
      .where(and(eq(secretSelections.roundId, old.id), eq(secretSelections.status, 'sealed')))
      .run();
  }
  const round = createRound(ctx, context, lesson, meta.opId, meta.opId);
  updateLesson(ctx, lesson, {});
  audit(ctx.db, ctx.actor, { action: 'secret.redraw', entity: 'secret_round', entityId: round.id, before: old ? roundAudit(old) : null, after: roundAudit(round), opId: meta.opId }, now);
  return drawResult(round, true);
}

// ---------------------------------------------------------------- silent absent replacement (D-007)
/**
 * Attendance listener: a chosen (sealed) student who is now away for a running lesson is withdrawn
 * and replaced by the next fair student in the room, in the same transaction. Nothing observable
 * changes: no audit row, no lesson version bump, the same `selectedCount` (SEC-3).
 */
export function onAttendanceChange(ctx: RequestContext, ch: AttendanceChange): void {
  const conds = [eq(lessons.classId, ch.classId), eq(lessons.localDate, ch.date), eq(lessons.status, 'active'), eq(secretRounds.status, 'live'), isNull(secretRounds.revealedAt)];
  if (ch.lessonId) conds.push(eq(lessons.id, ch.lessonId));
  const rows = ctx.db.select({ round: secretRounds, lesson: lessons }).from(secretRounds).innerJoin(lessons, eq(lessons.id, secretRounds.lessonId)).where(and(...conds)).all();
  for (const { round, lesson } of rows) {
    const sel = ctx.db
      .select()
      .from(secretSelections)
      .where(and(eq(secretSelections.roundId, round.id), eq(secretSelections.studentId, ch.studentId), eq(secretSelections.status, 'sealed')))
      .get();
    if (!sel) continue;
    const attendanceOn = isModuleEnabled(ctx.db, lesson.contextId, 'attendance');
    const me = rosterWithAttendance(ctx.db, lesson.classId, lesson.localDate, lesson.id, attendanceOn).find((s) => s.id === ch.studentId);
    if (me && !isAway(me.effective)) continue;
    const now = ctx.now();
    ctx.db.update(secretSelections).set({ status: 'withdrawn_absent', updatedAt: now }).where(eq(secretSelections.id, sel.id)).run();
    // Never the same student twice in one round: anyone already in it (in any status) is excluded.
    const inRound = new Set(ctx.db.select({ s: secretSelections.studentId }).from(secretSelections).where(eq(secretSelections.roundId, round.id)).all().map((r) => r.s));
    const pool = eligibleIds(ctx.db, lesson).filter((id) => !inRound.has(id));
    const [next] = choose(ctx.db, round.contextId, round.schoolYearId, pool, 1);
    if (next) {
      ctx.db.insert(secretSelections).values({ id: newId(), roundId: round.id, contextId: round.contextId, studentId: next, status: 'sealed', replacedSelectionId: sel.id, outcome: null, note: null, celebration: false, selectedAt: now, updatedAt: now, outcomeBy: null }).run();
    }
  }
}

// ---------------------------------------------------------------- reveal and outcomes
const studentDto = (s: StudentRow) => ({ id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue });

function studentsById(db: Db, ids: string[]): Map<string, StudentRow> {
  if (ids.length === 0) return new Map();
  return new Map(db.select().from(students).where(inArray(students.id, ids)).all().map((s) => [s.id, s]));
}

const selectionDto = (s: SelectionRow, st: StudentRow): RevealedSelection => ({
  selectionId: s.id,
  student: studentDto(st),
  outcome: s.outcome,
  note: s.note,
  celebration: s.celebration,
  replacedSelectionId: s.replacedSelectionId,
});

/** Names of a REVEALED round. Callers must have checked `revealedAt`. */
function revealDto(db: Db, round: RoundRow): SecretReveal {
  const sels = db.select().from(secretSelections).where(eq(secretSelections.roundId, round.id)).orderBy(asc(secretSelections.selectedAt), asc(secretSelections.id)).all();
  const byId = studentsById(db, sels.map((s) => s.studentId));
  const shown = sels.filter((s) => s.status === 'revealed');
  return {
    roundId: round.id,
    requestedCount: round.requestedCount,
    selectedCount: round.selectedCount,
    shortfall: round.shortfallReason,
    revealedAt: round.revealedAt ?? 0,
    selections: shown.map((s) => selectionDto(s, byId.get(s.studentId)!)),
    absent: sels
      .filter((s) => s.status === 'withdrawn_absent')
      .map((s) => ({ selectionId: s.id, student: studentDto(byId.get(s.studentId)!), replacedBy: shown.find((x) => x.replacedSelectionId === s.id)?.id ?? null })),
  };
}

function revealRound(ctx: RequestContext, round: RoundRow, opId: string | null): RoundRow {
  if (round.revealedAt) return round;
  const now = ctx.now();
  ctx.db.update(secretRounds).set({ revealedAt: now }).where(eq(secretRounds.id, round.id)).run();
  ctx.db
    .update(secretSelections)
    .set({ status: 'revealed', updatedAt: now })
    .where(and(eq(secretSelections.roundId, round.id), eq(secretSelections.status, 'sealed')))
    .run();
  const revealed = { ...round, revealedAt: now };
  // After the reveal the identities may be recorded (accountability, ACC-9), including replacements.
  const dto = revealDto(ctx.db, revealed);
  audit(
    ctx.db,
    ctx.actor,
    {
      action: 'secret.reveal',
      entity: 'secret_round',
      entityId: round.id,
      after: { ...roundAudit(revealed), revealed: dto.selections.map((s) => s.student.id), absentReplaced: dto.absent.map((a) => ({ studentId: a.student.id, replacedBy: a.replacedBy })) },
      opId,
    },
    now,
  );
  return revealed;
}

/** 'secret.reveal' (End Lesson, LES-3/SEC-5): reveals the live round of the active lesson and returns the names. */
export function reveal(ctx: RequestContext, p: P<'secret.reveal'>, meta: CommandMeta): SecretReveal {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'secretStudents');
  const round = liveRound(ctx.db, lesson.id);
  if (!round) throw new AppError('CONFLICT', 'No secret students were chosen in this lesson', { reason: 'NO_SECRET_ROUND' });
  const wasRevealed = Boolean(round.revealedAt);
  const revealed = revealRound(ctx, round, meta.opId);
  if (!wasRevealed) updateLesson(ctx, lesson, {});
  return revealDto(ctx.db, revealed);
}

function applyOutcome(ctx: RequestContext, round: RoundRow, o: { selectionId: string; outcome: SelectionRow['outcome'] & string; note?: string | null | undefined; celebration?: boolean | undefined }, opId: string | null) {
  const sel = ctx.db.select().from(secretSelections).where(eq(secretSelections.id, o.selectionId)).get();
  if (!sel || sel.roundId !== round.id || sel.status !== 'revealed') throw new AppError('CONFLICT', 'This secret student is not part of the revealed round', { reason: 'SECRET_SELECTION_UNKNOWN' });
  const note = o.note === undefined ? sel.note : o.note?.trim() ? o.note.trim() : null;
  const celebration = o.celebration ?? sel.celebration;
  const now = ctx.now();
  ctx.db.update(secretSelections).set({ outcome: o.outcome, note, celebration, outcomeBy: requireUser(ctx).id, updatedAt: now }).where(eq(secretSelections.id, sel.id)).run();
  audit(
    ctx.db,
    ctx.actor,
    { action: 'secret.outcome', entity: 'secret_selection', entityId: sel.id, before: { studentId: sel.studentId, outcome: sel.outcome, celebration: sel.celebration }, after: { studentId: sel.studentId, outcome: o.outcome, celebration, noted: note !== null }, opId },
    now,
  );
}

/** 'secret.recordOutcome' (SEC-5): Goal met / Still practising (/ not assessed), optional note and celebration. */
export function recordOutcome(ctx: RequestContext, p: P<'secret.recordOutcome'>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'secretStudents');
  const round = liveRound(ctx.db, lesson.id);
  if (!round?.revealedAt) throw new AppError('CONFLICT', 'Reveal the secret students first', { reason: 'SECRET_NOT_REVEALED' });
  applyOutcome(ctx, round, p, meta.opId);
  updateLesson(ctx, lesson, {});
  const sel = ctx.db.select().from(secretSelections).where(eq(secretSelections.id, p.selectionId)).get()!;
  return { selectionId: sel.id, outcome: sel.outcome, note: sel.note, celebration: sel.celebration };
}

/** End Lesson step: make sure the round is revealed, then apply outcomes sent with the end command. */
export function endStep(ctx: RequestContext, lesson: LessonRow, data: z.infer<typeof C.SecretEndStepInput>): void {
  const round = liveRound(ctx.db, lesson.id);
  if (!round) return;
  const revealed = revealRound(ctx, round, null);
  for (const o of data.outcomes ?? []) applyOutcome(ctx, revealed, o, null);
}

/**
 * Lesson close hook (D-010): a round that was never revealed (abandoned lesson, or the module was
 * switched off before End Lesson) is closed as `unrevealed_abandoned`. It still counts for the
 * rotation but is never shown as selected.
 */
export function onLessonClose(ctx: RequestContext, lesson: LessonRow, outcome: 'ended' | 'abandoned'): void {
  const round = liveRound(ctx.db, lesson.id);
  if (!round || round.revealedAt) return;
  const now = ctx.now();
  ctx.db
    .update(secretSelections)
    .set({ status: 'unrevealed_abandoned', updatedAt: now })
    .where(and(eq(secretSelections.roundId, round.id), eq(secretSelections.status, 'sealed')))
    .run();
  audit(ctx.db, ctx.actor, { action: 'secret.close_unrevealed', entity: 'secret_round', entityId: round.id, after: { ...roundAudit(round), lesson: outcome } }, now);
}

// ---------------------------------------------------------------- classroom read (today only)
export function lessonSecret(ctx: RequestContext, lessonId: string) {
  const lesson = ctx.db.select().from(lessons).where(eq(lessons.id, lessonId)).get();
  if (!lesson || lesson.teacherId !== requireUser(ctx).id) throw notFound('Lesson');
  const context = ctx.db.select().from(teachingContexts).where(eq(teachingContexts.id, lesson.contextId)).get();
  if (!context || context.endedAt !== null) throw notFound('Lesson');
  // Earlier days are teacher-area history (PIN-gated), like the reflection note (D-055).
  if (lesson.localDate < todayFor(ctx, getClass(ctx.db, lesson.classId))) throw notFound('Lesson');
  const round = liveRound(ctx.db, lesson.id);
  return { state: secretLessonState(ctx.db, context.id, lesson), reveal: round?.revealedAt ? revealDto(ctx.db, round) : null };
}

// ---------------------------------------------------------------- teacher history (SEC-6)
export function history(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const rounds = ctx.db
    .select()
    .from(secretRounds)
    .where(and(eq(secretRounds.contextId, context.id), eq(secretRounds.schoolYearId, cls.schoolYearId)))
    .orderBy(asc(secretRounds.drawnAt))
    .all();
  const revealedRounds = rounds.filter((r) => r.revealedAt !== null);
  const revealedIds = revealedRounds.map((r) => r.id);
  // Only selections of REVEALED rounds are read with their student (SEC-3, D-010).
  const sels = revealedIds.length
    ? ctx.db.select().from(secretSelections).where(inArray(secretSelections.roundId, revealedIds)).orderBy(asc(secretSelections.selectedAt), asc(secretSelections.id)).all()
    : [];
  const byStudent = studentsById(ctx.db, [...new Set(sels.map((s) => s.studentId))]);
  const stats = new Map<string, { revealed: number; goalMet: number; stillPractising: number; notAssessed: number; last: string | null }>();
  const roundDate = new Map(rounds.map((r) => [r.id, r.localDate]));
  for (const s of sels) {
    if (s.status !== 'revealed') continue;
    const cur = stats.get(s.studentId) ?? { revealed: 0, goalMet: 0, stillPractising: 0, notAssessed: 0, last: null };
    cur.revealed += 1;
    if (s.outcome === 'goal_met') cur.goalMet += 1;
    else if (s.outcome === 'still_practising') cur.stillPractising += 1;
    else cur.notAssessed += 1;
    const d = roundDate.get(s.roundId) ?? null;
    if (d && (!cur.last || d > cur.last)) cur.last = d;
    stats.set(s.studentId, cur);
  }
  const studentsOut = sortByName([...stats.entries()], ([id]) => byStudent.get(id)!.fullName).map(([id, st]) => ({
    student: studentDto(byStudent.get(id)!),
    revealed: st.revealed,
    goalMet: st.goalMet,
    stillPractising: st.stillPractising,
    notAssessed: st.notAssessed,
    lastRevealedDate: st.last,
  }));
  const roundsOut = rounds
    .map((r) => {
      const mine = r.revealedAt ? sels.filter((s) => s.roundId === r.id) : [];
      const state = r.status === 'withdrawn' ? ('withdrawn' as const) : r.revealedAt ? ('revealed' as const) : isLessonClosed(ctx.db, r.lessonId) ? ('abandoned' as const) : ('sealed' as const);
      return {
        roundId: r.id,
        lessonId: r.lessonId,
        localDate: r.localDate,
        requestedCount: r.requestedCount,
        selectedCount: r.selectedCount,
        shortfall: r.shortfallReason,
        state,
        selections: mine.filter((s) => s.status === 'revealed').map((s) => selectionDto(s, byStudent.get(s.studentId)!)),
        absent: mine.filter((s) => s.status === 'withdrawn_absent').map((s) => ({ student: studentDto(byStudent.get(s.studentId)!), replaced: mine.some((x) => x.replacedSelectionId === s.id) })),
      };
    })
    .reverse();
  return { students: studentsOut, rounds: roundsOut };
}

function isLessonClosed(db: Db, lessonId: string): boolean {
  return db.select({ s: lessons.status }).from(lessons).where(eq(lessons.id, lessonId)).get()?.s !== 'active';
}
