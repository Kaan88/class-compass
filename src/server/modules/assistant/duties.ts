/**
 * Assistant duty ticks (S13a, D-100): on the classroom screen the teacher ticks each responsibility
 * today's assistant has done, with large tick boxes. Ticks are outbox commands, recorded per day
 * (`assistant_duty_checks`), shown in the assistant history and the report. Unticking keeps the row
 * (`uncheckedAt`), so the history shows what happened; ticking again revives it.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { AssistantCommands } from '../../../shared/contracts/assistant.ts';
import { assistantDutyChecks, assistantResponsibilities } from '../../db/schema.ts';
import type { Db } from '../../db/client.ts';
import { emitStudentActivity } from '../../lib/activity.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { AppError } from '../../lib/errors.ts';
import { lessonForCommand } from '../lessons/service.ts';
import { assertModuleEnabled } from '../school/modules.ts';
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

/** 'assistant.checkDuty': tick or untick one responsibility for today's assistant. */
export function checkDuty(ctx: RequestContext, p: z.infer<(typeof AssistantCommands)['assistant.checkDuty']>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'assistant');
  const resp = ctx.db.select().from(assistantResponsibilities).where(eq(assistantResponsibilities.id, p.responsibilityId)).get();
  if (!resp || resp.contextId !== context.id || resp.archivedAt !== null) throw new AppError('NOT_FOUND', 'Responsibility not found', { reason: 'RESPONSIBILITY_NOT_FOUND' });
  const { today, row } = ensureToday(ctx, context);
  const studentId = row ? (row.actualStudentId ?? row.plannedStudentId) : null;
  if (!studentId || lesson.localDate !== today) throw new AppError('CONFLICT', 'There is no assistant today', { reason: 'NO_ASSISTANT_TODAY' });
  const existing = ctx.db
    .select()
    .from(assistantDutyChecks)
    .where(and(eq(assistantDutyChecks.contextId, context.id), eq(assistantDutyChecks.localDate, today), eq(assistantDutyChecks.studentId, studentId), eq(assistantDutyChecks.responsibilityId, resp.id)))
    .get();
  const now = ctx.now();
  const uid = requireUser(ctx).id;
  const isOn = Boolean(existing && existing.uncheckedAt === null);
  if (isOn === p.checked) return { checked: p.checked, changed: false };
  if (!existing) ctx.db.insert(assistantDutyChecks).values({ id: meta.opId, contextId: context.id, localDate: today, studentId, responsibilityId: resp.id, checkedAt: now, checkedBy: uid, uncheckedAt: null }).run();
  else if (p.checked) ctx.db.update(assistantDutyChecks).set({ checkedAt: now, checkedBy: uid, uncheckedAt: null }).where(eq(assistantDutyChecks.id, existing.id)).run();
  else ctx.db.update(assistantDutyChecks).set({ uncheckedAt: now }).where(eq(assistantDutyChecks.id, existing.id)).run();
  audit(ctx.db, ctx.actor, { action: p.checked ? 'assistant.duty_check' : 'assistant.duty_uncheck', entity: 'teaching_context', entityId: context.id, opId: meta.opId, after: { date: today, studentId, responsibilityId: resp.id } }, now);
  emitStudentActivity(ctx, { source: 'assistant', studentIds: [studentId], contextId: context.id });
  return { checked: p.checked, changed: true };
}
