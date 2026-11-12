/**
 * Per-account settings that follow the user across devices (S14e1, D-153), stored in the generic
 * `user_settings` table (one row per account and key). This file is the registry and the only reader
 * and writer of the table:
 * - every key is declared once in USER_SETTINGS with a Zod schema and a default;
 * - `getUserSetting` returns the default when nothing (or an invalid value, e.g. from an older
 *   version) is stored;
 * - `setUserSetting` validates the value with the key's schema before it is written.
 *
 * Adding a setting: add a line to USER_SETTINGS (the key is `<area>.<name>`), then read and write it
 * through these helpers from the owning service. Settings hold preferences only: never student data,
 * secrets or anything another account must see (per-device conveniences stay in localStorage).
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AreaDensity, DEFAULT_AREA_DENSITY } from '../../shared/contracts/auth.ts';
import { DisplayInfoRecord, EMPTY_DISPLAY_INFO } from '../../shared/contracts/displayInfo.ts';
import { DEFAULT_NOTIFICATION_SETTINGS, NotificationSettings } from '../../shared/notifications.ts';
import { DEFAULT_VIEW_REF, ViewRef } from '../../shared/reportViews.ts';
import type { Db } from '../db/client.ts';
import { userSettings } from '../db/schema.ts';

interface SettingSpec<S extends z.ZodType> {
  schema: S;
  default: z.infer<S>;
}
const setting = <S extends z.ZodType>(schema: S, def: z.infer<S>): SettingSpec<S> => ({ schema, default: def });

export const USER_SETTINGS = {
  /** The report view the teacher area's Reports page opens with (`builtin:<id>` or a saved view id). */
  'reports.defaultView.teacher': setting(ViewRef, DEFAULT_VIEW_REF),
  /** The same for the admin area's "By class and subject" reports. */
  'reports.defaultView.admin': setting(ViewRef, DEFAULT_VIEW_REF),
  /** S14e3 (D-155): which notification categories the teacher gets, and the daily email digest (off by default). */
  'notifications.settings': setting(NotificationSettings, DEFAULT_NOTIFICATION_SETTINGS),
  /** S16c (D-165): the last classroom screen seen by this account (removable module `displayInfo`; not a preference, account metadata only the admin sees). */
  'displayInfo.lastSeen': setting(DisplayInfoRecord, EMPTY_DISPLAY_INFO),
  /** S18 (D-167): Start lesson enters full screen and End lesson leaves it (on by default; the board's button works either way). */
  'lessons.fullscreen': setting(z.boolean(), true),
  /** S22d (D-178): Compact / Normal / Large in the teacher and admin areas (Normal by default; the classroom screen sizes its cards by itself: the D-177 fit, D-195). */
  'area.density': setting(AreaDensity, DEFAULT_AREA_DENSITY),
} as const;

export type UserSettingKey = keyof typeof USER_SETTINGS;
export type UserSettingValue<K extends UserSettingKey> = z.infer<(typeof USER_SETTINGS)[K]['schema']>;

export function getUserSetting<K extends UserSettingKey>(db: Db, userId: string, key: K): UserSettingValue<K> {
  const spec = USER_SETTINGS[key];
  const row = db
    .select({ value: userSettings.valueJson })
    .from(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
    .get();
  if (!row) return spec.default as UserSettingValue<K>;
  const parsed = spec.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : spec.default) as UserSettingValue<K>;
}

/** Validates and stores the value (throws a ZodError on an invalid value: a programming error). */
export function setUserSetting<K extends UserSettingKey>(db: Db, userId: string, key: K, value: UserSettingValue<K>, now: number): void {
  const valid = USER_SETTINGS[key].schema.parse(value);
  db.insert(userSettings)
    .values({ userId, key, valueJson: valid, updatedAt: now })
    .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { valueJson: valid, updatedAt: now } })
    .run();
}

/** Back to the default. */
export function clearUserSetting(db: Db, userId: string, key: UserSettingKey): void {
  db.delete(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
    .run();
}
