/**
 * Classroom board layout (S14b, D-148): the 12×12 tiling model, its validation, healing when modules
 * are switched off or on, and the edit operations the layout editor uses for pointer and keyboard.
 * Property tests: every operation keeps the layout valid and never loses or duplicates a box.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findBox, fromDock, moveBox, moveInDock, resizeH, resizeW, stepBox, stepSize, toDock, type KeyboardMove } from '../../src/domain/classroomLayout.ts';
import {
  BOX_CATALOGUE,
  BOX_KEYS,
  DEFAULT_LAYOUT,
  MAX_LAYOUT_BYTES,
  availableBoxes,
  cloneLayout,
  effectiveLayout,
  layoutIssues,
  placedKeys,
  type BoxKey,
  type ClassroomLayout,
} from '../../src/shared/classroomLayout.ts';

const MODULE_BOXES = BOX_KEYS.filter((k) => !BOX_CATALOGUE[k].core);
/** The module boxes of the default board: an opt-in module's box (Lesson goals, D-188) is not one of them. */
const DEFAULT_MODULE_BOXES = MODULE_BOXES.filter((k) => placedKeys(DEFAULT_LAYOUT).includes(k));
const sorted = (xs: readonly string[]) => [...xs].sort();

type Op =
  | { kind: 'move'; key: BoxKey; row: number; index: number }
  | { kind: 'newRow'; key: BoxKey; at: number }
  | { kind: 'resizeW'; row: number; index: number; delta: number }
  | { kind: 'resizeH'; row: number; delta: number }
  | { kind: 'toDock'; key: BoxKey }
  | { kind: 'fromDock'; key: BoxKey }
  | { kind: 'dockOrder'; key: BoxKey; delta: -1 | 1 }
  | { kind: 'step'; key: BoxKey; dir: KeyboardMove }
  | { kind: 'size'; key: BoxKey; dir: KeyboardMove };

const keyArb = fc.constantFrom(...BOX_KEYS);
const dirArb = fc.constantFrom<KeyboardMove>('left', 'right', 'up', 'down');
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('move' as const), key: keyArb, row: fc.nat(6), index: fc.nat(4) }),
  fc.record({ kind: fc.constant('newRow' as const), key: keyArb, at: fc.nat(6) }),
  fc.record({ kind: fc.constant('resizeW' as const), row: fc.nat(6), index: fc.nat(4), delta: fc.integer({ min: -12, max: 12 }) }),
  fc.record({ kind: fc.constant('resizeH' as const), row: fc.nat(6), delta: fc.integer({ min: -12, max: 12 }) }),
  fc.record({ kind: fc.constant('toDock' as const), key: keyArb }),
  fc.record({ kind: fc.constant('fromDock' as const), key: keyArb }),
  fc.record({ kind: fc.constant('dockOrder' as const), key: keyArb, delta: fc.constantFrom<-1 | 1>(-1, 1) }),
  fc.record({ kind: fc.constant('step' as const), key: keyArb, dir: dirArb }),
  fc.record({ kind: fc.constant('size' as const), key: keyArb, dir: dirArb }),
);

function apply(l: ClassroomLayout, op: Op): ClassroomLayout {
  switch (op.kind) {
    case 'move':
      return moveBox(l, op.key, { row: op.row, index: op.index });
    case 'newRow':
      return moveBox(l, op.key, { newRow: op.at });
    case 'resizeW':
      return resizeW(l, op.row, op.index, op.delta);
    case 'resizeH':
      return resizeH(l, op.row, op.delta);
    case 'toDock':
      return toDock(l, op.key);
    case 'fromDock':
      return fromDock(l, op.key);
    case 'dockOrder':
      return moveInDock(l, op.key, op.delta);
    case 'step':
      return stepBox(l, op.key, op.dir);
    case 'size':
      return stepSize(l, op.key, op.dir);
  }
}

const availableArb = fc.subarray([...MODULE_BOXES]).map((xs) => availableBoxes(xs));

