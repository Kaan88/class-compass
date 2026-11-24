/**
 * Lesson data on the classroom device (LES-2, LES-4, UX-10/11, D-006):
 * - lesson state per context is polled every 5 s while the page is visible (and on focus) with
 *   If-None-Match, so an unchanged poll is a bodiless 304;
 * - every lesson/attendance write is an outbox command carrying contextId + lessonId, applied
 *   optimistically to the cached state; polling pauses while this device has unsent commands so a
 *   poll can never roll the screen back;
 * - the server clock offset from the last full answer drives the date, day and timer display.
 */
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import { submitCommands } from '../../../shared/contracts/commands.ts';
import * as L from '../../../shared/contracts/lessons.ts';
import type { LessonCommandPayload, LessonCommandType, LessonState } from '../../../shared/contracts/lessons.ts';
import { call, callConditional } from '../../lib/api.ts';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';

export type LessonStateData = z.infer<typeof L.getLessonState.output>;
export interface LessonQueryData {
  etag: string | null;
  data: LessonStateData;
}
export type RosterData = z.infer<typeof L.lessonRoster.output>;
export type RosterStudent = RosterData['students'][number];

export const lessonKey = (contextId: string) => ['classroom', 'lesson', contextId] as const;
export const rosterKey = (contextId: string, lessonId: string | null) => ['classroom', 'roster', contextId, lessonId ?? 'today'] as const;
export const activeLessonsKey = ['classroom', 'lessons', 'active'] as const;
export const routinesKey = (contextId: string) => ['classroom', 'routines', contextId] as const;

export const POLL_MS = 5000;

// ---------------------------------------------------------------- server clock
let offsetMs = 0;
const clockListeners = new Set<() => void>();
/** Current server time estimated from the last full lesson-state answer. */
export const serverNow = () => Date.now() + offsetMs;
function learnOffset(serverMs: number, receivedAt: number) {
  const next = serverMs - receivedAt;
  if (Math.abs(next - offsetMs) > 1000) {
    offsetMs = next;
    clockListeners.forEach((l) => l());
  }
}
export const useServerOffset = () =>
  useSyncExternalStore(
    (fn) => {
      clockListeners.add(fn);
      return () => clockListeners.delete(fn);
    },
    () => offsetMs,
    () => offsetMs,
  );

// ---------------------------------------------------------------- queries
async function fetchLesson(contextId: string): Promise<LessonQueryData> {
  const prev = queryClient.getQueryData<LessonQueryData>(lessonKey(contextId));
  const r = await callConditional(L.getLessonState, { contextId }, prev?.etag ?? null);
  if (r.notModified && prev) return keepWhilePending(contextId, prev);
  if (r.notModified) return fetchLessonFresh(contextId);
  learnOffset(r.data.serverNow, r.receivedAt);
  // A changed attendance stamp means someone (maybe another teacher) changed attendance.
  if (prev && prev.data.attendanceStamp !== r.data.attendanceStamp) void queryClient.invalidateQueries({ queryKey: ['classroom', 'roster', contextId] });
  return keepWhilePending(contextId, { etag: r.etag, data: r.data });
}

/**
 * A lesson read that answers while this device still has unsent commands (a refetch on focus or on
 * mount, a read that started before a tap) is older than the screen: keep the cached, optimistic
 * state. The outbox invalidates the lesson again once its queue is empty (D-045).
 */
function keepWhilePending(contextId: string, answer: LessonQueryData): LessonQueryData {
  if (getOutbox().getStatus().pending === 0) return answer;
  return queryClient.getQueryData<LessonQueryData>(lessonKey(contextId)) ?? answer;
}

async function fetchLessonFresh(contextId: string): Promise<LessonQueryData> {
  const r = await callConditional(L.getLessonState, { contextId }, null);
  if (r.notModified) throw new Error('unexpected 304');
  learnOffset(r.data.serverNow, r.receivedAt);
  return { etag: r.etag, data: r.data };
}

/** Pause polling while this device still has commands to send (they would be overwritten on screen). */
const pollInterval = () => (getOutbox().getStatus().pending > 0 ? false : POLL_MS);

/** Query options of the polled lesson state (exported for tests). */
export const lessonQueryOptions = (contextId: string | null) => ({
  queryKey: lessonKey(contextId ?? 'none'),
  queryFn: () => fetchLesson(contextId!),
  enabled: Boolean(contextId),
  refetchInterval: pollInterval,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: 'always' as const,
  staleTime: 0,
});

