/**
 * Teacher notifications, read side (S14e3, D-155): the page, the bell count, mark read, settings.
 *
 * Access is re-checked on every read (`visibleRows`): a row shows only while the signed-in teacher
 * teaches the student now (an active class+subject of a class the student is in today) in the row's
 * subject (any subject for rows about the whole student), with the category's module on there. So a
 * teacher who lost the class, or a module switched off everywhere, hides the rows without deleting
 * them (they are purged after the retention period).
 *
 * Snippets are read here, from the record the row points to: the student's own text, cut to
 * SNIPPET_MAX characters, only while the record exists and is not hidden, and never a text that the
 * current word lists (school + this teacher) would block. Private teacher notes, Secret Student data
 * and blocked attempts' text are never read (blocked text is never stored at all, D-123).
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/notifications.ts';
import type { NotificationItem, NotificationSettingsView } from '../../../shared/contracts/notifications.ts';
import { CATEGORY_MODULE, groupOf, NOTIFICATIONS_PAGE_MAX, snippetOf, type NotificationCategory, type NotificationSettings } from '../../../shared/notifications.ts';
import { findRiskyWord } from '../../../shared/text/textQuality.ts';
import type { Db } from '../../db/client.ts';
import { evidence, goalEntries, goals, notifications, studentAchievements } from '../../db/schema.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { getUserSetting, setUserSetting } from '../../lib/userSettings.ts';
import { studentScope, type ScopeContext, type StudentScope } from '../links/scope.ts';
import { isModuleEnabled } from '../school/modules.ts';
import { wordListsFor } from '../textChecks/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
export type NotificationRow = typeof notifications.$inferSelect;

/** How many of a teacher's newest rows are looked at for the page (before the access check). */
const SCAN_MAX = 2000;

/**
 * The rows the teacher may see now, each with the class+subject it is shown in (the row's own when
 * it is still active, otherwise the teacher's first current one for the student in that subject).
 */
export function visibleRows(deps: Pick<AppDeps, 'db' | 'now'>, userId: string, rows: readonly NotificationRow[]): Array<{ row: NotificationRow; sc: ScopeContext; fullName: string }> {
  const scopes = new Map<string, StudentScope | null>();
  const moduleOn = new Map<string, boolean>();
  const out: Array<{ row: NotificationRow; sc: ScopeContext; fullName: string }> = [];
  for (const row of rows) {
    if (!scopes.has(row.studentId)) {
      let scope: StudentScope | null = null;
      try {
        scope = studentScope(deps, row.studentId);
      } catch {
        scope = null;
      }
      scopes.set(row.studentId, scope);
    }
    const scope = scopes.get(row.studentId);
    if (!scope) continue;
    const module = CATEGORY_MODULE[row.category];
    const options = scope.contexts.filter((c) => {
      if (c.context.teacherId !== userId) return false;
      if (row.subjectId !== null && c.subject.id !== row.subjectId) return false;
      if (!module) return true;
      const k = `${c.context.id}:${module}`;
      if (!moduleOn.has(k)) moduleOn.set(k, isModuleEnabled(deps.db, c.context.id, module));
      return moduleOn.get(k)!;
    });
    if (!options.length) continue;
    out.push({ row, sc: options.find((c) => c.context.id === row.contextId) ?? options[0]!, fullName: scope.student.fullName });
  }
  return out;
}

const userRows = (db: Db, userId: string, unreadOnly: boolean, limit = SCAN_MAX) =>
  db
    .select()
    .from(notifications)
    .where(unreadOnly ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : eq(notifications.userId, userId))
    .orderBy(desc(notifications.updatedAt), desc(notifications.id))
    .limit(limit)
    .all();

/** Unread rows the teacher may see (the bell counts lines on the page, not the counts inside them). */
export function unreadCount(deps: Pick<AppDeps, 'db' | 'now'>, userId: string): number {
  return visibleRows(deps, userId, userRows(deps.db, userId, true)).length;
}

const ENTRY_CATEGORIES = new Set<NotificationCategory>(['reflection', 'note', 'selfAssessment']);
const GOAL_CATEGORIES = new Set<NotificationCategory>(['goalCreated', 'goalEdited', 'goalAchieved']);

interface Detail {
  snippet: string | null;
  label: NotificationItem['label'];
  gone: boolean;
  goalId: string | null;
}

