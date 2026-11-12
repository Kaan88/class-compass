/**
 * The last classroom data on this device, for an offline cold start (S26b, D-190; D-006).
 *
 * The service worker never caches API answers. Instead, while the classroom screen is open, this
 * module keeps a copy of the classroom-safe queries the screen needs to show the board and start a
 * lesson (the teacher's classes, the lesson state, today's roster with names and avatars, routines,
 * layout, topics, today's assistant, lesson preferences, the enabled imported themes) and of the
 * signed-in account (`me`, always stored PIN-locked) in IndexedDB. When the classroom page is opened
 * or reloaded with no connection, the route guard puts them back into the query cache so the board
 * shows and a lesson can be started (the start waits in the outbox).
 *
 * Boundaries:
 * - only keys in OFFLINE_KEYS (never `['sensitive', …]`, never Secret Student, student cards, summaries
 *   or anything of the teacher area); only while the classroom screen is open;
 * - one account: a different account signing in, a sign-out, an expired or revoked session (401,
 *   e.g. after too many wrong PINs) all clear it (the `me` query becoming null or another account);
 * - at most MAX_AGE_MS old (7 days): older copies are deleted, never shown;
 * - used only when the server cannot be reached; online the server is always asked (PIN-8).
 */
import { Dexie, type Table } from 'dexie';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { requireRelock, type Me } from './session.ts';

export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ME_ROOT = 'me';

/** Second part of the `['classroom', …]` keys kept for an offline start. */
const CLASSROOM_PARTS = new Set(['contexts', 'lesson', 'roster', 'lessons', 'routines', 'avatars', 'layout', 'lessonPrefs', 'topics']);

/** Is this query kept for an offline cold start? (pure; exported for tests) */
export function isOfflineKey(key: QueryKey): boolean {
  if (key[0] === 'classroom') {
    const part = key[1];
    if (typeof part !== 'string') return false;
    if (part === 'assistant') return key[2] === 'today';
    return CLASSROOM_PARTS.has(part);
  }
  return key[0] === 'themes' && key[1] === 'available' && key.length === 2;
}

/** `me` as it is stored and restored: always PIN-locked and in classroom mode. */
export function lockedMe(me: Me): Me {
  return { ...me, classroomMode: true, pinUnlocked: false, pinUnlockedUntil: null, reauthFresh: false };
}

/** Query data as it is stored: a lesson state loses its ETag, so the first poll online is a full read. */
const storable = (key: QueryKey, data: unknown): unknown =>
  key[0] === 'classroom' && key[1] === 'lesson' && data && typeof data === 'object' && 'etag' in data ? { ...(data as object), etag: null } : data;

interface SavedQuery {
  key: string;
  userId: string;
  queryKey: QueryKey;
  data: unknown;
  savedAt: number;
}
interface SavedSession {
  id: 'me';
  userId: string;
  me: Me;
  savedAt: number;
}
export interface OfflineSnapshot {
  me: Me;
  savedAt: number;
  queries: Array<{ queryKey: QueryKey; data: unknown; savedAt: number }>;
}

type SnapshotDb = Dexie & { queries: Table<SavedQuery, string>; session: Table<SavedSession, string> };

export interface OfflineStore {
  saveSession(me: Me): Promise<void>;
  saveQuery(userId: string, queryKey: QueryKey, data: unknown): Promise<void>;
  /** The snapshot when it is fresh enough, else null (and anything too old is deleted). */
  load(): Promise<OfflineSnapshot | null>;
  clear(): Promise<void>;
  close(): void;
}

