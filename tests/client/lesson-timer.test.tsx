// @vitest-environment jsdom
/**
 * Classroom timer (RTN-3, S13a item 3, review fixes):
 * - time's-up is signalled ONCE per finished run for the whole page, even while the group screen
 *   shows a second (compact) timer over the dashboard's timer (one tone, one S13b announcement);
 * - the "Set time" keypad shows mm:ss and refuses seconds above 59, so the display is the time set.
 * Fictional data only.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonState } from '../../src/shared/contracts/lessons.ts';
import { onTimeUp } from '../../src/client/modules/classroomHooks.ts';
import { keypadMs, keypadSecondsValid, keypadText, LessonTimer, resetTimeUpSignals } from '../../src/client/modules/lessons/LessonTimer.tsx';

const START = Date.UTC(2026, 10, 9, 9, 0, 0);

function lessonWithTimer(): LessonState {
  return {
    id: 'lesson-fictional-1',
    contextId: 'context-fictional-1',
    timer: { durationMs: 2000, startedAt: START, remainingMs: 2000, running: true },
  } as unknown as LessonState;
}

describe('LessonTimer time-up signal (RTN-3, S13a 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    resetTimeUpSignals();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('calls the time-up handlers once when the dashboard timer and the group-screen timer are both mounted', () => {
    const calls: string[] = [];
    const off = onTimeUp((e) => calls.push(e.lesson.id));
    const lesson = lessonWithTimer();
    render(
      <>
        <LessonTimer lesson={lesson} />
        <LessonTimer lesson={lesson} compact />
      </>,
    );
    expect(calls).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(calls).toEqual(['lesson-fictional-1']);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(calls).toHaveLength(1);
    off();
  });
});

describe('timer keypad (S13a 3)', () => {
  it('reads the last two digits as seconds', () => {
    expect(keypadMs('130')).toBe(90_000);
    expect(keypadText('130')).toBe('01:30');
    expect(keypadSecondsValid('130')).toBe(true);
  });

  it('refuses seconds above 59 instead of setting a different time than the one shown', () => {
    expect(keypadText('99')).toBe('00:99');
    expect(keypadSecondsValid('99')).toBe(false);
    expect(keypadText('575')).toBe('05:75');
    expect(keypadSecondsValid('575')).toBe(false);
    expect(keypadSecondsValid('559')).toBe(true);
    expect(keypadSecondsValid('')).toBe(true);
  });
});
