/**
 * Achievement rule engine, pure part (S13c item 3, D-121). The server collects what one student did in
 * one class+subject (`ActivityFacts`, ids and dates only) and asks, for each automatic badge, how far
 * the student is (`ruleProgress`). Awarding is "progress reached the threshold and no live award
 * exists", so evaluating again (a replay, a backfill, a second event) never awards twice.
 *
 * Everything counts effort: no attendance, no speed, no comparison with other students. Streaks
 * count weeks (reflections) or assignments (homework done on time) in a row; a gap only ends the
 * current run, it never takes a badge away.
 */
import type { AchievementRule, AchievementSkill, EvidenceFilterKind } from '../shared/achievements.ts';

export interface ActivityFacts {
  goalsSet: Array<{ at: number; skill: AchievementSkill | null }>;
  goalsAchieved: Array<{ at: number; skill: AchievementSkill | null }>;
  selfAssessments: Array<{ at: number; goalId: string; confidence: number }>;
  reflections: Array<{ at: number; weekStart: string }>;
  notes: Array<{ at: number }>;
  evidence: Array<{ at: number; kind: EvidenceFilterKind; skill: AchievementSkill | null }>;
  /** Reviewed homework marks, any order. `kind` is the status kind (completed, submitted_late, missing, excused…). */
  homework: Array<{ at: number; dueOn: string; kind: string }>;
  /** Days the student was the daily assistant (ticked or thanked). */
  assistantDays: Array<{ at: number; date: string; allDuties: boolean }>;
  /** Revealed Secret Student turns where the class earned it. */
  secretEarned: Array<{ at: number }>;
}

export const emptyFacts = (): ActivityFacts => ({ goalsSet: [], goalsAchieved: [], selfAssessments: [], reflections: [], notes: [], evidence: [], homework: [], assistantDays: [], secretEarned: [] });

const DAY = 86_400_000;
const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);

/** Longest run of consecutive weeks (week starts 7 days apart). */
export function longestWeekRun(weekStarts: readonly string[]): number {
  const weeks = [...new Set(weekStarts)].map(dayNumber).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < weeks.length; i++) {
    run = i > 0 && weeks[i]! - weeks[i - 1]! === 7 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Statuses that neither continue nor break an on-time run (excused, not checked yet). */
const NEUTRAL = new Set(['excused', 'not_checked']);

/** Longest run of homework completed on time, in due-date order; excused work is skipped. */
export function longestOnTimeRun(marks: ReadonlyArray<{ dueOn: string; kind: string }>): number {
  const ordered = [...marks].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  let best = 0;
  let run = 0;
  for (const m of ordered) {
    if (NEUTRAL.has(m.kind)) continue;
    run = m.kind === 'completed' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Goals where a later self-assessment is more confident than an earlier one. */
export function confidenceGrewCount(items: ReadonlyArray<{ at: number; goalId: string; confidence: number }>): number {
  const byGoal = new Map<string, Array<{ at: number; confidence: number }>>();
  for (const i of items) byGoal.set(i.goalId, [...(byGoal.get(i.goalId) ?? []), i]);
  let n = 0;
  for (const list of byGoal.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    let min = Infinity;
    if (sorted.some((x) => (x.confidence > min ? true : ((min = Math.min(min, x.confidence)), false)))) n++;
  }
  return n;
}

const skillOk = (rule: AchievementRule, skill: AchievementSkill | null) => !rule.skill || rule.skill === skill;

/** How far a student is towards a rule (`current` capped at `target`), counting only what happened at or after `since`. */
export function ruleProgress(rule: AchievementRule, all: ActivityFacts, since: number | null = null): { current: number; target: number } {
  const s = since ?? -Infinity;
  const f = <T extends { at: number }>(xs: readonly T[]) => xs.filter((x) => x.at >= s);
  let current = 0;
  switch (rule.event) {
    case 'goal_set':
      current = f(all.goalsSet).filter((g) => skillOk(rule, g.skill)).length;
      break;
    case 'goal_achieved':
      current = f(all.goalsAchieved).filter((g) => skillOk(rule, g.skill)).length;
      break;
    case 'self_assessment':
      current = f(all.selfAssessments).length;
      break;
    case 'confidence_grew':
      current = confidenceGrewCount(f(all.selfAssessments));
      break;
    case 'evidence':
      current = f(all.evidence).filter((e) => skillOk(rule, e.skill) && (!rule.evidenceKind || rule.evidenceKind === e.kind)).length;
      break;
    case 'evidence_skills':
      current = new Set(f(all.evidence).flatMap((e) => (e.skill ? [e.skill] : []))).size;
      break;
    case 'reflection':
      current = f(all.reflections).length;
      break;
    case 'note':
      current = f(all.notes).length;
      break;
    case 'reflection_week_streak':
      current = longestWeekRun(f(all.reflections).map((r) => r.weekStart));
      break;
    case 'homework_completed':
      current = f(all.homework).filter((h) => h.kind === 'completed' || h.kind === 'submitted_late').length;
      break;
    case 'homework_on_time_streak':
      current = longestOnTimeRun(f(all.homework));
      break;
    case 'skill_activity':
      current = f(all.evidence).filter((e) => skillOk(rule, e.skill) && e.skill !== null).length + f(all.goalsAchieved).filter((g) => skillOk(rule, g.skill) && g.skill !== null).length;
      break;
    case 'assistant_day':
      current = f(all.assistantDays).length;
      break;
    case 'assistant_all_duties':
      current = f(all.assistantDays).filter((d) => d.allDuties).length;
      break;
    case 'secret_earned':
      current = f(all.secretEarned).length;
      break;
    case 'speaker_points':
      // Super Speakers (S12) does not exist yet: the badges are defined but cannot be earned.
      current = 0;
      break;
  }
  return { current: Math.min(current, rule.threshold), target: rule.threshold };
}

export const ruleReached = (rule: AchievementRule, facts: ActivityFacts, since: number | null = null) => {
  const p = ruleProgress(rule, facts, since);
  return p.current >= p.target;
};

export { DAY as DAY_MS, dayNumber };
