/**
 * Grouping solver (S8: GRP-1..8, ENG-3 "grouping constraints & uneven sizes", D-072): property tests
 * on the pure domain logic. Fictional ids only.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluateRules, fitToPresent, groupSizes, levelRanks, solveGroups, type GroupStudent, type PairRule, type Sizing } from '../../src/domain/grouping.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${String(i).padStart(2, '0')}`);

const studentsArb = fc
  .integer({ min: 0, max: 40 })
  .chain((n) => fc.tuple(fc.constant(ids(n)), fc.array(fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }), { minLength: n, maxLength: n })))
  .map(([list, levels]) => list.map((id, i): GroupStudent => ({ id, levelRank: levels[i] ?? null })));
const sizingArb: fc.Arbitrary<Sizing> = fc.oneof(fc.integer({ min: 1, max: 10 }).map((groupCount) => ({ groupCount })), fc.integer({ min: 1, max: 8 }).map((targetSize) => ({ targetSize })));
const modeArb = fc.constantFrom('level' as const, 'mixed' as const);

describe('groupSizes (GRP-2, GRP-8)', () => {
  it('sizes add up to n and differ by at most one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), sizingArb, (n, sizing) => {
        const sizes = groupSizes(n, sizing);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        if (n > 0) expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        if (n > 0 && 'groupCount' in sizing) expect(sizes.length).toBe(Math.min(sizing.groupCount, n));
      }),
    );
  });
  it('pairs of an odd class make one trio instead of a single student', () => {
    expect(groupSizes(17, { targetSize: 2 })).toEqual([3, 2, 2, 2, 2, 2, 2, 2]);
    expect(groupSizes(1, { targetSize: 2 })).toEqual([1]);
    expect(groupSizes(2, { groupCount: 5 })).toEqual([1, 1]); // tiny class: never empty groups
  });
});

describe('solveGroups (GRP-1..3, GRP-8)', () => {
  it('places every present student exactly once, with sizes within one (partition completeness)', () => {
    fc.assert(
      fc.property(studentsArb, sizingArb, modeArb, fc.string(), (students, sizing, mode, seed) => {
        const { groups } = solveGroups({ students, sizing, mode, rules: [], seed });
        const flat = groups.flat();
        expect(flat.sort()).toEqual(students.map((s) => s.id).sort());
        if (students.length) {
          const sizes = groups.map((g) => g.length);
          expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
          expect(Math.min(...sizes)).toBeGreaterThan(0);
        } else expect(groups).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it('is deterministic for a seed', () => {
    fc.assert(
      fc.property(studentsArb, sizingArb, modeArb, fc.string(), (students, sizing, mode, seed) => {
        const a = solveGroups({ students, sizing, mode, rules: [], seed });
        const b = solveGroups({ students: [...students].reverse(), sizing, mode, rules: [], seed });
        expect(b).toEqual(a);
      }),
      { numRuns: 40 },
    );
  });

  it('different seeds can give different mixed groups', () => {
    const students = ids(20).map((id, i) => ({ id, levelRank: i % 4 }));
    const results = new Set(['a', 'b', 'c', 'd', 'e'].map((seed) => JSON.stringify(solveGroups({ students, sizing: { targetSize: 4 }, mode: 'mixed', rules: [], seed }).groups)));
    expect(results.size).toBeGreaterThan(1);
  });

  it('level mode keeps similar levels together; mixed mode balances them', () => {
    const students = ids(18).map((id, i) => ({ id, levelRank: Math.floor(i / 6) })); // 6 per level 0/1/2
    const level = solveGroups({ students, sizing: { groupCount: 3 }, mode: 'level', rules: [], seed: 'x' });
    for (const g of level.groups) expect(new Set(g.map((id) => Math.floor(Number(id.slice(1)) / 6))).size).toBe(1);
    const mixed = solveGroups({ students, sizing: { groupCount: 3 }, mode: 'mixed', rules: [], seed: 'x' });
    for (const g of mixed.groups) expect(new Set(g.map((id) => Math.floor(Number(id.slice(1)) / 6))).size).toBe(3);
  });

  it('spreads the unassessed bucket evenly over the groups in both modes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 6 }), modeArb, (n, uRaw, k, mode) => {
        const u = Math.min(uRaw, n);
        const students = ids(n).map((id, i) => ({ id, levelRank: i < u ? null : i % 3 }));
        const { groups } = solveGroups({ students, sizing: { groupCount: k }, mode, rules: [], seed: 'u' });
        const per = groups.map((g) => g.filter((id) => Number(id.slice(1)) < u).length);
        expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 60 },
    );
  });

  it("honours 'apart' rules whenever they are satisfiable (GRP-4)", () => {
    // Each student has at most one 'apart' partner and there are at least two groups: always satisfiable.
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 36 }), fc.integer({ min: 2, max: 6 }), fc.integer({ min: 0, max: 18 }), modeArb, fc.string(), (n, k, pairs, mode, seed) => {
        const list = ids(n);
        const rules: PairRule[] = [];
        for (let i = 0; i < n - 1 - i && rules.length < pairs; i++) rules.push({ id: `r${i}`, a: list[i]!, b: list[n - 1 - i]!, kind: 'apart' });
        const students = list.map((id, i) => ({ id, levelRank: i % 3 }));
        const res = solveGroups({ students, sizing: { groupCount: Math.min(k, n) }, mode, rules, seed });
        expect(res.unsatisfied.filter((u) => u.kind === 'apart')).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("keeps 'together' students in one group when possible", () => {
    const list = ids(12);
    const students = list.map((id, i) => ({ id, levelRank: i % 4 }));
    const rules: PairRule[] = [
      { id: 't1', a: 's00', b: 's11', kind: 'together' },
      { id: 't2', a: 's03', b: 's07', kind: 'together' },
    ];
    const res = solveGroups({ students, sizing: { groupCount: 3 }, mode: 'mixed', rules, seed: 'q' });
    expect(res.unsatisfied).toEqual([]);
    const where = new Map(res.groups.flatMap((g, i) => g.map((id) => [id, i] as const)));
    expect(where.get('s00')).toBe(where.get('s11'));
    expect(where.get('s03')).toBe(where.get('s07'));
  });

  it('reports impossible rules transparently with a reason (GRP-8)', () => {
    const students = ids(4).map((id) => ({ id, levelRank: null }));
    // One group: apart is impossible.
    const one = solveGroups({ students, sizing: { groupCount: 1 }, mode: 'mixed', rules: [{ id: 'r', a: 's00', b: 's01', kind: 'apart' }], seed: 's' });
    expect(one.unsatisfied).toEqual([{ ruleId: 'r', a: 's00', b: 's01', kind: 'apart', reason: 'ONE_GROUP' }]);
    // together contradicts apart (a~b, b~c, a!c).
    const conflict = solveGroups({
      students,
      sizing: { groupCount: 2 },
      mode: 'mixed',
      rules: [
        { id: 't1', a: 's00', b: 's01', kind: 'together' },
        { id: 't2', a: 's01', b: 's02', kind: 'together' },
        { id: 'x', a: 's00', b: 's02', kind: 'apart' },
      ],
      seed: 's',
    });
    expect(conflict.unsatisfied.length).toBeGreaterThan(0);
    expect(conflict.unsatisfied.every((u) => u.kind === 'together' && u.reason === 'CONFLICTS_WITH_APART')).toBe(true);
    // Three students who must be together, groups of two.
    const big = solveGroups({
      students,
      sizing: { groupCount: 2 },
      mode: 'mixed',
      rules: [
        { id: 't1', a: 's00', b: 's01', kind: 'together' },
        { id: 't2', a: 's01', b: 's02', kind: 'together' },
      ],
      seed: 's',
    });
    expect(big.unsatisfied).toHaveLength(1);
    expect(big.unsatisfied[0]!.reason).toBe('GROUP_TOO_SMALL');
    // Rules about students who are not present are ignored.
    expect(solveGroups({ students, sizing: { groupCount: 1 }, mode: 'mixed', rules: [{ id: 'r', a: 's00', b: 'gone', kind: 'apart' }], seed: 's' }).unsatisfied).toEqual([]);
  });

  it('handles tiny classes (0, 1, 2 students)', () => {
    expect(solveGroups({ students: [], sizing: { groupCount: 3 }, mode: 'level', rules: [], seed: 'x' })).toEqual({ groups: [], unsatisfied: [] });
    expect(solveGroups({ students: [{ id: 'a', levelRank: null }], sizing: { targetSize: 4 }, mode: 'mixed', rules: [], seed: 'x' }).groups).toEqual([['a']]);
    expect(solveGroups({ students: ids(2).map((id) => ({ id, levelRank: 1 })), sizing: { groupCount: 5 }, mode: 'level', rules: [], seed: 'x' }).groups).toHaveLength(2);
  });

  it('evaluates hand-made groups and marks broken rules as arranged by hand', () => {
    const r: PairRule[] = [{ id: 'r', a: 'a', b: 'b', kind: 'apart' }];
    expect(evaluateRules([['a', 'b'], ['c']], r, { byHand: true })).toEqual([{ ruleId: 'r', a: 'a', b: 'b', kind: 'apart', reason: 'ARRANGED_BY_HAND' }]);
    expect(evaluateRules([['a'], ['b', 'c']], r, { byHand: true })).toEqual([]);
  });
});

describe('levelRanks (GRP-3)', () => {
  it('orders free-text levels naturally and keeps missing levels unassessed', () => {
    const r = levelRanks(new Map([['a', '10'], ['b', '2'], ['c', null], ['d', 'B1'], ['e', ' 2 '], ['f', '']]));
    expect(r.get('b')).toBe(0);
    expect(r.get('e')).toBe(0);
    expect(r.get('a')).toBe(1);
    expect(r.get('d')).toBe(2);
    expect(r.get('c')).toBeNull();
    expect(r.get('f')).toBeNull();
  });
});

describe('fitToPresent (GRP-5)', () => {
  it('excludes absent students, keeps every present student once, sizes within one, and never changes the saved groups', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 6 }), fc.array(fc.boolean(), { minLength: 30, maxLength: 30 }), (n, k, absentFlags) => {
        const list = ids(n);
        const saved = solveGroups({ students: list.map((id) => ({ id, levelRank: null })), sizing: { groupCount: k }, mode: 'mixed', rules: [], seed: 'p' }).groups;
        const frozen = JSON.stringify(saved);
        const present = [...list.filter((_, i) => !absentFlags[i]), 'newcomer'];
        const { groups } = fitToPresent(saved, present, [], 'seed');
        expect(JSON.stringify(saved)).toBe(frozen);
        const used = groups.filter((g) => g.length > 0);
        expect(used.flat().sort()).toEqual([...present].sort());
        const sizes = used.map((g) => g.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 60 },
    );
  });
  it('keeps the groups as saved when everyone is present', () => {
    const saved = [['a', 'b'], ['c', 'd']];
    expect(fitToPresent(saved, ['d', 'c', 'b', 'a'], [], 'x')).toEqual({ groups: saved, moved: [] });
  });
});
