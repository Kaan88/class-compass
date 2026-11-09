/**
 * Edit operations on the classroom board layout (S14b, D-148). Pure functions: each takes a valid
 * layout and returns a valid layout (a new object), or the same object when the edit is not possible
 * (no room, below a minimum size, a box that cannot go there). The layout editor uses the same
 * operations for the pointer and the keyboard, so both always produce the same layouts.
 *
 * Coordinates are those of the layout passed in: `row` is a row index, `index` the position in that
 * row counted without the box being moved.
 */
import {
  BOX_CATALOGUE,
  MAX_BOXES_PER_ROW,
  addRowBox,
  cloneLayout,
  dockRowIndex,
  insertIntoRow,
  insertNewRow,
  isValidLayout,
  removeFromRows,
  rowSlack,
  type BoxKey,
  type ClassroomLayout,
} from '../shared/classroomLayout.ts';

/** Where a box is in the rows, or null (in the dock or absent). */
export function findBox(l: ClassroomLayout, key: BoxKey): { row: number; index: number } | null {
  for (let row = 0; row < l.rows.length; row += 1) {
    const index = l.rows[row]!.boxes.findIndex((b) => b.key === key);
    if (index >= 0) return { row, index };
  }
  return null;
}

const movable = (key: BoxKey) => BOX_CATALOGUE[key].row && !BOX_CATALOGUE[key].fixed;
const checked = (before: ClassroomLayout, after: ClassroomLayout) => (isValidLayout(after) ? after : before);

export type MoveTarget = { row: number; index: number } | { newRow: number };

/**
 * Move a box to another place in the rows: into row `row` at `index`, or into a new full-width row
 * inserted before row `newRow`. The box keeps its width where there is room.
 */
export function moveBox(l: ClassroomLayout, key: BoxKey, to: MoveTarget): ClassroomLayout {
  const from = findBox(l, key);
  if (!from || !movable(key)) return l;
  const width = l.rows[from.row]!.boxes[from.index]!.w;
  const height = l.rows[from.row]!.h;
  const alone = l.rows[from.row]!.boxes.length === 1;
  if ('row' in to) {
    if (!l.rows[to.row] || (to.row === from.row && to.index === from.index)) return l;
    if (to.row !== from.row && l.rows[to.row]!.boxes.length >= MAX_BOXES_PER_ROW) return l;
  } else if (alone && (to.newRow === from.row || to.newRow === from.row + 1)) return l;
  const next = cloneLayout(l);
  if ('row' in to && to.row === from.row) {
    // Within its row the box keeps its width: only the order changes.
    const boxes = next.rows[from.row]!.boxes;
    const [box] = boxes.splice(from.index, 1);
    boxes.splice(Math.max(0, Math.min(to.index, boxes.length)), 0, box!);
    return checked(l, next);
  }
  removeFromRows(next, key);
  // A row that disappeared shifts the rows after it up by one.
  const shift = (r: number) => (alone && r > from.row ? r - 1 : r);
  if ('row' in to) {
    if (!insertIntoRow(next, shift(to.row), to.index, key, width)) return l;
  } else if (!insertNewRow(next, shift(to.newRow), key, alone ? height : 1)) return l;
  return checked(l, next);
}

/**
 * Move the splitter after box `index` of row `row` by `delta` columns (positive: the box gets wider
 * and its right neighbour narrower). Clamped to the boxes' minimum widths.
 */
export function resizeW(l: ClassroomLayout, row: number, index: number, delta: number): ClassroomLayout {
  const r = l.rows[row];
  const a = r?.boxes[index];
  const b = r?.boxes[index + 1];
  if (!r || !a || !b || BOX_CATALOGUE[a.key].fixed) return l;
  const d = Math.max(BOX_CATALOGUE[a.key].minW - a.w, Math.min(delta, b.w - BOX_CATALOGUE[b.key].minW));
  if (d === 0) return l;
  const next = cloneLayout(l);
  next.rows[row]!.boxes[index]!.w += d;
  next.rows[row]!.boxes[index + 1]!.w -= d;
  return checked(l, next);
}

/**
 * Change the height of row `row` by `delta` twelfths. A taller row takes the height from the nearest
 * row below it that can spare some (else the nearest above); a lower row gives it to the row below
 * (the row above for the last row before the dock). The dock row has a fixed height. Clamped to the
 * rows' minimum heights.
 */
