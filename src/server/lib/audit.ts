import type { Db } from '../db/client.ts';
import { auditEvents } from '../db/schema.ts';
import { newId } from './crypto.ts';
import type { Actor } from './context.ts';

export interface AuditEntry {
  action: string; // e.g. 'student.update', 'attendance.set'
  entity: string; // table/aggregate name
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  opId?: string | null;
}

/**
 * Write an audit row. Call inside the same transaction as the change. Never include secrets. An AI
 * tool acting for an account (S14h1, D-160) is recorded as that account with the token in
 * `via_token_id`, so the audit log names the person and says the change came through an AI tool.
 */
export function audit(db: Db, actor: Actor, e: AuditEntry, now: number): void {
  db.insert(auditEvents)
    .values({
      id: newId(),
      at: now,
      actorType: actor.type === 'mcp' ? 'user' : actor.type,
      actorId: actor.id,
      viaTokenId: actor.type === 'mcp' ? actor.tokenId : null,
      opId: e.opId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      beforeJson: e.before === undefined ? null : JSON.stringify(e.before),
      afterJson: e.after === undefined ? null : JSON.stringify(e.after),
    })
    .run();
}
