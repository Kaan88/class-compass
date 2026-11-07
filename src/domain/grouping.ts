/**
 * Grouping solver (S8: GRP-1..8, D-072). Pure, no I/O, deterministic for a seed.
 *
 * - `groupSizes`: k groups whose sizes differ by at most 1 (count mode: k = min(count, n); size
 *   mode: the k whose sizes stay closest to the target, fewer groups on a tie, so 17 students in
 *   pairs make 7 pairs and one trio rather than a lonely "pair" of one, and 7 students in teams of
 *   4 make 4 + 3 rather than one team of 7).
 * - Level mode puts similar levels together: assessed students fill the groups in level order;
 *   students without a level (the explicit "unassessed" bucket) are spread evenly over the groups.
 *   The order of the finished groups is then shuffled with the seed, so a group's position (and so
 *   its default name and icon) never tells the class which group is the lowest or highest (GRP-7).
 * - Levels are free text: numbers, codes (A1, B2) and the usual EN/TR word scales (Beginner …
 *   Advanced, Başlangıç … İleri) are ranked in their real order (`levelRanks`).
 * - Mixed mode balances levels across groups with a serpentine draft (highest levels first), with
 *   the unassessed bucket drafted last so it is also spread evenly.
 * - Pair constraints: 'apart' is a hard rule where possible, 'together' a soft one. A swap search
 *   (sizes never change) removes violations, then improves the level objective. When 'apart' rules
 *   are still broken, an exact backtracking search over the students those rules name decides
 *   whether they can all be met with these group sizes (and finds such an arrangement if so).
 *   Whatever cannot be met is reported with a reason (GRP-8); nothing is dropped silently.
 * - Ties are broken with `seededRank(seed, id)`, so the same seed always gives the same groups.
 */
import { foldForSearch } from '../shared/text/turkish.ts';
import { seededRank } from './rotation.ts';

export type GroupingMode = 'level' | 'mixed';
export type Sizing = { groupCount: number } | { targetSize: number };
export type ConstraintKind = 'together' | 'apart';

export interface GroupStudent {
  id: string;
  /** 0 = lowest level; null = not assessed (the "unassessed" bucket). */
  levelRank: number | null;
}

export interface PairRule {
  id: string;
  a: string;
  b: string;
  kind: ConstraintKind;
}

export type UnsatisfiedReason =
  /** Only one group: two students cannot be kept apart. */
  | 'ONE_GROUP'
  /** Students linked by 'together' rules are more than fit in one group. */
  | 'GROUP_TOO_SMALL'
  /** A 'together' rule contradicts an 'apart' rule (directly or through other 'together' rules). */
  | 'CONFLICTS_WITH_APART'
  /** No arrangement with these group sizes meets every rule; the 'apart' rules were preferred. */
  | 'NOT_POSSIBLE_WITH_OTHER_RULES'
  /** The search stopped before finding an arrangement that meets every 'apart' rule (very many rules). */
  | 'NO_ARRANGEMENT_FOUND'
  /** The groups were arranged by hand and break this rule. */
  | 'ARRANGED_BY_HAND';

export interface Unsatisfied {
  ruleId: string;
  a: string;
  b: string;
  kind: ConstraintKind;
  reason: UnsatisfiedReason;
}

export interface SolveInput {
  students: readonly GroupStudent[];
  mode: GroupingMode;
  sizing: Sizing;
  rules: readonly PairRule[];
  seed: string;
}

export interface SolveResult {
  groups: string[][];
  unsatisfied: Unsatisfied[];
}

/** Number of groups for a target size: sizes as close to the target as possible, fewer groups on a tie. */
function groupsForTarget(n: number, target: number): number {
  const t = Math.max(1, Math.trunc(target));
  const dev = (k: number) => Math.max(Math.abs(Math.ceil(n / k) - t), Math.abs(Math.floor(n / k) - t));
  const lo = Math.min(n, Math.max(1, Math.floor(n / t)));
  const hi = Math.min(n, Math.max(1, Math.ceil(n / t)));
  return dev(hi) < dev(lo) ? hi : lo;
}

