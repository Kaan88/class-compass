/**
 * The notifications tick (S14e3, D-155), run every 5 minutes from main.ts (and directly by tests):
 *
 * 1. Purge: notifications and digest records older than NOTIFICATION_RETENTION_DAYS (90) are deleted.
 * 2. Daily email digest, off by default: once a day per teacher (an active teacher account with an
 *    email address and the digest switched on), after the teacher's chosen hour in the school
 *    timezone, a plain-text email in the teacher's language with COUNTS ONLY: how many unread
 *    notifications of each kind arrived since the last digest (at most a week back; the last 24 hours
 *    for the first one), after the same access check as the page. A row that keeps collecting while
 *    unread counts only its new part (`count - digestedCount`); a digest that went out moves
 *    `digestedCount` up to what it mailed. Student names (with a count each) only when the
 *    teacher opted in; never student text, never class lists. Nothing new = no email (`empty`).
 *
 * A digest row (teacher, local day) is inserted BEFORE the mail goes out, so two ticks never send
 * twice; a failed send is recorded as `failed` and not retried that day (no SMTP hammering).
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { localDate } from '../../../domain/dates.ts';
import { categoryOn, NOTIFICATION_CATEGORIES, type NotificationCategory } from '../../../shared/notifications.ts';
import { translate, type Locale } from '../../../shared/i18n/index.ts';
import { dateTimeFormat } from '../../../shared/intl.ts';
import { sortByName } from '../../../shared/text/turkish.ts';
import { notificationDigests, notifications, users } from '../../db/schema.ts';
import type { AppDeps } from '../../lib/context.ts';
import { getUserSetting } from '../../lib/userSettings.ts';
import { yieldToEventLoop } from '../../lib/yield.ts';
import { getSchoolSettings } from '../school/policy.ts';
import { visibleRows } from './service.ts';

export const TICK_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;

/** The hour of `ms` in timezone `tz` (0–23). */
export function localHour(ms: number, tz: string): number {
  const h = Number(dateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(ms));
  return Number.isFinite(h) ? h % 24 : 0;
}

/** Rows deleted per statement by the purge (S15a, D-162). */
export const PURGE_BATCH = 500;

/**
 * Deletes notifications and digest records older than the retention period, at most `batch` rows per
 * statement with a turn of the event loop in between (S15a, D-162): one statement over months of rows
 * held the server for over a second. Returns the number of notifications deleted.
 */
export async function purgeNotifications(deps: Pick<AppDeps, 'db' | 'now' | 'config'>, batch = PURGE_BATCH): Promise<number> {
  const cutoff = deps.now() - deps.config.NOTIFICATION_RETENTION_DAYS * DAY_MS;
  const chunked = async (table: typeof notifications | typeof notificationDigests, older: SQL): Promise<number> => {
    let total = 0;
    for (;;) {
      const old = deps.db.select({ rowid: sql<number>`rowid` }).from(table).where(older).limit(batch).all();
      if (!old.length) return total;
      total += deps.db.delete(table).where(inArray(sql`rowid`, old.map((r) => r.rowid))).run().changes;
      if (old.length < batch) return total;
      await yieldToEventLoop();
    }
  };
  const n = await chunked(notifications, lt(notifications.createdAt, cutoff));
  await chunked(notificationDigests, lt(notificationDigests.sentAt, cutoff));
  return n;
}

export interface DigestContent {
  total: number;
  byCategory: Partial<Record<NotificationCategory, number>>;
  byStudent: Array<{ fullName: string; count: number }>;
  /** The rows counted, with their `count` at that moment (marked as digested once the mail went out). */
  covered: Array<{ id: string; count: number }>;
}

/** What a teacher's digest would say now (unread rows they may see, updated after `since`, of the kinds `keep` accepts). */
export function digestContent(deps: Pick<AppDeps, 'db' | 'now'>, userId: string, since: number, keep: (c: NotificationCategory) => boolean = () => true): DigestContent {
  const rows = deps.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), gt(notifications.updatedAt, since)))
    .all();
  const byCategory: Partial<Record<NotificationCategory, number>> = {};
  const students = new Map<string, { fullName: string; count: number }>();
  const covered: DigestContent['covered'] = [];
  let total = 0;
  for (const { row, fullName } of visibleRows(deps, userId, rows)) {
    if (!keep(row.category)) continue;
    // Only what is new since the last digest (or since the teacher read the row).
    const fresh = row.count - row.digestedCount;
    if (fresh <= 0) continue;
    covered.push({ id: row.id, count: row.count });
    byCategory[row.category] = (byCategory[row.category] ?? 0) + fresh;
    const s = students.get(row.studentId) ?? { fullName, count: 0 };
    s.count += fresh;
    students.set(row.studentId, s);
    total += fresh;
  }
  return { total, byCategory, byStudent: sortByName([...students.values()], (s) => s.fullName), covered };
}

