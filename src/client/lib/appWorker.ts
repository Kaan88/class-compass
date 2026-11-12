/**
 * Registers the teacher and classroom app's service worker (`/app-sw.js`, S26b, D-190) and moves to a
 * new build only at a quiet moment.
 *
 * - Registered by the main entry only, in production builds (never by the student page, the scorer
 *   app or the board), with scope `/`; the worker itself leaves the student and Super Speakers pages
 *   and every API request alone.
 * - A new deploy installs a new worker that waits. When this page already runs the new build (it was
 *   loaded from the network after the deploy), the new worker takes over at once. Otherwise it takes
 *   over at the next quiet moment, followed by one reload: the classroom screen with no lesson and
 *   no Start or End Lesson flow on screen, and never while commands are still waiting to be sent. A
 *   running lesson is never reloaded, and neither is any other page (a teacher form may hold typed
 *   text, even in a hidden tab): those move to the new build on their next full load.
 */
import { useEffect } from 'react';

type QuietReason = 'lesson' | 'flow' | 'idle';
let screen: QuietReason | null = null;
const listeners = new Set<() => void>();

/**
 * The classroom screen says what it shows: `lesson` (a board), `flow` (Start or End Lesson, a
 * summary) or `idle` (no lesson; a queued start counts as idle). Null elsewhere.
 */
export function setClassroomScreen(state: QuietReason | null) {
  if (screen === state) return;
  screen = state;
  listeners.forEach((l) => l());
}

export function useClassroomScreen(state: QuietReason | null) {
  useEffect(() => {
    setClassroomScreen(state);
    return () => setClassroomScreen(null);
  }, [state]);
}

/** Whether a reload now would interrupt nothing (pure, exported for tests). */
export function isQuietMoment(s: { screen: QuietReason | null; hidden: boolean; pending: number; online: boolean }): boolean {
  if (s.pending > 0 || !s.online) return false;
  // Only the classroom screen with no lesson and no flow. Any other page (teacher, admin, help) may
  // hold typed text, hidden or not: it moves to the new build on its next full load instead (the
  // page then runs the new build and the waiting worker takes over at once).
  return s.screen === 'idle';
}

/** The build this page was loaded from (`<meta name="cc-build">`, written by the build). */
export function pageBuild(doc: Pick<Document, 'querySelector'> = document): string | null {
  return doc.querySelector('meta[name="cc-build"]')?.getAttribute('content') ?? null;
}

function askBuild(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (e: MessageEvent<{ build?: string }>) => {
      clearTimeout(timer);
      resolve(typeof e.data?.build === 'string' ? e.data.build : null);
    };
    worker.postMessage({ type: 'BUILD' }, [channel.port2]);
  });
}

export interface AppWorkerEnv {
  pending: () => number;
  online: () => boolean;
  /** Called when `pending` or `online` may have changed. */
  subscribe: (fn: () => void) => void;
}

/** Register the worker (production builds of the main entry only). */
export function registerAppWorker(env: AppWorkerEnv) {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const mine = pageBuild();
  let reloadOnTakeOver = false;
  let checking = false;

  const quiet = () => isQuietMoment({ screen, hidden: document.visibilityState === 'hidden', pending: env.pending(), online: env.online() });

  const consider = async (reg: ServiceWorkerRegistration) => {
    const waiting = reg.waiting;
    if (!waiting || checking || reloadOnTakeOver) return;
    checking = true;
    try {
      // First install on this device: nothing to replace.
      if (!sw.controller) return waiting.postMessage({ type: 'SKIP_WAITING' });
      const build = await askBuild(waiting);
      if (build && build === mine) return waiting.postMessage({ type: 'SKIP_WAITING' });
      if (!quiet()) return;
      reloadOnTakeOver = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } finally {
      checking = false;
    }
  };

  sw.addEventListener('controllerchange', () => {
    if (reloadOnTakeOver) window.location.reload();
  });

  void sw
    .register('/app-sw.js', { scope: '/' })
    .then((reg) => {
      const check = () => void consider(reg);
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', check));
      listeners.add(check);
      env.subscribe(check);
      document.addEventListener('visibilitychange', check);
      window.addEventListener('online', check);
      // Look for a new build now and then (browsers also look on every page load).
      setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
      setInterval(check, 60_000);
      check();
    })
    .catch(() => undefined);
}
