/** Achievement rule engine, pure part (S13c item 2, D-121). Fictional data only. */
import { describe, expect, it } from 'vitest';
import { confidenceGrewCount, emptyFacts, longestOnTimeRun, longestWeekRun, ruleProgress, ruleReached } from '../../src/domain/achievements.ts';

describe('achievement rules', () => {
  it('counts goals, filtered by skill, capped at the threshold, and only since the start', () => {
    const f = emptyFacts();
    f.goalsSet.push({ at: 10, skill: 'reading' }, { at: 20, skill: 'writing' }, { at: 30, skill: 'reading' });
    expect(ruleProgress({ event: 'goal_set', threshold: 5 }, f)).toEqual({ current: 3, target: 5 });
    expect(ruleProgress({ event: 'goal_set', threshold: 2 }, f)).toEqual({ current: 2, target: 2 });
    expect(ruleProgress({ event: 'goal_set', threshold: 5, skill: 'reading' }, f).current).toBe(2);
    expect(ruleProgress({ event: 'goal_set', threshold: 5 }, f, 25).current).toBe(1);
    expect(ruleReached({ event: 'goal_set', threshold: 3 }, f)).toBe(true);
    expect(ruleReached({ event: 'goal_set', threshold: 3 }, f, 15)).toBe(false);
  });

  it('weekly reflection streaks count consecutive weeks; a gap ends the run but keeps the best', () => {
    expect(longestWeekRun(['2026-09-07', '2026-09-14', '2026-09-21', '2026-10-05', '2026-10-12'])).toBe(3);
    expect(longestWeekRun(['2026-09-07', '2026-09-07'])).toBe(1);
    expect(longestWeekRun([])).toBe(0);
  });

  it('on-time homework runs skip excused work and reset on missing work', () => {
    const marks = [
      { dueOn: '2026-09-01', kind: 'completed' },
      { dueOn: '2026-09-03', kind: 'excused' },
      { dueOn: '2026-09-05', kind: 'completed' },
      { dueOn: '2026-09-07', kind: 'missing' },
      { dueOn: '2026-09-09', kind: 'completed' },
    ];
    expect(longestOnTimeRun(marks)).toBe(2);
    const f = emptyFacts();
    f.homework.push(...marks.map((m, i) => ({ ...m, at: i })), { at: 9, dueOn: '2026-09-11', kind: 'submitted_late' });
    // Late work still counts as done (effort), but not as on time.
    expect(ruleProgress({ event: 'homework_completed', threshold: 10 }, f).current).toBe(4);
  });

  it('confidence grew is counted once per goal when a later check is more sure', () => {
    expect(
      confidenceGrewCount([
        { at: 1, goalId: 'a', confidence: 2 },
        { at: 2, goalId: 'a', confidence: 4 },
        { at: 3, goalId: 'a', confidence: 5 },
        { at: 1, goalId: 'b', confidence: 4 },
        { at: 2, goalId: 'b', confidence: 3 },
      ]),
    ).toBe(1);
  });

  it('evidence rules filter by kind and count distinct skills; Super Speakers rules count live points (S12, D-132)', () => {
    const f = emptyFacts();
    f.evidence.push({ at: 1, kind: 'image', skill: 'reading' }, { at: 2, kind: 'audio', skill: 'speaking' }, { at: 3, kind: 'image', skill: 'reading' });
    expect(ruleProgress({ event: 'evidence', threshold: 9, evidenceKind: 'image' }, f).current).toBe(2);
    expect(ruleProgress({ event: 'evidence_skills', threshold: 9 }, f).current).toBe(2);
    expect(ruleReached({ event: 'speaker_points', threshold: 1 }, f)).toBe(false);
    f.speakerPoints.push({ at: 5 }, { at: 9 });
    expect(ruleReached({ event: 'speaker_points', threshold: 2 }, f)).toBe(true);
    expect(ruleReached({ event: 'speaker_points', threshold: 2 }, f, 6)).toBe(false); // "start fresh" counts only later points
  });
});
