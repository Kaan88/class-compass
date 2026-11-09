/**
 * Classroom board layout (S14b, D-148). The lesson screen is tiled on a 12×12 snap grid: rows of
 * boxes (each row has a height in twelfths of the board, each box a width in twelfths of its row),
 * plus a dock of big buttons for the panels that are not shown as boxes. Tiling (instead of free x/y
 * placement) leaves no holes or overlaps and heals when a module is switched off: its box is dropped
 * and its neighbours take the space.
 *
 * - `BOX_CATALOGUE` lists every box the board knows. Module boxes use the module's dashboard slot key
 *   (`DashboardSlot.key`, test-enforced); core boxes start with `core.`.
 * - `layoutIssues()` validates a layout (shape, sums, minimum sizes, placements, 8 KB cap). The server
 *   refuses a layout with issues and never serves a stored one that has them.
 * - `effectiveLayout(stored | null, available)` is what the board shows: the stored layout (or the
 *   default) without the boxes that are not available in this class, plus newly available ones in
 *   their default place.
 *
 * Edit operations (move, resize, dock) are pure functions in `src/domain/classroomLayout.ts`.
 */
import { z } from 'zod';

export const LAYOUT_COLUMNS = 12;
export const LAYOUT_ROWS = 12;
export const MAX_LAYOUT_ROWS = 6;
export const MAX_BOXES_PER_ROW = 4;
/** A stored layout is at most this many bytes of JSON. */
export const MAX_LAYOUT_BYTES = 8192;

export const BOX_KEYS = ['core.timer', 'core.students', 'core.dock', 'routine', 'focus', 'counters', 'attendance', 'assistant', 'secret', 'groups', 'homework', 'achievements'] as const;
export type BoxKey = (typeof BOX_KEYS)[number];

export interface BoxSpec {
  key: BoxKey;
  /** Core boxes are always available; the others only while their dashboard slot is (module on). */
  core: boolean;
  /** May be a box in a row / may be a button in the dock. */
  row: boolean;
  dock: boolean;
  /** Where a newly available box goes. */
  defaultPlace: 'row' | 'dock';
  /** Must be in every layout. */
  required: boolean;
  /** The dock row: alone in the last row, full width, height 1; cannot be moved or resized. */
  fixed: boolean;
  /** Minimum width (columns) and height (rows of twelfths) as a box. */
  minW: number;
  minH: number;
}

const spec = (key: BoxKey, s: Partial<Omit<BoxSpec, 'key'>>): BoxSpec => ({ key, core: false, row: true, dock: true, defaultPlace: 'row', required: false, fixed: false, minW: 3, minH: 1, ...s });

export const BOX_CATALOGUE: Readonly<Record<BoxKey, BoxSpec>> = {
  'core.timer': spec('core.timer', { core: true, dock: false, minW: 3 }),
  'core.students': spec('core.students', { core: true, dock: false, required: true, minW: 6, minH: 3 }),
  'core.dock': spec('core.dock', { core: true, dock: false, required: true, fixed: true, minW: 12 }),
  routine: spec('routine', { minW: 5 }),
  focus: spec('focus', { minW: 3 }),
  counters: spec('counters', { minW: 4 }),
  attendance: spec('attendance', { row: false, defaultPlace: 'dock' }),
  assistant: spec('assistant', { defaultPlace: 'dock' }),
  secret: spec('secret', { defaultPlace: 'dock' }),
  groups: spec('groups', { defaultPlace: 'dock' }),
  homework: spec('homework', { defaultPlace: 'dock' }),
  achievements: spec('achievements', { defaultPlace: 'dock' }),
};

export const isBoxKey = (k: string): k is BoxKey => (BOX_KEYS as readonly string[]).includes(k);

export const LayoutBox = z.object({ key: z.enum(BOX_KEYS), w: z.number().int().min(1).max(LAYOUT_COLUMNS) }).strict();
export const LayoutRow = z.object({ h: z.number().int().min(1).max(LAYOUT_ROWS), boxes: z.array(LayoutBox).min(1).max(MAX_BOXES_PER_ROW) }).strict();
/** Shape only; `layoutIssues` checks the sums, sizes and placements. */
export const ClassroomLayout = z
  .object({ version: z.literal(1), rows: z.array(LayoutRow).min(1).max(MAX_LAYOUT_ROWS), dock: z.array(z.enum(BOX_KEYS)).max(BOX_KEYS.length) })
  .strict();
