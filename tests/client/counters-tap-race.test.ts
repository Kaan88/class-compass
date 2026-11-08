/**
 * Regression (S6 counters e2e flake): a fast run of taps must never be rolled back on screen by a lesson
 * read that the server answered before it had every tap. The real client code runs here: the app's
 * outbox singleton (on fake-indexeddb), its deferred invalidations, the polled lesson query and the
 * counter tap path (optimistic patch + `sendCounterCommand`), against a fake `/api` in `fetch`.
 *
 * The race: a tap's optimistic change was on screen before its command counted as pending (the tap
 * awaited `cancelQueries` and the IndexedDB write first). When the previous tap's answer arrived in
 * that gap, the outbox looked empty, the deferred invalidation re-read the lesson, and the server
 * answer without the new tap replaced the screen. The next tap then started from one too few, so the
 * tap that really filled the bar was not seen as the crossing and its undo toast named the student
 * (CNT-9, D-059).
 */
import 'fake-indexeddb/auto';
import { QueryObserver } from '@tanstack/react-query';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CounterLessonState } from '../../src/shared/contracts/counters.ts';
import { getOutbox, registerInvalidation } from '../../src/client/lib/outbox-client.ts';
import { queryClient } from '../../src/client/lib/queryClient.ts';
import { ME_KEY } from '../../src/client/lib/session.ts';
import { applyDelta, counterInvalidation, opensCrossing, patchCounters, sendCounterCommand } from '../../src/client/modules/counters/countersClient.ts';
import { lessonKey, lessonQueryOptions, type LessonQueryData } from '../../src/client/modules/lessons/lessonClient.ts';

const CTX = 'ctx-3a-english';
const LESSON = 'lesson-1';
const COUNTER = 'counter-reminders';

const counterAt = (barValue: number): CounterLessonState => ({
  id: COUNTER,
  kind: 'english_reminders',
  labels: { main: { en: 'Our English Time' }, supporting: {}, individual: { en: 'Turkish reminders' } },
  scope: 'both',
  barSegments: 10,
  colour: 'accent',
  resetPeriod: 'week',
  thresholds: [2, 4, 6],
  lessonTotal: barValue,
  barValue,
  reached: false,
  crossingSeq: null,
  crossingCount: 0,
  crossedAt: null,
  activeResponse: null,
  period: { from: '2026-11-09', to: '2026-11-15' },
  students: ['s1', 's2', 's3', 's4'].map((studentId) => ({ studentId, count: 0, level: 0 as const })),
});

/** Fake server: applies counter taps like the real one and answers lesson reads with its current state. */
const server = {
  counter: counterAt(7),
  version: 1,
  /** Bar value the server had at each lesson read. */
  reads: [] as number[],
  /** While set, /api/commands waits for it BEFORE applying anything. */
  gate: null as Promise<void> | null,
};

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

async function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  if (url === '/api/commands') {
    if (server.gate) await server.gate;
    const body = JSON.parse(String(init.body)) as { commands: Array<{ opId: string; type: string; payload: { studentId?: string } }> };
    const results = body.commands.map((c) => {
      if (c.type === 'counter.tap') server.counter = applyDelta(server.counter, c.payload.studentId ?? null, 1, Date.now());
      server.version += 1;
      return { opId: c.opId, ok: true, replayed: false, result: { eventId: `ev-${server.version}` } };
    });
    return json({ results });
  }
  if (url === `/api/classroom/contexts/${CTX}/lesson`) {
    server.reads.push(server.counter.barValue);
    return json({ lesson: null, serverNow: Date.now(), attendanceStamp: 'a1', counters: { showReminderBoxes: true, counters: [server.counter] } }, { etag: `"v${server.version}"` });
  }
  throw new Error(`unexpected request ${url}`);
}

