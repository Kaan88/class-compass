/**
 * Daily Assistant planning (AST-1/2/4, D-063). Pure and deterministic: no randomness, so the same
 * history always yields the same plan. Rotation = fewest turns this school year, then longest since
 * the last turn, then Turkish alphabetical order of the full name (then id).
 */
import { compareNames } from '../shared/text/turkish.ts';
import { addDays, weekdayOf } from './dates.ts';
import { pickFair } from './rotation.ts';

export interface AssistantCandidate {
  id: string;
  fullName: string;
}

export interface TurnInfo {
  count: number;
  /** Latest date ('YYYY-MM-DD') of a counted turn. */
  last: string | null;
}

/** School days of the week starting `weekStart`, limited to the school year. */
export function weekDates(weekStart: string, schoolDays: readonly number[], yearStart: string, yearEnd: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (schoolDays.includes(weekdayOf(d)) && d >= yearStart && d <= yearEnd) out.push(d);
  }
  return out;
}

const keys = (turns: ReadonlyMap<string, TurnInfo>) => ({
  count: (c: AssistantCandidate) => turns.get(c.id)?.count ?? 0,
  last: (c: AssistantCandidate) => turns.get(c.id)?.last ?? null,
  tie: (a: AssistantCandidate, b: AssistantCandidate) => compareNames(a.fullName, b.fullName) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

/** The next fair candidate (or null when there is none). */
export function nextAssistant(candidates: readonly AssistantCandidate[], turns: ReadonlyMap<string, TurnInfo>): AssistantCandidate | null {
  return pickFair(candidates, 1, keys(turns))[0] ?? null;
}

/**
 * Assign one assistant per date, in date order, counting each new assignment before the next date
 * is planned (so a week never repeats a student while others are waiting). `turns` holds the turns
 * that already exist (excluding `dates`); it is not modified.
 */
export function planAssistants(dates: readonly string[], rosterOn: (date: string) => readonly AssistantCandidate[], turns: ReadonlyMap<string, TurnInfo>): Map<string, string | null> {
  const t = new Map(turns);
  const out = new Map<string, string | null>();
  for (const date of [...dates].sort()) {
    const pick = nextAssistant(rosterOn(date), t);
    out.set(date, pick?.id ?? null);
    if (pick) {
      const cur = t.get(pick.id) ?? { count: 0, last: null };
      t.set(pick.id, { count: cur.count + 1, last: cur.last && cur.last > date ? cur.last : date });
    }
  }
  return out;
}