export type ClassroomLayout = z.infer<typeof ClassroomLayout>;
export type LayoutRow = ClassroomLayout['rows'][number];

/**
 * The default board (D-148): the routine with every stage beside a big timer, today's focus and the
 * class counter, the full-width student grid, then the dock (Attendance, Assistant, Secret Students,
 * Groups, Homework, Achievements … End lesson).
 */
export const DEFAULT_LAYOUT: ClassroomLayout = {
  version: 1,
  rows: [
    { h: 3, boxes: [{ key: 'routine', w: 8 }, { key: 'core.timer', w: 4 }] },
    { h: 1, boxes: [{ key: 'focus', w: 4 }, { key: 'counters', w: 8 }] },
    { h: 7, boxes: [{ key: 'core.students', w: 12 }] },
    { h: 1, boxes: [{ key: 'core.dock', w: 12 }] },
  ],
  dock: ['attendance', 'assistant', 'secret', 'groups', 'homework', 'achievements'],
};

export const cloneLayout = (l: ClassroomLayout): ClassroomLayout => ({ version: 1, rows: l.rows.map((r) => ({ h: r.h, boxes: r.boxes.map((b) => ({ ...b })) })), dock: [...l.dock] });

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const rowMinH = (r: LayoutRow) => Math.max(1, ...r.boxes.map((b) => BOX_CATALOGUE[b.key].minH));
const isDockRow = (r: LayoutRow) => r.boxes.some((b) => b.key === 'core.dock');

/** Every key placed in the layout (rows and dock). */
export const placedKeys = (l: ClassroomLayout): BoxKey[] => [...l.rows.flatMap((r) => r.boxes.map((b) => b.key)), ...l.dock];

/**
 * Problems with a layout (empty = valid). Codes, not prose: `SHAPE`, `TOO_LARGE`, `ROW_HEIGHTS`,
 * `ROW_WIDTHS:<row>`, `DUPLICATE:<key>`, `NOT_A_BOX:<key>`, `NOT_DOCKABLE:<key>`, `MIN_WIDTH:<key>`,
 * `MIN_HEIGHT:<key>`, `REQUIRED:<key>`, `DOCK_ROW`.
 */
export function layoutIssues(value: unknown): string[] {
  const parsed = ClassroomLayout.safeParse(value);
  if (!parsed.success) return ['SHAPE'];
  const l = parsed.data;
  const issues: string[] = [];
  if (JSON.stringify(l).length > MAX_LAYOUT_BYTES) issues.push('TOO_LARGE');
  if (sum(l.rows.map((r) => r.h)) !== LAYOUT_ROWS) issues.push('ROW_HEIGHTS');
  l.rows.forEach((r, i) => {
    if (sum(r.boxes.map((b) => b.w)) !== LAYOUT_COLUMNS) issues.push(`ROW_WIDTHS:${i}`);
    for (const b of r.boxes) {
      const s = BOX_CATALOGUE[b.key];
      if (!s.row) issues.push(`NOT_A_BOX:${b.key}`);
      if (b.w < s.minW) issues.push(`MIN_WIDTH:${b.key}`);
      if (r.h < s.minH) issues.push(`MIN_HEIGHT:${b.key}`);
    }
  });
  for (const k of l.dock) if (!BOX_CATALOGUE[k].dock) issues.push(`NOT_DOCKABLE:${k}`);
  const keys = placedKeys(l);
  for (const k of new Set(keys)) if (keys.filter((x) => x === k).length > 1) issues.push(`DUPLICATE:${k}`);
  for (const s of Object.values(BOX_CATALOGUE)) if (s.required && !keys.includes(s.key)) issues.push(`REQUIRED:${s.key}`);
  // The dock row is the last row, on its own, full width and one twelfth high.
  const last = l.rows[l.rows.length - 1];
  const dockRows = l.rows.filter(isDockRow);
  if (dockRows.length !== 1 || !last || !isDockRow(last) || last.boxes.length !== 1 || last.h !== 1) issues.push('DOCK_ROW');
  return issues;
}

export const isValidLayout = (value: unknown): value is ClassroomLayout => layoutIssues(value).length === 0;