const cached = () => queryClient.getQueryData<LessonQueryData>(lessonKey(CTX))?.data.counters?.counters[0];

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The tap path of CounterPanel's recordTap: optimistic patch, then queue the command. */
function tap(studentId: string) {
  let crossed = opensCrossing(cached()!);
  patchCounters(
    CTX,
    (c) => {
      const next = applyDelta(c, studentId, 1);
      crossed = next.reached && !c.reached;
      return next;
    },
    COUNTER,
  );
  const sent = sendCounterCommand('counter.tap', { contextId: CTX, lessonId: LESSON, counterId: COUNTER, studentId });
  return { crossed, sent };
}

/** Every bar value the screen (the cached lesson state) showed, in order. */
const shown: number[] = [];
let observer: QueryObserver<LessonQueryData> | null = null;
let unsubscribe = () => {};
let unwatch = () => {};

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  queryClient.setQueryData(ME_KEY, { id: 'teacher-1' });
  registerInvalidation(counterInvalidation.prefix, counterInvalidation.keys);
  await until(() => getOutbox().getOwner() === 'teacher-1');
  unwatch = queryClient.getQueryCache().subscribe(() => {
    const v = cached()?.barValue;
    if (v !== undefined && v !== shown.at(-1)) shown.push(v);
  });
  observer = new QueryObserver(queryClient, lessonQueryOptions(CTX) as never);
  unsubscribe = observer.subscribe(() => {});
  await until(() => cached()?.barValue === 7);
});

afterAll(() => {
  unsubscribe();
  unwatch();
  vi.unstubAllGlobals();
});

describe('counter taps vs lesson reads (CNT-9, D-045)', () => {
  it('a tap counts as pending the moment it is made, so a refresh between two taps never rolls the bar back and the filling tap is the crossing', async () => {
    const box = getOutbox();
    // The teacher's next tap lands exactly as the previous tap's answer arrives (the success listeners
    // run before the outbox re-reads its queue).
    let second: ReturnType<typeof tap> | null = null;
    let pendingRightAfterSecondTap = -1;
    const off = box.onSuccess(() => {
      if (second) return;
      second = tap('s2');
      pendingRightAfterSecondTap = box.getStatus().pending;
    });
    const first = tap('s1'); // 7 → 8
    expect(first.crossed).toBe(false);
    expect(box.getStatus().pending).toBe(1); // counted before the IndexedDB write
    await first.sent;
    await until(() => second !== null && server.counter.lessonTotal === 9 && box.getStatus().pending === 0);
    off();
    expect(pendingRightAfterSecondTap).toBeGreaterThanOrEqual(1);
    await until(() => cached()?.barValue === 9 && !queryClient.isFetching());
    // The screen went 7 → 8 → 9 and never back to 8 (a read without the second tap).
    expect(shown).toEqual([7, 8, 9]);
    // Lesson reads after the first one only ever saw the server with every tap.
    expect(server.reads.slice(1).every((v) => v === 9)).toBe(true);

    // The tap that fills the bar is the crossing, so its toast does not name the student.
    const third = tap('s3'); // 9 → 10
    expect(third.crossed).toBe(true);
    await third.sent;
    await until(() => box.getStatus().pending === 0 && server.counter.reached && cached()?.reached === true && !queryClient.isFetching());
    expect(shown).toEqual([7, 8, 9, 10]);
  });

  it('a lesson read that answers while a tap is still unsent keeps the optimistic state', async () => {
    const box = getOutbox();
    let open = () => {};
    server.gate = new Promise<void>((r) => (open = r));
    const t = tap('s4'); // 10 → 11, not yet on the server
    await until(() => box.getStatus().pending === 1);
    await observer!.refetch(); // e.g. a refetch on window focus
    expect(server.reads.at(-1)).toBe(10); // the server did not have the tap yet…
    expect(cached()?.barValue).toBe(11); // …and the screen kept it
    server.gate = null;
    open();
    await t.sent;
    await until(() => box.getStatus().pending === 0 && server.counter.barValue === 11 && !queryClient.isFetching());
    expect(cached()?.barValue).toBe(11);
    expect(shown).toEqual([7, 8, 9, 10, 11]);
  });
});
