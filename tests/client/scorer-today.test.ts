/**
 * "My awards today" in the scorer app (S12 review, SSP-6, UX-10/11): the list is derived from the
 * outbox, so an award or undo the server refused never shows as done, and a retried award (new opId)
 * appears once. Also checked against the real outbox on fake-indexeddb with a server that refuses.
 * Fictional data only.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CommandEnvelope, CommandResult } from '../../src/shared/contracts/commands.ts';
import type { ScorerAward } from '../../src/shared/contracts/superSpeakers.ts';
import { createOutbox, type OutboxOp } from '../../src/client/lib/outbox.ts';
import { liveCount, todayAwards } from '../../src/client/scorer/today.ts';

const T = Date.UTC(2026, 10, 9, 7, 0, 0);
const UNDO = 10 * 60_000;
const students = new Map([
  ['s-isik', { fullName: 'Işık Yıldız', className: '3-A' }],
  ['s-cem', { fullName: 'Cem Örnek', className: '3-B' }],
]);
const student = (id: string) => students.get(id);
const op = (o: Partial<OutboxOp> & Pick<OutboxOp, 'opId' | 'type' | 'payload'>): OutboxOp => ({ clientTime: T, state: 'pending', attempts: 0, createdAt: T, ownerId: 'link-1', ...o });
const serverRow = (id: string, studentId: string, extra: Partial<ScorerAward> = {}): ScorerAward => ({ id, studentId, fullName: student(studentId)!.fullName, className: student(studentId)!.className, occurredAt: T, voidedAt: null, undoUntil: T + UNDO, ...extra });
const base = { server: [] as ScorerAward[], confirmed: [] as ScorerAward[], confirmedVoids: new Set<string>(), student, undoWindowMs: UNDO };

describe('scorer "My awards today" (S12 review)', () => {
  it('shows a pending award, but not one the server refused (it waits in the tray)', () => {
    const t = todayAwards({
      ...base,
      queued: [op({ opId: 'a1', type: 'points.award', payload: { studentId: 's-isik' } }), op({ opId: 'a2', type: 'points.award', payload: { studentId: 's-cem' }, state: 'rejected', clientTime: T + 1 })],
    });
    expect(t.awards.map((a) => a.id)).toEqual(['a1']);
    expect(t.awards[0]).toMatchObject({ fullName: 'Işık Yıldız', className: '3-A', undoUntil: T + UNDO });
    expect(liveCount(t)).toBe(1);
  });

  it('shows a pending undo as undone, and a refused undo as still given (it still counts on the board)', () => {
    const server = [serverRow('p1', 's-isik'), serverRow('p2', 's-cem')];
    const pending = todayAwards({ ...base, server, queued: [op({ opId: 'u1', type: 'points.voidOwn', payload: { eventId: 'p1' } })] });
    expect([...pending.voiding]).toEqual(['p1']);
    expect(liveCount(pending)).toBe(1);
    const refused = todayAwards({ ...base, server, queued: [op({ opId: 'u1', type: 'points.voidOwn', payload: { eventId: 'p1' }, state: 'rejected' })] });
    expect(refused.voiding.size).toBe(0);
    expect(liveCount(refused)).toBe(2);
  });

  it('shows a retried award once (new opId), and a confirmed one until the server list has it', () => {
    // After Retry the old op is gone and the new one is pending under a new opId.
    const retried = todayAwards({ ...base, queued: [op({ opId: 'a1-retry', type: 'points.award', payload: { studentId: 's-isik' } })] });
    expect(retried.awards.map((a) => a.id)).toEqual(['a1-retry']);
    // Confirmed (removed from the outbox) but the list was not refetched yet: still shown.
    const confirmed = todayAwards({ ...base, queued: [], confirmed: [serverRow('a1-retry', 's-isik')] });
    expect(confirmed.awards.map((a) => a.id)).toEqual(['a1-retry']);
    // Server row and confirmed row together: once, with the server's state.
    const both = todayAwards({ ...base, queued: [], confirmed: [serverRow('a1-retry', 's-isik')], server: [serverRow('a1-retry', 's-isik', { voidedAt: T + 5 })] });
    expect(both.awards).toHaveLength(1);
    expect(liveCount(both)).toBe(0);
  });

  it('with the real outbox: a refused award and a refused undo leave the list right; Retry shows the award once', async () => {
    const refuse = new Set<string>();
    const accepted: CommandEnvelope[] = [];
    const send = async (commands: CommandEnvelope[]): Promise<CommandResult[]> =>
      commands.map((c) => {
        const reason = (c.payload as { studentId?: string }).studentId === 's-cem' && refuse.has('award') ? 'NOT_PARTICIPATING' : c.type === 'points.voidOwn' && refuse.has('undo') ? 'POINT_UNDO_PASSED' : null;
        if (reason) return { opId: c.opId, ok: false, replayed: false, error: { code: 'CONFLICT', message: 'refused', reason } };
        accepted.push(c);
        return { opId: c.opId, ok: true, replayed: false, result: null };
      });
    const box = createOutbox({ dbName: `scorer-today-${Math.random()}`, send, events: null, isOnline: () => true, owner: 'link-1' });
    await box.start();
    refuse.add('award').add('undo');
    await box.enqueue('points.award', { studentId: 's-isik' });
    const cem = await box.enqueue('points.award', { studentId: 's-cem' });
    await box.flush();
    const isikId = accepted.find((c) => c.type === 'points.award')!.opId;
    await box.enqueue('points.voidOwn', { eventId: isikId });
    await box.flush();
    const server = [serverRow(isikId, 's-isik')];
    const view = async () => todayAwards({ ...base, server, queued: await box.all() });
    let t = await view();
    expect(t.awards.map((a) => a.id)).toEqual([isikId]);
    expect(liveCount(t)).toBe(1);
    expect(box.getStatus().rejected.map((o) => o.type).sort()).toEqual(['points.award', 'points.voidOwn']);
    // Retry the refused award once the student takes part again: shown once, under its new opId.
    refuse.delete('award');
    await box.retry(cem);
    t = await view();
    const pendingOrSent = t.awards.filter((a) => a.studentId === 's-cem');
    expect(pendingOrSent.length).toBeLessThanOrEqual(1);
    await box.flush();
    const cemNew = accepted.filter((c) => (c.payload as { studentId?: string }).studentId === 's-cem');
    expect(cemNew).toHaveLength(1);
    expect(cemNew[0]!.opId).not.toBe(cem);
    t = todayAwards({ ...base, server: [...server, serverRow(cemNew[0]!.opId, 's-cem')], queued: await box.all() });
    expect(t.awards.filter((a) => a.studentId === 's-cem').map((a) => a.id)).toEqual([cemNew[0]!.opId]);
    box.close();
  });
});
