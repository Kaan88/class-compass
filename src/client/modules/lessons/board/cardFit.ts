/**
 * Student cards that fit the Students box (S22c, D-177; closes the S13 box "Compact density that
 * grows the cards into free height" and acts on the S16c box "a class of 40 at 1536×703").
 *
 * On the lesson board the Students box has a fixed height (its row takes what the other rows leave)
 * and scrolls inside. The grid picks one size from a ladder of card sizes, measured in the real box,
 * so the board shows every student at the largest size that fits (S27c, D-195: one automatic size; the
 * Compact / Normal / Large choice that used to say where the fit starts was removed by the owner):
 * - when every card fits at the middle size (`FIT_START`, the old Normal), the cards grow step by step
 *   while every card still fits, up to the largest size (a small class fills the free height instead
 *   of leaving it empty);
 * - when they do not, the cards shrink step by step to the largest size at which every card fits;
 * - when no size fits them all (a class of 40 on a short display), the size that shows the most whole
 *   cards, never below the readable minimum (`tight`: the name across the whole card on its own line,
 *   so it breaks only between words, then the avatar, the count, the marks and the + button at
 *   `var(--cc-touch)`); a tie goes to the larger size. The rest scroll inside the box under the
 *   "N more students below" cue (D-148, D-174).
 * At each size the name sits beside the + button while no word of a name has to break there, else
 * across the card above it (`data-fit-name="across"`, the S14i layout of compact cards), so a name
 * breaks only between words at every size.
 * The size is written as CSS variables on the grid (`--cc-card-*`, tokens of the board's card rules)
 * with `data-fit` naming the step, straight on the element before paint (no React render), like the
 * toaster's dock measurement (D-174). Where the box does not scroll (below 64rem the page scrolls) the
 * variables are removed and the board's own card sizes apply unchanged.
 */
import { useLayoutEffect, type RefObject } from 'react';

export interface FitStep {
  /** `tight`, or `s<t>` with t from 0 (smallest) to 3 (largest); the fit starts at 2. */
  key: string;
  /** The readable-minimum layout: the name on its own line across the card. */
  tight: boolean;
  vars: Readonly<Record<string, string>>;
}

/** Card sizes (rem) at t = 0, 1, 2 and 3 (the board's former Compact, Normal and Large sizes for 1–3). */
const ANCHORS = [
  { min: 9.5, h: 3.2, avatar: 1.85, name: 0.88, padY: 0.2, padX: 0.4, rowGap: 0.1, gap: 0.3, add: 0 },
  { min: 10, h: 3.8, avatar: 2, name: 0.92, padY: 0.35, padX: 0.5, rowGap: 0.15, gap: 0.45, add: 0 },
  { min: 11.25, h: 4.4, avatar: 2.3, name: 1, padY: 0.35, padX: 0.5, rowGap: 0.15, gap: 0.45, add: 0 },
  { min: 15, h: 5.5, avatar: 3, name: 1.2, padY: 0.35, padX: 0.5, rowGap: 0.15, gap: 0.45, add: 0.5 },
] as const;

const rem = (n: number) => `${Math.round(n * 1000) / 1000}rem`;

function varsAt(t: number): Record<string, string> {
  const i = Math.min(2, Math.floor(t));
  const f = t - i;
  const a = ANCHORS[i]!;
  const b = ANCHORS[i + 1]!;
  const mix = (k: keyof (typeof ANCHORS)[number]) => a[k] + (b[k] - a[k]) * f;
  return {
    '--cc-card-min': rem(mix('min')),
    '--cc-card-h': rem(mix('h')),
    '--cc-card-avatar': rem(mix('avatar')),
    '--cc-card-name': rem(mix('name')),
    '--cc-card-pad-y': rem(mix('padY')),
    '--cc-card-pad-x': rem(mix('padX')),
    '--cc-card-row-gap': rem(mix('rowGap')),
    '--cc-card-gap': rem(mix('gap')),
    // The + button is never smaller than a touch target; it grows a little towards the largest size.
    '--cc-card-add': `calc(var(--cc-touch) + ${rem(mix('add'))})`,
  };
}

/** The ladder, smallest first. */
export const FIT_STEPS: readonly FitStep[] = [
  { key: 'tight', tight: true, vars: varsAt(0) },
  ...[0, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3].map((t) => ({ key: `s${t}`, tight: false, vars: varsAt(t) })),
];

