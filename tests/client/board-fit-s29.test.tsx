// @vitest-environment jsdom
/**
 * Classroom board fit (S29, D-200): today's focus keeps to one line on the board (the topics that fit,
 * "+N" for the others, every topic still in the list for screen readers, Change as an icon with its
 * name), and the routine's stage chips choose names on one line, on two lines of whole words, or
 * compact chips (numbers, the current stage named) instead of cutting a name with an ellipsis.
 * jsdom has no layout, so the widths are given to the elements here. Fictional data only.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROUTINE_STAGES } from '../../src/domain/routines.ts';
import type { LessonState } from '../../src/shared/contracts/lessons.ts';
import { en, tr } from '../messages.ts';
import { FocusTopics, focusDashboardSlot, topicsThatFit } from '../../src/client/modules/lessons/TopicsClassroom.tsx';
import { fitStageName, fitStepper, routineDashboardSlot } from '../../src/client/modules/routines/RoutineClassroom.tsx';
import type { ClassroomContext } from '../../src/client/modules/types.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as { fonts?: unknown }).fonts;
  document.documentElement.style.removeProperty('--cc-text-scale');
});

/** A ResizeObserver that the test triggers by hand (jsdom has none). */
function fakeResizeObserver() {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  return () => act(() => callbacks.forEach((cb) => cb()));
}

