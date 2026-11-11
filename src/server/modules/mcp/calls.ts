/**
 * The MCP call log and rate limit (S14h1, D-160). `mcp_calls` records every request (method or tool,
 * token, account, outcome, duration, response size) and never the arguments or the result. The rate
 * limit is a one-minute budget per token: every request costs 1, a tool its declared cost.
 */
import { and, desc, eq, like, lt } from 'drizzle-orm';
import { MCP_RATE_PER_MINUTE } from '../../../shared/mcp.ts';
import { tx, type Db } from '../../db/client.ts';
import { mcpCalls } from '../../db/schema.ts';
import { newId } from '../../lib/crypto.ts';

export const CALL_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;

export type CallStatus = 'ok' | 'error' | 'denied' | 'rate_limited';
export interface CallRecord {
  tokenId: string;
  userId: string;
  method: string;
  status: CallStatus;
  errorCode?: string | null;
  durationMs: number;
  bytes: number;
}

export class CallLog {
  private lastPurge = 0;
  private db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  record(now: number, r: CallRecord) {
    this.recordMany([{ at: now, record: r }]);
  }
  /** Several records (the messages of one batch) in one transaction. */
  recordMany(rows: ReadonlyArray<{ at: number; record: CallRecord }>) {
    if (!rows.length) return;
    const now = Math.max(...rows.map((x) => x.at));
    tx(this.db, () => {
      for (const { at, record: r } of rows) {
        this.db.insert(mcpCalls).values({ id: newId(), at, tokenId: r.tokenId, userId: r.userId, method: r.method.slice(0, 120), status: r.status, errorCode: r.errorCode ?? null, durationMs: Math.max(0, Math.round(r.durationMs)), bytes: r.bytes }).run();
      }
    });
    if (now - this.lastPurge > PURGE_EVERY_MS) {
      this.lastPurge = now;
      this.db.delete(mcpCalls).where(lt(mcpCalls.at, now - CALL_RETENTION_MS)).run();
    }
  }
}

/** A fixed one-minute window per token. */
export class RateLimiter {
  private windows = new Map<string, { start: number; used: number }>();
  private limit: number;
  constructor(limit = MCP_RATE_PER_MINUTE) {
    this.limit = limit;
  }
  private window(tokenId: string, now: number) {
    let w = this.windows.get(tokenId);
    if (!w || now - w.start >= 60_000) {
      w = { start: now, used: 0 };
      this.windows.set(tokenId, w);
      if (this.windows.size > 10_000) for (const [k, v] of this.windows) if (now - v.start >= 60_000) this.windows.delete(k);
    }
    return w;
  }
  /** Seconds until the budget refills, when it is used up; otherwise null. */
  exhausted(tokenId: string, now: number): number | null {
    const w = this.window(tokenId, now);
    return w.used >= this.limit ? Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000)) : null;
  }
  /** Spend `cost`; false (and nothing spent) when it does not fit. */
  take(tokenId: string, now: number, cost: number): boolean {
    const w = this.window(tokenId, now);
    if (w.used + cost > this.limit) return false;
    w.used += cost;
    return true;
  }
}

/** How the transport names a tool call in the log (`tools/call:<tool>`). */
export const TOOL_CALL_PREFIX = 'tools/call:';

/** The newest successful tool call at the school (S19c, D-181: the admin checklist's "a first call worked"). */
export function lastSchoolToolCall(db: Db): number | null {
  const row = db
    .select({ at: mcpCalls.at })
    .from(mcpCalls)
    .where(and(eq(mcpCalls.status, 'ok'), like(mcpCalls.method, `${TOOL_CALL_PREFIX}%`)))
    .orderBy(desc(mcpCalls.at))
    .limit(1)
    .get();
  return row?.at ?? null;
}
