/**
 * Offline-safe command outbox (UX-10, UX-11, CNT-5, D-006).
 *
 * Every classroom write becomes a command with a client-generated UUIDv7 `opId`. The command is
 * written to IndexedDB (Dexie) BEFORE anything is sent, so a refresh, crash or lost connection never
 * loses it. A single-flight sender posts pending commands in enqueue order (batches) to
 * `/api/commands`; the server deduplicates by opId in the same transaction, so re-sending after a
 * lost response never applies an action twice (the server answers `replayed: true`).
 *
 * Outcomes per command:
 *  - ok (fresh or replayed)          → removed from the queue, success listeners run (query invalidation)
 *  - rejected by the server          → kept with state 'rejected' for the Needs-attention tray (Retry/Dismiss)
 *  - network error / 5xx / 429       → stays pending; retried with exponential backoff
 *  - 401 (signed out)                → paused until `resume()` after the next sign-in
 * Offline (navigator.onLine false) nothing is sent; the `online` event resumes sending.
 *
 * The module is framework-free so it can be unit-tested with fake-indexeddb; the React binding is
 * `useOutboxStatus()` in outbox-client.ts.
 */
import { Dexie, type Table } from 'dexie';
import { v7 as uuidv7 } from 'uuid';
import type { CommandEnvelope, CommandResult } from '../../shared/contracts/commands.ts';

export interface OutboxOp {
  /** Auto-increment key: the enqueue order, preserved when sending. */
  seq?: number;
  opId: string;
  type: string;
  payload: unknown;
  lessonId?: string | undefined;
  contextId?: string | undefined;
  clientTime: number;
  state: 'pending' | 'rejected';
  attempts: number;
  error?: { code: string; message: string } | undefined;
  createdAt: number;
}

export interface OutboxStatus {
  /** Commands waiting to be sent (not counting rejected ones). */
  pending: number;
  /** A request is in flight. */
  sending: boolean;
  online: boolean;
  /** The server said we are signed out; waiting for `resume()`. */
  authPaused: boolean;
  /** Commands the server refused; shown in the Needs-attention tray. */
  rejected: OutboxOp[];
  /** Time of the last successful save (ms), or null. */
  lastSavedAt: number | null;
  /** When the next automatic retry happens after a failure (ms), or null. */
  retryAt: number | null;
  /** Consecutive transient failures. */
  failures: number;
}

export type SendFn = (commands: CommandEnvelope[]) => Promise<CommandResult[]>;
export type FailureKind = 'transient' | 'auth' | 'reject';
type Timer = { cancel: () => void };

export interface OutboxOptions {
  dbName?: string;
  send: SendFn;
  isOnline?: () => boolean;
  /** Where `online` / `offline` events come from (window in the browser). */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => Timer;
  newOpId?: () => string;
  batchSize?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide what a thrown send error means. Default: by HTTP status (see `classifyFailure`). */
  classify?: (err: unknown) => FailureKind;
  /** Serialise sending across browser tabs (Web Locks); optional. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Default failure classification by the HTTP status carried on the error (ApiError has `status`). */
export function classifyFailure(err: unknown): FailureKind {
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
  if (status === 401) return 'auth';
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 413 || status === 422) return 'reject';
  return 'transient'; // network failures (no status), 5xx, 429, 423
}

export const backoffDelay = (failures: number, base: number, max: number) => Math.min(max, base * 2 ** Math.max(0, failures - 1));

export interface Outbox {
  enqueue(type: string, payload: unknown, meta?: { lessonId?: string | undefined; contextId?: string | undefined }): Promise<string>;
  start(): Promise<void>;
  stop(): void;
  /** Try to send now (single-flight: concurrent calls share one run). */
  flush(): Promise<void>;
  /** Re-queue a rejected command under a NEW opId (the old one is recorded as rejected on the server). */
  retry(opId: string): Promise<void>;
  dismiss(opId: string): Promise<void>;
  /** After signing in again. */
  resume(): Promise<void>;
  getStatus(): OutboxStatus;
  subscribe(fn: () => void): () => void;
  onSuccess(fn: (op: OutboxOp, result: CommandResult) => void): () => void;
  /** All stored commands in order (diagnostics/tests). */
  all(): Promise<OutboxOp[]>;
  close(): void;
}

type OutboxDb = Dexie & { ops: Table<OutboxOp, number> };

function openDb(name: string): OutboxDb {
  const db = new Dexie(name) as OutboxDb;
  db.version(1).stores({ ops: '++seq, &opId, state' });
  return db;
}

const defaultSchedule = (fn: () => void, ms: number): Timer => {
  const h = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(h) };
};