/** Snippets and "gone" flags for a page of rows, a few queries per kind of record. */
function details(db: Db, rows: readonly NotificationRow[], teacherId: string): Map<string, Detail> {
  const ids = (pick: (r: NotificationRow) => boolean) => [...new Set(rows.filter(pick).flatMap((r) => (r.entityId ? [r.entityId] : [])))];
  const goalIds = ids((r) => GOAL_CATEGORIES.has(r.category));
  const entryIds = ids((r) => ENTRY_CATEGORIES.has(r.category));
  const evidenceIds = ids((r) => r.entity === 'evidence');
  const awardIds = ids((r) => r.category === 'achievementEarned');
  const entryRows = entryIds.length ? db.select().from(goalEntries).where(inArray(goalEntries.id, entryIds)).all() : [];
  const allGoalIds = [...new Set([...goalIds, ...entryRows.map((e) => e.goalId)])];
  const goalRows = new Map((allGoalIds.length ? db.select().from(goals).where(inArray(goals.id, allGoalIds)).all() : []).map((g) => [g.id, g]));
  const entries = new Map(entryRows.map((e) => [e.id, e]));
  const evidences = new Map((evidenceIds.length ? db.select().from(evidence).where(inArray(evidence.id, evidenceIds)).all() : []).map((e) => [e.id, e]));
  const awards = new Map((awardIds.length ? db.select().from(studentAchievements).where(inArray(studentAchievements.id, awardIds)).all() : []).map((a) => [a.id, a]));
  const lists = wordListsFor(db, [teacherId]);
  // Never show a text the current word lists would block (a word may have been added since).
  const safe = (text: string | null | undefined) => {
    const s = snippetOf(text);
    return s && !findRiskyWord(text ?? '', lists) ? s : null;
  };
  const goalGone = (g: { deletedAt: number | null; hiddenAt: number | null } | undefined) => !g || g.deletedAt !== null || g.hiddenAt !== null;
  const out = new Map<string, Detail>();
  for (const r of rows) {
    let d: Detail = { snippet: null, label: null, gone: false, goalId: null };
    if (GOAL_CATEGORIES.has(r.category)) {
      const g = r.entityId ? goalRows.get(r.entityId) : undefined;
      const gone = goalGone(g);
      d = { snippet: gone ? null : safe(g!.text), label: null, gone, goalId: gone ? null : g!.id };
    } else if (ENTRY_CATEGORIES.has(r.category)) {
      const e = r.entityId ? entries.get(r.entityId) : undefined;
      const g = e ? goalRows.get(e.goalId) : undefined;
      const gone = !e || e.deletedAt !== null || e.hiddenAt !== null || goalGone(g);
      d = { snippet: gone ? null : safe(e!.body), label: null, gone, goalId: gone ? null : g!.id };
    } else if (r.entity === 'evidence') {
      const e = r.entityId ? evidences.get(r.entityId) : undefined;
      const gone = !e || e.deletedAt !== null || e.hiddenAt !== null;
      d = { snippet: gone ? null : safe(e!.kind === 'link' ? (e!.body ?? e!.url) : e!.body), label: null, gone, goalId: gone ? null : e!.goalId };
    } else if (r.category === 'achievementEarned') {
      const a = r.entityId ? awards.get(r.entityId) : undefined;
      const gone = !a || a.revokedAt !== null;
      d = { snippet: null, label: gone ? null : a!.nameSnapshot, gone, goalId: null };
    }
    out.set(r.id, d);
  }
  return out;
}

export function listNotifications(ctx: RequestContext, input: In<typeof C.notificationsList>) {
  const uid = requireUser(ctx).id;
  const visible = visibleRows(ctx, uid, userRows(ctx.db, uid, input.unread === '1')).filter(
    ({ row, sc }) => (!input.group || groupOf(row.category) === input.group) && (!input.contextId || sc.context.id === input.contextId),
  );
  const page = visible.slice(0, NOTIFICATIONS_PAGE_MAX);
  const more = details(
    ctx.db,
    page.map((v) => v.row),
    uid,
  );
  const items: NotificationItem[] = page.map(({ row, sc, fullName }) => {
    const d = more.get(row.id)!;
    return {
      id: row.id,
      category: row.category,
      student: { id: row.studentId, fullName },
      context: { id: sc.context.id, classId: sc.cls.id, className: sc.cls.name, subjectName: sc.subject.name },
      entity: row.entity,
      goalId: d.goalId,
      count: row.count,
      localDate: row.localDate,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      read: row.readAt !== null,
      snippet: d.snippet,
      label: d.label,
      gone: d.gone,
    };
  });
  return { items, unread: unreadCount(ctx, uid), truncated: visible.length > page.length };
}

/** The bell's count and its ETag (the count is all the bell shows, so it is the whole validator). */
export function countWithEtag(ctx: RequestContext): { unread: number; etag: string } {
  const unread = unreadCount(ctx, requireUser(ctx).id);
  return { unread, etag: `"nc-${unread}"` };
}

export function markRead(ctx: RequestContext, input: In<typeof C.markNotificationsRead>) {
  const uid = requireUser(ctx).id;
  const mine = and(eq(notifications.userId, uid), isNull(notifications.readAt));
  // Only the teacher's own rows: another account's ids simply match nothing.
  const where = 'ids' in input ? and(mine, inArray(notifications.id, [...new Set(input.ids)])) : mine;
  ctx.db.update(notifications).set({ readAt: ctx.now() }).where(where).run();
  return { ok: true as const, unread: unreadCount(ctx, uid) };
}

function settingsView(ctx: RequestContext, s: NotificationSettings): NotificationSettingsView {
  const user = requireUser(ctx);
  return { ...s, emailReady: Boolean(ctx.mailer), hasEmail: Boolean(user.email) };
}

export const getSettings = (ctx: RequestContext) => settingsView(ctx, getUserSetting(ctx.db, requireUser(ctx).id, 'notifications.settings'));

export function setSettings(ctx: RequestContext, input: NotificationSettings) {
  setUserSetting(ctx.db, requireUser(ctx).id, 'notifications.settings', input, ctx.now());
  return getSettings(ctx);
}