/** Sizes of the groups for n students: they differ by at most one, larger groups first. */
export function groupSizes(n: number, sizing: Sizing): number[] {
  if (n <= 0) return [];
  const k = 'groupCount' in sizing ? Math.min(Math.max(1, Math.trunc(sizing.groupCount)), n) : groupsForTarget(n, sizing.targetSize);
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Word scales teachers commonly use, lowest first, folded (Turkish lower case, no diacritics, letters
 * and digits only). Words on one line share a step; the steps are comparable across scales.
 */
const LEVEL_WORDS: ReadonlyArray<readonly string[]> = [
  ['beginner', 'starter', 'novice', 'emerging', 'baslangic', 'baslayan'],
  ['low', 'basic', 'dusuk', 'temel'],
  ['elementary', 'developing', 'gelisen', 'gelismekte'],
  ['preintermediate', 'ortaalti', 'ortaoncesi'],
  ['intermediate', 'medium', 'middle', 'average', 'orta'],
  ['upperintermediate', 'ortaustu', 'secure', 'iyi'],
  ['high', 'yuksek'],
  ['advanced', 'ileri'],
  ['proficient', 'proficiency', 'mastery', 'exceeding', 'uzman', 'cokiyi'],
];
const WORD_STEP = new Map(LEVEL_WORDS.flatMap((words, step) => words.map((w) => [w, step] as const)));
const foldLevel = (label: string) => foldForSearch(label).replace(/[^a-z0-9]/g, '');
/** The step of a known level word (EN or TR, any case), or null for other labels. */
export const levelWordStep = (label: string): number | null => WORD_STEP.get(foldLevel(label)) ?? null;

/**
 * Distinct teacher-entered level labels (free text), lowest first, as the solver ranks them: known
 * words (Beginner … Advanced, Başlangıç … İleri) by their step, then every other label in natural
 * order (numbers compare as numbers, so "2" < "10" and "A1" < "A2" < "B1"). Shown to the teacher so
 * the order used is never a surprise.
 */
export function orderedLevels(labels: Iterable<string | null | undefined>): string[] {
  const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
  const distinct = [...new Set([...labels].filter((l): l is string => Boolean(l?.trim())).map((l) => l.trim()))];
  return distinct.sort((a, b) => {
    const sa = levelWordStep(a);
    const sb = levelWordStep(b);
    if (sa !== null && sb !== null && sa !== sb) return sa - sb;
    if (sa !== null && sb === null) return -1;
    if (sa === null && sb !== null) return 1;
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/** Ranks of teacher-entered level labels (`orderedLevels`), lowest = 0. Empty / missing labels are unassessed. */
export function levelRanks(levels: ReadonlyMap<string, string | null>): Map<string, number | null> {
  const distinct = orderedLevels(levels.values());
  const rank = new Map<string, number>();
  // Labels on the same step of a word scale ("Orta" / "Intermediate") share a rank.
  let r = -1;
  distinct.forEach((l, i) => {
    const prev = i > 0 ? distinct[i - 1]! : null;
    const same = prev !== null && levelWordStep(l) !== null && levelWordStep(l) === levelWordStep(prev);
    if (!same) r++;
    rank.set(l, r);
  });
  return new Map([...levels].map(([id, l]) => [id, l?.trim() ? (rank.get(l.trim()) ?? null) : null]));
}

// ---------------------------------------------------------------- cost
const W_APART = 1_000_000;
const W_TOGETHER = 10_000;
const W_UNASSESSED = 1_000;

function groupIndex(groups: readonly (readonly string[])[]): Map<string, number> {
  const m = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((id) => m.set(id, i)));
  return m;
}

/** Rules whose two students are both placed (rules about absent / other students do not apply). */
const applicable = (rules: readonly PairRule[], where: ReadonlyMap<string, number>) => rules.filter((r) => r.a !== r.b && where.has(r.a) && where.has(r.b));

function violated(r: PairRule, where: ReadonlyMap<string, number>): boolean {
  const same = where.get(r.a) === where.get(r.b);
  return r.kind === 'apart' ? same : !same;
}

/** Level objective: spread inside groups (level mode) or distance of group means from the class mean (mixed). */
function qualityCost(groups: readonly (readonly string[])[], rank: ReadonlyMap<string, number | null>, mode: GroupingMode): number {
  // The unassessed bucket stays spread evenly (at most one apart per group) in both modes.
  const unassessed = groups.map((g) => g.filter((id) => (rank.get(id) ?? null) === null).length);
  let cost = unassessed.length ? Math.max(0, Math.max(...unassessed) - Math.min(...unassessed) - 1) * W_UNASSESSED : 0;
  const all = [...rank.values()].filter((r): r is number => r !== null);
  const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  for (const g of groups) {
    const rs = g.map((id) => rank.get(id) ?? null).filter((r): r is number => r !== null);
    if (!rs.length) continue;
    if (mode === 'level') cost += Math.max(...rs) - Math.min(...rs);
    else cost += Math.abs(rs.reduce((a, b) => a + b, 0) / rs.length - mean) * rs.length;
  }
  return cost;
}

function cost(groups: readonly (readonly string[])[], rules: readonly PairRule[], rank: ReadonlyMap<string, number | null>, mode: GroupingMode): number {
  const where = groupIndex(groups);
  let c = qualityCost(groups, rank, mode);
  for (const r of applicable(rules, where)) if (violated(r, where)) c += r.kind === 'apart' ? W_APART : W_TOGETHER;
  return c;
}

// ---------------------------------------------------------------- initial placement
function initialGroups(students: readonly GroupStudent[], sizes: readonly number[], mode: GroupingMode, seed: string): string[][] {
  const k = sizes.length;
  const tie = (a: GroupStudent, b: GroupStudent) => seededRank(seed, a.id) - seededRank(seed, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const assessed = students.filter((s) => s.levelRank !== null).sort((a, b) => a.levelRank! - b.levelRank! || tie(a, b));
  const unassessed = students.filter((s) => s.levelRank === null).sort(tie);
  const groups: string[][] = sizes.map(() => []);
  if (mode === 'level') {
    // Spread the unassessed bucket evenly first (quota per group), then fill groups in level order.
    const quota = sizes.map(() => 0);
    for (let i = 0; i < unassessed.length; i++) {
      // The group with the fewest unassessed so far (then the most free room) that can take one more.
      let best = -1;
      for (let g = 0; g < k; g++) {
        if (quota[g]! >= sizes[g]!) continue;
        if (best < 0 || quota[g]! < quota[best]! || (quota[g] === quota[best] && sizes[g]! - quota[g]! > sizes[best]! - quota[best]!)) best = g;
      }
      quota[best]! += 1;
    }
    let g = 0;
    for (const s of assessed) {
      while (groups[g]!.length >= sizes[g]! - quota[g]!) g++;
      groups[g]!.push(s.id);
    }
    let u = 0;
    for (let gi = 0; gi < k; gi++) for (let q = 0; q < quota[gi]!; q++) groups[gi]!.push(unassessed[u++]!.id);
    return groups;
  }
  // Mixed: serpentine draft from the highest level down, then the unassessed bucket.
  const order = [...[...assessed].reverse(), ...unassessed];
  let dir = 1;
  let g = 0;
  for (const s of order) {
    let guard = 0;
    while (groups[g]!.length >= sizes[g]! && guard++ < 2 * k) {
      g += dir;
      if (g >= k || g < 0) {
        dir = -dir;
        g += dir;
      }
    }
    groups[g]!.push(s.id);
    g += dir;
    if (g >= k || g < 0) {
      dir = -dir;
      g += dir;
    }
  }
  return groups;
}

// ---------------------------------------------------------------- improvement (swaps keep sizes)
function improve(start: string[][], rules: readonly PairRule[], rank: ReadonlyMap<string, number | null>, mode: GroupingMode): string[][] {
  const groups = start.map((g) => [...g]);
  let current = cost(groups, rules, rank, mode);
  for (let round = 0; round < 400; round++) {
    let best: { gi: number; i: number; gj: number; j: number; c: number } | null = null;
    for (let gi = 0; gi < groups.length; gi++)
      for (let gj = gi + 1; gj < groups.length; gj++)
        for (let i = 0; i < groups[gi]!.length; i++)
          for (let j = 0; j < groups[gj]!.length; j++) {
            const a = groups[gi]![i]!;
            const b = groups[gj]![j]!;
            groups[gi]![i] = b;
            groups[gj]![j] = a;
            const c = cost(groups, rules, rank, mode);
            groups[gi]![i] = a;
            groups[gj]![j] = b;
            if (c < current - 1e-9 && (!best || c < best.c - 1e-9)) best = { gi, i, gj, j, c };
          }
    if (!best) break;
    const a = groups[best.gi]![best.i]!;
    groups[best.gi]![best.i] = groups[best.gj]![best.j]!;
    groups[best.gj]![best.j] = a;
    current = best.c;
  }
  return groups;
}

// ---------------------------------------------------------------- reasons (GRP-8)
function components(ids: readonly string[], edges: readonly PairRule[]): Map<string, string> {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const e of edges) if (parent.has(e.a) && parent.has(e.b)) parent.set(find(e.a), find(e.b));
  return new Map(ids.map((id) => [id, find(id)]));
}

/**
 * The rules the arrangement breaks, each with the reason it could not be met. `byHand` = the groups
 * were edited or kept by hand, so a broken rule is reported as such. `apartSearch` = what the exact
 * search found for the 'apart' rules: 'gave_up' turns the 'not possible' reason into the softer
 * NO_ARRANGEMENT_FOUND (it was not proven impossible).
 */
export function evaluateRules(groups: readonly (readonly string[])[], rules: readonly PairRule[], opts: { byHand?: boolean; apartSearch?: 'impossible' | 'gave_up' } = {}): Unsatisfied[] {
  const where = groupIndex(groups);
  const live = applicable(rules, where);
  const ids = [...where.keys()];
  const together = live.filter((r) => r.kind === 'together');
  const comp = components(ids, together);
  const compSize = new Map<string, number>();
  for (const c of comp.values()) compSize.set(c, (compSize.get(c) ?? 0) + 1);
  const maxSize = Math.max(0, ...groups.map((g) => g.length));
  const apartInside = new Set(live.filter((r) => r.kind === 'apart' && comp.get(r.a) === comp.get(r.b)).map((r) => comp.get(r.a)!));
  const out: Unsatisfied[] = [];
  for (const r of live) {
    if (!violated(r, where)) continue;
    let reason: UnsatisfiedReason;
    if (opts.byHand) reason = 'ARRANGED_BY_HAND';
    else if (r.kind === 'apart') reason = groups.filter((g) => g.length > 0).length <= 1 ? 'ONE_GROUP' : comp.get(r.a) === comp.get(r.b) ? 'CONFLICTS_WITH_APART' : opts.apartSearch === 'gave_up' ? 'NO_ARRANGEMENT_FOUND' : 'NOT_POSSIBLE_WITH_OTHER_RULES';
    else if (apartInside.has(comp.get(r.a)!)) reason = 'CONFLICTS_WITH_APART';
    else if ((compSize.get(comp.get(r.a)!) ?? 0) > maxSize) reason = 'GROUP_TOO_SMALL';
    else reason = 'NOT_POSSIBLE_WITH_OTHER_RULES';
    out.push({ ruleId: r.id, a: r.a, b: r.b, kind: r.kind, reason });
  }
  return out;
}

const violationCost = (groups: readonly (readonly string[])[], rules: readonly PairRule[]) => {
  const where = groupIndex(groups);
  return applicable(rules, where).reduce((c, r) => c + (violated(r, where) ? (r.kind === 'apart' ? W_APART : W_TOGETHER) : 0), 0);
};

/**
 * Exact search (GRP-8): can every 'apart' rule be met with these group sizes? Only the students the
 * rules name are placed (the others fill the free seats afterwards), with backtracking and symmetry
 * pruning (empty groups of the same size are interchangeable). Returns groups (aligned with `sizes`)
 * that meet every 'apart' rule, 'impossible' when none exist, or 'gave_up' after `budget` steps.
 */
export function apartPlacement(ids: readonly string[], sizes: readonly number[], rules: readonly PairRule[], budget = 200_000): string[][] | 'impossible' | 'gave_up' {
  const all = new Set(ids);
  const apart = rules.filter((r) => r.kind === 'apart' && r.a !== r.b && all.has(r.a) && all.has(r.b));
  const nb = new Map<string, Set<string>>();
  for (const r of apart) {
    if (!nb.has(r.a)) nb.set(r.a, new Set());
    if (!nb.has(r.b)) nb.set(r.b, new Set());
    nb.get(r.a)!.add(r.b);
    nb.get(r.b)!.add(r.a);
  }
  // Most constrained first; ties by id so the search is deterministic.
  const named = [...nb.keys()].sort((a, b) => nb.get(b)!.size - nb.get(a)!.size || (a < b ? -1 : a > b ? 1 : 0));
  const groups: string[][] = sizes.map(() => []);
  const where = new Map<string, number>();
  let steps = 0;
  const place = (i: number): boolean | 'gave_up' => {
    if (i === named.length) return true;
    if (++steps > budget) return 'gave_up';
    const id = named[i]!;
    const triedEmpty = new Set<number>();
    for (let g = 0; g < sizes.length; g++) {
      if (groups[g]!.length >= sizes[g]!) continue;
      if (groups[g]!.length === 0) {
        if (triedEmpty.has(sizes[g]!)) continue;
        triedEmpty.add(sizes[g]!);
      }
      if ([...nb.get(id)!].some((o) => where.get(o) === g)) continue;
      groups[g]!.push(id);
      where.set(id, g);
      const r = place(i + 1);
      if (r !== false) return r;
      groups[g]!.pop();
      where.delete(id);
    }
    return false;
  };
  const r = place(0);
  if (r === 'gave_up') return 'gave_up';
  if (!r) return 'impossible';
  const rest = ids.filter((id) => !where.has(id));
  let k = 0;
  for (let g = 0; g < sizes.length; g++) while (groups[g]!.length < sizes[g]!) groups[g]!.push(rest[k++]!);
  return groups;
}

const apartBroken = (groups: readonly (readonly string[])[], rules: readonly PairRule[]) => {
  const where = groupIndex(groups);
  return applicable(rules, where).some((r) => r.kind === 'apart' && violated(r, where));
};

/** Partition the (present) students into groups. Every student is placed exactly once. */
export function solveGroups(input: SolveInput): SolveResult {
  const seen = new Set<string>();
  const students = input.students.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const sizes = groupSizes(students.length, input.sizing);
  if (!sizes.length) return { groups: [], unsatisfied: [] };
  const rank = new Map(students.map((s) => [s.id, s.levelRank]));
  let best: string[][] | null = null;
  let bestCost = Infinity;
  // A few deterministic restarts help the swap search out of a local optimum when rules remain broken.
  for (let attempt = 0; attempt < 6; attempt++) {
    const seed = attempt === 0 ? input.seed : `${input.seed}#${attempt}`;
    const start = attempt === 0 ? initialGroups(students, sizes, input.mode, seed) : initialGroups(students, sizes, input.mode === 'level' ? 'mixed' : 'level', seed);
    const groups = improve(start, input.rules, rank, input.mode);
    const c = cost(groups, input.rules, rank, input.mode);
    if (c < bestCost - 1e-9) {
      best = groups;
      bestCost = c;
    }
    if (violationCost(best!, input.rules) === 0) break;
  }
  let apartSearch: 'impossible' | 'gave_up' | undefined;
  if (apartBroken(best!, input.rules)) {
    // The swap search can miss a solution: decide exactly, and start from a solution when one exists.
    const exact = apartPlacement(students.map((s) => s.id), sizes, input.rules);
    if (Array.isArray(exact)) {
      const groups = improve(exact, input.rules, rank, input.mode);
      const c = cost(groups, input.rules, rank, input.mode);
      if (!apartBroken(groups, input.rules) || c < bestCost - 1e-9) best = groups;
    } else apartSearch = exact;
  }
  let groups = best!;
  if (input.mode === 'level') {
    // Level groups are built lowest level first; shuffle their order with the seed so that a group's
    // position, and so its default name and icon, does not reveal its level band (GRP-7).
    const key = (i: number) => seededRank(input.seed, `group-order:${i}`);
    groups = groups.map((g, i) => ({ g, i })).sort((a, b) => key(a.i) - key(b.i) || a.i - b.i).map((x) => x.g);
  }
  return { groups, unsatisfied: evaluateRules(groups, input.rules, apartSearch ? { apartSearch } : {}) };
}

/**
 * Fit a saved arrangement to the students present in a lesson (GRP-5), without changing the saved
 * arrangement: absent students and students no longer in the class are left out, present students
 * the arrangement does not know are added to the smallest groups, and groups are evened out (moving
 * as few students as possible, never into a group with an 'apart' partner when avoidable) so sizes
 * differ by at most one (among the groups that keep students). With a target size (`sizing`), groups
 * left too small by absences are merged until the group count suits the students present, so an
 * absent partner never leaves a child working alone in a "pair".
 */
export function fitToPresent(saved: readonly (readonly string[])[], present: readonly string[], rules: readonly PairRule[], seed: string, sizing?: Sizing): { groups: string[][]; moved: string[] } {
  const here = new Set(present);
  const groups = saved.map((g) => g.filter((id) => here.has(id)));
  const placed = new Set(groups.flat());
  const moved: string[] = [];
  const order = (ids: readonly string[]) => [...ids].sort((a, b) => seededRank(seed, a) - seededRank(seed, b) || (a < b ? -1 : 1));
  const apartOf = (id: string) => new Set(rules.filter((r) => r.kind === 'apart' && (r.a === id || r.b === id)).map((r) => (r.a === id ? r.b : r.a)));
  const conflicts = (id: string, g: readonly string[]) => {
    const ap = apartOf(id);
    return g.some((x) => ap.has(x));
  };
  if (!groups.length && present.length) groups.push([]);
  const dropped = new Set<number>();
  const live = () => groups.map((g, i) => ({ g, i })).filter(({ i }) => !dropped.has(i));
  /** The smallest live group for `id` (no 'apart' partner in it when possible). */
  const smallestFor = (id: string, except = -1) => {
    const pool = live().filter(({ i }) => i !== except);
    const smallest = Math.min(...pool.map(({ g }) => g.length));
    const candidates = pool.filter(({ g }) => g.length === smallest);
    return candidates.find(({ g }) => !conflicts(id, g)) ?? candidates[0]!;
  };
  for (const id of order(present.filter((x) => !placed.has(x)))) {
    smallestFor(id).g.push(id);
    moved.push(id);
  }
  if (sizing && 'targetSize' in sizing) {
    // Groups that lost every member are gone; then merge the smallest groups while there are more
    // groups than the students present call for.
    groups.forEach((g, i) => g.length === 0 && dropped.add(i));
    const k = groupSizes(present.length, sizing).length;
    while (live().length > Math.max(1, k)) {
      const pool = live();
      const smallest = Math.min(...pool.map(({ g }) => g.length));
      const victim = [...pool].reverse().find(({ g }) => g.length === smallest)!;
      dropped.add(victim.i);
      for (const id of order(victim.g)) {
        smallestFor(id, victim.i).g.push(id);
        moved.push(id);
      }
      groups[victim.i] = [];
    }
  }
  for (let guard = 0; guard < 1000; guard++) {
    const pool = live();
    if (pool.length < 2) break;
    const sizes = pool.map(({ g }) => g.length);
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    if (max - min <= 1) break;
    const from = pool[sizes.indexOf(max)]!.i;
    const to = pool[sizes.indexOf(min)]!.i;
    const pick = order(groups[from]!).find((id) => !conflicts(id, groups[to]!)) ?? order(groups[from]!)[0]!;
    groups[from] = groups[from]!.filter((x) => x !== pick);
    groups[to]!.push(pick);
    moved.push(pick);
  }
  // Aligned with `saved` (index i = saved group i; one extra group when nothing was saved), so callers
  // keep each group's name and roles; callers drop the empty ones.
  return { groups, moved };
}