export function createOutbox(opts: OutboxOptions): Outbox {
  const db = openDb(opts.dbName ?? 'cc-outbox');
  const send = opts.send;
  const isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? defaultSchedule;
  const newOpId = opts.newOpId ?? (() => uuidv7());
  const batchSize = opts.batchSize ?? 20;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const classify = opts.classify ?? classifyFailure;
  const lock = opts.lock ?? (<T,>(fn: () => Promise<T>) => fn());
  const events = opts.events === undefined ? (typeof window === 'undefined' ? null : window) : opts.events;

  let status: OutboxStatus = { pending: 0, sending: false, online: isOnline(), authPaused: false, rejected: [], lastSavedAt: null, retryAt: null, failures: 0 };
  const listeners = new Set<() => void>();
  const successListeners = new Set<(op: OutboxOp, result: CommandResult) => void>();
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = true;
  let retryTimer: Timer | null = null;

  const setStatus = (patch: Partial<OutboxStatus>) => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  };

  async function refresh() {
    const [pending, rejected] = await Promise.all([
      db.ops.where('state').equals('pending').count(),
      db.ops.where('state').equals('rejected').sortBy('seq'),
    ]);
    setStatus({ pending, rejected, online: isOnline() });
  }

  const canSend = () => !stopped && isOnline() && !status.authPaused && retryTimer === null;

  const envelope = (op: OutboxOp): CommandEnvelope => ({
    opId: op.opId,
    type: op.type,
    payload: op.payload,
    clientTime: op.clientTime,
    ...(op.lessonId ? { lessonId: op.lessonId } : {}),
    ...(op.contextId ? { contextId: op.contextId } : {}),
  });

  function scheduleRetry() {
    const failures = status.failures + 1;
    const delay = backoffDelay(failures, baseDelay, maxDelay);
    retryTimer?.cancel();
    retryTimer = schedule(() => {
      retryTimer = null;
      setStatus({ retryAt: null });
      void kick();
    }, delay);
    setStatus({ failures, retryAt: now() + delay });
  }

  /** Send pending commands in order until the queue is empty or sending must pause. */
  async function drain() {
    while (canSend()) {
      const batch = await db.ops
        .orderBy('seq')
        .filter((o) => o.state === 'pending')
        .limit(batchSize)
        .toArray();
      if (batch.length === 0) return;
      setStatus({ sending: true });
      let results: CommandResult[];
      try {
        results = await send(batch.map(envelope));
      } catch (err) {
        setStatus({ sending: false });
        const kind = classify(err);
        if (kind === 'auth') {
          setStatus({ authPaused: true });
          return;
        }
        if (kind === 'reject') {
          // The whole request was refused (e.g. malformed): park the batch for the teacher.
          const message = err instanceof Error ? err.message : 'Rejected';
          const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : 'REJECTED';
          await db.ops.bulkUpdate(batch.map((o) => ({ key: o.seq!, changes: { state: 'rejected' as const, error: { code, message } } })));
          await refresh();
          continue;
        }
        // Transient: keep the same opIds (the server may already have committed some of them).
        await db.ops.bulkUpdate(batch.map((o) => ({ key: o.seq!, changes: { attempts: o.attempts + 1 } })));
        scheduleRetry();
        return;
      }
      setStatus({ sending: false });
      const byId = new Map(results.map((r) => [r.opId, r]));
      let missing = false;
      for (const op of batch) {
        const r = byId.get(op.opId);
        if (!r) {
          missing = true;
          continue;
        }
        if (r.ok) {
          await db.ops.delete(op.seq!);
          successListeners.forEach((l) => {
            try {
              l(op, r);
            } catch {
              /* a listener must never break the queue */
            }
          });
        } else {
          await db.ops.update(op.seq!, { state: 'rejected', error: r.error ?? { code: 'REJECTED', message: 'Rejected' }, attempts: op.attempts + 1 });
        }
      }
      setStatus({ failures: 0, lastSavedAt: now() });
      await refresh();
      if (missing) {
        // The server did not answer for some commands: treat like a transient failure (same opIds).
        scheduleRetry();
        return;
      }
    }
  }

  function kick(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await lock(drain);
        } while (again && canSend());
      } finally {
        running = null;
        setStatus({ sending: false });
        await refresh().catch(() => undefined);
      }
    })();
    return running;
  }

  const onOnline = () => {
    // Coming back online: try immediately instead of waiting for the backoff timer.
    retryTimer?.cancel();
    retryTimer = null;
    setStatus({ online: true, retryAt: null });
    void kick();
  };
  const onOffline = () => setStatus({ online: false });

  function stop() {
    stopped = true;
    events?.removeEventListener('online', onOnline);
    events?.removeEventListener('offline', onOffline);
    retryTimer?.cancel();
    retryTimer = null;
  }

  return {
    async enqueue(type, payload, meta = {}) {
      const op: OutboxOp = {
        opId: newOpId(),
        type,
        payload,
        lessonId: meta.lessonId,
        contextId: meta.contextId,
        clientTime: now(),
        state: 'pending',
        attempts: 0,
        createdAt: now(),
      };
      await db.ops.add(op); // persisted BEFORE any network activity
      await refresh();
      void kick();
      return op.opId;
    },
    async start() {
      if (!stopped) return;
      stopped = false;
      events?.addEventListener('online', onOnline);
      events?.addEventListener('offline', onOffline);
      await refresh();
      await kick();
    },
    stop,
    flush: () => kick(),
    async retry(opId) {
      const op = await db.ops.where('opId').equals(opId).first();
      if (!op || op.state !== 'rejected') return;
      await db.transaction('rw', db.ops, async () => {
        await db.ops.delete(op.seq!);
        const { seq: _seq, error: _error, ...rest } = op;
        await db.ops.add({ ...rest, opId: newOpId(), state: 'pending', attempts: 0, clientTime: now() });
      });
      await refresh();
      void kick();
    },
    async dismiss(opId) {
      await db.ops.where('opId').equals(opId).delete();
      await refresh();
    },
    async resume() {
      setStatus({ authPaused: false });
      await kick();
    },
    getStatus: () => status,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onSuccess(fn) {
      successListeners.add(fn);
      return () => successListeners.delete(fn);
    },
    all: () => db.ops.orderBy('seq').toArray(),
    close() {
      stop();
      db.close();
    },
  };
}

/** Badge state derived from the outbox status (UX-10). */
export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'offline'; count: number } | { kind: 'error'; count: number };

export function saveStateOf(s: OutboxStatus): SaveState {
  if (s.rejected.length > 0) return { kind: 'error', count: s.rejected.length };
  if (s.pending > 0 && (!s.online || s.authPaused || s.retryAt !== null)) return { kind: 'offline', count: s.pending };
  if (s.pending > 0 || s.sending) return { kind: 'saving' };
  if (s.lastSavedAt !== null) return { kind: 'saved' };
  return { kind: 'idle' };
}
