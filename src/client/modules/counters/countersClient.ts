/**
 * Counters on the classroom device (CNT-2/3/5, UX-9/10/11): taps, undo and class resets are outbox
 * commands naming the lesson, applied optimistically to the cached lesson state (polling pauses
 * while they are pending, D-045). A per-student double-tap guard (700 ms) stops accidental double
 * taps before they are queued; the server deduplicates retries by opId.
 *
 * Sounds (S22a, D-175): only the device where the teacher taps plays a cue, at the moment of the tap
 * (`tapCounter`): `thresholdReached` for the tap that fills the class bar (once per crossing), the
 * tap cues otherwise, `undo` for an undo. Polls, outbox replays and an Undo of a reset never play the
 * threshold cue. `playEvent` applies the class sound switch, the device switch and the volume.
 */
import { levelFor } from '../../../domain/counters.ts';
import type { CounterCommandPayload, CounterCommandType, CounterLessonState, CountersLessonState } from '../../../shared/contracts/counters.ts';
import { DOUBLE_TAP_MS, RESET_UNDO_MS } from '../../../shared/counters.ts';
import type { SoundEvent } from '../../../shared/themePackage/tokens.ts';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { playEvent } from '../../themes/index.tsx';
import { activeLessonsKey, lessonKey, serverNow, type LessonQueryData } from '../lessons/lessonClient.ts';

/** Listed in the counters manifest. */
export const counterInvalidation: CommandInvalidation = { prefix: 'counter.', keys: (op) => (op.contextId ? [lessonKey(op.contextId), activeLessonsKey] : [['classroom', 'lesson']]) };

/**
 * Double-tap guard (P3): a second tap on the same student and counter within `windowMs` of the last
 * RECORDED tap is not recorded; the screen says "Already counted – tap again to add another".
 */
export function createTapGuard(windowMs = DOUBLE_TAP_MS, now: () => number = () => Date.now()) {
  const last = new Map<string, number>();
  return {
    /** true = record this tap; false = too soon after the previous recorded tap. */
    accept(key: string): boolean {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < windowMs) return false;
      last.set(key, t);
      return true;
    },
    forget(key: string) {
      last.delete(key);
    },
  };
}

export const tapGuard = createTapGuard();

/**
 * Queue a counter command right after its optimistic change. It is queued synchronously, before
 * anything is awaited: until the outbox counts it as pending, an "outbox is empty" refresh (the
 * deferred invalidation of the previous tap, the lesson poll) could replace the optimistic state with
 * a server answer that does not have this tap, and the next tap would then miss the bar crossing.
 * Lesson reads already in flight are cancelled (their answer would be just as old).
 */
export async function sendCounterCommand<T extends CounterCommandType>(type: T, payload: CounterCommandPayload<T>): Promise<string> {
  const p = payload as { contextId: string; lessonId: string };
  const queued = getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return queued;
}

/** Change the cached counters of a context right away (optimistic). Drops the ETag so the next poll is a full read. */
export function patchCounters(contextId: string, fn: (c: CounterLessonState) => CounterLessonState, counterId?: string) {
  queryClient.setQueryData<LessonQueryData>(lessonKey(contextId), (q) => {
    if (!q?.data.counters) return q;
    const counters: CountersLessonState = { ...q.data.counters, counters: q.data.counters.counters.map((c) => (counterId && c.id !== counterId ? c : fn(c))) };
    return { etag: null, data: { ...q.data, counters } };
  });
}

/** Optimistic effect of one tap (+1) or one undo (-1) on a counter. Mirrors the server rules (D-004). */
export function applyDelta(c: CounterLessonState, studentId: string | null, delta: 1 | -1, now = serverNow()): CounterLessonState {
  const barCounts = c.scope !== 'student';
  const lessonTotal = Math.max(0, c.lessonTotal + delta);
  const barValue = barCounts ? Math.max(0, c.barValue + delta) : c.barValue;
  const reached = barCounts && barValue >= c.barSegments;
  let { crossingSeq, crossingCount, crossedAt } = c;
  if (reached && !c.reached) {
    crossingCount += 1;
    crossingSeq = crossingCount;
    crossedAt = now;
  } else if (!reached) {
    crossingSeq = null;
    crossedAt = null;
  }
  const students = studentId
    ? c.students.map((s) => {
        if (s.studentId !== studentId) return s;
        const count = Math.max(0, s.count + delta);
        return { ...s, count, level: levelFor(count, c.thresholds) };
      })
    : c.students;
  // Any tap or tap undo after a class reset ends its Undo (D-175).
  return { ...c, lessonTotal, barValue, reached, crossingSeq, crossingCount, crossedAt, students, resetUndo: null };
}

/** Would one more tap on the class bar open a new threshold crossing? (scope lesson/both only) */
export const opensCrossing = (c: CounterLessonState) => c.scope !== 'student' && !c.reached && c.barValue + 1 >= c.barSegments;

/**
 * Text of the undo toast after a tap. It names the class and the student (UX-9), except for the tap
 * that fills the class bar: the threshold overlay opens at that moment on the shared display, so the
 * toast must not show who triggered it (CNT-9, D-059) and says "+1" for the class instead.
 */
export function tapToastText(
  t: (key: 'counter.toast.added' | 'counter.toast.addedHidden' | 'counter.toast.addedClass', vars: Record<string, string>) => string,
  a: { cls: string; label: string; studentName: string | null; crossed: boolean },
): string {
  if (a.studentName === null) return t('counter.toast.addedClass', { cls: a.cls, counter: a.label });
  if (a.crossed) return t('counter.toast.addedHidden', { cls: a.cls, counter: a.label });
  return t('counter.toast.added', { cls: a.cls, counter: a.label, name: a.studentName });
}

