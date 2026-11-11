/**
 * The classroom's last data on this device for an offline cold start (S26b, D-190; D-006, UX-11,
 * PIN-8): which queries are kept, for whom, how long, and when the copy is forgotten.
 */
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createOfflineStore,
  installOfflineClassroom,
  isOfflineKey,
  isUnreachable,
  lockedMe,
  MAX_AGE_MS,
  restoreOfflineClassroom,
  setClassroomOpen,
  setOfflineStoreForTests,
  type OfflineStore,
} from '../../src/client/lib/offlineClassroom.ts';
import { ApiError } from '../../src/client/lib/api.ts';
import type { Me } from '../../src/client/lib/session.ts';

const teacher: Me = {
  kind: 'user',
  id: 'u-ayse',
  displayName: 'Ayşe Demo',
  role: 'teacher',
  locale: 'tr',
  textScale: 1,
  density: 'normal',
  mustChangePassword: false,
  hasPin: true,
  signInMethod: 'password',
  hasEmail: false,
  reauthFresh: true,
  classroomMode: false,
  pinUnlockedUntil: 123,
  pinUnlocked: true,
} as Me;
const roster = { students: [{ id: 's1', displayName: 'Deniz Örnek' }] };

let n = 0;
let clock = 1_700_000_000_000;
let store: OfflineStore;
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  n += 1;
  clock = 1_700_000_000_000;
  store = createOfflineStore({ dbName: `cc-offline-test-${n}`, now: () => clock });
  setOfflineStoreForTests(store);
});
afterEach(() => {
  setOfflineStoreForTests(null);
  store.close();
});

describe('which data is kept (D-190)', () => {
  it('keeps only classroom-safe keys the board and the start need', () => {
    for (const k of [
      ['classroom', 'contexts'],
      ['classroom', 'lesson', 'c1'],
      ['classroom', 'roster', 'c1', 'today'],
      ['classroom', 'lessons', 'active'],
      ['classroom', 'routines', 'c1'],
      ['classroom', 'avatars'],
      ['classroom', 'layout', 'c1'],
      ['classroom', 'lessonPrefs'],
      ['classroom', 'topics', 'c1'],
      ['classroom', 'assistant', 'today', 'c1'],
      ['themes', 'available'],
    ])
      expect(isOfflineKey(k), JSON.stringify(k)).toBe(true);
    for (const k of [
      ['sensitive', 'teacher', 'reports'],
      ['classroom', 'secret', 'l1'],
      ['classroom', 'studentCard', 'c1', 's1'],
      ['classroom', 'summary', 'l1'],
      ['classroom', 'assistant', 'week', 'c1'],
      ['classroom', 'achievements', 'c1', null],
      ['classroom', 'weather'],
      ['me'],
      ['public', 'signin'],
      ['themes', 'available', 'x'],
    ])
      expect(isOfflineKey(k), JSON.stringify(k)).toBe(false);
  });

  it('stores the account PIN-locked and in classroom mode (PIN-8)', () => {
    expect(lockedMe(teacher)).toMatchObject({ classroomMode: true, pinUnlocked: false, pinUnlockedUntil: null, reauthFresh: false });
  });

  it('counts a missing connection or a gateway error as unreachable, never an answer of the server', () => {
    expect(isUnreachable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isUnreachable(new ApiError(503, 'X', 'down'))).toBe(true);
    expect(isUnreachable(new ApiError(401, 'UNAUTHENTICATED', 'no'))).toBe(false);
    expect(isUnreachable(new ApiError(423, 'PIN_REQUIRED', 'no'))).toBe(false);
    expect(isUnreachable(new Error('x'))).toBe(false);
  });
});