// ---------------------------------------------------------------- healing helpers (shared with the edit operations)
/** Index of the student grid's row (the row that gives and takes height first). */
export const studentsRowIndex = (l: ClassroomLayout) => l.rows.findIndex((r) => r.boxes.some((b) => b.key === 'core.students'));
/** Index of the dock row (always the last row of a valid layout). */
export const dockRowIndex = (l: ClassroomLayout) => l.rows.findIndex(isDockRow);

/** Height a row could give away without going below what its boxes need. */
export const rowSlack = (r: LayoutRow) => (isDockRow(r) ? 0 : r.h - rowMinH(r));

/**
 * Take `amount` twelfths of height from other rows (the student grid first, then the tallest), never
 * below their minimum. Returns false (and changes nothing) when there is not enough slack.
 */
export function takeHeight(l: ClassroomLayout, amount: number, except: number = -1): boolean {
  const donors = l.rows.map((r, i) => ({ i, slack: i === except ? 0 : rowSlack(r) }));
  if (sum(donors.map((d) => d.slack)) < amount) return false;
  const si = studentsRowIndex(l);
  let left = amount;
  while (left > 0) {
    const preferred = donors.find((d) => d.i === si && d.slack > 0) ?? [...donors].sort((a, b) => b.slack - a.slack || a.i - b.i)[0]!;
    preferred.slack -= 1;
    l.rows[preferred.i]!.h -= 1;
    left -= 1;
  }
  return true;
}

/** Give `amount` twelfths of height to the student grid (or, without one, to the first other row). */
function giveHeight(l: ClassroomLayout, amount: number) {
  const si = studentsRowIndex(l);
  const target = si >= 0 ? si : l.rows.findIndex((r) => !isDockRow(r));
  if (target >= 0) l.rows[target]!.h += amount;
}

/**
 * Take `amount` columns from the other boxes of a row (most spare width first), never below their
 * minimum widths. Returns false (and changes nothing) when there is not enough spare width.
 */
function takeWidth(row: LayoutRow, amount: number, exceptIndex: number): boolean {
  const slack = row.boxes.map((b, i) => (i === exceptIndex ? 0 : b.w - BOX_CATALOGUE[b.key].minW));
  if (sum(slack) < amount) return false;
  for (let left = amount; left > 0; left -= 1) {
    let best = -1;
    for (let i = 0; i < slack.length; i += 1) if (slack[i]! > 0 && (best < 0 || slack[i]! > slack[best]!)) best = i;
    slack[best]! -= 1;
    row.boxes[best]!.w -= 1;
  }
  return true;
}

/**
 * Remove a box from the rows in place: its width goes to its left neighbour (or the right one), and
 * an emptied row gives its height to the student grid. Returns whether the box was in a row.
 */
export function removeFromRows(l: ClassroomLayout, key: BoxKey): boolean {
  const ri = l.rows.findIndex((r) => r.boxes.some((b) => b.key === key));
  if (ri < 0) return false;
  const row = l.rows[ri]!;
  const bi = row.boxes.findIndex((b) => b.key === key);
  const [gone] = row.boxes.splice(bi, 1);
  if (row.boxes.length) {
    const heir = row.boxes[Math.max(0, bi - 1)]!;
    heir.w += gone!.w;
    return true;
  }
  l.rows.splice(ri, 1);
  giveHeight(l, row.h);
  return true;
}

/**
 * Put a box into row `ri` at `index` with (about) width `w`, taking width from the row's other boxes.
 * Returns false (and changes nothing) when the row is full, too low or has no room.
 */
export function insertIntoRow(l: ClassroomLayout, ri: number, index: number, key: BoxKey, w: number): boolean {
  const row = l.rows[ri];
  const s = BOX_CATALOGUE[key];
  if (!row || isDockRow(row) || !s.row || row.boxes.length >= MAX_BOXES_PER_ROW || row.h < s.minH) return false;
  const room = LAYOUT_COLUMNS - sum(row.boxes.map((b) => BOX_CATALOGUE[b.key].minW));
  if (room < s.minW) return false;
  const width = Math.max(s.minW, Math.min(w, room));
  const at = Math.max(0, Math.min(index, row.boxes.length));
  row.boxes.splice(at, 0, { key, w: width });
  if (!takeWidth(row, width, at)) {
    row.boxes.splice(at, 1);
    return false;
  }
  return true;
}