/**
 * Optimistic class reset: the bar starts again from 0, the lesson total and weekly counts stay. The
 * Undo it offers carries the bar it took away; its id is the reset command's opId, known once queued
 * (an empty id until the server state names it).
 */
export const applyReset = (c: CounterLessonState, now = serverNow()): CounterLessonState => ({
  ...c,
  barValue: 0,
  reached: false,
  crossingSeq: null,
  crossedAt: null,
  resetUndo: { resetId: '', until: now + RESET_UNDO_MS, barValue: c.barValue },
});

/**
 * Optimistic Undo of a class reset: the bar it took away comes back and, when that bar was full, the
 * same crossing is open again (`crossingCount` does not move, so no overlay and no sound replay).
 * `before` is the counter as this device had it just before the reset, when it still knows it.
 */
export function applyUndoReset(c: CounterLessonState, before?: Pick<CounterLessonState, 'crossedAt'> | null): CounterLessonState {
  if (!c.resetUndo) return c;
  const barValue = c.resetUndo.barValue;
  const reached = c.scope !== 'student' && barValue >= c.barSegments;
  return { ...c, barValue, reached, crossingSeq: reached ? c.crossingCount : null, crossedAt: reached ? (before?.crossedAt ?? null) : null, resetUndo: null };
}

/** Can the reset of this counter still be undone from this screen? (the server checks again). */
export const canUndoReset = (c: CounterLessonState, now = serverNow()) => c.resetUndo !== null && now < c.resetUndo.until;

/** The cue of one tap: the threshold cue only for the tap that opens a crossing (D-175). */
export const tapCue = (crossed: boolean, forStudent: boolean): SoundEvent => (crossed ? 'thresholdReached' : forStudent ? 'pointAwarded' : 'tap');

/**
 * One tap on a counter (optimistic + outbox) with its cue. `crossed` is true only for the tap that
 * fills the bar, so the threshold cue plays once per crossing; `sent` resolves to the event id.
 */
export function tapCounter(contextId: string, lessonId: string, counter: CounterLessonState, studentId: string | null): { crossed: boolean; sent: Promise<string> } {
  let crossed = opensCrossing(counter);
  patchCounters(
    contextId,
    (c) => {
      const next = applyDelta(c, studentId, 1);
      crossed = next.reached && !c.reached;
      return next;
    },
    counter.id,
  );
  playEvent(tapCue(crossed, studentId !== null));
  const sent = sendCounterCommand('counter.tap', { contextId, lessonId, counterId: counter.id, ...(studentId ? { studentId } : {}) });
  return { crossed, sent };
}

/** Undo one tap (from its toast): the undo cue, -1 on screen, then the void command. */
export async function undoTap(contextId: string, lessonId: string, counterId: string, studentId: string | null, sent: Promise<string>): Promise<void> {
  playEvent('undo');
  const eventId = await sent;
  patchCounters(contextId, (c) => applyDelta(c, studentId, -1), counterId);
  await sendCounterCommand('counter.void', { contextId, lessonId, eventId });
}

/** Resets queued on this device: their opId (= the reset id) and the counter just before. */
const localResets = new Map<string, { sent: Promise<string>; before: CounterLessonState }>();

/** A confirmed class reset (optimistic + outbox). Undo is offered on the counter card for RESET_UNDO_MS. */
export function resetCounterBar(contextId: string, lessonId: string, counter: CounterLessonState): Promise<string> {
  patchCounters(contextId, (c) => applyReset(c), counter.id);
  const sent = sendCounterCommand('counter.resetLessonBar', { contextId, lessonId, counterId: counter.id });
  localResets.set(counter.id, { sent, before: counter });
  return sent;
}

/**
 * Undo the class reset shown on the card (S22a, D-175): the undo cue, the bar back on screen, then
 * the `counter.undoReset` command (outbox, so it waits for the connection like the reset itself).
 */
export async function undoCounterReset(contextId: string, lessonId: string, counter: CounterLessonState): Promise<void> {
  const local = localResets.get(counter.id);
  const resetId = counter.resetUndo?.resetId || (local ? await local.sent : '');
  if (!resetId) return;
  playEvent('undo');
  localResets.delete(counter.id);
  patchCounters(contextId, (c) => applyUndoReset(c, local?.before), counter.id);
  await sendCounterCommand('counter.undoReset', { contextId, lessonId, counterId: counter.id, resetId });
}

// ---------------------------------------------------------------- crossings already shown on this device
const SEEN_KEY = 'cc.seenCrossings';
let seen: string[] | null = null;
function loadSeen(): string[] {
  if (seen) return seen;
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    if (!Array.isArray(seen)) seen = [];
  } catch {
    seen = [];
  }
  return seen;
}
export const crossingKey = (lessonId: string, counterId: string, seq: number) => `${lessonId}:${counterId}:${seq}`;
export const wasShown = (key: string) => loadSeen().includes(key);
export function markShown(key: string) {
  const list = loadSeen();
  if (list.includes(key)) return;
  seen = [...list, key].slice(-50);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* per-tab only */
  }
}
/** The response overlay plays only for a fresh crossing (not when a device opens the lesson much later, D-059). */
export const FRESH_CROSSING_MS = 2 * 60 * 1000;
