/**
 * The threshold sound and the Undo of a class reset on the classroom device (S22a, D-175; CNT-9,
 * CNT-11, UX-9). The real tap path runs here (optimistic patch, cue, outbox command) against a fake
 * `/api` in `fetch`, with `playEvent` observed: the threshold cue plays once per crossing, at the tap
 * that fills the bar, and never for an undo, a resent (replayed) command, a lesson poll or the Undo of
 * a reset that brings a full bar back. Fictional data only.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterLessonState } from '../../src/shared/contracts/counters.ts';
import { RESET_UNDO_MS } from '../../src/shared/counters.ts';
import { getOutbox, registerInvalidation } from '../../src/client/lib/outbox-client.ts';
import { queryClient } from '../../src/client/lib/queryClient.ts';
import { ME_KEY } from '../../src/client/lib/session.ts';
import {
  applyDelta,
  applyReset,
  applyUndoReset,
  canUndoReset,
  counterInvalidation,
  resetCounterBar,
  tapCounter,
  tapCue,
  undoCounterReset,
  undoTap,
} from '../../src/client/modules/counters/countersClient.ts';
import { lessonKey, lessonQueryOptions, type LessonQueryData } from '../../src/client/modules/lessons/lessonClient.ts';

const playEvent = vi.hoisted(() => vi.fn<(name: string) => boolean>(() => true));
vi.mock('../../src/client/themes/index.tsx', async (importOriginal) => ({ ...(await importOriginal<object>()), playEvent }));

const CTX = 'ctx-3b-english';
const LESSON = 'lesson-sound-1';
const COUNTER = 'counter-sound';

const counterAt = (barValue: number): CounterLessonState => ({
  id: COUNTER,
  kind: 'english_reminders',
  labels: { main: { en: 'Our English Time' }, supporting: {}, individual: { en: 'Turkish reminders' } },
  scope: 'both',
  barSegments: 3,
  colour: 'accent',
  resetPeriod: 'week',
  thresholds: [],
  lessonTotal: barValue,
  barValue,
  reached: false,
  crossingSeq: null,
  crossingCount: 0,
  crossedAt: null,
  activeResponse: null,
  resetUndo: null,
  period: { from: '2026-11-09', to: '2026-11-15' },
  students: ['s1', 's2'].map((studentId) => ({ studentId, count: 0, level: 0 as const })),
});

/** Fake server: applies counter commands with the same rules and answers lesson reads. */
const server = {
  counter: counterAt(0),
  version: 1,
  /** Command op ids the server has applied (a resent op is answered as a replay). */
  applied: new Set<string>(),
  /** Fail the next /api/commands call with a network error (the outbox keeps the op and resends it). */
  dropNext: false,
  commands: [] as string[],
};

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

async function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  if (url === '/api/commands') {
    if (server.dropNext) {
      server.dropNext = false;
      throw new TypeError('Failed to fetch');
    }
    const body = JSON.parse(String(init.body)) as { commands: Array<{ opId: string; type: string; payload: { studentId?: string; resetId?: string } }> };
    const results = body.commands.map((c) => {
      server.commands.push(c.type);
      if (server.applied.has(c.opId)) return { opId: c.opId, ok: true, replayed: true, result: { eventId: c.opId } };
      server.applied.add(c.opId);
      const studentId = c.payload.studentId ?? null;
      if (c.type === 'counter.tap') server.counter = applyDelta(server.counter, studentId, 1, Date.now());
      if (c.type === 'counter.void') server.counter = applyDelta(server.counter, studentId, -1, Date.now());
      if (c.type === 'counter.resetLessonBar') server.counter = { ...applyReset(server.counter, Date.now()), resetUndo: { resetId: c.opId, until: Date.now() + RESET_UNDO_MS, barValue: server.counter.barValue } };
      if (c.type === 'counter.undoReset') server.counter = applyUndoReset(server.counter);
      server.version += 1;
      return { opId: c.opId, ok: true, replayed: false, result: { eventId: c.opId } };
    });
    return json({ results });
  }
  if (url === `/api/classroom/contexts/${CTX}/lesson`) {
    return json({ lesson: null, serverNow: Date.now(), attendanceStamp: 'a1', counters: { showReminderBoxes: true, counters: [server.counter] } }, { etag: `"v${server.version}"` });
  }
  throw new Error(`unexpected request ${url}`);
}

const cached = () => queryClient.getQueryData<LessonQueryData>(lessonKey(CTX))!.data.counters!.counters[0]!;
const setCached = (c: CounterLessonState) =>
  queryClient.setQueryData<LessonQueryData>(lessonKey(CTX), { etag: null, data: { counters: { weekStart: '2026-11-09', weekEnd: '2026-11-15', showReminderBoxes: true, counters: [c] } } as LessonQueryData['data'] });
const cues = () => playEvent.mock.calls.map((c) => c[0]);
const thresholdCues = () => cues().filter((c) => c === 'thresholdReached').length;

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settled = () => until(() => getOutbox().getStatus().pending === 0 && !queryClient.isFetching());
/** A lesson poll (the polled GET), as the board does every few seconds. */
const poll = () => queryClient.fetchQuery(lessonQueryOptions(CTX) as never);
const tap = (studentId: string | null = 's1') => tapCounter(CTX, LESSON, cached(), studentId);

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  queryClient.setQueryData(ME_KEY, { id: 'teacher-sound' });
  registerInvalidation(counterInvalidation.prefix, counterInvalidation.keys);
  await until(() => getOutbox().getOwner() === 'teacher-sound');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => {
  await settled();
  server.counter = counterAt(0);
  server.applied.clear();
  server.commands = [];
  setCached(counterAt(0));
  playEvent.mockClear();
});

