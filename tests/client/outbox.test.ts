/**
 * Command outbox (UX-10, UX-11, CNT-5, ENG-3 "duplicate submissions", "offline/abort-after-commit").
 * Runs the real Dexie code on fake-indexeddb against a fake server that deduplicates by opId exactly
 * like /api/commands does.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandEnvelope, CommandResult } from '../../src/shared/contracts/commands.ts';
import { backoffDelay, classifyFailure, createOutbox, isRetryable, saveStateOf, type Outbox, type OutboxOptions } from '../../src/client/lib/outbox.ts';

/** Fake /api/commands: idempotent by opId, records what was applied. */
class FakeServer {
  /** The account whose session cookie the browser currently sends. */
  actor = 'teacher-a';
  appliedBy: string[] = [];
  applied: CommandEnvelope[] = [];
  requests: string[][] = [];
  log = new Map<string, CommandResult & { actor: string }>();
  /** Throw after committing (response lost) for the next N requests. */
  loseResponses = 0;
  /** Fail before committing for the next N requests. */
  failBefore = 0;
  failStatus: number | undefined = undefined;
  reject = new Set<string>(); // command types the server refuses
  send = async (cmds: CommandEnvelope[], asUser?: string): Promise<CommandResult[]> => {
    this.requests.push(cmds.map((c) => c.opId));
    if (asUser !== undefined && asUser !== this.actor) {
      throw Object.assign(new Error('wrong account'), { status: 409, code: 'CONFLICT', details: { reason: 'WRONG_ACCOUNT' } });
    }
    if (this.failBefore > 0) {
      this.failBefore--;
      throw Object.assign(new Error('network down'), this.failStatus ? { status: this.failStatus } : {});
    }
    const results = cmds.map((c) => {
      const prev = this.log.get(c.opId);
      if (prev && prev.actor !== this.actor) {
        // Same as src/server/lib/commands.ts: an opId replayed by another account is a conflict.
        return { opId: c.opId, ok: false, replayed: true, error: { code: 'CONFLICT', message: 'Operation id reused with different content', reason: 'OP_ID_REUSED' } };
      }
      if (prev) return { opId: prev.opId, ok: prev.ok, result: prev.result, error: prev.error, replayed: true };
      const r: CommandResult = this.reject.has(c.type)
        ? { opId: c.opId, ok: false, replayed: false, error: { code: 'CONFLICT', message: 'refused' } }
        : { opId: c.opId, ok: true, replayed: false, result: { n: this.applied.length + 1 } };
      if (r.ok) {
        this.applied.push(c);
        this.appliedBy.push(this.actor);
      }
      this.log.set(c.opId, { ...r, actor: this.actor });
      return r;
    });
    if (this.loseResponses > 0) {
      this.loseResponses--;
      throw new TypeError('Failed to fetch'); // committed, but the client never hears back
    }
    return results;
  };
}

/** Manual timers so backoff is deterministic. */
class ManualTimers {
  queue: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  schedule = (fn: () => void, ms: number) => {
    const t = { fn, ms, cancelled: false };
    this.queue.push(t);
    return { cancel: () => (t.cancelled = true) };
  };
  async fireAll() {
    const due = this.queue.filter((t) => !t.cancelled);
    this.queue = [];
    for (const t of due) t.fn();
    await new Promise((r) => setTimeout(r, 0));
  }
  get delays() {
    return this.queue.filter((t) => !t.cancelled).map((t) => t.ms);
  }
}

let n = 0;
const boxes: Outbox[] = [];
function make(server: FakeServer, extra: Partial<OutboxOptions> & { dbName?: string } = {}) {
  const box = createOutbox({ dbName: extra.dbName ?? `test-outbox-${++n}`, send: server.send, events: null, owner: 'teacher-a', ...extra });
  boxes.push(box);
  return box;
}
afterEach(() => {
  while (boxes.length) boxes.pop()!.close();
});

