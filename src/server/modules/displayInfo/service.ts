/**
 * Classroom screen size (S16c, D-165). The sample is stored in the per-account user setting
 * `displayInfo.lastSeen`: the last sample is overwritten, and the last RECENT_SIZES distinct sizes are
 * kept newest first so different classrooms show up.
 *
 * Not an outbox command: it is not a classroom write (no lesson, no student, nothing a teacher would
 * miss if one sample is lost), and the board sends again on its next mount. No audit row for the same
 * reason: it is account metadata, not an edit of shared data.
 */
import { eq } from 'drizzle-orm';
import { RECENT_SIZES, type DisplayInfoRow, type DisplaySample, type DisplaySize } from '../../../shared/contracts/displayInfo.ts';
import { compareNames } from '../../../shared/text/turkish.ts';
import { forbidden } from '../../lib/errors.ts';
import { actorUserId, type RequestContext } from '../../lib/context.ts';
import { getUserSetting, setUserSetting } from '../../lib/userSettings.ts';
import { userSettings, users } from '../../db/schema.ts';

const KEY = 'displayInfo.lastSeen';

type Size = Omit<DisplaySize, 'seenAt'>;
const sameSize = (a: Size, b: Size) =>
  a.innerWidth === b.innerWidth && a.innerHeight === b.innerHeight && a.screenWidth === b.screenWidth && a.screenHeight === b.screenHeight && a.pixelRatio === b.pixelRatio;

export function recordDisplay(ctx: RequestContext, sample: DisplaySample): { ok: true } {
  const userId = actorUserId(ctx.actor);
  if (!userId) throw forbidden();
  const now = ctx.now();
  const prev = getUserSetting(ctx.db, userId, KEY);
  const size: DisplaySize = {
    innerWidth: sample.innerWidth,
    innerHeight: sample.innerHeight,
    screenWidth: sample.screenWidth,
    screenHeight: sample.screenHeight,
    pixelRatio: sample.pixelRatio,
    seenAt: now,
  };
  const recent = [size, ...prev.recent.filter((r) => !sameSize(r, size))].slice(0, RECENT_SIZES);
  setUserSetting(ctx.db, userId, KEY, { last: { ...sample, seenAt: now }, recent }, now);
  return { ok: true };
}

/** Every account with a recorded screen, by name. */
export function listDisplayInfo(ctx: RequestContext): DisplayInfoRow[] {
  const rows = ctx.db
    .select({ userId: users.id, displayName: users.displayName })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(eq(userSettings.key, KEY))
    .all();
  const out: DisplayInfoRow[] = [];
  for (const r of rows) {
    const v = getUserSetting(ctx.db, r.userId, KEY);
    if (v.last) out.push({ userId: r.userId, displayName: r.displayName, last: v.last, recent: v.recent });
  }
  return out.sort((a, b) => compareNames(a.displayName, b.displayName));
}
