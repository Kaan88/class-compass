import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countAttendance, effectiveAttendance, nextStatus } from '../../src/domain/attendance.ts';
import { weekdayOf } from '../../src/domain/dates.ts';
import { clampStage } from '../../src/domain/routines.ts';
import { formatTimer, idleTimer, isFinished, pauseTimer, remainingAt, resetTimer, setTimer, startTimer } from '../../src/domain/timer.ts';

describe('attendance rules (ATT-2)', () => {
  it('exception › daily › not recorded', () => {
    expect(effectiveAttendance(null, null)).toBe('not_recorded');
    expect(effectiveAttendance(null, 'absent')).toBe('absent');
    expect(effectiveAttendance('present', 'absent')).toBe('present');
  });
  it('one tap cycles through every status and back (UX-8)', () => {
    expect(nextStatus('present')).toBe('absent');
    expect(nextStatus('absent')).toBe('late');
    expect(nextStatus('late')).toBe('excused');
    expect(nextStatus('excused')).toBe('present');
    expect(nextStatus('not_recorded')).toBe('absent');
    expect(countAttendance(['present', 'absent', 'present', 'not_recorded'])).toEqual({ present: 2, absent: 1, late: 0, excused: 0, not_recorded: 1 });
  });
});

describe('classroom timer (RTN-3)', () => {
  it('counts down from server time and pauses/resumes exactly', () => {
    let t = setTimer(60_000);
    t = startTimer(t, 1_000);
    expect(remainingAt(t, 11_000)).toBe(50_000);
    t = pauseTimer(t, 11_000);
    expect(t).toEqual({ durationMs: 60_000, startedAt: null, remainingMs: 50_000, running: false });
    expect(remainingAt(t, 99_000)).toBe(50_000);
    t = startTimer(t, 100_000);
    expect(remainingAt(t, 200_000)).toBe(0);
    expect(isFinished(t, 200_000)).toBe(true);
    // A finished timer starts again from the full duration.
    t = startTimer(pauseTimer(t, 200_000), 300_000);
    expect(remainingAt(t, 300_000)).toBe(60_000);
    expect(resetTimer(t)).toEqual(idleTimer(60_000));
    expect(formatTimer(65_000)).toBe('1:05');
    expect(formatTimer(3_600_000)).toBe('1:00:00');
  });
  it('never reports negative or more than the remaining time (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 3_600_000 }), fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 1e7 }), (d, at, later) => {
        const t = startTimer(setTimer(d), at);
        const left = remainingAt(t, at + later);
        return left >= 0 && left <= d;
      }),
    );
  });
});

describe('routine and calendar helpers', () => {
  it('clamps stage indexes and computes weekdays (DSH-2)', () => {
    expect(clampStage(9, 6)).toBe(5);
    expect(clampStage(-1, 6)).toBe(0);
    expect(clampStage(3, 0)).toBe(0);
    expect(weekdayOf('2026-11-09')).toBe(1);
    expect(weekdayOf('2026-11-15')).toBe(0);
  });
});