describe('threshold sound (S22a, D-175; CNT-11)', () => {
  it('names the cue of a tap: the threshold cue only for the tap that opens a crossing', () => {
    expect(tapCue(true, true)).toBe('thresholdReached');
    expect(tapCue(true, false)).toBe('thresholdReached');
    expect(tapCue(false, true)).toBe('pointAwarded');
    expect(tapCue(false, false)).toBe('tap');
  });

  it('plays once per crossing: at the filling tap, not for taps past the limit, again only after the bar fell below and filled again', async () => {
    tap('s1');
    tap('s2');
    expect(thresholdCues()).toBe(0);
    const filling = tap(null); // 2 → 3 of 3
    expect(filling.crossed).toBe(true);
    expect(cues()).toEqual(['pointAwarded', 'pointAwarded', 'thresholdReached']);
    tap('s1'); // 4: still the same crossing
    tap(null);
    expect(thresholdCues()).toBe(1);
    await settled();
    expect(cached()).toMatchObject({ barValue: 5, reached: true });

    // Undo of the taps: the undo cue only, never the threshold cue.
    const last = tap('s2'); // 6
    await undoTap(CTX, LESSON, COUNTER, 's2', last.sent);
    await settled();
    expect(cues().slice(-2)).toEqual(['pointAwarded', 'undo']);
    expect(thresholdCues()).toBe(1);

    // Below the limit and up again is a new crossing: one more threshold cue.
    setCached({ ...cached(), barValue: 2, lessonTotal: 5, reached: false, crossingSeq: null, crossedAt: null });
    server.counter = { ...server.counter, barValue: 2, reached: false, crossingSeq: null, crossedAt: null };
    tap('s1');
    expect(thresholdCues()).toBe(2);
    await settled();
  });

  it('never plays for a resent (replayed) command or a lesson poll that brings a crossing from another device', async () => {
    tap('s1');
    tap('s1');
    server.dropNext = true; // the next send fails: the outbox keeps the ops and sends them again
    tap('s2'); // fills the bar here: one cue
    expect(thresholdCues()).toBe(1);
    await getOutbox().flush();
    await getOutbox().flush();
    await settled();
    expect(server.commands.filter((t) => t === 'counter.tap').length).toBeGreaterThanOrEqual(3);
    expect(thresholdCues()).toBe(1);

    // Another device fills the bar again (new crossing); this device only reads it.
    server.counter = { ...applyDelta({ ...server.counter, barValue: 2, reached: false, crossingSeq: null, crossedAt: null }, null, 1, Date.now()) };
    server.version += 1;
    const before = cues().length;
    await poll();
    expect(cached().crossingCount).toBe(2);
    expect(cues().length).toBe(before);
  });
});

describe('undo of a class reset on the device (S22a, D-175)', () => {
  it('brings the full bar back with the same crossing, plays only the undo cue, and is offered only until the next tap', async () => {
    tap('s1');
    tap('s1');
    tap('s2'); // full: crossing 1
    await settled();
    expect(thresholdCues()).toBe(1);
    const full = cached();
    expect(full).toMatchObject({ barValue: 3, reached: true, crossingSeq: 1 });

    const resetId = await resetCounterBar(CTX, LESSON, full);
    expect(cached()).toMatchObject({ barValue: 0, reached: false, crossingSeq: null });
    expect(canUndoReset(cached())).toBe(true);
    expect(cached().resetUndo?.barValue).toBe(3);
    await settled();
    await poll();
    expect(cached().resetUndo?.resetId).toBe(resetId);

    await undoCounterReset(CTX, LESSON, cached());
    expect(cached()).toMatchObject({ barValue: 3, reached: true, crossingSeq: 1, crossingCount: 1, resetUndo: null });
    await settled();
    expect(server.commands).toContain('counter.undoReset');
    await poll();
    expect(cached()).toMatchObject({ barValue: 3, reached: true, crossingSeq: 1 });
    expect(cues().slice(-1)).toEqual(['undo']);
    expect(thresholdCues()).toBe(1);

    // A later tap ends the Undo on the screen right away (the server refuses it too).
    await resetCounterBar(CTX, LESSON, cached());
    expect(canUndoReset(cached())).toBe(true);
    tap('s1');
    expect(canUndoReset(cached())).toBe(false);
    await settled();
  });

  it('is offered for 10 minutes only', () => {
    const now = 1_000_000;
    const reset = applyReset(counterAt(3), now);
    expect(canUndoReset(reset, now + RESET_UNDO_MS - 1)).toBe(true);
    expect(canUndoReset(reset, now + RESET_UNDO_MS)).toBe(false);
    // A half-full bar comes back without a crossing.
    expect(applyUndoReset(applyReset(counterAt(2), now))).toMatchObject({ barValue: 2, reached: false, crossingSeq: null, resetUndo: null });
  });
});
