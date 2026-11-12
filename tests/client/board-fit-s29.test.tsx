// @vitest-environment jsdom
/**
 * Classroom board fit (S29, D-200): today's focus keeps to one line on the board (the topics that fit,
 * "+N" for the others, every topic still in the list for screen readers, Change as an icon with its
 * name), and the routine's stage chips choose names on one line, on two lines of whole words, or
 * compact chips (numbers, the current stage named) instead of cutting a name with an ellipsis.
 * jsdom has no layout, so the widths are given to the elements here. Fictional data only.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROUTINE_STAGES } from '../../src/domain/routines.ts';
import type { LessonState } from '../../src/shared/contracts/lessons.ts';
import { en, tr } from '../messages.ts';
import { FocusTopics, focusDashboardSlot, topicsThatFit } from '../../src/client/modules/lessons/TopicsClassroom.tsx';
import { fitStepper, routineDashboardSlot } from '../../src/client/modules/routines/RoutineClassroom.tsx';
import type { ClassroomContext } from '../../src/client/modules/types.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const w = this.classList.contains('cc-focus__topic') ? 120 : this.classList.contains('cc-focus__more') ? 40 : 0;
      return { width: w, height: 30, top: 0, left: 0, right: w, bottom: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cc-focus__list') ? 200 : 0;
    });
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
    wrap(<Focus context={context} lesson={lesson(0, topics)} presentation="box" />);
    expect([...screen.getByTestId('todays-focus').querySelectorAll('[data-overflow]')]).toHaveLength(0);
    expect(screen.getByTestId('focus-more').hasAttribute('data-unused')).toBe(true);
  });

  it('has Change as an icon button named for screen readers', () => {
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

  it('gives every chip its whole stage name as its accessible name, and the list a fit', () => {
    const Stepper = routineDashboardSlot.Component;
    wrap(<Stepper context={context} lesson={lesson(3, topics)} presentation="box" />);
    const list = screen.getByTestId('routine-stages');
    expect(list.dataset.fit).toBe('one');
    for (const s of DEFAULT_ROUTINE_STAGES) expect(screen.getByRole('button', { name: new RegExp(s.name.en ?? '') })).toBeTruthy();
    // No ellipsis class or clamp is involved: the chip's name is the plain text.
    expect([...list.querySelectorAll('.cc-stepper__name')].map((n) => n.textContent)).toEqual(DEFAULT_ROUTINE_STAGES.map((s) => s.name.en));
  });
});
