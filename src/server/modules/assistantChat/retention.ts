/**
 * Retention of assistant chats (S19b, D-180; owner decision 2026-11-11): a chat is deleted one school
 * year after its last message (`assistant_settings.retention_days`, 365 by default, changeable by an
 * administrator). Runs hourly from the server (`main.ts`) in small pieces; deletions are counted in one
 * system audit row, never with content.
 */
import { inArray, lt } from 'drizzle-orm';
import { assistantChats, assistantMessages } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps } from '../../lib/context.ts';
import { tx } from '../../db/client.ts';
import { yieldToEventLoop } from '../../lib/yield.ts';
import { assistantSettingsOf } from './settings.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const PIECE = 200;
/** How often the server runs the clean-up. */
export const RETENTION_TICK_MS = 60 * 60_000;

export async function purgeOldChats(deps: Pick<AppDeps, 'db' | 'now'>): Promise<number> {
  const cutoff = deps.now() - assistantSettingsOf(deps.db).retentionDays * DAY_MS;
  let total = 0;
  for (;;) {
    const ids = deps.db.select({ id: assistantChats.id }).from(assistantChats).where(lt(assistantChats.lastMessageAt, cutoff)).limit(PIECE).all().map((r) => r.id);
    if (!ids.length) break;
    tx(deps.db, () => {
      deps.db.delete(assistantMessages).where(inArray(assistantMessages.chatId, ids)).run();
      deps.db.delete(assistantChats).where(inArray(assistantChats.id, ids)).run();
    });
    total += ids.length;
    if (ids.length < PIECE) break;
    await yieldToEventLoop();
  }
  if (total) audit(deps.db, { type: 'system', id: null }, { action: 'assistant_chat.retention', entity: 'assistant_chat', entityId: null, after: { deleted: total } }, deps.now());
  return total;
}