/** Where the fit starts: the middle size (the board's Normal size before S27c). */
export const FIT_START = FIT_STEPS.findIndex((s) => s.key === 's2');

export interface FitMeasure {
  /** Every card is whole inside the box. */
  all: boolean;
  /** Whole cards inside the box (the box scrolled to its top). */
  full: number;
}

/**
 * The step to use (pure, unit-tested): grow from the start while every card fits, else shrink to the
 * largest step where every card fits, else the step with the most whole cards (ties: the larger).
 * `measure` is called at most once per step.
 */
export function chooseFitStep(base: number, steps: number, measure: (step: number) => FitMeasure): number {
  const seen = new Map<number, FitMeasure>();
  const m = (i: number) => {
    let r = seen.get(i);
    if (!r) {
      r = measure(i);
      seen.set(i, r);
    }
    return r;
  };
  if (m(base).all) {
    let i = base;
    while (i + 1 < steps && m(i + 1).all) i += 1;
    return i;
  }
  for (let i = base - 1; i >= 0; i -= 1) if (m(i).all) return i;
  let best = base;
  for (let i = base - 1; i >= 0; i -= 1) if (m(i).full > m(best).full) best = i;
  return best;
}

/** How a step is laid out: the number of columns, and the name across the card (`across`). */
interface Variant {
  cols: number;
  across: boolean;
}

function apply(grid: HTMLElement, step: FitStep | null, v?: Variant) {
  for (const name of [...Object.keys(FIT_STEPS[0]!.vars), '--cc-card-cols']) grid.style.removeProperty(name);
  delete grid.dataset.fitName;
  if (!step || !v) {
    delete grid.dataset.fit;
    return;
  }
  for (const [name, value] of Object.entries(step.vars)) grid.style.setProperty(name, value);
  grid.style.setProperty('--cc-card-cols', String(v.cols));
  grid.dataset.fit = step.key;
  if (v.across) grid.dataset.fitName = 'across';
}

/**
 * Columns of a step: as many as its card width allows (what `auto-fill` gives), and at most as many as
 * the readable minimum's card width allows.
 */
function columnsOf(grid: HTMLElement, step: FitStep): { natural: number; most: number } {
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const px = (v: string | undefined) => parseFloat(v ?? '0') * remPx;
  const width = grid.clientWidth;
  const gap = px(step.vars['--cc-card-gap']);
  const natural = Math.max(1, Math.floor((width + gap) / (px(step.vars['--cc-card-min']) + gap)));
  return { natural, most: Math.max(natural, Math.floor((width + gap) / (px(FIT_STEPS[0]!.vars['--cc-card-min']) + gap))) };
}

/**
 * A word of a name broken over two lines: a layout that does this is not chosen while another one
 * keeps every name whole (S14i: a name breaks only between words). Only the readable minimum
 * (`tight`, the name across the whole card) may still break a word wider than the card.
 */
function splitsWords(grid: HTMLElement): boolean {
  const range = document.createRange();
  for (const card of grid.children) {
    const node = card.querySelector('.cc-student-card__name-text')?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    for (const m of (node.textContent ?? '').matchAll(/\S+/gu)) {
      const at = m.index ?? 0;
      range.setStart(node, at);
      range.setEnd(node, at + m[0].length);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) return true;
    }
  }
  return false;
}

function measureIn(scroller: HTMLElement, grid: HTMLElement): FitMeasure {
  const s = scroller.getBoundingClientRect();
  const g = grid.getBoundingClientRect();
  const offset = g.top - s.top - scroller.clientTop + scroller.scrollTop;
  const room = scroller.clientHeight - offset - (parseFloat(getComputedStyle(scroller).paddingBottom) || 0);
  let full = 0;
  const cards = grid.children;
  for (const card of cards) if (card.getBoundingClientRect().bottom - g.top <= room + 0.5) full += 1;
  return { all: full === cards.length, full };
}

/**
 * One step, measured. Its own number of columns first; when not every card fits, also with more
 * columns (each try one row less, never narrower than the readable minimum's cards), so a small class
 * grows taller instead of into a second row, and with fewer columns (wider cards keep long names on
 * one line, so a row is lower and more whole cards can show). Each layout first with the name beside
 * the + button and, when that breaks a word of a name, with the name across the card above it (the
 * S14i layout of compact cards). A layout that still breaks a word is never chosen (`full: -1`); the
 * readable minimum then takes its widest cards, where only a word wider than the card can break.
 */