export function createOfflineStore(opts: { dbName?: string; now?: () => number } = {}): OfflineStore {
  const db = new Dexie(opts.dbName ?? 'cc-offline-classroom') as SnapshotDb;
  db.version(1).stores({ queries: '&key, userId', session: '&id' });
  const now = opts.now ?? Date.now;
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback; // private windows and blocked storage: no offline start, nothing breaks
    }
  };
  const clear = () => safe(() => db.transaction('rw', db.queries, db.session, async () => Promise.all([db.queries.clear(), db.session.clear()])).then(() => undefined), undefined);
  return {
    saveSession: (me) =>
      safe(async () => {
        const prev = await db.session.get('me');
        // Another account on this device: the previous one's copy goes first.
        if (prev && prev.userId !== me.id) await db.queries.clear();
        await db.session.put({ id: 'me', userId: me.id, me: lockedMe(me), savedAt: now() });
      }, undefined),
    saveQuery: (userId, queryKey, data) =>
      safe(async () => {
        const session = await db.session.get('me');
        if (!session || session.userId !== userId) return;
        await db.queries.put({ key: JSON.stringify(queryKey), userId, queryKey, data: storable(queryKey, data), savedAt: now() });
      }, undefined),
    load: () =>
      safe(async () => {
        const session = await db.session.get('me');
        if (!session) return null;
        const t = now();
        if (t - session.savedAt > MAX_AGE_MS || session.savedAt > t + 60_000) {
          await clear();
          return null;
        }
        const rows = await db.queries.where('userId').equals(session.userId).toArray();
        const fresh = rows.filter((r) => t - r.savedAt <= MAX_AGE_MS && isOfflineKey(r.queryKey));
        return { me: lockedMe(session.me), savedAt: session.savedAt, queries: fresh.map((r) => ({ queryKey: r.queryKey, data: r.data, savedAt: r.savedAt })) };
      }, null),
    clear,
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------- the app's copy
let store: OfflineStore | null = null;
const getStore = () => (store ??= createOfflineStore());
let classroomOpen = false;
let installedOn: QueryClient | null = null;
/**
 * The account on screen came from the device copy, not the server: it is never saved again (the
 * copy's age counts from the last time the server confirmed the session), until the server answers.
 */
let restored = false;
/** Writes made while restoring the copy are not saved back. */
let restoring = false;
/** Store writes run one after another, in the order they were asked for (a query after its account). */
let chain: Promise<void> = Promise.resolve();
const serial = (fn: (s: OfflineStore) => Promise<void>) => {
  chain = chain.then(() => fn(getStore())).catch(() => undefined);
};

/** Is this a failure to reach the server (no connection, gateway down), not an answer? */
export function isUnreachable(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
  return status === 502 || status === 503 || status === 504;
}

function saveAllOpen(qc: QueryClient) {
  const me = qc.getQueryData<Me | null>([ME_ROOT]);
  if (!me || me.role !== 'teacher' || !me.hasPin) return;
  if (!restored) serial((s) => s.saveSession(me));
  for (const q of qc.getQueryCache().getAll()) {
    if (q.state.status === 'success' && q.state.data !== undefined && isOfflineKey(q.queryKey)) serial((s) => s.saveQuery(me.id, q.queryKey, q.state.data));
  }
}

/**
 * The classroom screen is open (or closed): only then is its data copied. Opening it copies what is
 * already loaded.
 */
export function setClassroomOpen(open: boolean) {
  classroomOpen = open;
  if (open && installedOn) saveAllOpen(installedOn);
}

/** Follow the query cache: copy classroom data while the classroom is open; clear on sign-out or another account. */
export function installOfflineClassroom(qc: QueryClient) {
  if (installedOn === qc) return;
  installedOn = qc;
  const saved = new WeakMap<object, unknown>();
  let lastUser: string | null | undefined;
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success' || restoring) return;
    const key = e.query.queryKey;
    if (key[0] === ME_ROOT) {
      const me = e.query.state.data as Me | null | undefined;
      const id = me?.id ?? null;
      // Signed out on this device (sign-out, a revoked or expired session: a 401, e.g. after too many
      // wrong PINs): forget the copy. `resetSignedOut` writes this null by hand, so it counts too.
      if (id === null) {
        lastUser = null;
        serial((s) => s.clear());
        return;
      }
      // Otherwise only the server's answers count (a manual write is the device copy or a lock mark).
      if (e.action.manual) return;
      restored = false;
      // Another account on this device: the previous one's copy goes.
      if (lastUser && lastUser !== id) serial((s) => s.clear());
      lastUser = id;
      if (me && classroomOpen && me.role === 'teacher' && me.hasPin) serial((s) => s.saveSession(me));
      return;
    }
    if (!classroomOpen || !isOfflineKey(key)) return;
    const me = qc.getQueryData<Me | null>([ME_ROOT]);
    const data = e.query.state.data;
    if (!me || me.role !== 'teacher' || data === undefined) return;
    if (saved.get(e.query) === data) return; // an unchanged poll (304) is not written again
    saved.set(e.query, data);
    serial((s) => s.saveQuery(me.id, key, data));
  });
}

/** Forget the copy (sign-out from this device). */
export const clearOfflineClassroom = () => {
  serial((s) => s.clear());
  return chain;
};

/**
 * For the classroom route guard when the server cannot be reached: put the last classroom data back
 * into the query cache and return the (PIN-locked) account, or null when there is no fresh copy.
 */
export async function restoreOfflineClassroom(qc: QueryClient): Promise<Me | null> {
  await chain;
  const snap = await getStore().load();
  if (!snap) return null;
  // The server was not told to engage classroom mode: it is, before its next `me` is trusted (PIN-6).
  requireRelock();
  restoring = true;
  try {
    for (const q of snap.queries) {
      if (qc.getQueryData(q.queryKey) === undefined) qc.setQueryData(q.queryKey, q.data, { updatedAt: q.savedAt });
    }
    qc.setQueryData([ME_ROOT], snap.me, { updatedAt: snap.savedAt });
  } finally {
    restoring = false;
  }
  restored = true;
  return snap.me;
}

/** Tests: use a separate store. */
export function setOfflineStoreForTests(s: OfflineStore | null) {
  store = s;
  installedOn = null;
  classroomOpen = false;
  restored = false;
  chain = Promise.resolve();
}
