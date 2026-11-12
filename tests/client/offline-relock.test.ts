// @vitest-environment jsdom
/**
 * Opening the classroom from this device's copy relocks the server session as soon as it can be
 * reached (S26b review; D-190, PIN-6, PIN-8): with no connection the classroom route never told the
 * server to engage classroom mode, so the server's session may still be PIN-unlocked (or out of
 * classroom mode). The next `me` first calls "enter classroom", and an answer read before that is
 * never trusted. A guard that waits too long for the server opens the copy. Fictional data only.
 */
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Auth from '../../src/shared/contracts/auth.ts';

const calls: string[] = [];
/** The server's session as the fake API sees it. */
const server = { classroomMode: false, pinUnlocked: true, reachable: true };
const me = (over: Record<string, unknown> = {}) => ({
  kind: 'user',
  id: 'u1',
  displayName: 'Ayşe Demo',
  role: 'teacher',
  locale: 'en',
  textScale: 1,
  density: 'normal',
  mustChangePassword: false,
  hasPin: true,
  signInMethod: 'password',
  hasEmail: false,
  reauthFresh: false,
  pinUnlockedUntil: null,
  ...over,
});
let meHook: (() => void) | null = null;

vi.mock('../../src/client/lib/api.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/client/lib/api.ts')>();
  return {
    ...real,
    call: vi.fn(async (ep: { path: string }) => {
      calls.push(ep.path);
      if (!server.reachable) throw new TypeError('Failed to fetch');
      if (ep.path === Auth.enterClassroom.path) {
        server.classroomMode = true;
        server.pinUnlocked = false;
        return { classroomMode: true };
      }
      if (ep.path === Auth.me.path) {
        const answer = me({ classroomMode: server.classroomMode, pinUnlocked: server.classroomMode ? server.pinUnlocked : true });
        meHook?.();
        return answer;
      }
      throw new Error(`unexpected ${ep.path}`);
    }),
  };
});

const session = await import('../../src/client/lib/session.ts');
const offline = await import('../../src/client/lib/offlineClassroom.ts');
const { requireClassroomSession, SESSION_TIMEOUT_MS } = await import('../../src/client/routes/guards.ts');

const location = { href: '/classroom', pathname: '/classroom' } as never;
let n = 0;
let store: ReturnType<typeof offline.createOfflineStore>;

beforeEach(async () => {
  calls.length = 0;
  meHook = null;
  Object.assign(server, { classroomMode: false, pinUnlocked: true, reachable: true });
  n += 1;
  store = offline.createOfflineStore({ dbName: `cc-offline-relock-${n}` });
  offline.setOfflineStoreForTests(store);
  await store.saveSession(me({ classroomMode: true, pinUnlocked: true }) as never);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  offline.setOfflineStoreForTests(null);
  store.close();
  // Leave no relock pending for the next test.
  server.reachable = true;
  await session.fetchMe().catch(() => null);
});

describe('the classroom opened offline relocks on reconnect (PIN-6, review of S26b)', () => {
  it('teacher area unlocked, then the classroom opened offline: back online, the first me relocks first', async () => {
    // Scenario A: the server still says PIN-unlocked (and B: out of classroom mode) when the network returns.
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    server.reachable = false;
    const qc = new QueryClient();
    const r = await requireClassroomSession({ context: { queryClient: qc }, location });
    expect(r.offline).toBe(true);
    expect(r.me.pinUnlocked).toBe(false);
    expect(session.relockIsPending()).toBe(true);

    // Still offline: me cannot be read and the lock stays pending; the locked copy stays.
    await expect(session.freshMe(qc)).rejects.toBeInstanceOf(TypeError);
    expect(session.relockIsPending()).toBe(true);
    expect(qc.getQueryData<{ pinUnlocked: boolean }>(session.ME_KEY)?.pinUnlocked).toBe(false);

    // Back online (the teacher taps Teacher area: its guard asks for me): enter classroom first.
    vi.unstubAllGlobals();
    server.reachable = true;
    calls.length = 0;
    const fresh = await session.freshMe(qc);
    expect(calls).toEqual([Auth.enterClassroom.path, Auth.me.path]);
    expect(fresh).toMatchObject({ classroomMode: true, pinUnlocked: false });
    expect(session.isLocked(fresh)).toBe(true);
    expect(session.relockIsPending()).toBe(false);

    // Afterwards me is read as usual.
    calls.length = 0;
    await session.freshMe(qc);
    expect(calls).toEqual([Auth.me.path]);
  });

  it('a me answer that was on its way when the copy was restored is not trusted', async () => {
    // The copy is restored (the guard timed out) while the server's unlocked answer is on its way.
    meHook = () => {
      meHook = null;
      session.requireRelock();
    };
    server.classroomMode = true;
    server.pinUnlocked = true;
    const answer = await session.fetchMe();
    expect(calls).toEqual([Auth.me.path, Auth.enterClassroom.path, Auth.me.path]);
    expect(answer).toMatchObject({ classroomMode: true, pinUnlocked: false });
  });

  it('a server that takes requests but never answers: the copy opens after the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const qc = new QueryClient();
    let release: (() => void) | null = null;
    const { call } = await import('../../src/client/lib/api.ts');
    vi.mocked(call).mockImplementationOnce(() => new Promise((_resolve, reject) => (release = () => reject(new TypeError('Failed to fetch')))));
    const p = requireClassroomSession({ context: { queryClient: qc }, location });
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS + 10);
    const r = await p;
    expect(r.offline).toBe(true);
    expect(r.me.pinUnlocked).toBe(false);
    expect(session.relockIsPending()).toBe(true);
    (release as (() => void) | null)?.();
  });

  it('a server that answers in time is followed, never the copy', async () => {
    server.classroomMode = true;
    server.pinUnlocked = false;
    const r = await requireClassroomSession({ context: { queryClient: new QueryClient() }, location });
    expect(r.offline).toBe(false);
    expect(session.relockIsPending()).toBe(false);
  });
});
