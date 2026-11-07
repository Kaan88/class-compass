/**
 * Classroom timer (RTN-3). The server stores `{durationMs, startedAt, remainingMs, running}` with
 * server timestamps; every device derives what to show from the same state and its offset to the
 * server clock, so the laptop and the touchscreen show the same countdown.
 */
import { MAX_TIMER_MS } from '../shared/lessons.ts';

export { MAX_TIMER_MS };

export interface TimerState {
  durationMs: number;
  /** Server time when the current run started; null while paused/stopped. */
  startedAt: number | null;
  /** Remaining time at `startedAt` (running) or now (paused). */
  remainingMs: number;
  running: boolean;
}

export const DEFAULT_TIMER_MS = 5 * 60 * 1000;
export const idleTimer = (durationMs = DEFAULT_TIMER_MS): TimerState => ({ durationMs, startedAt: null, remainingMs: durationMs, running: false });

/** Milliseconds left at server time `now` (never negative). */
export function remainingAt(t: TimerState, now: number): number {
  if (!t.running || t.startedAt === null) return Math.max(0, t.remainingMs);
  return Math.max(0, t.remainingMs - Math.max(0, now - t.startedAt));
}

export const isFinished = (t: TimerState, now: number) => remainingAt(t, now) === 0 && (t.running || t.remainingMs === 0);

/** Start or resume. A finished timer starts again from its full duration. */
export function startTimer(t: TimerState, now: number): TimerState {
  if (t.running) return t;
  const left = t.remainingMs > 0 ? t.remainingMs : t.durationMs;
  return { ...t, running: true, startedAt: now, remainingMs: left };
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  if (!t.running) return t;
  return { ...t, running: false, startedAt: null, remainingMs: remainingAt(t, now) };
}

export const resetTimer = (t: TimerState): TimerState => ({ ...t, running: false, startedAt: null, remainingMs: t.durationMs });

export const setTimer = (durationMs: number): TimerState => idleTimer(Math.min(MAX_TIMER_MS, Math.max(1000, Math.trunc(durationMs))));

/** "m:ss" or "h:mm:ss" (digits only; no locale words). */
export function formatTimer(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