/**
 * Filling in End Lesson for a lesson that ended by itself (S37, D-218, `LateEndLesson`): its steps read
 * THAT lesson's state (sent by `lessonFillIn`), not today's polled one, which may be another lesson.
 */
export const LessonStateOverride = createContext<LessonQueryData | null>(null);

export function useLessonState(contextId: string | null) {
  const late = useContext(LessonStateOverride);
  const q = useQuery({ ...lessonQueryOptions(contextId), enabled: Boolean(contextId) && !late });
  return late ? ({ ...q, data: late } as typeof q) : q;
}

export function useActiveLessons(enabled: boolean) {
  return useQuery({ queryKey: activeLessonsKey, queryFn: () => call(L.activeLessons, {}), enabled, refetchInterval: 15_000, refetchOnWindowFocus: 'always' });
}

export function useLessonRoster(contextId: string | null, lessonId: string | null) {
  return useQuery({
    queryKey: rosterKey(contextId ?? 'none', lessonId),
    queryFn: () => call(L.lessonRoster, { contextId: contextId!, ...(lessonId ? { lessonId } : {}) }),
    enabled: Boolean(contextId),
    refetchOnWindowFocus: 'always',
  });
}

export function useRoutines(contextId: string | null) {
  return useQuery({ queryKey: routinesKey(contextId ?? 'none'), queryFn: () => call(L.lessonRoutines, { contextId: contextId! }), enabled: Boolean(contextId) });
}

// ---------------------------------------------------------------- commands
/** Refresh what a lesson command touches once the server accepted it. */
const refreshFor = (contextId: string | undefined): QueryKey[] =>
  contextId ? [lessonKey(contextId), ['classroom', 'roster', contextId], activeLessonsKey] : [['classroom', 'lesson'], ['classroom', 'roster'], activeLessonsKey];
/** Listed in the lessons and attendance manifests. */
export const lessonInvalidation: CommandInvalidation = { prefix: 'lesson.', keys: (op) => refreshFor(op.contextId) };
export const attendanceInvalidation: CommandInvalidation = { prefix: 'attendance.', keys: (op) => refreshFor(op.contextId) };

/** Change the cached lesson state right away (optimistic). The ETag is dropped so the next poll is a full read. */
export function patchLesson(contextId: string, fn: (l: LessonState) => LessonState) {
  queryClient.setQueryData<LessonQueryData>(lessonKey(contextId), (q) => (q?.data.lesson ? { etag: null, data: { ...q.data, lesson: fn(q.data.lesson) } } : q));
}

export function patchRoster(contextId: string, lessonId: string | null, fn: (s: RosterStudent) => RosterStudent) {
  queryClient.setQueryData<RosterData>(rosterKey(contextId, lessonId), (r) => (r ? { ...r, students: r.students.map(fn) } : r));
  queryClient.setQueryData<LessonQueryData>(lessonKey(contextId), (q) => (q ? { ...q, etag: null } : q));
}

/**
 * Queue a lesson command for this device's account (D-039). contextId/lessonId travel in the
 * envelope too, so the server can refuse anything aimed at another lesson (LES-4).
 */
export async function sendLessonCommand<T extends LessonCommandType>(type: T, payload: LessonCommandPayload<T>): Promise<string> {
  const p = payload as { contextId: string; lessonId?: string };
  // Queued before anything is awaited, so it counts as pending at once (see sendCounterCommand).
  const queued = getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return queued;
}

/**
 * The keep-alive of an open End Lesson (S37, D-218): "Still teaching" as a best-effort signal, not a
 * classroom change worth keeping. Sent only while online, straight to the command endpoint (the same
 * command and server checks, never the outbox), and dropped silently on any failure (offline, network
 * error, refusal): it is never queued, counted as waiting, shown in Needs attention or replayed after
 * the lesson's end was queued. Resolves true when the server accepted it.
 */
export async function sendKeepAlive(p: { contextId: string; lessonId: string }): Promise<boolean> {
  return (await sendStillTeachingNow(p)).ok;
}

/** What a direct "Still teaching" got: accepted, refused (with the server's error), or not sent / no answer (`network`). */
export type StillTeachingOutcome = { ok: true } | { ok: false; network: true } | { ok: false; network: false; error: { code: string; reason?: string | undefined } | undefined };

