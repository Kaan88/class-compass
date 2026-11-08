/**
 * Super Speakers rules (S12, SSP-1..12, D-130). Pure functions, no I/O; shared by the server (board,
 * history) and the scorer app (search).
 *
 * - Week: the week containing an instant starts on `weekStartsOn` (default 1 = Monday) at 00:00 in the
 *   school timezone. The weekly "reset" is only this time window: points are never deleted.
 * - Podium: the top three PLACES of the week by dense ranking (equal totals share a place, the next
 *   total is the next place). Students with 0 points are never ranked. A place lists EVERY tied
 *   student in Turkish name order (never "who scored first"); the board makes a crowded place compact
 *   instead of hiding names (owner decision 1, D-133).
 * - Class totals: every participating class, including those with 0, by total then Turkish name order.
 * - Search: Turkish folding (`foldForSearch`: "isik" finds "Işık"), any word start of the full name,
 *   the class name without separators ("3a" finds "3-A") and the student number.
 */
import { compareNames, foldForSearch } from '../shared/text/turkish.ts';
import { addDays } from './dates.ts';
import { weekStartOf } from './counters.ts';

export interface WeekRange {
  /** First local day of the week ('YYYY-MM-DD'). */
  start: string;
  /** Last local day (inclusive). */
  end: string;
}

/** The week (local dates) containing instant `ms` in `tz`. */
export function weekRangeOf(ms: number, tz: string, weekStartsOn = 1): WeekRange {
  const start = weekStartOf(ms, tz, weekStartsOn);
  return { start, end: addDays(start, 6) };
}

/** Does local date `date` fall inside `week`? */
export const inWeek = (date: string, week: WeekRange) => date >= week.start && date <= week.end;

// ---------------------------------------------------------------- podium
export const PODIUM_PLACES = 3;

export interface Scored<S> {
  student: S;
  points: number;
}

export interface Place<S> {
  /** 1, 2 or 3 (dense rank). */
  rank: number;
  points: number;
  /** Every student with this total, in Turkish name order. */
  students: S[];
}

/**
 * Dense-ranked podium: the `places` highest distinct totals above 0, each with every student who has
 * that total (names in Turkish order).
 */
export function podium<S>(scores: readonly Scored<S>[], nameOf: (s: S) => string, opts: { places?: number } = {}): Place<S>[] {
  const places = opts.places ?? PODIUM_PLACES;
  const totals = [...new Set(scores.filter((s) => s.points > 0).map((s) => s.points))].sort((a, b) => b - a).slice(0, places);
  return totals.map((points, i) => {
    const tied = scores
      .filter((s) => s.points === points)
      .map((s) => s.student)
      .sort((a, b) => compareNames(nameOf(a), nameOf(b)));
    return { rank: i + 1, points, students: tied };
  });
}

/** Total per student of a list of point rows. */
export function totalsByStudent(rows: ReadonlyArray<{ studentId: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.studentId, (out.get(r.studentId) ?? 0) + 1);
  return out;
}

export interface ClassTotal {
  classId: string;
  name: string;
  points: number;
}

/** Every class, including 0, by total (high first) then Turkish name order (SSP-3). */
export function classTotals(classes: ReadonlyArray<{ id: string; name: string }>, rows: ReadonlyArray<{ classId: string }>): ClassTotal[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.classId, (count.get(r.classId) ?? 0) + 1);
  return classes.map((c) => ({ classId: c.id, name: c.name, points: count.get(c.id) ?? 0 })).sort((a, b) => b.points - a.points || compareNames(a.name, b.name));
}

// ---------------------------------------------------------------- search
export interface SearchableStudent {
  id: string;
  fullName: string;
  className: string;
  classId: string;
  studentNumber?: string | null;
}

export interface SearchEntry<S extends SearchableStudent> {
  student: S;
  /** Folded words of the full name. */
  words: string[];
  /** Folded class name without spaces, dashes or dots ("3-A" → "3a"). */
  classKey: string;
  number: string;
}

/** Folded, separators removed: what class names and numbers are compared on. */
export const compactKey = (s: string) => foldForSearch(s).replace(/[\s\-./_]+/gu, '');

/** Build once per student list (1,500 students in a few milliseconds). */
export function buildSearchIndex<S extends SearchableStudent>(students: readonly S[]): SearchEntry<S>[] {
  return [...students]
    .sort((a, b) => compareNames(a.fullName, b.fullName))
    .map((student) => ({ student, words: foldForSearch(student.fullName).split(' ').filter(Boolean), classKey: compactKey(student.className), number: (student.studentNumber ?? '').trim() }));
}

/** How well one query token matches an entry: 3 whole word, 2 word start, 1 class or number, 0 none. */
function tokenScore(e: SearchEntry<SearchableStudent>, token: string, compact: string): number {
  let best = 0;
  for (const w of e.words) {
    if (w === token) return 3;
    if (w.startsWith(token)) best = 2;
  }
  if (best) return best;
  if (compact && (e.classKey === compact || (compact.length >= 2 && e.classKey.startsWith(compact)))) return 1;
  if (compact && e.number && e.number.startsWith(compact)) return 1;
  return 0;
}

/**
 * Students matching every word of `query` (each word: the start of a name word, the class name, or
 * the start of the student number), best matches first, then in Turkish name order. An empty query
 * with a class filter lists that class.
 */
export function searchStudents<S extends SearchableStudent>(index: readonly SearchEntry<S>[], query: string, opts: { classId?: string | null; limit?: number } = {}): S[] {
  const limit = opts.limit ?? 40;
  const pool = opts.classId ? index.filter((e) => e.student.classId === opts.classId) : index;
  const tokens = foldForSearch(query)
    .split(/\s+/u)
    .map((t) => t.replace(/^[\-./_]+|[\-./_]+$/gu, ''))
    .filter(Boolean);
  if (!tokens.length) return opts.classId ? pool.slice(0, limit).map((e) => e.student) : [];
  const compacts = tokens.map(compactKey);
  const hits: Array<{ e: SearchEntry<S>; score: number; order: number }> = [];
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]!;
    let score = 0;
    let all = true;
    for (let k = 0; k < tokens.length; k++) {
      const s = tokenScore(e, tokens[k]!, compacts[k]!);
      if (!s) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) hits.push({ e, score, order: i });
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, limit).map((h) => h.e.student);
}
