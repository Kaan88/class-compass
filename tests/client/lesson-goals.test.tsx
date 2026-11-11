// @vitest-environment jsdom
/**
 * Lesson goals on the classroom screen (S25d, D-188): the board box shows today's goal for the class
 * and changes it through the outbox ('lessonGoals.set', LES-4); without a goal only a quiet "Set a goal"
 * action stays; with the module off nothing renders; the End Lesson review offers three answers in words
 * (never colour alone) and can be cleared; the start step sends a goal only when one was typed (LES-1).
 * Fictional data only.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonState } from '../../src/shared/contracts/lessons.ts';
import type { LessonGoalState } from '../../src/shared/contracts/lessonGoals.ts';
import { en } from '../messages.ts';
import type { ClassroomContext } from '../../src/client/modules/types.ts';

const enqueue = vi.fn<(type: string, payload: unknown, meta: unknown) => string>(() => 'op-fictional-1');
vi.mock('../../src/client/lib/outbox-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/lib/outbox-client.ts')>();
  return { ...actual, getOutbox: () => ({ enqueue, getStatus: () => ({ pending: 1, rejected: [] }), subscribe: () => () => {}, onSuccess: () => () => {} }) };
});

const { queryClient } = await import('../../src/client/lib/queryClient.ts');
const { lessonKey } = await import('../../src/client/modules/lessons/lessonClient.ts');
const { lessonGoalDashboardSlot, lessonGoalEndStepUi, lessonGoalStartStep } = await import('../../src/client/modules/lessonGoals/LessonGoalsPanel.tsx');

const context = { id: 'context-fictional-1', modules: { lessonGoals: true } } as unknown as ClassroomContext;
const lesson = { id: 'lesson-fictional-1', contextId: context.id, endSteps: ['lessonGoal', 'reflection'] } as unknown as LessonState;

function seed(goal: LessonGoalState | null) {
  queryClient.setQueryData(lessonKey(context.id), { etag: '"fictional"', data: { lesson, lessonGoal: goal } });
}
const wrap = (node: ReactNode) => render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
const Box = lessonGoalDashboardSlot.Component;

beforeEach(() => {
  enqueue.mockClear();
  // Keep the seeded state: no network in these tests.
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, refetchInterval: false, refetchOnMount: false } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("Today's goal on the board (S25d, D-188)", () => {
  it('shows the goal under its heading and changes it through the outbox', () => {
    seed({ text: 'We can ask and answer about the weather.', outcome: null });
    wrap(<Box context={context} lesson={lesson} presentation="box" />);
    const box = screen.getByTestId('lesson-goal');
    expect(box.textContent).toContain(en['lessonGoals.title']);
    expect(box.textContent).toContain('We can ask and answer about the weather.');

    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.change'] }));
    const field = screen.getByRole('textbox', { name: en['lessonGoals.field'] }) as HTMLInputElement;
    expect(field.value).toBe('We can ask and answer about the weather.');
    fireEvent.change(field, { target: { value: '  We can name the seasons. ' } });
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.save'] }));
    expect(enqueue).toHaveBeenCalledWith('lessonGoals.set', { contextId: context.id, lessonId: lesson.id, text: 'We can name the seasons.' }, { contextId: context.id, lessonId: lesson.id });
    // Shown at once (optimistic), before the server answers.
    expect(screen.getByTestId('lesson-goal').textContent).toContain('We can name the seasons.');
  });

  it('removes the goal from the dialog (an empty text)', () => {
    seed({ text: 'We can count to twenty.', outcome: null });
    wrap(<Box context={context} lesson={lesson} presentation="box" />);
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.change'] }));
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.remove'] }));
    expect(enqueue).toHaveBeenCalledWith('lessonGoals.set', { contextId: context.id, lessonId: lesson.id, text: '' }, expect.anything());
    expect(screen.queryByTestId('lesson-goal')).toBeNull();
    expect(screen.getByTestId('lesson-goal-empty').textContent).toContain(en['lessonGoals.set']);
  });

  it('without a goal keeps only a quiet "Set a goal" action; with the module off it renders nothing', () => {
    seed({ text: null, outcome: null });
    wrap(<Box context={context} lesson={lesson} presentation="box" />);
    expect(screen.queryByTestId('lesson-goal')).toBeNull();
    expect(screen.getByTestId('lesson-goal-empty').textContent).toBe(en['lessonGoals.set']);
    cleanup();
    seed(null);
    const off = wrap(<Box context={context} lesson={lesson} presentation="box" />);
    expect(off.container.innerHTML).toBe('');
  });
});

describe('End Lesson review (LES-3)', () => {
  const Review = lessonGoalEndStepUi.Component as (p: { lesson: LessonState; value: unknown; onChange: (v: unknown) => void }) => ReactNode;

  it('shows the goal and three answers in words; a second tap clears the answer', () => {
    seed({ text: 'We can spell five colours.', outcome: null });
    const onChange = vi.fn();
    const { rerender } = wrap(<Review lesson={lesson} value={{ outcome: null }} onChange={onChange} />);
    expect(screen.getByTestId('lesson-goal-review').textContent).toContain('We can spell five colours.');
    const group = screen.getByRole('radiogroup', { name: en['lessonGoals.question'] });
    const options = Array.from(group.querySelectorAll('[role="radio"]')).map((b) => b.textContent);
    expect(options).toEqual([en['lessonGoals.outcome.reached'], en['lessonGoals.outcome.partly'], en['lessonGoals.outcome.notYet']]);
    fireEvent.click(screen.getByRole('radio', { name: en['lessonGoals.outcome.partly'] }));
    expect(onChange).toHaveBeenLastCalledWith({ outcome: 'partly' });
    rerender(
      <QueryClientProvider client={queryClient}>
        <Review lesson={lesson} value={{ outcome: 'partly' }} onChange={onChange} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('radio', { name: en['lessonGoals.outcome.partly'] }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: en['lessonGoals.outcome.partly'] }));
    expect(onChange).toHaveBeenLastCalledWith({ outcome: null });
  });
});

describe('Start Lesson step (LES-1)', () => {
  const contribute = lessonGoalStartStep.useContribution!;

  it('sends a trimmed goal only when one was typed and the module is on', () => {
    expect(contribute(context, '  We can read a short story. ', true)).toEqual({ input: { steps: { lessonGoal: { text: 'We can read a short story.' } } }, ready: true });
    expect(contribute(context, '   ', true)).toEqual({ input: {}, ready: true });
    expect(contribute(context, 'We can read a short story.', false)).toEqual({ input: {}, ready: true });
    expect(lessonGoalStartStep.initial()).toBe('');
  });
});
