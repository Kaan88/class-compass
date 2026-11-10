/**
 * The teacher's own lesson preferences (S18, D-167): "Full screen during lessons", stored in the
 * per-account user setting `lessons.fullscreen` (D-153). A preference of one account, not shared data:
 * no audit row, no outbox command.
 */
import type { LessonPrefs } from '../../../shared/contracts/lessons.ts';
import { forbidden } from '../../lib/errors.ts';
import { actorUserId, type RequestContext } from '../../lib/context.ts';
import { getUserSetting, setUserSetting } from '../../lib/userSettings.ts';

function userOf(ctx: RequestContext): string {
  const id = actorUserId(ctx.actor);
  if (!id) throw forbidden();
  return id;
}

export const getLessonPrefs = (ctx: RequestContext): LessonPrefs => ({ fullscreen: getUserSetting(ctx.db, userOf(ctx), 'lessons.fullscreen') });

export function setLessonPrefs(ctx: RequestContext, input: LessonPrefs): LessonPrefs {
  setUserSetting(ctx.db, userOf(ctx), 'lessons.fullscreen', input.fullscreen, ctx.now());
  return getLessonPrefs(ctx);
}
