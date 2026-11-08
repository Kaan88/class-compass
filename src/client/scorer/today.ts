/**
 * "My awards today" in the scorer app (S12, SSP-6; S12 review): the server's list plus what this
 * device still has in its outbox, derived from the outbox itself so the list never shows something
 * the server refused.
 *
 * - An award still waiting to be sent is shown (newest first) under its opId, which becomes the point's
 *   id on the server. A refused award (NOT_PARTICIPATING, SCORER_RATE_LIMIT, SPEAKERS_OFF…) is not in
 *   the list: it waits in the Needs-attention tray, and a Retry there queues it under a new opId, which
 *   is then shown once (the old row is gone with the old op).
 * - An undo still waiting to be sent shows its row as undone. A refused undo (POINT_UNDO_PASSED,
 *   NOT_YOUR_AWARD) shows the point as given again, as it still counts on the board.
 * - Between the server's answer and the next refetch of the list, confirmed awards and undos are kept
 *   from the outbox's success events (`confirmed`, `confirmedVoids`), so nothing flickers away.
 */
import type { ScorerAward } from '../../shared/contracts/superSpeakers.ts';
import type { OutboxOp } from '../lib/outbox.ts';

export interface TodayInput {
  /** The server's list (`GET /api/scorer/awards`). */
  server: readonly ScorerAward[];
  /** This scorer link's commands still in the outbox (pending or refused). */
  queued: readonly Pick<OutboxOp, 'opId' | 'type' | 'payload' | 'clientTime' | 'state'>[];
  /** Awards the server accepted since the list was last fetched. */
  confirmed: readonly ScorerAward[];
  /** Point ids the server voided (own undo) since the list was last fetched. */
  confirmedVoids: ReadonlySet<string>;
  student: (id: string) => { fullName: string; className: string } | undefined;
  undoWindowMs: number;
}

export interface Today {
  awards: ScorerAward[];
  /** Points shown as undone although the server list does not say so yet. */
  voiding: Set<string>;
}

const payloadOf = (op: { payload: unknown }) => (op.payload ?? {}) as { studentId?: string; eventId?: string };

export function todayAwards(input: TodayInput): Today {
  const byId = new Map<string, ScorerAward>();
  for (const op of input.queued) {
    if (op.type !== 'points.award' || op.state !== 'pending') continue;
    const studentId = payloadOf(op).studentId ?? '';
    const s = input.student(studentId);
    byId.set(op.opId, { id: op.opId, studentId, fullName: s?.fullName ?? '', className: s?.className ?? '', occurredAt: op.clientTime, voidedAt: null, undoUntil: op.clientTime + input.undoWindowMs });
  }
  // Server rows win over local ones (they carry the real void state and undo time).
  for (const a of input.confirmed) byId.set(a.id, a);
  for (const a of input.server) byId.set(a.id, a);
  const voiding = new Set<string>(input.confirmedVoids);
  for (const op of input.queued) {
    if (op.type === 'points.voidOwn' && op.state === 'pending') {
      const id = payloadOf(op).eventId;
      if (id) voiding.add(id);
    }
  }
  const awards = [...byId.values()].sort((a, b) => b.occurredAt - a.occurredAt);
  return { awards, voiding };
}

/** Live points in the list (the "My awards today" count). */
export const liveCount = (t: Today) => t.awards.filter((a) => a.voidedAt === null && !t.voiding.has(a.id)).length;
