import { useQuery, type QueryClient } from '@tanstack/react-query';
import * as Auth from '../../shared/contracts/auth.ts';
import { ApiError, call } from './api.ts';
import { purgeSensitive, queryClient } from './queryClient.ts';
import { clearAllToasts, clearSensitiveToasts } from './toast.ts';

export type Me = Auth.Me;
export const ME_KEY = ['me'] as const;

/** The signed-in account, or null when signed out. */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await call(Auth.me, {});
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Always asks the server (route guards: PIN state must never come from a stale cache). */
export function freshMe(qc: QueryClient = queryClient): Promise<Me | null> {
  return qc.fetchQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 0 });
}

export function useMe(): Me | null {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 30_000 }).data ?? null;
}

/** Sensitive areas are locked: classroom mode and not PIN-unlocked (server-computed, PIN-1). */
export const isLocked = (me: Me | null) => me !== null && me.classroomMode && !me.pinUnlocked;

/** Mark the session locked locally (after a 423, the lock button or inactivity) and purge sensitive data. */
export function markLocked(qc: QueryClient = queryClient) {
  purgeSensitive(qc);
  clearSensitiveToasts(); // e.g. "Student added: <name>" must not stay over the lock screen (PIN-3)
  qc.setQueryData<Me | null>(ME_KEY, (m) => (m ? { ...m, pinUnlocked: false, pinUnlockedUntil: null } : m));
}

export async function lockNow(qc: QueryClient = queryClient) {
  markLocked(qc);
  try {
    await call(Auth.lockNow, {});
  } finally {
    await freshMe(qc).catch(() => null);
  }
}

/** Enter (or re-enter) classroom mode: relocks the teacher area on this device (PIN-6). */
export async function enterClassroom(qc: QueryClient = queryClient) {
  purgeSensitive(qc);
  clearSensitiveToasts();
  await call(Auth.enterClassroom, {});
  return freshMe(qc);
}

/**
 * Forget everything cached for the previous account and mark the device signed out. The `me` query
 * itself is kept (only its data becomes null): `qc.clear()` would detach the root layout's `useMe`
 * observer from the cache, so the next sign-in would keep the previous language and text size until
 * a reload (found in the S13a review: a Turkish account saw its first sign-in in English).
 */
export function resetSignedOut(qc: QueryClient = queryClient) {
  void qc.cancelQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
  qc.getMutationCache().clear();
  qc.setQueryData(ME_KEY, null);
}

export async function signOut(qc: QueryClient = queryClient) {
  try {
    await call(Auth.logout, {});
  } catch {
    /* already signed out */
  }
  resetSignedOut(qc);
  clearAllToasts();
}
