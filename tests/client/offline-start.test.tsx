// @vitest-environment jsdom
/**
 * Starting a lesson offline (S26b, D-190; D-006, LES-1, UX-10, UX-11): the start waits in the outbox,
 * the classroom shows it as saved (offline) or being sent, the teacher can take it back while offline,
 * and once the server accepts it the lesson begins. The classroom route opens from this device's copy
 * only when the server cannot be reached.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../messages.ts';
import type { CommandResult } from '../../src/shared/contracts/commands.ts';
import type { OutboxOp, OutboxStatus } from '../../src/client/lib/outbox.ts';

// ---------------------------------------------------------------- a fake outbox
const listeners = new Set<() => void>();
const successListeners = new Set<(op: OutboxOp, r: CommandResult) => void>();
let status: OutboxStatus;
const dismissed: string[] = [];
let ops: OutboxOp[] = [];
const resetStatus = (patch: Partial<OutboxStatus> = {}) => {
  status = { pending: 0, sending: false, online: true, authPaused: false, rejected: [], otherAccounts: 0, lastSavedAt: null, retryAt: null, failures: 0, ...patch };
  listeners.forEach((l) => l());
};
const box = {
  getStatus: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  onSuccess: (fn: (op: OutboxOp, r: CommandResult) => void) => {
    successListeners.add(fn);
    return () => successListeners.delete(fn);
  },
  all: async () => ops,
  dismiss: async (opId: string) => {
    dismissed.push(opId);
    ops = ops.filter((o) => o.opId !== opId);
    resetStatus({ online: false, pending: ops.length });
  },
  enqueue: async () => 'op-start',
};
vi.mock('../../src/client/lib/outbox-client.ts', () => ({
  getOutbox: () => box,
  useOutboxStatus: () => useSyncExternalStore(box.subscribe, box.getStatus, box.getStatus),
  registerInvalidation: () => undefined,
}));
vi.mock('../../src/client/lib/session.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/session.ts')>()),
  freshMe: vi.fn(),
}));

const { awaitOrQueued, useQueuedEnd, useQueuedStart } = await import('../../src/client/modules/lessons/lessonClient.ts');
const { QueuedStartCard } = await import('../../src/client/modules/lessons/StartLesson.tsx');
const { QueuedEndCard } = await import('../../src/client/modules/lessons/EndLesson.tsx');
const { clearAllToasts, useToasts } = await import('../../src/client/lib/toast.ts');
const session = await import('../../src/client/lib/session.ts');
const { requireClassroomSession } = await import('../../src/client/routes/guards.ts');
const offline = await import('../../src/client/lib/offlineClassroom.ts');

const context = { id: 'ctx1', classId: 'c1', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, timezone: 'Europe/Istanbul', modules: {} } as never;
const startOp = (opId = 'op-start'): OutboxOp => ({ opId, ownerId: 'u1', type: 'lesson.start', payload: { contextId: 'ctx1' }, contextId: 'ctx1', clientTime: 1, state: 'pending', attempts: 0, createdAt: 1 });
const succeed = (opId: string, result: unknown) => successListeners.forEach((l) => l(startOp(opId), { opId, ok: true, result } as CommandResult));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function ToastProbe() {
  const toasts = useToasts();
  return <output data-testid="toasts">{toasts.map((t) => t.message).join(' | ')}</output>;
}

beforeEach(() => {
  ops = [];
  dismissed.length = 0;
  listeners.clear();
  successListeners.clear();
  resetStatus();
});
afterEach(() => {
  cleanup();
  clearAllToasts();
  vi.unstubAllGlobals();
});

describe('a start that cannot be sent now waits in the outbox (D-190)', () => {
  it('is reported as queued at once while the device is offline', async () => {
    resetStatus({ online: false, pending: 1 });
    await expect(awaitOrQueued('op-start')).resolves.toEqual({ queued: true });
  });

  it('is reported as queued when a try fails (the server cannot be reached)', async () => {
    const p = awaitOrQueued('op-start');
    resetStatus({ pending: 1, failures: 1 });
    await expect(p).resolves.toEqual({ queued: true });
  });

  it('gives the server’s result when it is sent at once', async () => {
    const p = awaitOrQueued('op-start');
    succeed('op-start', { started: true, lessonId: 'op-start' });
    await expect(p).resolves.toEqual({ queued: false, result: { started: true, lessonId: 'op-start' } });
  });
});

describe('the queued start on the classroom screen (D-190, UX-10)', () => {
  it('offline: says the start is saved and will be sent, and lets the teacher take it back', async () => {
    ops = [startOp()];
    resetStatus({ online: false, pending: 1 });
    wrap(<QueuedStartCard context={context} opId="op-start" onStarted={() => undefined} />);
    expect(screen.getByTestId('queued-start').textContent).toContain(en['lesson.queued.offline']);
    expect(screen.getByText(en['lesson.queued.meanwhile'])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en['lesson.queued.cancel'] }));
    await act(async () => undefined);
    expect(dismissed).toEqual(['op-start']);
  });

  it('online again: says it is being sent, offers no take-back, and begins the lesson when accepted', async () => {
    ops = [startOp()];
    resetStatus({ online: true, sending: true, pending: 1 });
    const onStarted = vi.fn();
    wrap(
      <>
        <QueuedStartCard context={context} opId="op-start" onStarted={onStarted} />
        <ToastProbe />
      </>,
    );
    expect(screen.getByTestId('queued-start').textContent).toContain(en['lesson.queued.sending']);
    expect(screen.queryByRole('button', { name: en['lesson.queued.cancel'] })).toBeNull();
    await act(async () => succeed('op-start', { started: true, lessonId: 'op-start', attendanceKept: 0 }));
    expect(onStarted).toHaveBeenCalledOnce();
    expect(screen.getByTestId('toasts').textContent).toContain('3-A');
  });
});

describe('a lesson end that waits (review of S26b, D-190)', () => {
  const endOp = (opId = 'op-end'): OutboxOp => ({ opId, ownerId: 'u1', type: 'lesson.end', payload: { contextId: 'ctx1', lessonId: 'l1' }, contextId: 'ctx1', lessonId: 'l1', clientTime: 1, state: 'pending', attempts: 0, createdAt: 2 });

  function Probe() {
    const end = useQueuedEnd('ctx1', 'u1');
    const start = useQueuedStart('ctx1', 'u1');
    return <output data-testid="probe">{`${end?.opId ?? '-'}:${end?.lessonId ?? '-'}|${start?.opId ?? '-'}`}</output>;
  }

  it('a queued end is found for its lesson (so the classroom shows it instead of the board), apart from a queued start', async () => {
    ops = [endOp()];
    resetStatus({ online: false, pending: 1 });
    wrap(<Probe />);
    await act(async () => undefined);
    expect(screen.getByTestId('probe').textContent).toBe('op-end:l1|-');
    ops = [endOp(), { ...startOp('op-next'), createdAt: 3 }];
    await act(async () => resetStatus({ online: false, pending: 2 }));
    expect(screen.getByTestId('probe').textContent).toBe('op-end:l1|op-next');
  });

  it('is reported as queued while offline, like a start', async () => {
    resetStatus({ online: false, pending: 1 });
    await expect(awaitOrQueued('op-end')).resolves.toEqual({ queued: true });
  });

  it('offline: says the end is saved, and lets the teacher go back to the lesson', async () => {
    ops = [endOp()];
    resetStatus({ online: false, pending: 1 });
    wrap(<QueuedEndCard context={context} opId="op-end" onEnded={() => undefined} />);
    expect(screen.getByTestId('queued-end').textContent).toContain(en['lesson.queuedEnd.offline']);
    fireEvent.click(screen.getByRole('button', { name: en['lesson.queuedEnd.cancel'] }));
    await act(async () => undefined);
    expect(dismissed).toEqual(['op-end']);
  });

  it('online again: shows the summary once the server accepted the end', async () => {
    ops = [endOp()];
    resetStatus({ online: true, sending: true, pending: 1 });
    const onEnded = vi.fn();
    wrap(<QueuedEndCard context={context} opId="op-end" onEnded={onEnded} />);
    expect(screen.getByTestId('queued-end').textContent).toContain(en['lesson.queuedEnd.sending']);
    expect(screen.queryByRole('button', { name: en['lesson.queuedEnd.cancel'] })).toBeNull();
    await act(async () => succeed('op-end', { lessonId: 'l1' }));
    expect(onEnded).toHaveBeenCalledWith({ lessonId: 'l1' });
  });
});

describe('opening the classroom with no connection (D-190, PIN-8)', () => {
  const me = { kind: 'user', id: 'u1', displayName: 'Ayşe Demo', role: 'teacher', locale: 'en', textScale: 1, density: 'normal', mustChangePassword: false, hasPin: true, signInMethod: 'password', hasEmail: false, reauthFresh: false, classroomMode: true, pinUnlockedUntil: null, pinUnlocked: true } as never;
  const location = { href: '/classroom', pathname: '/classroom' } as never;
  let n = 0;
  let store: ReturnType<typeof offline.createOfflineStore>;
  beforeEach(async () => {
    n += 1;
    store = offline.createOfflineStore({ dbName: `cc-offline-route-${n}` });
    offline.setOfflineStoreForTests(store);
    await store.saveSession(me);
    await store.saveQuery('u1', ['classroom', 'contexts'], { contexts: [{ id: 'ctx1' }] });
  });
  afterEach(() => {
    offline.setOfflineStoreForTests(null);
    store.close();
  });

  it('the browser is offline: the server is not asked and the PIN-locked copy opens', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const qc = new QueryClient();
    const r = await requireClassroomSession({ context: { queryClient: qc }, location });
    expect(r.offline).toBe(true);
    expect(r.me).toMatchObject({ id: 'u1', pinUnlocked: false });
    expect(session.freshMe).not.toHaveBeenCalled();
    expect(qc.getQueryData(['classroom', 'contexts'])).toEqual({ contexts: [{ id: 'ctx1' }] });
  });

  it('the server cannot be reached: the copy opens', async () => {
    vi.mocked(session.freshMe).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await requireClassroomSession({ context: { queryClient: new QueryClient() }, location });
    expect(r.offline).toBe(true);
  });

  it('the server answers: its answer is followed, never the copy', async () => {
    vi.mocked(session.freshMe).mockResolvedValueOnce({ ...(me as object), pinUnlocked: false } as never);
    const r = await requireClassroomSession({ context: { queryClient: new QueryClient() }, location });
    expect(r.offline).toBe(false);
    // Signed out on the server: the sign-in redirect, not the copy.
    vi.mocked(session.freshMe).mockResolvedValueOnce(null);
    await expect(requireClassroomSession({ context: { queryClient: new QueryClient() }, location })).rejects.toBeTruthy();
  });

  it('no copy on this device: the failure stands', async () => {
    await store.clear();
    vi.mocked(session.freshMe).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(requireClassroomSession({ context: { queryClient: new QueryClient() }, location })).rejects.toBeInstanceOf(TypeError);
  });
});