describe('the store (D-190)', () => {
  it('loads what was saved for the account, the lesson state without its ETag', async () => {
    await store.saveSession(teacher);
    await store.saveQuery(teacher.id, ['classroom', 'roster', 'c1', 'today'], roster);
    await store.saveQuery(teacher.id, ['classroom', 'lesson', 'c1'], { etag: 'W/"7"', data: { lesson: null } });
    const snap = await store.load();
    expect(snap?.me).toMatchObject({ id: teacher.id, pinUnlocked: false });
    expect(snap?.queries.find((q) => q.queryKey[1] === 'roster')?.data).toEqual(roster);
    expect(snap?.queries.find((q) => q.queryKey[1] === 'lesson')?.data).toEqual({ etag: null, data: { lesson: null } });
  });

  it('keeps nothing for a query without a saved account, or of another account', async () => {
    await store.saveQuery(teacher.id, ['classroom', 'contexts'], { contexts: [] });
    expect(await store.load()).toBeNull();
    await store.saveSession(teacher);
    await store.saveQuery('u-other', ['classroom', 'contexts'], { contexts: [] });
    expect((await store.load())?.queries).toEqual([]);
  });

  it('forgets a copy older than 7 days', async () => {
    await store.saveSession(teacher);
    await store.saveQuery(teacher.id, ['classroom', 'contexts'], { contexts: [] });
    clock += MAX_AGE_MS - 1000;
    expect(await store.load()).not.toBeNull();
    clock += 2000;
    expect(await store.load()).toBeNull();
    clock -= 2000; // even a clock set back cannot bring it back: it is deleted
    expect(await store.load()).toBeNull();
  });

  it('another account signing in on this device clears the previous one’s data', async () => {
    await store.saveSession(teacher);
    await store.saveQuery(teacher.id, ['classroom', 'contexts'], { contexts: [] });
    await store.saveSession({ ...teacher, id: 'u-mehmet' });
    const snap = await store.load();
    expect(snap?.me.id).toBe('u-mehmet');
    expect(snap?.queries).toEqual([]);
  });
});

describe('following the query cache (D-190)', () => {
  it('copies classroom data only while the classroom is open, and restores it PIN-locked', async () => {
    const qc = new QueryClient();
    installOfflineClassroom(qc);
    qc.setQueryData(['me'], teacher);
    // Signed in through the server (not a manual write): the fetch path.
    await qc.fetchQuery({ queryKey: ['me'], queryFn: () => teacher, staleTime: 0 });
    await qc.fetchQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => ({ contexts: [{ id: 'c1' }] }) });
    await settle();
    expect(await store.load()).toBeNull(); // not yet: the classroom was not open
    setClassroomOpen(true);
    await settle();
    await qc.fetchQuery({ queryKey: ['classroom', 'roster', 'c1', 'today'], queryFn: () => roster });
    await qc.fetchQuery({ queryKey: ['sensitive', 'teacher', 'notes'], queryFn: () => ({ notes: ['private'] }) });
    await qc.fetchQuery({ queryKey: ['classroom', 'secret', 'l1'], queryFn: () => ({ studentId: 's1' }) });
    await settle();
    setClassroomOpen(false);

    const fresh = new QueryClient();
    const me = await restoreOfflineClassroom(fresh);
    expect(me).toMatchObject({ id: teacher.id, pinUnlocked: false, classroomMode: true });
    expect(fresh.getQueryData(['me'])).toEqual(me);
    expect(fresh.getQueryData(['classroom', 'contexts'])).toEqual({ contexts: [{ id: 'c1' }] });
    expect(fresh.getQueryData(['classroom', 'roster', 'c1', 'today'])).toEqual(roster);
    expect(fresh.getQueryData(['sensitive', 'teacher', 'notes'])).toBeUndefined();
    expect(fresh.getQueryData(['classroom', 'secret', 'l1'])).toBeUndefined();
  });

  it('forgets the copy when the device is signed out (sign-out, or a 401 after a revoked session)', async () => {
    const qc = new QueryClient();
    installOfflineClassroom(qc);
    setClassroomOpen(true);
    await qc.fetchQuery({ queryKey: ['me'], queryFn: () => teacher });
    await qc.fetchQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => ({ contexts: [] }) });
    await settle();
    expect(await store.load()).not.toBeNull();
    // resetSignedOut writes the signed-out state by hand.
    qc.setQueryData(['me'], null);
    await settle();
    expect(await store.load()).toBeNull();
    setClassroomOpen(false);
  });

  it('a restored copy does not renew its own age: only the server confirming the session does', async () => {
    const qc = new QueryClient();
    installOfflineClassroom(qc);
    setClassroomOpen(true);
    await qc.fetchQuery({ queryKey: ['me'], queryFn: () => teacher });
    await settle();
    setClassroomOpen(false);
    const savedAt = (await store.load())!.savedAt;

    clock += 3 * 24 * 60 * 60 * 1000;
    const offline = new QueryClient();
    installOfflineClassroom(offline);
    await restoreOfflineClassroom(offline);
    setClassroomOpen(true);
    await settle();
    expect((await store.load())!.savedAt).toBe(savedAt);

    // Back online: the server answers, the copy is renewed.
    await offline.fetchQuery({ queryKey: ['me'], queryFn: () => teacher, staleTime: 0 });
    await settle();
    expect((await store.load())!.savedAt).toBe(clock);
    setClassroomOpen(false);
  });

  it('nothing to restore gives null (the route then waits for the server as before)', async () => {
    expect(await restoreOfflineClassroom(new QueryClient())).toBeNull();
  });
});
