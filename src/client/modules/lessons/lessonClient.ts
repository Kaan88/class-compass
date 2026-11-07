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
import { useSyncExternalStore } from 'react';
import type { z } from 'zod';
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
  if (r.notModified && prev) return prev;
  if (r.notModified) return fetchLessonFresh(contextId);
  learnOffset(r.data.serverNow, r.receivedAt);
  // A changed attendance stamp means someone (maybe another teacher) changed attendance.
  if (prev && prev.data.attendanceStamp !== r.data.attendanceStamp) void queryClient.invalidateQueries({ queryKey: ['classroom', 'roster', contextId] });
  return { etag: r.etag, data: r.data };
}

async function fetchLessonFresh(contextId: string): Promise<LessonQueryData> {
  const r = await callConditional(L.getLessonState, { contextId }, null);
  if (r.notModified) throw new Error('unexpected 304');
  learnOffset(r.data.serverNow, r.receivedAt);
  return { etag: r.etag, data: r.data };
}

/** Pause polling while this device still has commands to send (they would be overwritten on screen). */
const pollInterval = () => (getOutbox().getStatus().pending > 0 ? false : POLL_MS);

export function useLessonState(contextId: string | null) {
  return useQuery({
    queryKey: lessonKey(contextId ?? 'none'),
    queryFn: () => fetchLesson(contextId!),
    enabled: Boolean(contextId),
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });
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
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
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
