/**
 * A lazy student screen that renders at once after its chunk was preloaded (S26c, D-191; budget D-151).
 * `preload()` fetches the chunk (the page calls it right after its first render, `preloadWritingScreens`);
 * `Screen` shows the loaded component directly once it is here, and React.lazy (with the nearest
 * Suspense fallback) only before that.
 */
import { createElement, lazy, useState, type ComponentType } from 'react';

export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const fetchIt = () =>
    (pending ??= load().then(
      (c) => (loaded = c),
      (e: unknown) => {
        pending = null; // a failed fetch is tried again when the screen opens
        throw e;
      },
    ));
  const Lazy = lazy(() => fetchIt().then((c) => ({ default: c })));
  /**
   * React.lazy suspends once even when the chunk is already here (its own `.then` runs later), and the
   * Suspense fallback is then held for React's reveal throttle (about 0.8 s). So once the module has
   * arrived the screen renders it directly. The choice is made once per mount, so a screen that
   * mounted lazily keeps its state when the chunk arrives.
   */
  function Screen(props: P) {
    const [Use] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return createElement(Use, props);
  }
  return { Screen, preload: () => fetchIt().then(() => undefined) };
}

