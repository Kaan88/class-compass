/**
 * The notification sink (S14e3, D-155), registered through the notifications manifest's
 * `notificationSink` and called by `notify()` (lib/notify.ts) inside the writing transaction.
 *
 * Recipients: the student's CURRENT teachers (active class+subjects of the classes the student is in
 * today, D-027) of the event's subject (every subject when it is null), with the category's module on
 * in that class+subject, the category switched on in the teacher's settings, an active teacher
 * account, and never the teacher who caused the event (`actorUserId`). A deactivated student has no
 * current classes, so nobody is notified.
 *
 * Rows hold ids only. Daily aggregates add to the day's row; other categories add to an unread row
 * about the same record (a student editing one goal five times is one line with a count of 5).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import { CATEGORY_MODULE, categoryOn, isAggregate } from '../../../shared/notifications.ts';
import { notifications, users } from '../../db/schema.ts';
import { newId } from '../../lib/crypto.ts';
import type { NotifyDeps, NotifyEvent } from '../../lib/notify.ts';
import { getUserSetting } from '../../lib/userSettings.ts';
import { studentScope, type ScopeContext } from '../links/scope.ts';
import { isModuleEnabled } from '../school/modules.ts';
import { getSchoolSettings } from '../school/policy.ts';

/** The class+subject each recipient teacher gets the event in (one per teacher). */
export function recipientsOf(deps: NotifyDeps, e: Pick<NotifyEvent, 'category' | 'studentId' | 'subjectId' | 'contextId' | 'actorUserId'>): Map<string, ScopeContext> {
  const out = new Map<string, ScopeContext>();
  let scope;
  try {
    scope = studentScope(deps, e.studentId);
  } catch {
    return out; // the student is gone (erased in the same transaction)
  }
  const module = CATEGORY_MODULE[e.category];
  for (const c of scope.contexts) {
    if (e.subjectId !== null && c.subject.id !== e.subjectId) continue;
    if (e.actorUserId && c.context.teacherId === e.actorUserId) continue;
    if (module && !isModuleEnabled(deps.db, c.context.id, module)) continue;
    const prev = out.get(c.context.teacherId);
    // The event's own class+subject wins for its teacher; otherwise the oldest (studentScope's order).
    if (!prev || c.context.id === e.contextId) out.set(c.context.teacherId, c);
  }
  if (!out.size) return out;
  const active = new Set(
    deps.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...out.keys()]), eq(users.role, 'teacher'), isNull(users.disabledAt)))
      .all()
      .map((u) => u.id),
  );
  for (const id of [...out.keys()]) if (!active.has(id)) out.delete(id);
  return out;
}

export function writeNotifications(deps: NotifyDeps, e: NotifyEvent): void {
  const recipients = recipientsOf(deps, e);
  if (!recipients.size) return;
  const now = deps.now();
  const date = localDate(now, getSchoolSettings(deps.db).timezone);
  const add = Math.max(1, Math.floor(e.count ?? 1));
  for (const [userId, c] of recipients) {
    if (!categoryOn(getUserSetting(deps.db, userId, 'notifications.settings'), e.category)) continue;
    const existing = isAggregate(e.category)
      ? deps.db
          .select()
          .from(notifications)
          .where(and(eq(notifications.userId, userId), eq(notifications.studentId, e.studentId), eq(notifications.category, e.category), eq(notifications.localDate, date)))
          .get()
      : e.entityId
        ? deps.db
            .select()
            .from(notifications)
            .where(and(eq(notifications.userId, userId), eq(notifications.category, e.category), eq(notifications.entityId, e.entityId), isNull(notifications.readAt)))
            .get()
        : undefined;
    if (existing) {
      // Read again (an aggregate the teacher already read becomes new with the next point). What the
      // teacher had already read is not new: the digest counts only what came after it.
      const digestedCount = existing.readAt !== null ? existing.count : existing.digestedCount;
      deps.db
        .update(notifications)
        .set({ count: existing.count + add, digestedCount, updatedAt: now, readAt: null, contextId: c.context.id })
        .where(eq(notifications.id, existing.id))
        .run();
      continue;
    }
    deps.db
      .insert(notifications)
      .values({
        id: newId(),
        userId,
        studentId: e.studentId,
        subjectId: e.subjectId,
        contextId: c.context.id,
        category: e.category,
        entity: e.entity,
        entityId: e.entityId,
        count: add,
        digestedCount: 0,
        localDate: date,
        createdAt: now,
        updatedAt: now,
        readAt: null,
      })
      .run();
  }
}
