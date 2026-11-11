import { redirect, type ParsedLocation } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { freshMe, isLocked, type Me } from '../lib/session.ts';
import { isUnreachable, restoreOfflineClassroom } from '../lib/offlineClassroom.ts';

export interface RouterContext {
  queryClient: QueryClient;
}

/** Paths that work without a session (the 401 handler never redirects away from them). */
export const PUBLIC_PATHS = ['/login', '/reset-password', '/invite', '/signin-link'];

/** Where a signed-in account lands by default. */
export function homeFor(me: Me): '/admin' | '/classroom' | '/teacher' | '/change-password' {
  if (me.mustChangePassword && !isLocked(me)) return '/change-password';
  if (me.role === 'admin') return '/admin';
  return me.classroomMode ? '/classroom' : '/teacher';
}

/** Only same-origin absolute paths are accepted as post-login destinations (no open redirects). */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (PUBLIC_PATHS.some((p) => next.startsWith(p))) return null;
  return next;
}

/**
 * beforeLoad guard for every signed-in area: asks the server for `me` EVERY time (PIN state must
 * never come from a stale cache, PIN-8), redirects to sign-in when there is no session, and to the
 * forced password change when required. The PIN lock itself is rendered by SensitiveGate so that no
 * sensitive component mounts while locked.
 */
export async function requireSession({ context, location }: { context: RouterContext; location: ParsedLocation }): Promise<{ me: Me }> {
  const me = await freshMe(context.queryClient);
  if (!me) throw redirect({ to: '/login', search: { next: location.href } });
  if (me.mustChangePassword && !isLocked(me) && location.pathname !== '/change-password') throw redirect({ to: '/change-password' });
  return { me };
}

/**
 * `requireSession` for the classroom screen (S26b, D-190): when the server cannot be reached at all
 * (no connection, gateway down), the last classroom data of this device is put back instead (at
 * most 7 days old, PIN-locked, cleared on sign-out), so a teacher can open or reload the classroom
 * and start a lesson that waits in the outbox. `offline` tells the caller not to call the server.
 * Any answer of the server (a 401 included) is followed as usual.
 */
export async function requireClassroomSession(args: { context: RouterContext; location: ParsedLocation }): Promise<{ me: Me; offline: boolean }> {
  // The browser knows it has no connection: the server is not asked (a query would wait for the
  // connection). Without a copy on this device the usual guard runs and waits for the connection.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const me = await restoreOfflineClassroom(args.context.queryClient);
    if (me) return { me, offline: true };
  }
  try {
    return { ...(await requireSession(args)), offline: false };
  } catch (err) {
    if (!isUnreachable(err)) throw err;
    const me = await restoreOfflineClassroom(args.context.queryClient);
    if (!me) throw err;
    return { me, offline: true };
  }
}
