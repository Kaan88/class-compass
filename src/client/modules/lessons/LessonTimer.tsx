/**
 * Optional classroom timer (RTN-3, THM-5): big digits, start/pause/reset and a few presets. The
 * countdown is derived from the server state + server clock offset, so every device agrees. When
 * time is up the panel changes once (text + icon, no flashing) and plays one soft tone only if
 * sounds are on for the class AND this device.
 */
import { useEffect, useRef, useState } from 'react';
import { formatTimer, remainingAt } from '../../../domain/timer.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { soundsAllowed, useDisplay } from '../../lib/display.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconBack, IconClock, IconPause, IconPlay } from '../../ui/icons.tsx';
import { patchLesson, sendLessonCommand, serverNow } from './lessonClient.ts';
import { pauseTimer, resetTimer, setTimer, startTimer } from '../../../domain/timer.ts';

const PRESETS_MIN = [1, 3, 5, 10, 15];

function playSoftTone() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio unavailable: the visual signal is enough */
  }
}

export function LessonTimer({ lesson }: { lesson: LessonState }) {
  const { t } = useI18n();
  const display = useDisplay();
  const timer = lesson.timer;
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!timer.running) return;
    const h = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(h);
  }, [timer.running]);
  const left = remainingAt(timer, timer.running ? now : serverNow());
  const finished = timer.running && left === 0;

  // One tone per finished run (keyed by the run's start time), never repeated.
  const signalled = useRef<string | null>(null);
  useEffect(() => {
    const runKey = `${lesson.id}:${timer.startedAt}`;
    if (finished && signalled.current !== runKey) {
      signalled.current = runKey;
      if (soundsAllowed(display)) playSoftTone();
    }
  }, [finished, lesson.id, timer.startedAt, display]);

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
              apply((tm) => startTimer(finished ? pauseTimer(tm, serverNow()) : tm, serverNow()));
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