describe('layout model (D-148)', () => {
  it('the default layout is valid: routine w8 + timer w4, focus w4 + counters w8, students w12, dock', () => {
    expect(layoutIssues(DEFAULT_LAYOUT)).toEqual([]);
    expect(DEFAULT_LAYOUT.rows.map((r) => [r.h, r.boxes.map((b) => `${b.key}:${b.w}`)])).toEqual([
      [3, ['routine:8', 'core.timer:4']],
      [1, ['focus:4', 'counters:8']],
      [7, ['core.students:12']],
      [1, ['core.dock:12']],
    ]);
    expect(DEFAULT_LAYOUT.dock).toEqual(['attendance', 'assistant', 'secret', 'groups', 'homework', 'achievements']);
  });

  it('layoutIssues refuses bad sums, sizes, placements, duplicates and missing required boxes', () => {
    const bad = (fn: (l: ClassroomLayout) => void) => {
      const l = cloneLayout(DEFAULT_LAYOUT);
      fn(l);
      return layoutIssues(l);
    };
    expect(layoutIssues(null)).toEqual(['SHAPE']);
    expect(layoutIssues({ ...DEFAULT_LAYOUT, version: 2 })).toEqual(['SHAPE']);
    expect(layoutIssues({ ...DEFAULT_LAYOUT, extra: 1 })).toEqual(['SHAPE']);
    expect(bad((l) => (l.rows[0]!.h = 4))).toContain('ROW_HEIGHTS');
    expect(bad((l) => (l.rows[0]!.boxes[0]!.w = 7))).toContain('ROW_WIDTHS:0');
    expect(bad((l) => ((l.rows[0]!.boxes[0]!.w = 4), (l.rows[0]!.boxes[1]!.w = 8)))).toContain('MIN_WIDTH:routine');
    expect(bad((l) => l.dock.push('core.timer'))).toEqual(expect.arrayContaining(['NOT_DOCKABLE:core.timer', 'DUPLICATE:core.timer']));
    expect(bad((l) => (l.rows[1]!.boxes = [{ key: 'attendance', w: 12 }]))).toContain('NOT_A_BOX:attendance');
    expect(bad((l) => (l.rows[2]!.boxes = [{ key: 'groups', w: 12 }]))).toContain('REQUIRED:core.students');
    expect(bad((l) => l.rows.reverse())).toContain('DOCK_ROW');
    expect(bad((l) => ((l.rows[2]!.h = 2), (l.rows[0]!.h = 8)))).toContain('MIN_HEIGHT:core.students');
    expect(JSON.stringify(DEFAULT_LAYOUT).length).toBeLessThan(MAX_LAYOUT_BYTES);
  });

  it('effectiveLayout heals: unavailable boxes drop out (neighbours take the space), new ones come back in their default place', () => {
    const none = effectiveLayout(null, availableBoxes([]));
    expect(layoutIssues(none)).toEqual([]);
    expect(none.rows.map((r) => [r.h, r.boxes.map((b) => `${b.key}:${b.w}`)])).toEqual([
      [3, ['core.timer:12']],
      [8, ['core.students:12']],
      [1, ['core.dock:12']],
    ]);
    expect(none.dock).toEqual([]);
    const all = effectiveLayout(null, availableBoxes(DEFAULT_MODULE_BOXES));
    expect(all).toEqual(DEFAULT_LAYOUT);
    // S25d (D-188): today's goal, switched on in a class, gets its own one-line row above the student grid.
    const withGoal = effectiveLayout(null, availableBoxes(MODULE_BOXES));
    expect(layoutIssues(withGoal)).toEqual([]);
    expect(withGoal.rows.map((r) => [r.h, r.boxes.map((b) => `${b.key}:${b.w}`)])).toEqual([
      [3, ['routine:8', 'core.timer:4']],
      [1, ['focus:4', 'counters:8']],
      [1, ['lessonGoal:12']],
      [6, ['core.students:12']],
      [1, ['core.dock:12']],
    ]);
    // Counters off: today's focus takes the whole second row.
    const noCounters = effectiveLayout(DEFAULT_LAYOUT, availableBoxes(DEFAULT_MODULE_BOXES.filter((k) => k !== 'counters')));
    expect(noCounters.rows[1]!.boxes).toEqual([{ key: 'focus', w: 12 }]);
    // A stored layout that is not valid is not used: the default is.
    expect(effectiveLayout({ version: 1, rows: [], dock: [] }, availableBoxes(DEFAULT_MODULE_BOXES))).toEqual(DEFAULT_LAYOUT);
  });

  it('effectiveLayout always returns a valid layout with exactly the available boxes, and is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), availableArb, (ops, available) => {
        const stored = ops.reduce(apply, cloneLayout(DEFAULT_LAYOUT));
        const eff = effectiveLayout(stored, available);
        expect(layoutIssues(eff)).toEqual([]);
        const expected = BOX_KEYS.filter((k) => BOX_CATALOGUE[k].core || available.has(k));
        const placed = placedKeys(eff);
        // Every available box is placed once, except one that fits nowhere as a box and has no dock button.
        for (const k of placed) expect(expected).toContain(k);
        expect(new Set(placed).size).toBe(placed.length);
        for (const k of expected) if (BOX_CATALOGUE[k].dock || BOX_CATALOGUE[k].required) expect(placed, k).toContain(k);
        expect(effectiveLayout(eff, available)).toEqual(eff);
      }),
      { numRuns: 300 },
    );
  });
});