/** After a digest went out: what it counted is not new any more (never lowers a newer mark). */
function markDigested(deps: Pick<AppDeps, 'db'>, covered: DigestContent['covered']): void {
  for (const { id, count } of covered) {
    deps.db
      .update(notifications)
      .set({ digestedCount: sql`max(${notifications.digestedCount}, ${count})` })
      .where(eq(notifications.id, id))
      .run();
  }
}

/** The plain-text email (counts only; names only when `includeNames`). */
export function digestMail(locale: Locale, name: string, content: DigestContent, includeNames: boolean, link: string) {
  const T = (key: string, vars: Record<string, string | number> = {}) => translate(locale, key, vars);
  const lines = NOTIFICATION_CATEGORIES.filter((c) => content.byCategory[c]).map((c) => `- ${T(`notifications.category.${c}`)}: ${content.byCategory[c]}`);
  const students = includeNames ? `${T('notifications.digest.byStudent')}\n${content.byStudent.map((s) => `- ${s.fullName}: ${s.count}`).join('\n')}\n\n` : '';
  return {
    subject: T('notifications.digest.subject', { count: content.total }),
    text: T('notifications.digest.body', { name, lines: lines.join('\n'), students, link }),
  };
}

/** One tick: purge, then the digests that are due. Resolves when every due mail was tried. */
export async function runNotificationTick(deps: AppDeps): Promise<{ purged: number; sent: number; empty: number; failed: number }> {
  const purged = await purgeNotifications(deps);
  const result = { purged, sent: 0, empty: 0, failed: 0 };
  const mailer = deps.mailer;
  if (!mailer) return result;
  const now = deps.now();
  const tz = getSchoolSettings(deps.db).timezone;
  const today = localDate(now, tz);
  const hour = localHour(now, tz);
  const teachers = deps.db
    .select()
    .from(users)
    .where(and(eq(users.role, 'teacher'), isNull(users.disabledAt), isNotNull(users.email)))
    .all();
  for (const u of teachers) {
    // One teacher at a time, with requests served in between (S15a, D-162).
    await yieldToEventLoop();
    if (!u.email) continue;
    const settings = getUserSetting(deps.db, u.id, 'notifications.settings');
    if (!settings.digest.enabled || hour < settings.digest.hour) continue;
    if (deps.db.select().from(notificationDigests).where(and(eq(notificationDigests.userId, u.id), eq(notificationDigests.localDate, today))).get()) continue;
    // Since the last digest that went out or found nothing (a failed one is mailed again next time),
    // at most a week back; the last 24 hours for the first one.
    const last = deps.db
      .select()
      .from(notificationDigests)
      .where(and(eq(notificationDigests.userId, u.id), inArray(notificationDigests.status, ['sent', 'empty'])))
      .orderBy(desc(notificationDigests.sentAt))
      .limit(1)
      .get();
    const since = last ? Math.max(last.sentAt, now - 7 * DAY_MS) : now - DAY_MS;
    // Claim the day first: a second tick (or process) finds the row and sends nothing.
    const claimed = deps.db
      .insert(notificationDigests)
      .values({ userId: u.id, localDate: today, sentAt: now, status: 'sending', itemsJson: {} })
      .onConflictDoNothing()
      .run().changes;
    if (!claimed) continue;
    // Only the kinds the teacher still gets (a kind switched off since is not mailed).
    const content = digestContent(deps, u.id, since, (c) => categoryOn(settings, c));
    const counts = { ...content.byCategory } as Record<string, number>;
    const setStatus = (status: 'sent' | 'failed' | 'empty') =>
      deps.db
        .update(notificationDigests)
        .set({ status, itemsJson: counts })
        .where(and(eq(notificationDigests.userId, u.id), eq(notificationDigests.localDate, today)))
        .run();
    if (!content.total) {
      setStatus('empty');
      result.empty += 1;
      continue;
    }
    const mail = digestMail(u.locale, u.displayName, content, settings.digest.includeNames, `${deps.config.origins.main}/teacher/notifications`);
    try {
      await mailer.send({ to: u.email, subject: mail.subject, text: mail.text });
      markDigested(deps, content.covered);
      setStatus('sent');
      result.sent += 1;
    } catch {
      // The address and the error stay out of the logs and the database (they may name a person).
      setStatus('failed');
      result.failed += 1;
    }
  }
  return result;
}
