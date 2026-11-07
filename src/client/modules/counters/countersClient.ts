/**
 * Counters on the classroom device (CNT-2/3/5, UX-9/10/11): taps, undo and class resets are outbox
 * commands naming the lesson, applied optimistically to the cached lesson state (polling pauses
 * while they are pending, D-045). A per-student double-tap guard (700 ms) stops accidental double
 * taps before they are queued; the server deduplicates retries by opId.
 */
import { levelFor } from '../../../domain/counters.ts';
import type { CounterCommandPayload, CounterCommandType, CounterLessonState, CountersLessonState } from '../../../shared/contracts/counters.ts';
import { DOUBLE_TAP_MS } from '../../../shared/counters.ts';
import { getOutbox, registerInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { activeLessonsKey, lessonKey, serverNow, type LessonQueryData } from '../lessons/lessonClient.ts';

registerInvalidation('counter.', (op) => (op.contextId ? [lessonKey(op.contextId), activeLessonsKey] : [['classroom', 'lesson']]));

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

export async function sendCounterCommand<T extends CounterCommandType>(type: T, payload: CounterCommandPayload<T>): Promise<string> {
  const p = payload as { contextId: string; lessonId: string };
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
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
  return { ...c, lessonTotal, barValue, reached, crossingSeq, crossingCount, crossedAt, students };
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

/** Optimistic class reset: the bar starts again from 0, the lesson total and weekly counts stay. */
export const applyReset = (c: CounterLessonState): CounterLessonState => ({ ...c, barValue: 0, reached: false, crossingSeq: null, crossedAt: null });

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
