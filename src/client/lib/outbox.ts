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
 * Shared classroom PCs (ACC-9, UX-11): every command records the account that queued it (`ownerId`).
 * Only the current owner's commands are sent, counted and shown; the request carries `asUser` and the
 * server refuses it (409 WRONG_ACCOUNT) if another account is signed in, so another teacher's queued
 * commands are never applied or audited as the wrong person. They stay parked on the device until
 * their owner signs in again. With no owner (signed out) nothing is sent and nothing can be enqueued.
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
  /** User id of the account that queued the command; only that account ever sends it. */
  ownerId?: string | undefined;
  type: string;
  payload: unknown;
  lessonId?: string | undefined;
  contextId?: string | undefined;
  clientTime: number;
  state: 'pending' | 'rejected';
  attempts: number;
  error?: OutboxError | undefined;
  createdAt: number;
}

export interface OutboxError {
  code: string;
  /** English diagnostics only; the UI translates `reason`/`code`. */
  message: string;
  reason?: string | undefined;
}

/** Refusals a retry can never change: the command can only be dismissed. */
const FINAL_REASONS = new Set(['OP_ID_REUSED', 'UNKNOWN_COMMAND', 'START_STALE']);

/**
 * Retry re-sends under a NEW opId (D-035). That is only safe when the server definitely did not apply
 * the original: an opId conflict means it may have been applied already (possibly under another
 * account), so those commands can only be dismissed. A lesson start made on an earlier day
 * (`START_STALE`) is refused again on every retry (its day never comes back), so it is dismiss-only too.
 */
export const isRetryable = (op: OutboxOp) => !FINAL_REASONS.has(op.error?.reason ?? '');

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
  /** Commands on this device that belong to other accounts (parked, never sent or shown here). */
  otherAccounts: number;
  /** Time of the last successful save (ms), or null. */
  lastSavedAt: number | null;
  /** When the next automatic retry happens after a failure (ms), or null. */
  retryAt: number | null;
  /** Consecutive transient failures. */
  failures: number;
}

export type SendFn = (commands: CommandEnvelope[], asUser: string) => Promise<CommandResult[]>;
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
  /** The signed-in account at start (usually set later with `setOwner`). */
  owner?: string | null;
  /** Serialise sending across browser tabs (Web Locks); optional. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

function reasonOf(err: unknown): string | undefined {
  const details = typeof err === 'object' && err !== null && 'details' in err ? (err as { details: unknown }).details : undefined;
  const reason = typeof details === 'object' && details !== null && 'reason' in details ? (details as { reason: unknown }).reason : undefined;
  return typeof reason === 'string' ? reason : undefined;
}

/** Default failure classification by the HTTP status carried on the error (ApiError has `status`). */
export function classifyFailure(err: unknown): FailureKind {
  // Another account is signed in, or the account must change its temporary password: wait, do not park.
  if (reasonOf(err) === 'WRONG_ACCOUNT' || reasonOf(err) === 'MUST_CHANGE_PASSWORD') return 'auth';
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
  if (status === 401) return 'auth';
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 413 || status === 422) return 'reject';
  return 'transient'; // network failures (no status), 5xx, 429, 423
}

export const backoffDelay = (failures: number, base: number, max: number) => Math.min(max, base * 2 ** Math.max(0, failures - 1));

export interface Outbox {
  /** Queue a command for the current owner. Throws when nobody is signed in. */
  enqueue(type: string, payload: unknown, meta?: { lessonId?: string | undefined; contextId?: string | undefined }): Promise<string>;
  /** The signed-in account changed (sign-in, sign-out, user switch). Null = nobody: nothing is sent. */
  setOwner(userId: string | null): Promise<void>;
  getOwner(): string | null;
  start(): Promise<void>;
  stop(): void;
  /** Try to send now (single-flight: concurrent calls share one run). */
  flush(): Promise<void>;
  /** Re-queue a rejected command under a NEW opId (the old one is recorded as rejected on the server). Ignored unless `isRetryable` and owned. */
  retry(opId: string): Promise<void>;
  dismiss(opId: string): Promise<void>;
  /** After signing in again (as `ownerId`, which becomes the owner). */
  resume(ownerId?: string): Promise<void>;
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

