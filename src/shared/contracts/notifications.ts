/**
 * Teacher notifications (S14e3, D-155): the bell, the notifications page and its settings. All
 * `teacher` access (423 while the classroom lock is on; the bell lives behind the PIN gate).
 *
 * The list re-checks access on every read: only students the teacher teaches now (in that subject,
 * with the category's module on) are listed. Snippets are at most SNIPPET_MAX characters of the
 * student's own text, only for items that still exist and are not hidden, and never a text that the
 * current word lists would block. No private notes, no Secret Student data, no blocked words.
 */
import { z } from 'zod';
import { NotificationCategory, NotificationGroup, NotificationSettings, NOTIFICATION_ENTITIES } from '../notifications.ts';
import { LocalizedText, endpoint, Empty } from './define.ts';
import { Id } from './school.ts';

export const NotificationItem = z.object({
  id: z.string(),
  category: NotificationCategory,
  student: z.object({ id: z.string(), fullName: z.string() }),
  /** The teacher's own class+subject for the student (deep links), when there is one. */
  context: z.object({ id: z.string(), classId: z.string(), className: z.string(), subjectName: LocalizedText }).nullable(),
  entity: z.enum(NOTIFICATION_ENTITIES),
  /** The goal the item belongs to (goals, entries, evidence on a goal), for the deep link. */
  goalId: z.string().nullable(),
  count: z.number().int().min(1),
  localDate: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  read: z.boolean(),
  /** Up to SNIPPET_MAX characters of the student's own text; null when there is none to show. */
  snippet: z.string().nullable(),
  /** The achievement's name (achievementEarned). */
  label: LocalizedText.nullable(),
  /** The item was deleted, hidden or taken back since. */
  gone: z.boolean(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

const Flag = z.enum(['0', '1']);
export const notificationsList = endpoint({
  method: 'GET',
  path: '/api/teacher/notifications',
  access: 'teacher',
  input: z.object({ unread: Flag.optional(), group: NotificationGroup.optional(), contextId: Id.optional() }),
  output: z.object({ items: z.array(NotificationItem), unread: z.number().int(), truncated: z.boolean() }),
});

/**
 * Polled every 60 s while the bell is on screen; answers 304 to a matching `If-None-Match`. A
 * background poll: it never keeps a classroom device's PIN unlock alive (PIN-7).
 */
export const notificationsCount = endpoint({
  method: 'GET',
  path: '/api/teacher/notifications/count',
  access: 'teacher',
  background: true,
  input: Empty,
  output: z.object({ unread: z.number().int() }),
});

export const markNotificationsRead = endpoint({
  method: 'POST',
  path: '/api/teacher/notifications/read',
  access: 'teacher',
  input: z.union([z.object({ ids: z.array(Id).min(1).max(500) }), z.object({ all: z.literal(true) })]),
  output: z.object({ ok: z.literal(true), unread: z.number().int() }),
});

export const NotificationSettingsView = NotificationSettings.extend({
  /** The school sends email (SMTP configured) and the account has an address, so the digest can arrive. */
  emailReady: z.boolean(),
  hasEmail: z.boolean(),
});
export type NotificationSettingsView = z.infer<typeof NotificationSettingsView>;

export const getNotificationSettings = endpoint({
  method: 'GET',
  path: '/api/teacher/notification-settings',
  access: 'teacher',
  input: Empty,
  output: NotificationSettingsView,
});

export const setNotificationSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/notification-settings',
  access: 'teacher',
  input: NotificationSettings,
  output: NotificationSettingsView,
});
