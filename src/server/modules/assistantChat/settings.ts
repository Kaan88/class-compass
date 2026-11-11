/**
 * The administrator's switch and retention for the assistant chat (S19b, D-180), and whether a teacher
 * may use the chat right now. The chat works only while all three hold: an administrator switched it
 * on, the school's AI tools switch is on (the chat sends the same data out as an AI app would, so it
 * follows the same KVKK decision, D-160), and at least one connection can be used.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ASSISTANT_RETENTION_DEFAULT_DAYS, type AssistantUnavailable } from '../../../shared/assistantChat.ts';
import type * as C from '../../../shared/contracts/assistantChat.ts';
import { tx, type Db } from '../../db/client.ts';
import { aiConnections, assistantChats, assistantSettings } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, RequestContext, UserRow } from '../../lib/context.ts';
import { AppError, conflict } from '../../lib/errors.ts';
import { connectionSettings, statusOf } from '../aiConnections/service.ts';
import { getSchoolSettings } from '../school/policy.ts';

export function assistantSettingsOf(db: Db): { enabled: boolean; retentionDays: number } {
  const s = db.select().from(assistantSettings).where(eq(assistantSettings.id, 1)).get();
  return { enabled: s?.enabled ?? false, retentionDays: s?.retentionDays ?? ASSISTANT_RETENTION_DEFAULT_DAYS };
}

/** Connections a user may choose now: ready school connections, and their own ones while the administrator allows them. */
export function usableConnections(deps: Pick<AppDeps, 'db' | 'now' | 'config'>, user: UserRow) {
  const own = connectionSettings(deps.db).teacherConnectionsAllowed;
  return deps.db
    .select()
    .from(aiConnections)
    .where(isNull(aiConnections.deletedAt))
    .all()
    .filter((r) => (r.ownerUserId === null || (own && r.ownerUserId === user.id)) && statusOf(deps, r) === 'ready')
    .sort((a, b) => Number(a.ownerUserId !== null) - Number(b.ownerUserId !== null) || a.createdAt - b.createdAt);
}

/** Why the chat cannot be used now, or null. */
export function unavailableReason(deps: Pick<AppDeps, 'db' | 'now' | 'config'>, user: UserRow): AssistantUnavailable | null {
  if (!assistantSettingsOf(deps.db).enabled) return 'OFF';
  if (!getSchoolSettings(deps.db).mcpEnabled) return 'AI_TOOLS_OFF';
  if (!usableConnections(deps, user).length) return 'NO_CONNECTION';
  return null;
}

export function assertAvailable(ctx: RequestContext, user: UserRow) {
  const why = unavailableReason(ctx, user);
  if (why === 'NO_CONNECTION') throw new AppError('FEATURE_DISABLED', 'No connection is set up', { reason: 'AI_NO_CONNECTION' });
  if (why) throw new AppError('FEATURE_DISABLED', 'The assistant is switched off', { reason: why === 'OFF' ? 'ASSISTANT_OFF' : 'MCP_DISABLED' });
}

const readyCount = (deps: Pick<AppDeps, 'db' | 'now' | 'config'>) =>
  deps.db
    .select()
    .from(aiConnections)
    .where(and(isNull(aiConnections.ownerUserId), isNull(aiConnections.deletedAt)))
    .all()
    .filter((r) => statusOf(deps, r) === 'ready').length;

export function adminView(ctx: RequestContext): z.infer<typeof C.AssistantAdmin> {
  const s = assistantSettingsOf(ctx.db);
  const n = ctx.db.select({ chats: sql<number>`count(*)`, teachers: sql<number>`count(distinct ${assistantChats.ownerUserId})` }).from(assistantChats).get();
  return { ...s, aiToolsEnabled: getSchoolSettings(ctx.db).mcpEnabled, readyConnections: readyCount(ctx), chats: n?.chats ?? 0, teachers: n?.teachers ?? 0 };
}

export function setAdmin(ctx: RequestContext, input: { enabled?: boolean | undefined; retentionDays?: number | undefined }): z.infer<typeof C.AssistantAdmin> {
  const before = assistantSettingsOf(ctx.db);
  const next = { enabled: input.enabled ?? before.enabled, retentionDays: input.retentionDays ?? before.retentionDays };
  // Switching on needs a connection to use (the settings page says so); switching off always works.
  if (next.enabled && !before.enabled && readyCount(ctx) === 0) throw conflict('Add and test a connection first', { reason: 'ASSISTANT_NEEDS_CONNECTION' });
  if (next.enabled !== before.enabled || next.retentionDays !== before.retentionDays) {
    const now = ctx.now();
    tx(ctx.db, () => {
      ctx.db
        .insert(assistantSettings)
        .values({ id: 1, ...next, updatedAt: now })
        .onConflictDoUpdate({ target: assistantSettings.id, set: { ...next, updatedAt: now } })
        .run();
      audit(ctx.db, ctx.actor, { action: 'assistant_chat.settings', entity: 'assistant_settings', entityId: '1', before, after: next }, now);
    });
  }
  return adminView(ctx);
}
