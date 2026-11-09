/**
 * Assistant duty ticks (S13a, D-100): on the classroom screen the teacher ticks each responsibility
 * today's assistant has done, with large tick boxes. Ticks are outbox commands, recorded per day
 * (`assistant_duty_checks`), shown in the assistant history and the report. Unticking keeps the row
 * (`uncheckedAt`), so the history shows what happened; ticking again revives it.
 *
 * S14b (D-149): the same ticks can be given on the Start Lesson screen (the assistant start step,
 * part of 'lesson.start') and on the End Lesson thank-you step (live 'assistant.checkDuty' commands).
 * Both go through `setDutyCheck`.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { AssistantCommands, AssistantStartStepInput } from '../../../shared/contracts/assistant.ts';
import type { StartStepNotes } from '../../../shared/contracts/lessons.ts';
import { assistantDutyChecks, assistantResponsibilities } from '../../db/schema.ts';
import type { Db } from '../../db/client.ts';
import { emitStudentActivity } from '../../lib/activity.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import type { LessonRow } from '../lessons/endSteps.ts';
import { lessonForCommand } from '../lessons/service.ts';
import { assertModuleEnabled } from '../school/modules.ts';
import { assertOwnsContext, type ContextRow } from '../school/policy.ts';
import { ensureToday } from './service.ts';

type CheckRow = typeof assistantDutyChecks.$inferSelect;

/** Live ticks of a context on some days (unticked rows left out). */
export function checksOn(db: Db, contextId: string, dates: readonly string[]): CheckRow[] {
  if (!dates.length) return [];
  return db
    .select()
    .from(assistantDutyChecks)
    .where(and(eq(assistantDutyChecks.contextId, contextId), inArray(assistantDutyChecks.localDate, [...dates])))
    .all()
    .filter((r) => r.uncheckedAt === null);
}

/** A live responsibility of this class+subject, or null. */
function liveResponsibility(db: Db, contextId: string, responsibilityId: string) {
  const resp = db.select().from(assistantResponsibilities).where(eq(assistantResponsibilities.id, responsibilityId)).get();
  return resp && resp.contextId === contextId && resp.archivedAt === null ? resp : null;
}

/**
 * Tick or untick one responsibility for `studentId` on `today` (audited, emits student activity).
 * The caller has checked that the student is today's assistant. `id` names a new row.
 */
export function setDutyCheck(ctx: RequestContext, ctxRow: ContextRow, today: string, studentId: string, responsibilityId: string, checked: boolean, opId: string, id: string): { changed: boolean } {
  const existing = ctx.db
    .select()
    .from(assistantDutyChecks)
    .where(and(eq(assistantDutyChecks.contextId, ctxRow.id), eq(assistantDutyChecks.localDate, today), eq(assistantDutyChecks.studentId, studentId), eq(assistantDutyChecks.responsibilityId, responsibilityId)))
    .get();
  const now = ctx.now();
  const uid = requireUser(ctx).id;
  const isOn = Boolean(existing && existing.uncheckedAt === null);
  if (isOn === checked) return { changed: false };
  if (!existing) ctx.db.insert(assistantDutyChecks).values({ id, contextId: ctxRow.id, localDate: today, studentId, responsibilityId, checkedAt: now, checkedBy: uid, uncheckedAt: null }).run();
  else if (checked) ctx.db.update(assistantDutyChecks).set({ checkedAt: now, checkedBy: uid, uncheckedAt: null }).where(eq(assistantDutyChecks.id, existing.id)).run();
  else ctx.db.update(assistantDutyChecks).set({ uncheckedAt: now }).where(eq(assistantDutyChecks.id, existing.id)).run();
  audit(ctx.db, ctx.actor, { action: checked ? 'assistant.duty_check' : 'assistant.duty_uncheck', entity: 'teaching_context', entityId: ctxRow.id, opId, after: { date: today, studentId, responsibilityId } }, now);
  emitStudentActivity(ctx, { source: 'assistant', studentIds: [studentId], contextId: ctxRow.id });
  return { changed: true };
}

/** Today's assistant (after absence carry-forward), or null. */
function todaysAssistant(ctx: RequestContext, ctxRow: ContextRow) {
  const { today, row } = ensureToday(ctx, ctxRow);
  return { today, studentId: row ? (row.actualStudentId ?? row.plannedStudentId) : null };
}

/** 'assistant.checkDuty': tick or untick one responsibility for today's assistant. */
export function checkDuty(ctx: RequestContext, p: z.infer<(typeof AssistantCommands)['assistant.checkDuty']>, meta: CommandMeta) {
  const { context: ctxRow, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, ctxRow.id, 'assistant');
  const resp = liveResponsibility(ctx.db, ctxRow.id, p.responsibilityId);
  if (!resp) throw new AppError('NOT_FOUND', 'Responsibility not found', { reason: 'RESPONSIBILITY_NOT_FOUND' });
  const { today, studentId } = todaysAssistant(ctx, ctxRow);
  if (!studentId || lesson.localDate !== today) throw new AppError('CONFLICT', 'There is no assistant today', { reason: 'NO_ASSISTANT_TODAY' });
  const { changed } = setDutyCheck(ctx, ctxRow, today, studentId, resp.id, p.checked, meta.opId, meta.opId);
  return { checked: p.checked, changed };
}

/**
 * Start Lesson step 'assistant' (S14b, D-149): the duties ticked (and unticked) on the start screen
 * for the assistant the screen showed. Applied only if that student is still today's assistant after
 * the start-screen attendance (an absence moves the turn, D-065); otherwise every change (tick or
 * untick) is dropped and counted in the start result as `dutiesDropped`. A change for a responsibility
 * removed meanwhile is left out and counted apart as `dutiesSkipped`, so the classroom can name the
 * right reason. Runs on a resumed lesson as well (per-day data).
 */
export function assistantStartStep(ctx: RequestContext, lesson: LessonRow, data: z.infer<typeof AssistantStartStepInput>, info: { opId: string }): StartStepNotes {
  const ctxRow = assertOwnsContext(ctx, lesson.contextId);
  const wanted = [...data.check.map((id) => [id, true] as const), ...data.uncheck.filter((id) => !data.check.includes(id)).map((id) => [id, false] as const)];
  if (!wanted.length) return {};
  const { today, studentId } = todaysAssistant(ctx, ctxRow);
  if (!studentId || studentId !== data.studentId || lesson.localDate !== today) return { dutiesDropped: wanted.length };
  let skipped = 0;
  for (const [responsibilityId, checked] of wanted) {
    if (!liveResponsibility(ctx.db, ctxRow.id, responsibilityId)) {
      skipped += 1;
      continue;
    }
    setDutyCheck(ctx, ctxRow, today, studentId, responsibilityId, checked, info.opId, newId());
  }
  return skipped ? { dutiesSkipped: skipped } : {};
}
