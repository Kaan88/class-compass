/**
 * Sends the classroom screen's size once per board mount and after a window resize or a full screen
 * change (S18), at most once a minute (S16c, D-165). Renders nothing. A failed send is dropped: the next mount sends again.
 */
import { useEffect, useRef } from 'react';
import * as C from '../../../shared/contracts/displayInfo.ts';
import { call } from '../../lib/api.ts';
import { readDensity } from '../../lib/classroomPrefs.ts';
import { getDisplay } from '../../lib/display.ts';
import { useMe } from '../../lib/session.ts';
import type { BoardWatcherProps } from '../types.ts';
import { readSample } from './sample.ts';

/** Wait after mount so the layout has loaded and the window has settled (also skips React's dev double mount). */
export const MOUNT_DELAY_MS = 1500;
/** A resize is sent when the window has been still this long… */
export const RESIZE_SETTLE_MS = 2000;
/** …and never sooner than this after the previous send. */
export const MIN_GAP_MS = 60_000;

type Props = BoardWatcherProps;

export function DisplayReporter({ layoutSource }: Props) {
  const me = useMe();
  const latest = useRef({ layoutSource, userId: me?.id ?? null });
  latest.current = { layoutSource, userId: me?.id ?? null };

  useEffect(() => {
    let lastSent = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      timer = null;
      const d = getDisplay();
      const sample = readSample({ density: readDensity(latest.current.userId), theme: d.theme, layout: latest.current.layoutSource, textScale: d.textScale });
      lastSent = Date.now();
      if (sample) void call(C.reportDisplay, sample).catch(() => undefined);
    };
    timer = setTimeout(send, MOUNT_DELAY_MS);
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, Math.max(RESIZE_SETTLE_MS, lastSent + MIN_GAP_MS - Date.now()));
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onResize);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
