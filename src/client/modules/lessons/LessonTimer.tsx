/**
 * Optional classroom timer (RTN-3, THM-5): big digits, start/pause/reset, a few presets and (S13a)
 * "Set time": a big mm:ss keypad for any time up to 3 hours. The countdown is derived from the
 * server state + server clock offset, so every device agrees. When time is up the panel changes once
 * (text + icon, no flashing), plays one soft tone only if sounds are on for the class AND this
 * device, and calls the time's-up handlers (`onTimeUp`, the S13b voice/chime hook).
 */
import { useEffect, useState } from 'react';
import { formatTimer, MAX_TIMER_MS, remainingAt } from '../../../domain/timer.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { useDisplay } from '../../lib/display.ts';
import { playEvent, useTheme } from '../../themes/index.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconBack, IconBackspace, IconCheck, IconClock, IconPause, IconPlay } from '../../ui/icons.tsx';
import { emitTimeUp } from '../classroomHooks.ts';
import { patchLesson, sendLessonCommand, serverNow } from './lessonClient.ts';
import { announceTimeUp } from './timeUp.ts';
import { pauseTimer, resetTimer, setTimer, startTimer } from '../../../domain/timer.ts';

const PRESETS_MIN = [1, 3, 5, 10, 15];

/**
 * Time's-up is signalled once per finished run for the whole page, not once per mounted timer: the
 * group screen shows a second (compact) timer over the dashboard's, and the class must hear one tone
 * and one S13b announcement. A run counts as watched when any mounted timer saw it counting down.
 */
const watchedRuns = new Set<string>();
const signalledRuns = new Set<string>();
const remember = (set: Set<string>, key: string) => {
  set.add(key);
  if (set.size > 50) set.delete(set.values().next().value as string);
};
/** Test hook: forget which runs were watched / signalled. */
export function resetTimeUpSignals(): void {
  watchedRuns.clear();
  signalledRuns.clear();
}
/** A run that ended at most this long ago still gets its tone when the screen first shows it. */
const RECENT_END_MS = 3_000;

/** Keypad digits → milliseconds: the last two digits are seconds, the ones before are minutes ("130" = 1:30). */
export function keypadMs(digits: string): number {
  const d = digits.replace(/\D/g, '').slice(-4);
  const sec = Number(d.slice(-2) || '0');
  const min = Number(d.slice(0, -2) || '0');
  return (min * 60 + sec) * 1000;
}
/** The seconds part shown on the keypad must be 00-59, so the mm:ss display is exactly the time that is set. */
export const keypadSecondsValid = (digits: string) => Number(digits.replace(/\D/g, '').slice(-4).slice(-2) || '0') < 60;
export const keypadText = (digits: string) => {
  const d = digits.padStart(4, '0').slice(-4);
  return `${d.slice(0, 2)}:${d.slice(2)}`;
};

function TimerKeypad({ isOpen, onOpenChange, onSet }: { isOpen: boolean; onOpenChange: (v: boolean) => void; onSet: (ms: number) => void }) {
  const { t } = useI18n();
  const [digits, setDigits] = useState('');
  const ms = keypadMs(digits);
  const secondsOk = keypadSecondsValid(digits);
  const valid = secondsOk && ms >= 1000 && ms <= MAX_TIMER_MS;
  const press = (k: string) => setDigits((d) => (d + k).replace(/^0+/, '').slice(0, 4));
  const close = (v: boolean) => {
    if (!v) setDigits('');
    onOpenChange(v);
  };
  return (
    <Modal isOpen={isOpen} onOpenChange={close} title={t('timer.setTitle')} testId="timer-keypad">
      <output className="cc-keypad__display" aria-live="polite" aria-label={t('timer.keypadValue')} data-testid="timer-keypad-value">
        {keypadText(digits)}
      </output>
      <p className="cc-muted">{t('timer.keypadHint')}</p>
      <div className="cc-keypad" role="group" aria-label={t('timer.keypad')}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <Button key={k} size="big" onPress={() => press(k)}>
            {k}
          </Button>
        ))}
        <Button size="big" onPress={() => setDigits('')}>
          {t('timer.keypadClearShort')}
        </Button>
        <Button size="big" onPress={() => press('0')}>
          0
        </Button>
        <Button size="big" onPress={() => setDigits((d) => d.slice(0, -1))} aria-label={t('timer.keypadBack')}>
          <IconBackspace />
        </Button>
      </div>
      {!secondsOk ? <p className="cc-muted">{t('timer.keypadSeconds')}</p> : !valid && digits ? <p className="cc-muted">{t('timer.keypadRange')}</p> : null}
      <DialogActions>
        <Button onPress={() => close(false)}>{t('common.cancel')}</Button>
        <Button
          variant="primary"
          isDisabled={!valid}
          onPress={() => {
            onSet(ms);
            close(false);
          }}
        >
          <IconCheck />
          {t('timer.setTime')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

export function LessonTimer({ lesson, compact = false }: { lesson: LessonState; compact?: boolean }) {
  const { t, locale } = useI18n();
  const [keypad, setKeypad] = useState(false);
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
  useEffect(() => {
    if (timer.running && !finished) remember(watchedRuns, runKey);
    if (!finished || signalledRuns.has(runKey)) return;
    remember(signalledRuns, runKey);
    const endedAt = (timer.startedAt ?? 0) + timer.remainingMs;
    // The class's time's-up announcement (voice, clip, chime or off; S13b, D-107), only if the class
    // and this device allow sounds (D-048, THM-5).
    if (watchedRuns.has(runKey) || serverNow() - endedAt <= RECENT_END_MS) {
      announceTimeUp(display, theme);
      emitTimeUp({ lesson, display, locale });
    }
  }, [finished, runKey, timer.running, timer.startedAt, timer.remainingMs, display, theme, lesson, locale]);

  const ref = { contextId: lesson.contextId, lessonId: lesson.id };
  const apply = (fn: (tm: LessonState['timer']) => LessonState['timer']) => patchLesson(lesson.contextId, (l) => ({ ...l, timer: fn(l.timer) }));

  const titleId = compact ? 'cc-timer-title-compact' : 'cc-timer-title';
  return (
    <section className="cc-card cc-stack cc-timer" data-compact={compact ? '' : undefined} data-finished={finished ? '' : undefined} aria-labelledby={titleId} data-testid={compact ? 'timer-compact' : 'timer'}>
      <h2 id={titleId} className="cc-h2 cc-row">
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
              playEvent('timerStart');
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
        <Button size="small" onPress={() => setKeypad(true)} aria-pressed={!timer.running && !PRESETS_MIN.some((m) => timer.durationMs === m * 60_000)}>
          <IconClock />
          {t('timer.setTime')}
        </Button>
      </div>
      <TimerKeypad
        isOpen={keypad}
        onOpenChange={setKeypad}
        onSet={(ms) => {
          apply(() => setTimer(ms));
          void sendLessonCommand('lesson.timer.set', { ...ref, durationMs: ms });
        }}
      />
    </section>
  );
}
