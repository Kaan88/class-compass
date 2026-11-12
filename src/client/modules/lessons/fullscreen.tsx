/**
 * Full screen during lessons (S18, D-167): the teacher's preference, the board's Full screen / Leave
 * full screen button and the profile page setting. The Fullscreen API itself is only called through
 * `lib/fullscreen.ts`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import * as L from '../../../shared/contracts/lessons.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { enterFullscreen, exitFullscreen, fullscreenSupported, useIsFullscreen } from '../../lib/fullscreen.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { IconButton } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Toggle } from '../../ui/Fields.tsx';
import { IconFullscreen, IconFullscreenExit } from '../../ui/icons.tsx';

export const lessonPrefsKey = ['classroom', 'lessonPrefs'] as const;
/** Used until the preference is read (and when it cannot be): the setting is off by default (owner 2026-11-12). */
export const DEFAULT_LESSON_PREFS: L.LessonPrefs = { fullscreen: false };

export function useLessonPrefs(): L.LessonPrefs {
  const q = useQuery({ queryKey: lessonPrefsKey, queryFn: () => call(L.getLessonPrefs, {}), staleTime: 5 * 60_000 });
  return q.data ?? DEFAULT_LESSON_PREFS;
}

/** Start lesson: call inside the press handler, before anything is awaited. */
export function enterLessonFullscreen(prefs: L.LessonPrefs) {
  if (prefs.fullscreen) enterFullscreen();
}

/** End lesson: leaves full screen when the preference is on and the page is in it. */
export function exitLessonFullscreen(prefs: L.LessonPrefs) {
  if (prefs.fullscreen) exitFullscreen();
}

/**
 * The top bar button: "Full screen" outside full screen (only where `canEnter`, i.e. while a lesson
 * runs on the board), a small "Leave full screen" icon button whenever the page is in full screen,
 * whatever the lesson state or the screen, so a touch panel without Esc is never left without a way
 * out (after the summary, a failed start, a lesson ended elsewhere, the teacher area). Nothing where
 * the browser has no full screen. Works whatever the preference says.
 */
export function FullscreenButton({ canEnter = true }: { canEnter?: boolean }) {
  const { t } = useI18n();
  const active = useIsFullscreen();
  if (!fullscreenSupported()) return null;
  if (active) {
    return <IconButton icon={<IconFullscreenExit />} label={t('fullscreen.leave')} hideLabel onPress={() => exitFullscreen()} data-testid="fullscreen-leave" />;
  }
  return canEnter ? <IconButton icon={<IconFullscreen />} label={t('fullscreen.enter')} onPress={() => enterFullscreen()} data-testid="fullscreen-enter" /> : null;
}

/** Profile page (teachers): "Full screen during lessons". Saved at once. */
export function LessonPrefsSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: lessonPrefsKey, queryFn: () => call(L.getLessonPrefs, {}) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (fullscreen: boolean) => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(lessonPrefsKey, await call(L.setLessonPrefs, { fullscreen }));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-lesson-prefs" data-testid="lesson-prefs">
      <h2 id="cc-lesson-prefs" className="cc-h2">
        {t('fullscreen.settingsTitle')}
      </h2>
      <Toggle
        label={t('fullscreen.setting')}
        description={t('fullscreen.settingHint')}
        isSelected={(prefs.data ?? DEFAULT_LESSON_PREFS).fullscreen}
        isDisabled={!prefs.isSuccess || busy}
        onChange={(v) => void save(v)}
      />
      {error ? <Alert>{error}</Alert> : null}
    </section>
  );
}
