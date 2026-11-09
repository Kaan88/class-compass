/**
 * Super Speakers moving to its own origin (S14f, D-157), the scorer app's side.
 *
 * Awards made offline wait in this origin's IndexedDB outbox. When the administrator gives Super
 * Speakers its own hostname, the main host redirects `/p` and `/p/app` to it, and the new origin has
 * its own, empty IndexedDB: a queue left on the main origin would be stranded. So:
 * - while this device has awards waiting, the app sets the scorer queue cookie (path `/p`, value `1`,
 *   nothing secret); the main host then still serves the app instead of redirecting;
 * - once the queue is empty the cookie is cleared, and a page that was opened with the cookie set asks
 *   the server (a `HEAD /p` that does not follow redirects) whether `/p` now redirects. If it does, the
 *   app reopens the same page, so the main host's 308 (decided by the server, never by a value the page
 *   reads) takes it to the speakers origin, with the link's token in the fragment when there was one.
 * With SPEAKERS_ORIGIN unset the cookie changes nothing: the server never redirects, so the app stays.
 */
import { SCORER_PAGE_PATH, SCORER_QUEUE_COOKIE } from '../../shared/contracts/superSpeakers.ts';

/** Long enough to outlast any offline stretch; cleared as soon as the queue is empty. */
const QUEUE_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 60;

/** Is the scorer queue cookie set (read from a `document.cookie` string)? */
export function hasQueueCookie(cookie: string): boolean {
  return cookie.split(';').some((part) => part.trim() === `${SCORER_QUEUE_COOKIE}=1`);
}

/** The `document.cookie` assignment that sets (`on`) or clears the scorer queue cookie. */
export function queueCookieString(on: boolean, secure: boolean): string {
  return `${SCORER_QUEUE_COOKIE}=${on ? '1' : ''}; Path=${SCORER_PAGE_PATH}; Max-Age=${on ? QUEUE_COOKIE_MAX_AGE_S : 0}; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export interface MoveEnv {
  /** Current `document.cookie`. */
  readCookie: () => string;
  writeCookie: (value: string) => void;
  secure: boolean;
  /** A `HEAD /p` that does not follow redirects; true when the server answered with a redirect. */
  probeRedirect: () => Promise<boolean>;
  /** Reopen this page (`location.replace`). */
  reopen: (url: string) => void;
  /** The page's path and query (no fragment). */
  here: () => string;
}

export function browserMoveEnv(): MoveEnv {
  return {
    readCookie: () => document.cookie,
    writeCookie: (v) => {
      document.cookie = v;
    },
    secure: window.location.protocol === 'https:',
    probeRedirect: async () => {
      const res = await fetch(SCORER_PAGE_PATH, { method: 'HEAD', redirect: 'manual', credentials: 'same-origin', cache: 'no-store' });
      return res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
    },
    reopen: (url) => window.location.replace(url),
    here: () => window.location.pathname + window.location.search,
  };
}

/**
 * Keeps the cookie in step with the queue and moves the app once it is empty. `queuedAtLoad`: the
 * cookie was set when this page loaded (only then can the main host have served it while split).
 */
export function createQueueMover(env: MoveEnv, queuedAtLoad: boolean, token: string | null) {
  let probed = false;
  let probing = false;
  return {
    /** Awards are waiting (or were just queued): keep the app on this origin until they are sent. */
    queued(): void {
      if (!hasQueueCookie(env.readCookie())) env.writeCookie(queueCookieString(true, env.secure));
    },
    /** The queue is empty (checked against the outbox itself, after this link's owner was set). */
    async drained(): Promise<void> {
      if (hasQueueCookie(env.readCookie())) env.writeCookie(queueCookieString(false, env.secure));
      if (!queuedAtLoad || probing || probed) return;
      probing = true;
      try {
        const moved = await env.probeRedirect();
        probed = true;
        if (moved) env.reopen(env.here() + (token ? `#${token}` : ''));
      } catch {
        // No answer (offline): ask again the next time the queue is found empty.
      } finally {
        probing = false;
      }
    },
  };
}
