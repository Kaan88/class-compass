/**
 * Fair rotation (SEC-2, AST-2, D-062, D-063). Pure, no I/O. Candidates are ranked by
 *   1. fewest turns so far (`count`),
 *   2. longest since the last turn (`last`; never = first; numbers or ISO dates compare naturally),
 *   3. a caller-supplied tie-break (seeded random for Secret Students, Turkish name order for the
 *      Daily Assistant).
 * Picking always takes a prefix of that ranking, so among students who are always available the
 * turn counts never differ by more than one.
 */

export interface RotationKeys<T> {
  count: (t: T) => number;
  last: (t: T) => number | string | null;
  tie: (a: T, b: T) => number;
}

function compareLast(a: number | string | null, b: number | string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

export function rankFair<T>(items: readonly T[], k: RotationKeys<T>): T[] {
  return [...items].sort((a, b) => k.count(a) - k.count(b) || compareLast(k.last(a), k.last(b)) || k.tie(a, b));
}

/** The first `n` candidates of the fair ranking (fewer when there are not enough). Never repeats one. */
export function pickFair<T>(items: readonly T[], n: number, k: RotationKeys<T>): T[] {
  if (n <= 0) return [];
  return rankFair(items, k).slice(0, n);
}

/**
 * Deterministic pseudo-random number in [0, 2^32) for (seed, id): FNV-1a followed by a murmur-style
 * finaliser. The same seed always ranks the same students the same way, so a replay of a draw can
 * never pick differently, while different rounds (different seeds) break ties differently.
 */
export function seededRank(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
