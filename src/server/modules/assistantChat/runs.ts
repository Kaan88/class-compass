/**
 * Runs of the assistant (S19b, D-180): one answer being written, held in memory by the server process
 * that runs it. A run has a list of events (`AssistantRunEvent`, numbered) that the browser streams and
 * can re-read after a reconnect (`after`), an abort signal (Stop), and listeners. One run per chat at a
 * time; a finished run is kept a few minutes so a reconnecting page still gets its end.
 */
import type { AssistantRunEnd } from '../../../shared/assistantChat.ts';
import type { AssistantRunEvent } from '../../../shared/contracts/assistantChat.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';

type EventBody = AssistantRunEvent extends infer E ? (E extends { seq: number } ? Omit<E, 'seq'> : never) : never;

export interface Run {
  id: string;
  chatId: string;
  userId: string;
  events: AssistantRunEvent[];
  done: boolean;
  end: AssistantRunEnd | null;
  abort: AbortController;
  listeners: Set<() => void>;
  finishedAt: number | null;
  /** Resolves when the run has ended (tests and shutdown wait for it). */
  finished: Promise<void>;
  resolveFinished: () => void;
}

/** Finished runs are forgotten after this long. */
const KEEP_MS = 10 * 60_000;
/** Answers being written at once for one account. */
export const RUNS_PER_USER = 2;

export class RunRegistry {
  private runs = new Map<string, Run>();

  private prune(now: number) {
    for (const [id, r] of this.runs) if (r.finishedAt !== null && now - r.finishedAt > KEEP_MS) this.runs.delete(id);
  }

  /** The chat's run that is still writing, if any. */
  activeFor(chatId: string): Run | null {
    for (const r of this.runs.values()) if (r.chatId === chatId && !r.done) return r;
    return null;
  }

  start(chatId: string, userId: string, now: number): Run {
    this.prune(now);
    if (this.activeFor(chatId)) throw new AppError('CONFLICT', 'An answer is still being written', { reason: 'ASSISTANT_BUSY' });
    if ([...this.runs.values()].filter((r) => r.userId === userId && !r.done).length >= RUNS_PER_USER) throw new AppError('CONFLICT', 'Too many answers at once', { reason: 'ASSISTANT_BUSY' });
    let resolveFinished = () => {};
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const run: Run = { id: newId(), chatId, userId, events: [], done: false, end: null, abort: new AbortController(), listeners: new Set(), finishedAt: null, finished, resolveFinished };
    this.runs.set(run.id, run);
    return run;
  }

  /**
   * Gives back the slot of a run taken by `start` that never began (the send or answer it was taken for
   * was refused or needs no answer): the slot is taken first, so a refused request has no side effects.
   */
  discard(run: Run) {
    if (run.events.length || run.done) return;
    this.runs.delete(run.id);
    run.done = true;
    run.resolveFinished();
  }

  /** The caller's run (another account's run is a 404, like their chats). */
  get(runId: string, userId: string): Run {
    const r = this.runs.get(runId);
    if (!r || r.userId !== userId) throw notFound('Run');
    return r;
  }

  emit(run: Run, ev: EventBody) {
    if (run.done) return;
    run.events.push({ ...ev, seq: run.events.length + 1 } as AssistantRunEvent);
    for (const l of run.listeners) l();
  }

  finish(run: Run, end: AssistantRunEnd, reason: string | null, now: number) {
    if (run.done) return;
    this.emit(run, { type: 'end', end, reason });
    run.done = true;
    run.end = end;
    run.finishedAt = now;
    for (const l of run.listeners) l();
    run.resolveFinished();
  }

  /** Server shutdown: stop every answer being written. */
  abortAll() {
    for (const r of this.runs.values()) if (!r.done) r.abort.abort();
  }

  /** Every run (tests wait for them). */
  all(): Run[] {
    return [...this.runs.values()];
  }
}