/**
 * Put a box into a new full-width row at position `at` (before the dock row at the latest), taking its
 * height from the other rows. Returns false (and changes nothing) when there is no room.
 */
export function insertNewRow(l: ClassroomLayout, at: number, key: BoxKey, h: number = 1): boolean {
  const s = BOX_CATALOGUE[key];
  if (!s.row || l.rows.length >= MAX_LAYOUT_ROWS) return false;
  const di = dockRowIndex(l);
  const pos = Math.max(0, Math.min(at, di < 0 ? l.rows.length : di));
  for (let height = Math.max(h, s.minH); height >= s.minH; height -= 1) {
    const snapshot = l.rows.map((r) => r.h);
    if (takeHeight(l, height)) {
      l.rows.splice(pos, 0, { h: height, boxes: [{ key, w: LAYOUT_COLUMNS }] });
      return true;
    }
    snapshot.forEach((v, i) => (l.rows[i]!.h = v));
  }
  return false;
}

/** Where the default layout puts a row box: its row's other boxes (partners), index and size. */
function defaultPlacement(key: BoxKey) {
  const ri = DEFAULT_LAYOUT.rows.findIndex((r) => r.boxes.some((b) => b.key === key));
  if (ri < 0) return null;
  const row = DEFAULT_LAYOUT.rows[ri]!;
  const index = row.boxes.findIndex((b) => b.key === key);
  return { ri, index, w: row.boxes[index]!.w, h: row.h, partners: row.boxes.filter((b) => b.key !== key).map((b) => b.key) };
}

/**
 * Add a box to the rows: beside its partners from the default layout when they are there, else in a
 * new row above the student grid, else in any row with room. Returns false when it fits nowhere.
 */
export function addRowBox(l: ClassroomLayout, key: BoxKey, preferredH = 1): boolean {
  const d = defaultPlacement(key);
  if (d) {
    const ri = l.rows.findIndex((r) => r.boxes.some((b) => d.partners.includes(b.key)));
    if (ri >= 0) {
      const row = l.rows[ri]!;
      // Same side of its partners as in the default layout.
      const firstPartner = row.boxes.findIndex((b) => d.partners.includes(b.key));
      const index = d.index === 0 ? firstPartner : row.boxes.length;
      if (insertIntoRow(l, ri, index, key, d.w)) return true;
    }
  }
  const si = studentsRowIndex(l);
  if (insertNewRow(l, si >= 0 ? si : 0, key, d?.h ?? preferredH)) return true;
  for (let ri = 0; ri < l.rows.length; ri += 1) if (insertIntoRow(l, ri, l.rows[ri]!.boxes.length, key, BOX_CATALOGUE[key].minW)) return true;
  return false;
}

/** Keys that are available in a class: the core boxes plus the module boxes whose slot is on. */
export const availableBoxes = (moduleBoxes: Iterable<string>): Set<BoxKey> => {
  const out = new Set<BoxKey>(BOX_KEYS.filter((k) => BOX_CATALOGUE[k].core));
  for (const k of moduleBoxes) if (isBoxKey(k)) out.add(k);
  return out;
};

/**
 * What the board shows: the stored layout when it is valid (else the default), without the boxes that
 * are not available here (their width and height go to their neighbours) and with newly available
 * boxes added in their default place. The result is always valid.
 */
export function effectiveLayout(stored: unknown, available: ReadonlySet<BoxKey>): ClassroomLayout {
  const l = cloneLayout(isValidLayout(stored) ? stored : DEFAULT_LAYOUT);
  const isAvailable = (k: BoxKey) => BOX_CATALOGUE[k].core || available.has(k);
  for (const k of placedKeys(l)) if (!isAvailable(k) && !l.dock.includes(k)) removeFromRows(l, k);
  l.dock = l.dock.filter(isAvailable);
  const placed = new Set(placedKeys(l));
  for (const k of BOX_KEYS) {
    if (!isAvailable(k) || placed.has(k)) continue;
    const s = BOX_CATALOGUE[k];
    if (s.defaultPlace === 'row' && addRowBox(l, k)) continue;
    if (s.dock) l.dock.push(k);
  }
  return l;
}
