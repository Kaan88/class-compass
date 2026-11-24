// @vitest-environment jsdom
/**
 * A sign-in gate in front of part of the site (D-217): an API call answered with a redirect is not
 * followed; the page is loaded again once so the gate can show its sign-in, and after that the person
 * gets a message instead of a loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Admin from '../../src/shared/contracts/admin.ts';
import * as Auth from '../../src/shared/contracts/auth.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { ApiError, call, callConditional, gate, onAuthProblem } from '../../src/client/lib/api.ts';
import { errorText } from '../../src/client/lib/errors.ts';

const redirected = () => ({ type: 'opaqueredirect', status: 0, ok: false, statusText: '', headers: new Headers(), json: async () => null }) as unknown as Response;
const json = (body: unknown) => ({ type: 'basic', status: 200, ok: true, statusText: 'OK', headers: new Headers(), json: async () => body }) as unknown as Response;

describe('a sign-in gate in front of an address (D-217)', () => {
  let reload: ReturnType<typeof vi.fn>;
  const realReload = gate.reload;
  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    gate.reload = reload as unknown as () => void;
  });
  afterEach(() => {
    gate.reload = realReload;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('never follows a redirect: every call asks for it to be handed back', async () => {
    const fetchMock = vi.fn(async () => json({ users: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await call(Admin.listUsers, {});
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
  });

  it('loads the page again once, does not sign the person out, and says what to do in both languages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => redirected()));
    const problems: string[] = [];
    const off = onAuthProblem((p) => problems.push(p));
    const err = await call(Admin.listUsers, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).details).toEqual({ reason: 'SIGN_IN_GATE' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(problems).toEqual([]);
    expect(errorText(((k: string) => (en as Record<string, string>)[k]) as never, err)).toBe(en['error.SIGN_IN_GATE']);
    expect(errorText(((k: string) => (tr as Record<string, string>)[k]) as never, err)).toBe(tr['error.SIGN_IN_GATE']);
    off();
  });

  it('a gate that keeps refusing gets one reload a minute, not a loop; polled calls are covered too', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    vi.stubGlobal('fetch', vi.fn(async () => redirected()));
    await call(Admin.listUsers, {}).catch(() => null);
    await call(Admin.listUsers, {}).catch(() => null);
    await callConditional(Auth.me, {}, null).catch(() => null);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_800_000_000_000 + 61_000);
    await call(Admin.listUsers, {}).catch(() => null);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('an ordinary answer is untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ users: [] })));
    expect(await call(Admin.listUsers, {})).toEqual({ users: [] });
    expect(reload).not.toHaveBeenCalled();
  });
});
