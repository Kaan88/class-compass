/** Fair rotation (SEC-2, AST-2, D-062, D-063): property tests on the pure domain logic. */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { planAssistants, weekDates, nextAssistant } from '../../src/domain/assistant.ts';
import { addDays } from '../../src/domain/dates.ts';
import { pickFair, rankFair, seededRank } from '../../src/domain/rotation.ts';

const keys = (seed: string) => ({
  count: (c: { count: number }) => c.count,
  last: (c: { last: number | null }) => c.last,
  tie: (a: { id: string }, b: { id: string }) => seededRank(seed, a.id) - seededRank(seed, b.id),
});

describe('pickFair (SEC-2)', () => {
  it('always takes the students with the fewest turns, never the same one twice', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ id: fc.uuid(), count: fc.nat(5), last: fc.option(fc.nat(1000), { nil: null }) }), { selector: (c) => c.id, maxLength: 30 }),
        fc.nat(8),
        fc.string(),
        (cands, n, seed) => {
          const picked = pickFair(cands, n, keys(seed));
          expect(picked.length).toBe(Math.min(n, cands.length));
          expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
          const maxPicked = Math.max(-1, ...picked.map((p) => p.count));
          const notPicked = cands.filter((c) => !picked.includes(c));
          for (const c of notPicked) expect(c.count).toBeGreaterThanOrEqual(maxPicked);
        },
      ),
    );
  });

  it('prefers the student whose last turn was longest ago, then the seeded order; same seed = same order', () => {
    const cands = [
      { id: 'a', count: 1, last: 50 },
      { id: 'b', count: 1, last: 10 },
      { id: 'c', count: 1, last: null },
      { id: 'd', count: 0, last: 99 },
    ];
    expect(rankFair(cands, keys('s')).map((c) => c.id)).toEqual(['d', 'c', 'b', 'a']);
    const ties = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, count: 0, last: null }));
    expect(pickFair(ties, 3, keys('round-1'))).toEqual(pickFair(ties, 3, keys('round-1')));
    const orders = new Set(['r1', 'r2', 'r3', 'r4', 'r5'].map((seed) => pickFair(ties, 3, keys(seed)).map((t) => t.id).join()));
    expect(orders.size).toBeGreaterThan(1); // different rounds break ties differently
  });

  it('over repeated draws with absences, students present every time differ by at most one (SEC-2, SEC-7)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.integer({ min: 1, max: 4 }), fc.array(fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }), { minLength: 1, maxLength: 60 }), (size, n, days) => {
        const counts = new Map<string, { count: number; last: number | null }>();
        const ids = Array.from({ length: size }, (_, i) => `k${i}`);
        days.forEach((presence, day) => {
          const present = ids.filter((_, i) => i === 0 || presence[i]);
          const picked = pickFair(
            present.map((id) => ({ id, ...(counts.get(id) ?? { count: 0, last: null }) })),
            n,
            keys(`d${day}`),
          );
          for (const p of picked) counts.set(p.id, { count: p.count + 1, last: day });
        });
        const always = ids.filter((_, i) => i === 0 || days.every((d) => d[i])).map((id) => counts.get(id)?.count ?? 0);
        expect(Math.max(...always) - Math.min(...always)).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('assistant planning (AST-2, UX-5)', () => {
  it('plans in Turkish alphabetical order when nobody has had a turn (deterministic)', () => {
    const roster = ['İrem Su', 'Çağla Ak', 'Işıl Er', 'Can Uslu', 'Ilgaz Ok'].map((fullName, i) => ({ id: `id${i}`, fullName }));
    const dates = weekDates('2026-11-09', [1, 2, 3, 4, 5], '2026-09-01', '2027-06-30');
    const plan = planAssistants(dates, () => roster, new Map());
    expect(dates.map((d) => roster.find((r) => r.id === plan.get(d))!.fullName)).toEqual(['Can Uslu', 'Çağla Ak', 'Ilgaz Ok', 'Işıl Er', 'İrem Su']);
    expect(planAssistants(dates, () => [...roster].reverse(), new Map())).toEqual(plan);
  });

  it('turn counts never differ by more than one over a school year (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), fc.integer({ min: 1, max: 40 }), (size, weeks) => {
        const roster = Array.from({ length: size }, (_, i) => ({ id: `s${i}`, fullName: `Öğrenci ${String(i).padStart(2, '0')}` }));
        const turns = new Map<string, { count: number; last: string | null }>();
        for (let w = 0; w < weeks; w++) {
          const dates = weekDates(addDays('2026-09-07', 7 * w), [1, 2, 3, 4, 5], '2026-09-01', '2027-06-30');
          const plan = planAssistants(dates, () => roster, turns);
          for (const d of dates) {
            const id = plan.get(d)!;
            const cur = turns.get(id) ?? { count: 0, last: null };
            turns.set(id, { count: cur.count + 1, last: d });
          }
        }
        const counts = roster.map((r) => turns.get(r.id)?.count ?? 0);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('weekDates keeps only school days inside the school year; nextAssistant handles an empty class', () => {
    expect(weekDates('2026-08-31', [1, 2, 3, 4, 5], '2026-09-01', '2027-06-30')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(nextAssistant([], new Map())).toBeNull();
  });
});
