import { redirect, type ParsedLocation } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { freshMe, isLocked, type Me } from '../lib/session.ts';

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
