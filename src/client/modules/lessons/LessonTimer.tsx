/**
 * Optional classroom timer (RTN-3, THM-5): big digits, start/pause/reset and a few presets. The
 * countdown is derived from the server state + server clock offset, so every device agrees. When
 * time is up the panel changes once (text + icon, no flashing) and plays one soft tone only if
 * sounds are on for the class AND this device.
 */
import { useEffect, useRef, useState } from 'react';
import { formatTimer, remainingAt } from '../../../domain/timer.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { useDisplay } from '../../lib/display.ts';
import { playThemeSound, useTheme } from '../../themes/index.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconBack, IconClock, IconPause, IconPlay } from '../../ui/icons.tsx';
import { patchLesson, sendLessonCommand, serverNow } from './lessonClient.ts';
import { pauseTimer, resetTimer, setTimer, startTimer } from '../../../domain/timer.ts';

const PRESETS_MIN = [1, 3, 5, 10, 15];
/** A run that ended at most this long ago still gets its tone when the screen first shows it. */
const RECENT_END_MS = 3_000;

export function LessonTimer({ lesson }: { lesson: LessonState }) {
  const { t } = useI18n();
  const display = useDisplay();
  const theme = useTheme();
  const timer = lesson.timer;
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!timer.running) return;
    const h = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(h);
  }, [timer.running]);
  const left = remainingAt(timer, timer.running ? now : serverNow());
  const finished = timer.running && left === 0;

  // One tone per finished run, and only when the countdown reaches 0 while this screen shows it
  // (or within the last few seconds): a run that finished long ago stays silent after a reload, on
  // another device or when the dashboard is shown again.
  const runKey = `${lesson.id}:${timer.startedAt}`;
  const watched = useRef<string | null>(null);
  const signalled = useRef<string | null>(null);
  useEffect(() => {
    if (timer.running && !finished) watched.current = runKey;
    if (!finished || signalled.current === runKey) return;
    signalled.current = runKey;
    const endedAt = (timer.startedAt ?? 0) + timer.remainingMs;
    // One soft tone of the class theme, only if the class and this device allow sounds (D-048, THM-5).
    if (watched.current === runKey || serverNow() - endedAt <= RECENT_END_MS) playThemeSound(display, theme, 'timerEnd');
  }, [finished, runKey, timer.running, timer.startedAt, timer.remainingMs, display, theme]);

  const ref = { contextId: lesson.contextId, lessonId: lesson.id };
  const apply = (fn: (tm: LessonState['timer']) => LessonState['timer']) => patchLesson(lesson.contextId, (l) => ({ ...l, timer: fn(l.timer) }));

  return (
    <section className="cc-card cc-stack cc-timer" data-finished={finished ? '' : undefined} aria-labelledby="cc-timer-title">
      <h2 id="cc-timer-title" className="cc-h2 cc-row">
        <IconClock />
        {t('timer.title')}
      </h2>
      <div className="cc-timer__digits" role="timer" aria-live="off" data-testid="timer-digits">
        {formatTimer(left)}
      </div>
      {finished ? (
        <p className="cc-timer__done" role="status">
          <IconClock />
          {t('timer.done')}
        </p>
      ) : null}
      <div className="cc-row">
        {timer.running && !finished ? (
          <Button
            size="big"
            variant="primary"
            onPress={() => {
              apply((tm) => pauseTimer(tm, serverNow()));
              void sendLessonCommand('lesson.timer.pause', ref);
            }}
          >
            <IconPause />
            {t('timer.pause')}
          </Button>
        ) : (
          <Button
            size="big"
            variant="primary"
            onPress={() => {
              apply((tm) => startTimer(tm, serverNow()));
              void sendLessonCommand('lesson.timer.start', ref);
            }}
          >
            <IconPlay />
            {t('timer.start')}
          </Button>
        )}
        <Button
          size="big"
          onPress={() => {
            apply(resetTimer);
            void sendLessonCommand('lesson.timer.reset', ref);
          }}
        >
          <IconBack />
          {t('timer.reset')}
        </Button>
      </div>
      <div className="cc-row" role="group" aria-label={t('timer.presets')}>
        {PRESETS_MIN.map((m) => (
          <Button
            key={m}
            size="small"
            aria-pressed={!timer.running && timer.durationMs === m * 60_000}
            onPress={() => {
              apply(() => setTimer(m * 60_000));
              void sendLessonCommand('lesson.timer.set', { ...ref, durationMs: m * 60_000 });
            }}
          >
            {t('timer.minutes', { count: m })}
          </Button>
        ))}
      </div>
    </section>
  );
}