  let owner: string | null = opts.owner ?? null;
  let status: OutboxStatus = { pending: 0, sending: false, online: isOnline(), authPaused: false, rejected: [], otherAccounts: 0, lastSavedAt: null, retryAt: null, failures: 0 };
  const listeners = new Set<() => void>();
  const successListeners = new Set<(op: OutboxOp, result: CommandResult) => void>();
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = true;
  let retryTimer: Timer | null = null;
  /**
   * Commands handed to `enqueue` whose IndexedDB write has not finished yet. They count as pending
   * from the moment `enqueue` is called: the screen already shows their optimistic change, so a
   * "queue is empty" check in that gap (deferred invalidations, the lesson poll) would let a server
   * answer without them overwrite it.
   */
  const reserved = new Set<string>();

  const setStatus = (patch: Partial<OutboxStatus>) => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  };

  const mine = (o: OutboxOp) => owner !== null && o.ownerId === owner;

  async function refresh() {
    const all = await db.ops.orderBy('seq').toArray();
    const own = all.filter(mine);
    setStatus({
      pending: new Set([...own.filter((o) => o.state === 'pending').map((o) => o.opId), ...reserved]).size,
      rejected: own.filter((o) => o.state === 'rejected'),
      otherAccounts: all.length - own.length,
      online: isOnline(),
    });
  }

  const canSend = () => !stopped && owner !== null && isOnline() && !status.authPaused && retryTimer === null;

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
      const asUser = owner!;
      const batch = await db.ops
        .orderBy('seq')
        .filter((o) => o.state === 'pending' && o.ownerId === asUser)
        .limit(batchSize)
        .toArray();
      if (batch.length === 0) return;
      setStatus({ sending: true });
      let results: CommandResult[];
      try {
        results = await send(batch.map(envelope), asUser);
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
          const reason = reasonOf(err);
          const error: OutboxError = { code, message, ...(reason ? { reason } : {}) };
          await db.ops.bulkUpdate(batch.map((o) => ({ key: o.seq!, changes: { state: 'rejected' as const, error } })));
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

  async function setOwner(userId: string | null) {
    if (userId === owner) return;
    owner = userId;
    // A different account (or none): a pause or backoff caused by the previous account no longer applies.
    retryTimer?.cancel();
    retryTimer = null;
    setStatus({ authPaused: false, failures: 0, retryAt: null, lastSavedAt: null });
    await refresh();
    if (owner !== null) await kick();
  }

  function stop() {
    stopped = true;
    events?.removeEventListener('online', onOnline);
    events?.removeEventListener('offline', onOffline);
    retryTimer?.cancel();
    retryTimer = null;
  }

  return {
    async enqueue(type, payload, meta = {}) {
      if (owner === null) throw new Error('Outbox: no signed-in account to queue commands for');
      const op: OutboxOp = {
        opId: newOpId(),
        ownerId: owner,
        type,
        payload,
        lessonId: meta.lessonId,
        contextId: meta.contextId,
        clientTime: now(),
        state: 'pending',
        attempts: 0,
        createdAt: now(),
      };
      // Counted as pending at once (synchronously), before the IndexedDB write.
      reserved.add(op.opId);
      setStatus({ pending: status.pending + 1 });
      try {
        await db.ops.add(op); // persisted BEFORE any network activity
      } finally {
        reserved.delete(op.opId);
        await refresh();
      }
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
    setOwner,
    getOwner: () => owner,
    async retry(opId) {
      const op = await db.ops.where('opId').equals(opId).first();
      if (!op || op.state !== 'rejected' || !mine(op) || !isRetryable(op)) return;
      await db.transaction('rw', db.ops, async () => {
        await db.ops.delete(op.seq!);
        const { seq: _seq, error: _error, ...rest } = op;
        await db.ops.add({ ...rest, opId: newOpId(), state: 'pending', attempts: 0, clientTime: now() });
      });
      await refresh();
      void kick();
    },
    async dismiss(opId) {
      // Only the owner can drop their own commands; another teacher's parked commands are untouchable.
      await db.ops
        .where('opId')
        .equals(opId)
        .filter((o) => mine(o))
        .delete();
      await refresh();
    },
    async resume(ownerId) {
      if (ownerId !== undefined && ownerId !== owner) return setOwner(ownerId);
      setStatus({ authPaused: false });
      await refresh();
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