/** `document.fonts` whose `ready` the test resolves (jsdom has none). */
function fakeFonts() {
  let resolve = () => {};
  const ready = new Promise<void>((r) => {
    resolve = r;
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  return async () => {
    resolve();
    await act(async () => {
      await ready;
    });
  };
}

/** Topic widths and the list width for the focus fit, changeable during a test. */
function focusLayout(sizes: { topic: number; more: number; list: number }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.classList.contains('cc-focus__topic') ? sizes.topic : this.classList.contains('cc-focus__more') ? sizes.more : 0;
    return { width: w, height: 30, top: 0, left: 0, right: w, bottom: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('cc-focus__list') ? sizes.list : 0;
  });
  return sizes;
}
const overflowCount = () => screen.getByTestId('todays-focus').querySelectorAll('[data-overflow]').length;

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
const context = { id: 'context-fictional-1' } as unknown as ClassroomContext;
const topics = [
  { id: 'topic-fictional-1', name: { en: 'Reading', tr: 'Okuma' }, icon: 'book' as const },
  { id: 'topic-fictional-2', name: { en: 'Writing', tr: 'Yazma' }, icon: 'pen' as const },
  { id: 'topic-fictional-3', name: { en: 'Grammar', tr: 'Dil bilgisi' }, icon: 'grammar' as const },
] as unknown as LessonState['topics'];

function lesson(stageIndex: number, list: LessonState['topics']): LessonState {
  return {
    id: 'lesson-fictional-1',
    contextId: context.id,
    routine: { templateId: null, name: { en: 'Default routine', tr: 'Varsayılan rutin' }, stages: DEFAULT_ROUTINE_STAGES.map((s) => ({ ...s })) },
    stageIndex,
    topics: list,
  } as unknown as LessonState;
}

describe('topicsThatFit (S29, D-200)', () => {
  it('shows every topic when the line holds them all', () => {
    expect(topicsThatFit([100, 100, 100], 10, 40, 320)).toBe(3);
  });
  it('keeps room for "+N" when it does not', () => {
    // 100 + 10 + 100 + 10 + 40 = 260
    expect(topicsThatFit([100, 100, 100], 10, 40, 260)).toBe(2);
    expect(topicsThatFit([100, 100, 100], 10, 40, 259)).toBe(1);
  });
  it('always shows the first topic, even in a very narrow box', () => {
    expect(topicsThatFit([100, 100, 100], 10, 40, 50)).toBe(1);
    expect(topicsThatFit([], 10, 40, 50)).toBe(0);
  });
});

describe("Today's focus on the board (S29, D-200)", () => {
  const Focus = focusDashboardSlot.Component;

  it('is one line: the topics that fit, "+N" for the others, every topic still listed for screen readers', () => {
    // Each topic 120 px, the list 200 px: one topic and "+2".
    focusLayout({ topic: 120, more: 40, list: 200 });
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    const box = screen.getByTestId('todays-focus');
    const items = [...box.querySelectorAll('.cc-focus__topic')];
    expect(items.map((li) => li.textContent)).toEqual(['Reading', 'Writing', 'Grammar']);
    expect(items.map((li) => li.hasAttribute('data-overflow'))).toEqual([false, true, true]);
    const more = screen.getByTestId('focus-more');
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('aria-hidden')).toBe('true');
    expect(more.hasAttribute('data-unused')).toBe(false);
  });

  it('shows no "+N" when every topic fits', () => {
    // 3 × 90 px (no gap in jsdom) = 270 px in a 300 px list.
    focusLayout({ topic: 90, more: 40, list: 300 });
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    expect(overflowCount()).toBe(0);
    expect(screen.getByTestId('focus-more').hasAttribute('data-unused')).toBe(true);
  });

  it('fits again when the list gets narrower, but not when only its height changes (S29 review)', () => {
    const resize = fakeResizeObserver();
    const sizes = focusLayout({ topic: 90, more: 40, list: 300 });
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    expect(overflowCount()).toBe(0);
    sizes.topic = 120; // wider topics at the same list width: a height-only resize does not fit again
    resize();
    expect(overflowCount()).toBe(0);
    sizes.list = 200;
    resize();
    expect(overflowCount()).toBe(2);
  });

  it('fits again once the fonts have loaded (S29 review)', async () => {
    const fontsLoaded = fakeFonts();
    const sizes = focusLayout({ topic: 90, more: 40, list: 300 });
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    expect(overflowCount()).toBe(0);
    sizes.topic = 120;
    await fontsLoaded();
    expect(overflowCount()).toBe(1);
  });

  it("fits again when the teacher's text size changes at the same width (S29 review)", async () => {
    const sizes = focusLayout({ topic: 90, more: 40, list: 300 });
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    expect(overflowCount()).toBe(0);
    sizes.topic = 120;
    await act(async () => {
      document.documentElement.style.setProperty('--cc-text-scale', '1.5');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(overflowCount()).toBe(1);
  });

  it('turns transitions off while it measures, so reduced motion cannot hand over a size mid-transition (S29 review)', () => {
    // The guard is CSS: the list carries data-measuring only while it measures, and app.css turns
    // every transition off under it (as for the dock and the card fit).
    const css = readFileSync('src/client/styles/app.css', 'utf8');
    expect(css).toMatch(/\.cc-focus__list\[data-measuring\],\s*\.cc-focus__list\[data-measuring\] \* \{\s*transition: none !important;/u);
    expect(css).toMatch(/\.cc-stepper\[data-fitting\],\s*\.cc-stepper\[data-fitting\] \* \{\s*transition: none !important;/u);
    let measuring: boolean | null = null;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('cc-focus__topic')) measuring = this.parentElement!.hasAttribute('data-measuring');
      return { width: 50, height: 30, top: 0, left: 0, right: 50, bottom: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    expect(measuring).toBe(true);
    expect(screen.getByTestId('todays-focus').querySelector('[data-measuring]')).toBeNull();
  });

  it("has Change as an icon button named for screen readers, apart from the goal box's Change (S29 review)", () => {
    expect(en['lesson.topic.change']).not.toBe(en['lessonGoals.change']);
    expect(tr['lesson.topic.change']).not.toBe(tr['lessonGoals.change']);
    expect(en['lesson.topic.change']).toMatch(/^Change /u);
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    const change = screen.getByRole('button', { name: en['lesson.topic.change'] });
    expect(change.textContent).toBe('');
    expect(change.querySelector('svg')).toBeTruthy();
  });

  it('wraps freely in the full-screen dock view (no "+N" there)', () => {
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="dock" />);
    expect(screen.queryByTestId('focus-more')).toBeNull();
    expect(screen.getByTestId('todays-focus').querySelector('[data-one-line]')).toBeNull();
  });

  it('has the "+N" words in English and Turkish', () => {
    expect(en['lesson.topic.more']).toBe('+{count}');
    expect(tr['lesson.topic.more']).toBe('+{count}');
  });

  it('the stage repeats every topic in full (no "+N" on the Learning goal stage)', () => {
    wrap(<FocusTopics topics={topics} />);
    expect(screen.queryByTestId('focus-more')).toBeNull();
  });
});

describe('Stage chips (S29, D-200)', () => {
  /** A list whose overflow depends on its fit, as the browser would lay it out. */
  function fakeList(overflowsAt: ReadonlySet<string>) {
    const list = document.createElement('ol');
    Object.defineProperty(list, 'clientWidth', { get: () => 800 });
    Object.defineProperty(list, 'scrollWidth', { get: () => (overflowsAt.has(list.dataset.fit ?? '') ? 900 : 800) });
    return list;
  }

  it('keeps the names on one line when they fit', () => {
    const list = fakeList(new Set());
    expect(fitStepper(list)).toBe('one');
    expect(list.dataset.fit).toBe('one');
  });
  it('puts names on two lines of whole words before anything is shortened', () => {
    const list = fakeList(new Set(['one']));
    expect(fitStepper(list)).toBe('two');
  });
  it('falls back to compact chips when even two lines do not fit (many stages)', () => {
    const list = fakeList(new Set(['one', 'two']));
    expect(fitStepper(list)).toBe('compact');
  });
  /** A list inside a routine box whose height and scrolling depend on the fit. */
  function listInBox(overflowsAt: ReadonlySet<string>, boxHeight: (fit: string) => number, bodyScrolls: (fit: string) => boolean) {
    const box = document.createElement('div');
    box.className = 'cc-lesson-box';
    const body = document.createElement('div');
    body.className = 'cc-lesson-box__body';
    const list = fakeList(overflowsAt);
    body.append(list);
    box.append(body);
    vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() => ({ height: boxHeight(list.dataset.fit ?? '') }) as DOMRect);
    Object.defineProperty(body, 'clientHeight', { get: () => 200 });
    Object.defineProperty(body, 'scrollHeight', { get: () => (bodyScrolls(list.dataset.fit ?? '') ? 260 : 200) });
    return list;
  }

  it('wraps the named chips onto another line when the box has that room already (larger text, S29 review)', () => {
    expect(fitStepper(listInBox(new Set(['one', 'two']), () => 200, () => false))).toBe('wrap');
  });
  it('stays compact when wrapping would make the routine box higher or scroll (S29 review)', () => {
    expect(fitStepper(listInBox(new Set(['one', 'two']), (fit) => (fit === 'wrap' ? 240 : 200), () => false))).toBe('compact');
    expect(fitStepper(listInBox(new Set(['one', 'two']), () => 200, (fit) => fit === 'wrap'))).toBe('compact');
    // A box that already scrolls when compact (a teacher's small layout) is not made worse.
    expect(fitStepper(listInBox(new Set(['one', 'two']), () => 200, () => true))).toBe('compact');
  });
  it('turns transitions off only while it measures (S29 review)', () => {
    const list = document.createElement('ol');
    const seen: boolean[] = [];
    Object.defineProperty(list, 'clientWidth', { get: () => 800 });
    Object.defineProperty(list, 'scrollWidth', {
      get: () => {
        seen.push(list.hasAttribute('data-fitting'));
        return list.dataset.fit === 'one' ? 900 : 800;
      },
    });
    expect(fitStepper(list)).toBe('two');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(list.hasAttribute('data-fitting')).toBe(false);
  });

  it('rejects a fit where a name is cut or takes more than two lines', () => {
    const list = document.createElement('ol');
    const name = document.createElement('span');
    name.className = 'cc-stepper__name';
    list.append(name);
    document.body.append(list);
    vi.spyOn(name, 'getBoundingClientRect').mockImplementation(() => ({ width: 80, height: list.dataset.fit === 'one' ? 20 : 60, top: 0, left: 0, right: 80, bottom: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    Object.defineProperty(name, 'scrollWidth', { get: () => (list.dataset.fit === 'one' ? 120 : 80) });
    Object.defineProperty(name, 'clientWidth', { get: () => 80 });
    name.style.lineHeight = '20px';
    // One line cuts the name; two lines would need three lines of 20 px: compact.
    expect(fitStepper(list)).toBe('compact');
    list.remove();
  });

  /** The stage list overflows sideways at the fits in `overflowsAt` (changeable during a test). */
  function stepperLayout(state: { overflowsAt: Set<string>; width: number }) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'routine-stages' ? state.width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'routine-stages' && state.overflowsAt.has(this.dataset.fit ?? '') ? state.width + 100 : state.width;
    });
    return state;
  }
  const Stepper = routineDashboardSlot.Component;

  it('gives every chip its whole stage name as its accessible name, and the list a fit', () => {
    stepperLayout({ overflowsAt: new Set(['one']), width: 800 });
    wrap(<Stepper context={context} lesson={lesson(3, topics)} presentation="box" />);
    const list = screen.getByTestId('routine-stages');
    expect(list.dataset.fit).toBe('two');
    for (const s of DEFAULT_ROUTINE_STAGES) expect(screen.getByRole('button', { name: new RegExp(s.name.en ?? '') })).toBeTruthy();
    // No ellipsis class or clamp is involved: the chip's name is the plain text.
    expect([...list.querySelectorAll('.cc-stepper__name')].map((n) => n.textContent)).toEqual(DEFAULT_ROUTINE_STAGES.map((s) => s.name.en));
  });

  it('fits again when the stage changes, when the width changes and once the fonts have loaded (S29 review)', async () => {
    const resize = fakeResizeObserver();
    const fontsLoaded = fakeFonts();
    const state = stepperLayout({ overflowsAt: new Set(), width: 800 });
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <Stepper context={context} lesson={lesson(0, topics)} presentation="box" />
      </QueryClientProvider>,
    );
    const list = screen.getByTestId('routine-stages');
    expect(list.dataset.fit).toBe('one');
    state.overflowsAt = new Set(['one']);
    view.rerender(
      <QueryClientProvider client={client}>
        <Stepper context={context} lesson={lesson(1, topics)} presentation="box" />
      </QueryClientProvider>,
    );
    expect(list.dataset.fit).toBe('two');
    state.overflowsAt = new Set(['one', 'two']);
    resize(); // same width: a height change from the fit itself is no reason to fit again
    expect(list.dataset.fit).toBe('two');
    state.width = 700;
    resize();
    expect(list.dataset.fit).toBe('compact');
    state.overflowsAt = new Set(['one']);
    await fontsLoaded();
    expect(list.dataset.fit).toBe('two');
  });

  it('a done chip keeps its number for the compact fit, with the tick and "Done" (S29 review)', () => {
    wrap(<Stepper context={context} lesson={lesson(3, topics)} presentation="box" />);
    const chips = [...screen.getByTestId('routine-stages').querySelectorAll('li')];
    chips.slice(0, 3).forEach((li, i) => {
      expect(li.dataset.state).toBe('done');
      expect(li.querySelector('.cc-stepper__done-num')?.textContent).toBe(String(i + 1));
      expect(li.querySelector('.cc-stepper__tick svg')).toBeTruthy();
      expect(li.querySelector('.cc-visually-hidden')?.textContent).toBe(en['routine.stageDone']);
    });
    // Shown only in the compact fit (app.css), so the other fits look as before.
    const css = readFileSync('src/client/styles/app.css', 'utf8');
    expect(css).toMatch(/\.cc-stepper__done-num \{\s*display: none;/u);
    expect(css).toMatch(/\[data-fit='compact'\] > li\[data-state='done'\] \.cc-stepper__done-num \{\s*display: inline;/u);
  });
});

describe('The big stage name above the chips (S29 review)', () => {
  function stageName(heights: Record<string, number>) {
    const name = document.createElement('span');
    name.style.lineHeight = '40px';
    document.body.append(name);
    vi.spyOn(name, 'getBoundingClientRect').mockImplementation(() => ({ height: heights[name.dataset.fit ?? ''] ?? 40 }) as DOMRect);
    return name;
  }
  it('keeps the big size when the name is on one line', () => {
    const name = stageName({ '': 40 });
    fitStageName(name);
    expect(name.dataset.fit).toBeUndefined();
    name.remove();
  });
  it('sets a long name smaller on the same line height instead of taking a second line', () => {
    const name = stageName({ '': 80, small: 40 });
    fitStageName(name);
    expect(name.dataset.fit).toBe('small');
    const name2 = stageName({ '': 80, small: 80, smaller: 40 });
    fitStageName(name2);
    expect(name2.dataset.fit).toBe('smaller');
    name.remove();
    name2.remove();
  });
  it('keeps the big size when even the smallest size needs two lines', () => {
    const name = stageName({ '': 80, small: 80, smaller: 80 });
    fitStageName(name);
    expect(name.dataset.fit).toBeUndefined();
    expect(name.hasAttribute('data-fitting')).toBe(false);
    name.remove();
  });
});