function measureStep(scroller: HTMLElement, grid: HTMLElement, step: FitStep, count: number): FitMeasure & { v: Variant } {
  const tryLayout = (cols: number): (FitMeasure & { v: Variant }) | null => {
    for (const across of step.tight ? [false] : [false, true]) {
      apply(grid, step, { cols, across });
      if (!splitsWords(grid)) return { ...measureIn(scroller, grid), v: { cols, across } };
    }
    return null;
  };
  const { natural, most } = columnsOf(grid, step);
  const tries = [natural];
  for (let rows = Math.ceil(count / natural); rows > 1 && tries.length < 4; rows -= 1) {
    const cols = Math.ceil(count / (rows - 1));
    if (cols > most) break;
    tries.push(cols);
  }
  if (count > natural) for (let less = 1; less <= (step.tight ? 4 : 2); less += 1) if (natural - less >= 1) tries.push(natural - less);
  let best: (FitMeasure & { v: Variant }) | null = null;
  for (const cols of tries) {
    const r = tryLayout(cols);
    if (r?.all) return r;
    if (r && (!best || r.full > best.full)) best = r;
  }
  if (best) return best;
  if (!step.tight) return { all: false, full: -1, v: { cols: natural, across: false } };
  const cols = Math.min(...tries);
  apply(grid, step, { cols, across: false });
  return { ...measureIn(scroller, grid), v: { cols, across: false } };
}

/** Sent on the section after each fit: what counts the cards in view (the "more students" cue) counts again. */
export const CARD_FIT_EVENT = 'cc-card-fit';

/** Fits the cards of the grid inside `section`'s scrolling box (the board's Students box). */
export function fitCards(section: HTMLElement): void {
  const scroller = section.parentElement;
  const grid = section.querySelector<HTMLElement>('.cc-student-grid');
  if (!scroller || !grid) return;
  if (!/auto|scroll/u.test(getComputedStyle(scroller).overflowY) || grid.children.length === 0) {
    apply(grid, null);
    return;
  }
  const count = grid.children.length;
  const variants = new Map<number, Variant>();
  // The avatars and frames are drawn in SVG, which is slow to lay out again at every size tried: while
  // measuring they are hidden (their boxes keep their size) and transitions are off (a size read in
  // the middle of one is the old size), and they are drawn once at the chosen size.
  grid.dataset.fitMeasuring = '';
  const pick = chooseFitStep(FIT_START, FIT_STEPS.length, (i) => {
    const r = measureStep(scroller, grid, FIT_STEPS[i]!, count);
    variants.set(i, r.v);
    return r;
  });
  apply(grid, FIT_STEPS[pick]!, variants.get(pick));
  // The chosen size is laid out while transitions are still off, so nothing eases into it.
  void grid.offsetHeight;
  delete grid.dataset.fitMeasuring;
  section.dispatchEvent(new Event(CARD_FIT_EVENT));
}

/** Sizes of the cards' names: a change the fit did not make (a late font, an avatar) measures again. */
const nameSizes = (section: HTMLElement) =>
  [...section.querySelectorAll('.cc-student-card__name-text')]
    .map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`;
    })
    .join();

/**
 * Runs `fitCards` before paint whenever `deps` change (number of students, the grid opened, what the
 * cards carry, a header line of an add-on), when the box changes size (window, text size, the other
 * rows) and when a name changes size without the fit (content that arrives later). The fit's own changes never run it again (the box and the names are compared with what the last fit
 * left), so it cannot loop.
 */
export function useCardFit(sectionRef: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const scroller = section?.parentElement;
    if (!section || !scroller) return;
    let box = '';
    let names = '';
    const boxSize = () => `${scroller.clientWidth}x${scroller.clientHeight}`;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (boxSize() !== box || nameSizes(section) !== names ? run() : undefined)) : null;
    function run() {
      fitCards(section!);
      box = boxSize();
      names = nameSizes(section!);
      if (!ro) return;
      ro.disconnect();
      ro.observe(scroller!);
      for (const e of section!.querySelectorAll('.cc-student-card__name-text')) ro.observe(e);
    }
    run();
    return () => ro?.disconnect();
    // The caller lists what the cards depend on.
  }, [sectionRef, ...deps]);
}
