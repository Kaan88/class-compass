/**
 * Sign-out cache reset (UX-4, S13a review fix): after a 401 or a sign-out the cache is emptied but the
 * `me` query stays attached to its observers, so the root layout picks up the next account's language
 * without a reload (a Turkish account's first sign-in was shown in English). Fictional data only.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ME_KEY, resetSignedOut, type Me } from '../../src/client/lib/session.ts';

const turkishTeacher: Me = {
  kind: 'user',
  id: 'user-fictional-1',
  displayName: 'Zeynep Deneme',
  role: 'teacher',
  locale: 'tr',
  textScale: 100,
  density: 'normal',
  mustChangePassword: true,
  hasPin: false,
  signInMethod: 'password',
  hasEmail: false,
  reauthFresh: false,
  classroomMode: false,
  pinUnlockedUntil: null,
  pinUnlocked: true,
};

describe('resetSignedOut (UX-4)', () => {
  it('drops other cached data but keeps the me observer attached, so the next sign-in reaches the root layout', () => {
    const qc = new QueryClient();
    qc.setQueryData(ME_KEY, null);
    qc.setQueryData(['sensitive', 'students'], ['fictional']);
    const seen: Array<Me | null | undefined> = [];
    const observer = new QueryObserver<Me | null>(qc, { queryKey: ME_KEY, enabled: false });
    const off = observer.subscribe((r) => seen.push(r.data));

    resetSignedOut(qc);
    expect(qc.getQueryData(['sensitive', 'students'])).toBeUndefined();
    expect(qc.getQueryData(ME_KEY)).toBeNull();

    // The sign-in screen stores the new account: the (root layout's) observer must see it.
    qc.setQueryData(ME_KEY, turkishTeacher);
    expect(seen.at(-1)?.locale).toBe('tr');
    off();
  });

  it('keeps public sign-in page data, so a signed-out page load (401) does not cancel it (D-142)', async () => {
    const qc = new QueryClient();
    let resolve: (v: { emailLinkEnabled: boolean }) => void = () => undefined;
    const pending = qc.fetchQuery({ queryKey: ['public', 'reset-available'], queryFn: () => new Promise<{ emailLinkEnabled: boolean }>((r) => (resolve = r)) });
    resetSignedOut(qc);
    resolve({ emailLinkEnabled: true });
    await pending;
    expect(qc.getQueryData(['public', 'reset-available'])).toEqual({ emailLinkEnabled: true });
  });
});