describe('edit operations (pointer and keyboard)', () => {
  it('every sequence of operations keeps the layout valid and never loses or duplicates a box (property)', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let l = cloneLayout(DEFAULT_LAYOUT);
        const keys = sorted(placedKeys(l));
        for (const op of ops) {
          const next = apply(l, op);
          expect(layoutIssues(next), JSON.stringify(op)).toEqual([]);
          expect(sorted(placedKeys(next))).toEqual(keys);
          l = next;
        }
      }),
      { numRuns: 400 },
    );
  });

  it('an operation that cannot be done returns the same layout object', () => {
    // Clamped to the minimum widths: the timer (minimum 3) can give one column, no more.
    expect(resizeW(DEFAULT_LAYOUT, 0, 0, 5).rows[0]!.boxes.map((b) => b.w)).toEqual([9, 3]);
    expect(resizeW(resizeW(DEFAULT_LAYOUT, 0, 0, 1), 0, 0, 1).rows[0]!.boxes.map((b) => b.w)).toEqual([9, 3]);
    const narrow = resizeW(DEFAULT_LAYOUT, 0, 0, -4); // routine minimum 5
    expect(narrow.rows[0]!.boxes.map((b) => b.w)).toEqual([5, 7]);
    expect(resizeW(narrow, 0, 0, -1)).toBe(narrow);
    expect(resizeH(DEFAULT_LAYOUT, 3, 1)).toBe(DEFAULT_LAYOUT); // the dock row is fixed
    expect(toDock(DEFAULT_LAYOUT, 'core.timer')).toBe(DEFAULT_LAYOUT);
    expect(fromDock(DEFAULT_LAYOUT, 'attendance')).toBe(DEFAULT_LAYOUT);
    expect(moveBox(DEFAULT_LAYOUT, 'core.dock', { newRow: 0 })).toBe(DEFAULT_LAYOUT);
  });

  it('keyboard: arrows move within and between rows, Shift+arrows resize', () => {
    const swapped = stepBox(DEFAULT_LAYOUT, 'core.timer', 'left');
    expect(swapped.rows[0]!.boxes.map((b) => `${b.key}:${b.w}`)).toEqual(['core.timer:4', 'routine:8']);
    const down = stepBox(DEFAULT_LAYOUT, 'core.timer', 'down');
    expect(findBox(down, 'core.timer')?.row).toBe(1);
    expect(down.rows[0]!.boxes).toEqual([{ key: 'routine', w: 12 }]);
    const up = stepBox(DEFAULT_LAYOUT, 'routine', 'up');
    expect(up.rows[0]!.boxes.map((b) => b.key)).toEqual(['routine']);
    const wider = stepSize(DEFAULT_LAYOUT, 'core.timer', 'right');
    expect(wider.rows[0]!.boxes.map((b) => b.w)).toEqual([7, 5]);
    // Taller: the height comes from the nearest row below that can spare it (the student grid here).
    expect(stepSize(DEFAULT_LAYOUT, 'routine', 'down').rows.map((r) => r.h)).toEqual([4, 1, 6, 1]);
    expect(stepSize(DEFAULT_LAYOUT, 'routine', 'up').rows.map((r) => r.h)).toEqual([2, 2, 7, 1]);
    expect(stepSize(DEFAULT_LAYOUT, 'counters', 'up')).toBe(DEFAULT_LAYOUT); // already one twelfth
  });

  it('dock: a panel goes to the dock and comes back as a box; the dock order can change', () => {
    const docked = toDock(DEFAULT_LAYOUT, 'counters');
    expect(docked.rows[1]!.boxes).toEqual([{ key: 'focus', w: 12 }]);
    expect(docked.dock.at(-1)).toBe('counters');
    const back = fromDock(docked, 'counters');
    expect(back.rows[1]!.boxes.map((b) => b.key)).toEqual(['focus', 'counters']);
    const groups = fromDock(DEFAULT_LAYOUT, 'groups');
    expect(layoutIssues(groups)).toEqual([]);
    expect(findBox(groups, 'groups')).not.toBeNull();
    expect(groups.dock).not.toContain('groups');
    expect(moveInDock(DEFAULT_LAYOUT, 'assistant', -1).dock.slice(0, 2)).toEqual(['assistant', 'attendance']);
  });
});
