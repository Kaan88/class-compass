/**
 * Where the student is on their page (S14d, D-151): screens live in the QUERY STRING,
 * `/s?screen=…&subject=…&goal=…&step=n`, with `pushState` and `popstate`, so the phone's Back button,
 * a reload and a bookmark all work.
 *
 * The URL fragment is never used here: `main.tsx` reads the link's token from it and removes it before
 * anything renders, so a token can never be taken for a screen and a screen never ends up in the
 * fragment. Unknown screens and malformed values fall back to the home screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const SCREENS = ['home', 'goals', 'newGoal', 'howIsItGoing', 'showMyWork', 'achievements', 'homework', 'avatar', 'help'] as const;
export type Screen = (typeof SCREENS)[number];

export interface StudentNav {
  screen: Screen;
  /** The subject the screen is about (the home screen's subject switch). */
  subject: string | null;
  /** A goal chosen in an earlier step (How is it going?). */
  goal: string | null;
  /** The step of a short-steps screen, from 1. */
  step: number;
}

export const HOME: StudentNav = { screen: 'home', subject: null, goal: null, step: 1 };
export const MAX_STEP = 9;

/** Ids are UUIDs: anything else in the address is ignored. */
const ID = /^[0-9A-Za-z-]{1,64}$/u;

export function readNav(search: string): StudentNav {
  const q = new URLSearchParams(search);
  const screen = q.get('screen') ?? 'home';
  const subject = q.get('subject');
  const goal = q.get('goal');
  const step = Number(q.get('step') ?? '1');
  return {
    screen: (SCREENS as readonly string[]).includes(screen) ? (screen as Screen) : 'home',
    subject: subject && ID.test(subject) ? subject : null,
    goal: goal && ID.test(goal) ? goal : null,
    step: Number.isInteger(step) && step >= 1 && step <= MAX_STEP ? step : 1,
  };
}

/** The query string of a place (home with no subject is the bare `/s`). */
export function navSearch(nav: StudentNav): string {
  const q = new URLSearchParams();
  if (nav.screen !== 'home') q.set('screen', nav.screen);
  if (nav.subject) q.set('subject', nav.subject);
  if (nav.goal) q.set('goal', nav.goal);
  if (nav.step > 1) q.set('step', String(nav.step));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The page address of a place: path + query, never a fragment. */
export const navHref = (nav: StudentNav, pathname = typeof window === 'undefined' ? '/s' : window.location.pathname) => `${pathname}${navSearch(nav)}`;

/** How many of our own entries are behind this one in the tab's history (0 = the page was opened here). */
const depthOf = (state: unknown) => (state && typeof state === 'object' && typeof (state as { ccStudent?: unknown }).ccStudent === 'number' ? (state as { ccStudent: number }).ccStudent : 0);

export interface NavApi {
  nav: StudentNav;
  /** Go to a place (a new history entry, or the same entry with `replace`). */
  go: (next: Partial<StudentNav> & { screen: Screen }, opts?: { replace?: boolean }) => void;
  /** One step back in the page's own history, or home when the page was opened here. */
  back: () => void;
  /**
   * A short-steps screen is done (saved): leave its step entries behind and show `target` in place of
   * its first step, so Back then goes to where the steps started, not into a finished form.
   */
  finish: (target: Partial<StudentNav> & { screen: Screen }) => void;
}

export function useStudentNav(): NavApi {
  const [nav, setNav] = useState<StudentNav>(() => readNav(window.location.search));
  const pending = useRef<StudentNav | null>(null);
  useEffect(() => {
    // Mark the entry the page opened on, so Back knows where our own history starts.
    if (depthOf(window.history.state) === 0) window.history.replaceState({ ccStudent: 0 }, '', navHref(readNav(window.location.search)));
    const onPop = () => {
      const target = pending.current;
      pending.current = null;
      if (target) window.history.replaceState({ ccStudent: depthOf(window.history.state) }, '', navHref(target));
      setNav(readNav(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback<NavApi['go']>((next, opts = {}) => {
    const target: StudentNav = { subject: null, goal: null, step: 1, ...next };
    const depth = depthOf(window.history.state);
    if (opts.replace) window.history.replaceState({ ccStudent: depth }, '', navHref(target));
    else window.history.pushState({ ccStudent: depth + 1 }, '', navHref(target));
    setNav(readNav(window.location.search));
  }, []);
  const back = useCallback(() => {
    if (depthOf(window.history.state) > 0) window.history.back();
    else {
      const here = readNav(window.location.search);
      const target: StudentNav = { ...HOME, subject: here.subject };
      window.history.replaceState({ ccStudent: 0 }, '', navHref(target));
      setNav(target);
    }
  }, []);
  const finish = useCallback<NavApi['finish']>((next) => {
    const target: StudentNav = { subject: null, goal: null, step: 1, ...next };
    // Our own entries behind this one that belong to the finished steps (never past the page's first entry).
    const steps = Math.min(readNav(window.location.search).step - 1, depthOf(window.history.state));
    if (steps <= 0) {
      window.history.replaceState({ ccStudent: depthOf(window.history.state) }, '', navHref(target));
      setNav(target);
      return;
    }
    pending.current = target;
    window.history.go(-steps);
  }, []);
  return { nav, go, back, finish };
}