describe('command outbox', () => {
  it('persists before sending, sends in enqueue order and empties the queue (UX-11)', async () => {
    const server = new FakeServer();
    let persistedBeforeSend = false;
    const ref: { box?: Outbox } = {};
    const send = async (cmds: CommandEnvelope[]) => {
      persistedBeforeSend = (await ref.box!.all()).some((o) => o.opId === cmds[0]!.opId);
      return server.send(cmds);
    };
    const box = (ref.box = make(server, { send }));
    await box.start();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await box.enqueue('counter.add', { i }, { lessonId: 'L1', contextId: 'C1' }));
    await box.flush();
    expect(persistedBeforeSend).toBe(true);
    expect(server.applied.map((c) => (c.payload as { i: number }).i)).toEqual([0, 1, 2, 3, 4]);
    expect(server.applied[0]).toMatchObject({ lessonId: 'L1', contextId: 'C1', type: 'counter.add' });
    expect(await box.all()).toEqual([]);
    expect(saveStateOf(box.getStatus())).toEqual({ kind: 'saved' });
    // opIds are UUIDv7 (time-ordered)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('never duplicates an action when the response is lost after the server committed (CNT-5)', async () => {
    const server = new FakeServer();
    const timers = new ManualTimers();
    const box = make(server, { schedule: timers.schedule });
    await box.start();
    server.loseResponses = 1;
    const opId = await box.enqueue('counter.add', { student: 's1' });
    await box.flush();
    // Committed once on the server, but the client did not hear back → still queued with the SAME opId.
    expect(server.applied).toHaveLength(1);
    expect((await box.all()).map((o) => o.opId)).toEqual([opId]);
    expect(saveStateOf(box.getStatus()).kind).toBe('offline');
    await timers.fireAll();
    await box.flush();
    expect(server.requests.map((r) => r[0])).toEqual([opId, opId]); // retried with the same id
    expect(server.applied).toHaveLength(1); // …and applied exactly once (replayed)
    expect(await box.all()).toEqual([]);
  });

  it('single-flight: concurrent flushes and double taps do not send a command twice', async () => {
    const server = new FakeServer();
    const box = make(server);
    await box.start();
    await Promise.all([box.enqueue('a', 1), box.enqueue('b', 2)]);
    await Promise.all([box.flush(), box.flush(), box.flush()]);
    const sent = server.requests.flat();
    expect(new Set(sent).size).toBe(sent.length);
    expect(server.applied.map((c) => c.type)).toEqual(['a', 'b']);
  });

  it('queues while offline and sends in order when the connection returns', async () => {
    const server = new FakeServer();
    let online = false;
    const events = new EventTarget();
    const box = make(server, { isOnline: () => online, events });
    await box.start();
    await box.enqueue('first', 1);
    await box.enqueue('second', 2);
    await box.flush();
    expect(server.requests).toEqual([]);
    expect(saveStateOf(box.getStatus())).toEqual({ kind: 'offline', count: 2 });
    online = true;
    events.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 10));
    await box.flush();
    expect(server.applied.map((c) => c.type)).toEqual(['first', 'second']);
    expect(box.getStatus().pending).toBe(0);
  });

  it('survives a reload: a new outbox on the same database resumes the queue', async () => {
    const server = new FakeServer();
    const dbName = `reload-${++n}`;
    const first = make(server, { dbName, isOnline: () => false });
    await first.start();
    const a = await first.enqueue('one', 1);
    const b = await first.enqueue('two', 2);
    first.close(); // page closed before anything was sent
    expect(server.requests).toEqual([]);

    const second = make(server, { dbName });
    await second.start();
    await second.flush();
    expect(server.applied.map((c) => c.opId)).toEqual([a, b]);
    expect(await second.all()).toEqual([]);
  });

  it('backs off exponentially on transient failures and keeps order', async () => {
    const server = new FakeServer();
    const timers = new ManualTimers();
    const box = make(server, { schedule: timers.schedule, baseDelayMs: 1000, maxDelayMs: 8000 });
    await box.start();
    server.failBefore = 4;
    server.failStatus = 503;
    await box.enqueue('x', 1);
    await box.enqueue('y', 2);
    await box.flush();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      delays.push(...timers.delays);
      await timers.fireAll();
      await box.flush();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    expect(server.applied.map((c) => c.type)).toEqual(['x', 'y']);
    expect(box.getStatus().failures).toBe(0);
    expect(backoffDelay(10, 1000, 30000)).toBe(30000);
  });

  it('moves server-rejected commands to the needs-attention list; Retry uses a new opId, Dismiss removes', async () => {
    const server = new FakeServer();
    server.reject.add('bad');
    const box = make(server);
    await box.start();
    await box.enqueue('good', 1);
    const badId = await box.enqueue('bad', 2);
    await box.enqueue('good', 3);
    await box.flush();
    expect(server.applied.map((c) => c.payload)).toEqual([1, 3]); // the rejection does not block later commands
    const st = box.getStatus();
    expect(st.rejected.map((o) => o.opId)).toEqual([badId]);
    expect(st.rejected[0]!.error).toEqual({ code: 'CONFLICT', message: 'refused' });
    expect(saveStateOf(st)).toEqual({ kind: 'error', count: 1 });

    server.reject.clear();
    await box.retry(badId);
    await box.flush();
    expect(server.applied.map((c) => c.payload)).toEqual([1, 3, 2]);
    expect(server.applied[2]!.opId).not.toBe(badId);
    expect(box.getStatus().rejected).toEqual([]);

    server.reject.add('bad');
    const again = await box.enqueue('bad', 4);
    await box.flush();
    await box.dismiss(again);
    expect(box.getStatus().rejected).toEqual([]);
    expect(await box.all()).toEqual([]);
  });

  it('pauses on 401 until resumed after signing in again', async () => {
    const server = new FakeServer();
    const box = make(server);
    await box.start();
    server.failBefore = 1;
    server.failStatus = 401;
    await box.enqueue('x', 1);
    await box.flush();
    expect(box.getStatus().authPaused).toBe(true);
    expect(saveStateOf(box.getStatus()).kind).toBe('offline');
    await box.resume();
    expect(server.applied).toHaveLength(1);
  });

  it('runs success listeners for fresh and replayed results (query invalidation hook)', async () => {
    const server = new FakeServer();
    const timers = new ManualTimers();
    const box = make(server, { schedule: timers.schedule });
    const seen: Array<[string, boolean]> = [];
    box.onSuccess((op, r) => seen.push([op.type, r.replayed]));
    await box.start();
    await box.enqueue('fresh', 1);
    await box.flush();
    server.loseResponses = 1;
    await box.enqueue('lost', 2);
    await box.flush();
    await timers.fireAll();
    await box.flush();
    expect(seen).toEqual([
      ['fresh', false],
      ['lost', true],
    ]);
  });

  it("never sends one teacher's queued commands under another teacher's session (ACC-9, UX-11)", async () => {
    const server = new FakeServer();
    const dbName = `shared-pc-${++n}`;
    let online = false;
    const box = make(server, { dbName, isOnline: () => online });
    await box.start();
    const a1 = await box.enqueue('counter.add', { s: 1 });
    const a2 = await box.enqueue('counter.add', { s: 2 });
    // Teacher A signs out with commands still queued (offline); teacher B signs in on the same PC.
    await box.setOwner(null);
    await expect(box.enqueue('x', 0)).rejects.toThrow(/no signed-in account/);
    server.actor = 'teacher-b';
    online = true;
    await box.resume('teacher-b');
    const b1 = await box.enqueue('counter.add', { s: 3 });
    await box.flush();
    expect(server.applied.map((c) => c.opId)).toEqual([b1]); // only B's own command
    expect(server.appliedBy).toEqual(['teacher-b']);
    // A's commands are neither counted nor shown to B, and B cannot dismiss them.
    expect(box.getStatus()).toMatchObject({ pending: 0, rejected: [], otherAccounts: 2 });
    await box.dismiss(a1);
    expect((await box.all()).map((o) => o.opId)).toEqual([a1, a2]);
    // A reload while B is signed in does not send them either.
    box.close();
    const reloaded = make(server, { dbName, owner: 'teacher-b' });
    await reloaded.start();
    await reloaded.flush();
    expect(server.applied).toHaveLength(1);
    // Teacher A signs in again: their commands go out, in order, as A.
    server.actor = 'teacher-a';
    await reloaded.resume('teacher-a');
    await reloaded.flush();
    expect(server.applied.map((c) => c.opId)).toEqual([b1, a1, a2]);
    expect(server.appliedBy).toEqual(['teacher-b', 'teacher-a', 'teacher-a']);
    expect(await reloaded.all()).toEqual([]);
  });

  it('pauses instead of sending when the browser session belongs to another account (WRONG_ACCOUNT)', async () => {
    const server = new FakeServer();
    const box = make(server);
    await box.start();
    server.actor = 'teacher-b'; // e.g. B signed in from another tab; this tab still thinks it is A
    await box.enqueue('counter.add', 1);
    await box.flush();
    expect(server.applied).toEqual([]);
    expect(box.getStatus()).toMatchObject({ authPaused: true, pending: 1, rejected: [] }); // parked, not rejected
    await box.setOwner('teacher-b'); // `me` refetched: the owner switches; A's command stays parked
    await box.flush();
    expect(server.applied).toEqual([]);
    expect(box.getStatus()).toMatchObject({ authPaused: false, pending: 0, otherAccounts: 1 });
  });

  it('offers no Retry for an opId conflict, so a possibly committed action is never applied twice', async () => {
    const server = new FakeServer();
    const timers = new ManualTimers();
    // What the guard protects against: the server committed A's command but the response was lost,
    // and the same opId is later replayed under B's session (a client without `asUser`).
    const box = make(server, { schedule: timers.schedule, send: (cmds) => server.send(cmds) });
    await box.start();
    server.loseResponses = 1;
    const opId = await box.enqueue('counter.add', 1);
    await box.flush();
    expect(server.applied).toHaveLength(1);
    server.actor = 'teacher-b';
    await timers.fireAll();
    await box.flush();
    const [rejected] = box.getStatus().rejected;
    expect(rejected).toMatchObject({ opId, error: { code: 'CONFLICT', reason: 'OP_ID_REUSED' } });
    expect(isRetryable(rejected!)).toBe(false);
    await box.retry(opId);
    await box.flush();
    expect(server.applied).toHaveLength(1); // not applied a second time
    expect((await box.all()).map((o) => o.state)).toEqual(['rejected']);
    await box.dismiss(opId);
    expect(await box.all()).toEqual([]);
  });

  it('classifies failures by HTTP status', () => {
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('transient');
    expect(classifyFailure({ status: 500 })).toBe('transient');
    expect(classifyFailure({ status: 429 })).toBe('transient');
    expect(classifyFailure({ status: 401 })).toBe('auth');
    expect(classifyFailure({ status: 400 })).toBe('reject');
    expect(classifyFailure({ status: 403 })).toBe('reject');
    expect(classifyFailure({ status: 409, details: { reason: 'WRONG_ACCOUNT' } })).toBe('auth');
    expect(classifyFailure({ status: 403, details: { reason: 'MUST_CHANGE_PASSWORD' } })).toBe('auth');
  });
});