export function resizeH(l: ClassroomLayout, row: number, delta: number): ClassroomLayout {
  const di = dockRowIndex(l);
  if (row < 0 || row >= l.rows.length || row === di || delta === 0) return l;
  const others = l.rows.map((_, i) => i).filter((i) => i !== row && i !== di);
  const below = others.filter((i) => i > row);
  const above = others.filter((i) => i < row).reverse();
  let other: number | undefined;
  let d: number;
  if (delta > 0) {
    other = [...below, ...above].find((i) => rowSlack(l.rows[i]!) > 0);
    if (other === undefined) return l;
    d = Math.min(delta, rowSlack(l.rows[other]!));
  } else {
    other = below[0] ?? above[0];
    if (other === undefined) return l;
    d = -Math.min(-delta, rowSlack(l.rows[row]!));
  }
  if (d === 0) return l;
  const next = cloneLayout(l);
  next.rows[row]!.h += d;
  next.rows[other]!.h -= d;
  return checked(l, next);
}

/** Show a box as a button in the dock instead (its row neighbours take its space). */
export function toDock(l: ClassroomLayout, key: BoxKey): ClassroomLayout {
  if (!BOX_CATALOGUE[key].dock || !findBox(l, key) || l.dock.includes(key)) return l;
  const next = cloneLayout(l);
  removeFromRows(next, key);
  next.dock.push(key);
  return checked(l, next);
}

/** Show a dock button as a box: beside its default partners, else in a new row above the student grid. */
export function fromDock(l: ClassroomLayout, key: BoxKey): ClassroomLayout {
  if (!BOX_CATALOGUE[key].row || !l.dock.includes(key)) return l;
  const next = cloneLayout(l);
  next.dock = next.dock.filter((k) => k !== key);
  if (!addRowBox(next, key, 2)) return l;
  return checked(l, next);
}

/** Move a dock button one place left (-1) or right (+1). */
export function moveInDock(l: ClassroomLayout, key: BoxKey, delta: -1 | 1): ClassroomLayout {
  const i = l.dock.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= l.dock.length) return l;
  const next = cloneLayout(l);
  next.dock[i] = next.dock[j]!;
  next.dock[j] = key;
  return next;
}

export type KeyboardMove = 'left' | 'right' | 'up' | 'down';

/**
 * One keyboard step for a picked-up box (arrows): left/right within its row, up/down into the row
 * above/below at the same position, or into a new row at the top / above the dock at the edges.
 */
export function stepBox(l: ClassroomLayout, key: BoxKey, dir: KeyboardMove): ClassroomLayout {
  const at = findBox(l, key);
  if (!at) return l;
  const di = dockRowIndex(l);
  if (dir === 'left' || dir === 'right') {
    const index = at.index + (dir === 'left' ? -1 : 1);
    if (index < 0 || index >= l.rows[at.row]!.boxes.length) return l;
    return moveBox(l, key, { row: at.row, index });
  }
  const target = at.row + (dir === 'up' ? -1 : 1);
  if (target < 0) return moveBox(l, key, { newRow: 0 });
  if (target === di || target >= l.rows.length) return moveBox(l, key, { newRow: di < 0 ? l.rows.length : di });
  const moved = moveBox(l, key, { row: target, index: Math.min(at.index, l.rows[target]!.boxes.length) });
  if (moved !== l) return moved;
  // A full row: go past it into a new row of its own.
  return moveBox(l, key, { newRow: dir === 'up' ? target : target + 1 });
}

/** One keyboard resize step (Shift+arrows): wider/narrower by a column, taller/lower by a twelfth. */
export function stepSize(l: ClassroomLayout, key: BoxKey, dir: KeyboardMove): ClassroomLayout {
  const at = findBox(l, key);
  if (!at) return l;
  const row = l.rows[at.row]!;
  if (dir === 'up' || dir === 'down') return resizeH(l, at.row, dir === 'down' ? 1 : -1);
  const grow = dir === 'right' ? 1 : -1;
  // The splitter on the right of the box, or (for the last box) the one on its left, mirrored.
  if (at.index < row.boxes.length - 1) return resizeW(l, at.row, at.index, grow);
  return resizeW(l, at.row, at.index - 1, -grow);
}
