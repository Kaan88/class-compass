/**
 * Teacher notifications (S14e3, D-155): what a student did that a teacher may want to see later.
 * Shared by the server (writer, digest) and the client (bell, page, settings).
 *
 * - A notification row holds ids only (student, subject, class+subject, the thing it is about) and a
 *   count; the text a teacher sees is read at display time, after the access check, so a deleted or
 *   hidden item, or a student the teacher no longer teaches, never shows.
 * - Categories are switched per teacher (the user setting `notifications.settings`); `DEFAULT_ON`
 *   lists the ones that start on. Two categories are daily aggregates (one row per teacher, student,
 *   category and day, with a count): blocked text and Super Speakers points.
 * - The optional daily email digest is off by default and carries counts only (student names only
 *   when the teacher opts in), never student text.
 */
import { z } from 'zod';
import type { PolicyKey } from './modules.ts';

export const NOTIFICATION_CATEGORIES = [
  'goalCreated',
  'goalEdited',
  'goalAchieved',
  'reflection',
  'note',
  'selfAssessment',
  'evidenceText',
  'evidenceLink',
  'evidencePicture',
  'evidenceDocument',
  'evidenceVoice',
  'evidenceVideo',
  'achievementEarned',
  'avatarChanged',
  'avatarPicture',
  'textBlocked',
  'linkNewDevice',
  'speakersPoints',
] as const;
export const NotificationCategory = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories that start on (owner decision 2026-11-09); the others start off. */
export const DEFAULT_ON: Readonly<Record<NotificationCategory, boolean>> = {
  goalCreated: true,
  goalEdited: true,
  goalAchieved: true,
  reflection: true,
  note: true,
  selfAssessment: true,
  evidenceText: true,
  evidenceLink: true,
  evidencePicture: true,
  evidenceDocument: true,
  evidenceVoice: true,
  /** S27a (D-193). */
  evidenceVideo: true,
  achievementEarned: true,
  avatarChanged: false,
  /** S24 (D-184): a student sent their own picture to check (on by default: nobody else sees it until a teacher decides). */
  avatarPicture: true,
  textBlocked: false,
  linkNewDevice: false,
  speakersPoints: false,
};

/** One row per teacher, student, category and local day, with a count (unique partial index). */
export const AGGREGATE_CATEGORIES = ['textBlocked', 'speakersPoints'] as const satisfies readonly NotificationCategory[];
export const isAggregate = (c: NotificationCategory) => (AGGREGATE_CATEGORIES as readonly string[]).includes(c);

/** The module whose switch gates a category (null = core: always on while the teacher teaches the student). */
export const CATEGORY_MODULE: Readonly<Record<NotificationCategory, PolicyKey | null>> = {
  goalCreated: 'goals',
  goalEdited: 'goals',
  goalAchieved: 'goals',
  reflection: 'goals',
  note: 'goals',
  selfAssessment: 'goals',
  evidenceText: 'goals',
  evidenceLink: 'goals',
  evidencePicture: 'goals',
  evidenceDocument: 'goals',
  evidenceVoice: 'goals',
  evidenceVideo: 'goals',
  achievementEarned: 'achievements',
  avatarChanged: null,
  avatarPicture: null,
  textBlocked: null,
  linkNewDevice: null,
  speakersPoints: 'superSpeakers',
};

/** Groups for the page's filter and the settings screen, in display order. */
export const NOTIFICATION_GROUPS = {
  goals: ['goalCreated', 'goalEdited', 'goalAchieved', 'reflection', 'note', 'selfAssessment'],
  evidence: ['evidenceText', 'evidenceLink', 'evidencePicture', 'evidenceDocument', 'evidenceVoice', 'evidenceVideo'],
  achievements: ['achievementEarned', 'speakersPoints'],
  other: ['avatarChanged', 'avatarPicture', 'textBlocked', 'linkNewDevice'],
} as const satisfies Record<string, readonly NotificationCategory[]>;
export type NotificationGroup = keyof typeof NOTIFICATION_GROUPS;
export const NOTIFICATION_GROUP_KEYS = Object.keys(NOTIFICATION_GROUPS) as NotificationGroup[];
export const NotificationGroup = z.enum(['goals', 'evidence', 'achievements', 'other']);
export const groupOf = (c: NotificationCategory): NotificationGroup => NOTIFICATION_GROUP_KEYS.find((g) => (NOTIFICATION_GROUPS[g] as readonly string[]).includes(c))!;

/** What a row is about (`notifications.entity`). */
export const NOTIFICATION_ENTITIES = ['goal', 'goal_entry', 'evidence', 'student_achievement', 'student', 'student_link', 'text_check', 'point_event'] as const;
export type NotificationEntity = (typeof NOTIFICATION_ENTITIES)[number];

/** Longest snippet of student text on the notifications page (characters, then "…"). */
export const SNIPPET_MAX = 120;
/** Rows a teacher sees at most on the page (newest first). */
export const NOTIFICATIONS_PAGE_MAX = 300;

export const DigestSettings = z.object({
  enabled: z.boolean(),
  /** Local hour (school timezone) after which the day's email is sent. */
  hour: z.number().int().min(0).max(23),
  /** Name the students in the email (counts per student); off = counts per kind only. */
  includeNames: z.boolean(),
});
export type DigestSettings = z.infer<typeof DigestSettings>;

/** Stored per teacher (user setting `notifications.settings`). Categories not stored use `DEFAULT_ON`. */
export const NotificationSettings = z.object({
  categories: z.partialRecord(NotificationCategory, z.boolean()),
  digest: DigestSettings,
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  categories: {},
  digest: { enabled: false, hour: 16, includeNames: false },
};

/** Is the category on for these settings (stored value, else the default)? */
export const categoryOn = (s: NotificationSettings, c: NotificationCategory) => s.categories[c] ?? DEFAULT_ON[c];

/** Cuts student text to `max` characters (by code point) with an ellipsis. */
export function snippetOf(text: string | null | undefined, max = SNIPPET_MAX): string | null {
  const flat = (text ?? '').replace(/\s+/gu, ' ').trim();
  if (!flat) return null;
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