/**
 * "Still teaching" sent now or not at all (S37, D-218): straight to the command endpoint while online,
 * never through the outbox (it only means something at this moment, so it is never queued or replayed).
 * The same command and server checks as a queued one.
 */
export async function sendStillTeachingNow(p: { contextId: string; lessonId: string }): Promise<StillTeachingOutcome> {
  if (!getOutbox().getStatus().online) return { ok: false, network: true };
  try {
    const r = await call(submitCommands, { commands: [{ opId: uuidv7(), type: 'lesson.stillTeaching', payload: p, contextId: p.contextId, lessonId: p.lessonId, clientTime: Date.now() }] });
    const res = r.results[0];
    return res?.ok ? { ok: true } : { ok: false, network: false, error: res?.error };
  } catch {
    return { ok: false, network: true };
  }
}

/** Resolves with the server's result for `opId` once it was accepted; rejects if it was refused. */
export function awaitCommand(opId: string): Promise<unknown> {
  const box = getOutbox();
  return new Promise((resolve, reject) => {
    const offOk = box.onSuccess((op, r) => {
      if (op.opId !== opId) return;
      cleanup();
      resolve(r.result);
    });
    const offStatus = box.subscribe(() => {
      const rejected = box.getStatus().rejected.find((o) => o.opId === opId);
      if (rejected) {
        cleanup();
        reject(new Error(rejected.error?.reason ?? rejected.error?.code ?? 'REJECTED'));
      }
    });
    const cleanup = () => {
      offOk();
      offStatus();
    };
  });
}

// ---------------------------------------------------------------- a start or end that waits (S26b, D-190)
export type QueuedOutcome = { queued: true } | { queued: false; result: unknown };

/**
 * The server's result for a queued 'lesson.start' or 'lesson.end', or `{ queued: true }` as soon as it
 * cannot be sent now (this device is offline, or a try failed and waits for the next one). Rejects
 * when the server refused it. A queued command stays in the outbox and is sent, in order, when the
 * connection returns.
 */
export function awaitOrQueued(opId: string): Promise<QueuedOutcome> {
  const box = getOutbox();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      offStatus();
      fn();
    };
    const check = () => {
      const s = box.getStatus();
      if (!s.online || s.failures > 0) finish(() => resolve({ queued: true }));
    };
    const offStatus = box.subscribe(check);
    awaitCommand(opId).then(
      (result) => finish(() => resolve({ queued: false, result })),
      (err: unknown) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
    check();
  });
}

export interface QueuedLessonOp {
  opId: string;
  createdAt: number;
  /** The lesson an end is for (null for a start). */
  lessonId: string | null;
}

/** The start of a lesson in this class that waits in this account's outbox, or null. */
export const useQueuedStart = (contextId: string | null, ownerId: string | null) => useQueuedLessonOp('lesson.start', contextId, ownerId);

/**
 * The end of a lesson in this class that waits in this account's outbox, or null. After a reload
 * offline the device copy still shows that lesson running: the classroom shows the saved end instead
 * of its board (anything done on the board would be refused once the end is sent).
 */
export const useQueuedEnd = (contextId: string | null, ownerId: string | null) => useQueuedLessonOp('lesson.end', contextId, ownerId);

function useQueuedLessonOp(type: 'lesson.start' | 'lesson.end', contextId: string | null, ownerId: string | null): QueuedLessonOp | null {
  const [queued, setQueued] = useState<QueuedLessonOp | null>(null);
  // Every outbox change (a new status object), not only the count: an enqueue first counts as
  // reserved and then as stored, with the same count.
  const status = useSyncExternalStore(
    (fn) => getOutbox().subscribe(fn),
    () => getOutbox().getStatus(),
    () => null,
  );
  const pending = status?.pending ?? 0;
  useEffect(() => {
    let live = true;
    if (!contextId || !ownerId || pending === 0) {
      setQueued(null);
      return;
    }
    void getOutbox()
      .all()
      .then((ops) => {
        const op = ops.find((o) => o.type === type && o.state === 'pending' && o.ownerId === ownerId && o.contextId === contextId);
        if (live) setQueued((prev) => (op ? (prev?.opId === op.opId ? prev : { opId: op.opId, createdAt: op.createdAt, lessonId: op.lessonId ?? null }) : null));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [type, contextId, ownerId, pending, status]);
  return queued;
}
