// @vitest-environment jsdom
/**
 * Lesson goals on the classroom screen (S25d, D-188): the board box shows today's goal for the class
 * and changes it through the outbox ('lessonGoals.set', LES-4); without a goal only a quiet "Set a goal"
 * action stays; with the module off nothing renders; the End Lesson review offers three answers in words
 * (never colour alone) and can be cleared; the start step sends a goal only when one was typed (LES-1).
 * S28a (D-197): the goal on the routine's Learning goal stage and on the Lesson saved summary.
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
const { endStepsWithGoal, lessonGoalDashboardSlot, lessonGoalEndStepUi, lessonGoalStartStep } = await import('../../src/client/modules/lessonGoals/LessonGoalsPanel.tsx');
const { routineDashboardSlot } = await import('../../src/client/modules/routines/RoutineClassroom.tsx');
const { LessonSummaryView } = await import('../../src/client/modules/lessons/EndLesson.tsx');
const { DEFAULT_ROUTINE_STAGES } = await import('../../src/domain/routines.ts');

const context = { id: 'context-fictional-1', modules: { lessonGoals: true } } as unknown as ClassroomContext;
const lesson = { id: 'lesson-fictional-1', contextId: context.id, endSteps: ['lessonGoal', 'reflection'] } as unknown as LessonState;

function seed(goal: LessonGoalState | null, l: LessonState = lesson) {
  queryClient.setQueryData(lessonKey(context.id), { etag: '"fictional"', data: { lesson: l, lessonGoal: goal } });
}
const cachedEndSteps = () => (queryClient.getQueryData(lessonKey(context.id)) as { data: { lesson: LessonState } }).data.lesson.endSteps;
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

describe('End Lesson steps follow a goal set or removed on the board (S25d review)', () => {
  it('adds "Our goal" before the reflection at once, so End lesson asks about it even offline', () => {
    const noGoal = { ...lesson, endSteps: ['assistant', 'reflection'] } as LessonState;
    seed({ text: null, outcome: null }, noGoal);
    wrap(<Box context={context} lesson={noGoal} presentation="box" />);
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.set'] }));
    fireEvent.change(screen.getByRole('textbox', { name: en['lessonGoals.field'] }), { target: { value: 'We can say three animal names.' } });
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.save'] }));
    expect(cachedEndSteps()).toEqual(['assistant', 'lessonGoal', 'reflection']);
    // Removed again: no question about a goal there is not.
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.change'] }));
    fireEvent.click(screen.getByRole('button', { name: en['lessonGoals.remove'] }));
    expect(cachedEndSteps()).toEqual(['assistant', 'reflection']);
  });

  it('endStepsWithGoal never doubles the step and works without a reflection', () => {
    expect(endStepsWithGoal(['lessonGoal', 'reflection'], true)).toEqual(['lessonGoal', 'reflection']);
    expect(endStepsWithGoal(['secret'], true)).toEqual(['secret', 'lessonGoal']);
    expect(endStepsWithGoal(['lessonGoal', 'reflection'], false)).toEqual(['reflection']);
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

describe('the goal on the routine\'s "Learning goal" stage (S28a, D-197; RTN-1)', () => {
  const Stepper = routineDashboardSlot.Component;
  const listening = { id: 'topic-fictional-1', name: { en: 'Listening', tr: 'Dinleme' }, icon: 'ear' as const };
  const learningGoal = DEFAULT_ROUTINE_STAGES.findIndex((st) => st.id === 'learning-goal');
  const onStage = (stageIndex: number, topics: LessonState['topics'] = [listening]) =>
    ({ ...lesson, routine: { templateId: null, name: { en: 'Default routine', tr: 'Varsayılan rutin' }, stages: DEFAULT_ROUTINE_STAGES.map((st) => ({ ...st })) }, stageIndex, topics }) as unknown as LessonState;
  const LONG = 'We can ask and answer questions about the weather, say what we wear on a rainy day and write two short sentences about it.';

  it('shows the goal sentence under the topics on the Learning goal stage, set smaller when it is long', () => {
    const l = onStage(learningGoal);
    seed({ text: 'We can name the seasons.', outcome: null }, l);
    wrap(<Stepper context={context} lesson={l} presentation="box" />);
    expect(screen.getByTestId('stage-focus').textContent).toContain('Listening');
    const goal = screen.getByTestId('stage-goal');
    expect(goal.textContent).toContain(en['lessonGoals.title']);
    expect(goal.textContent).toContain('We can name the seasons.');
    expect(goal.getAttribute('data-length')).toBeNull();
    cleanup();
    seed({ text: LONG, outcome: null }, l);
    wrap(<Stepper context={context} lesson={l} presentation="box" />);
    expect(screen.getByTestId('stage-goal').getAttribute('data-length')).toBe('long');
  });

  it('lays the head out for the goal: topics beside the stage name, Previous / Next beside the goal when there are several topics (review of D-197)', () => {
    const head = () => screen.getByTestId('current-stage').parentElement!;
    const reading = { id: 'topic-fictional-2', name: { en: 'Reading', tr: 'Okuma' }, icon: 'book' as const };
    const writing = { id: 'topic-fictional-3', name: { en: 'Writing', tr: 'Yazma' }, icon: 'pen' as const };
    const one = onStage(learningGoal);
    seed({ text: LONG, outcome: null }, one);
    wrap(<Stepper context={context} lesson={one} presentation="box" />);
    expect(head().getAttribute('data-goal')).toBe('one');
    // The goal is a line of the head of its own (not inside the "now" box), before Previous / Next.
    expect(screen.getByTestId('stage-goal').parentElement).toBe(head());
    expect(screen.getByTestId('current-stage').contains(screen.getByTestId('stage-goal'))).toBe(false);
    cleanup();
    const three = onStage(learningGoal, [listening, reading, writing]);
    seed({ text: LONG, outcome: null }, three);
    wrap(<Stepper context={context} lesson={three} presentation="box" />);
    expect(head().getAttribute('data-goal')).toBe('many');
    cleanup();
    seed({ text: null, outcome: null }, three);
    wrap(<Stepper context={context} lesson={three} presentation="box" />);
    expect(head().getAttribute('data-goal')).toBeNull();
  });

  it('shows the goal without topics too, and nothing on another stage, without a goal or with the module off', () => {
    const noTopics = onStage(learningGoal, []);
    seed({ text: 'We can count to twenty.', outcome: null }, noTopics);
    wrap(<Stepper context={context} lesson={noTopics} presentation="box" />);
    expect(screen.queryByTestId('stage-focus')).toBeNull();
    expect(screen.getByTestId('stage-goal').textContent).toContain('We can count to twenty.');
    cleanup();
    const other = onStage(0);
    seed({ text: 'We can count to twenty.', outcome: null }, other);
    wrap(<Stepper context={context} lesson={other} presentation="box" />);
    expect(screen.queryByTestId('stage-goal')).toBeNull();
    for (const goal of [{ text: null, outcome: null }, null]) {
      cleanup();
      const l = onStage(learningGoal);
      seed(goal, l);
      wrap(<Stepper context={context} lesson={l} presentation="box" />);
      expect(screen.queryByTestId('stage-goal')).toBeNull();
      expect(screen.getByTestId('stage-focus')).toBeTruthy();
    }
  });
});

describe('the goal on the "Lesson saved" summary (S28a, D-197; LES-3)', () => {
  const summary = (lessonGoal: LessonGoalState | null) => ({
    id: 'lesson-fictional-1',
    contextId: context.id,
    status: 'ended' as const,
    className: '3-A',
    subjectName: { en: 'English', tr: 'İngilizce' },
    localDate: '2026-11-09',
    startedAt: Date.UTC(2026, 10, 9, 7, 0),
    endedAt: Date.UTC(2026, 10, 9, 7, 38),
    routineName: { en: 'Default routine', tr: 'Varsayılan rutin' },
    stageCount: 6,
    stageReached: 6,
    attendance: null,
    reflection: null,
    lessonGoal,
  });
  const show = (lessonGoal: LessonGoalState | null) =>
    wrap(<LessonSummaryView lessonId={`lesson-${Math.random()}`} timezone="Europe/Istanbul" initial={summary(lessonGoal)} onDone={() => {}} />);

  it('shows the goal with the class answer in words (with an icon), or "Not answered"', () => {
    for (const outcome of ['reached', 'partly', 'notYet'] as const) {
      show({ text: 'We can name ten animals.', outcome });
      const row = screen.getByTestId('summary-goal');
      expect(screen.getByText(en['summary.goal'])).toBeTruthy();
      expect(row.textContent).toContain('We can name ten animals.');
      expect(row.textContent).toContain(en[`lessonGoals.outcome.${outcome}`]);
      expect(row.querySelector('svg')).toBeTruthy();
      cleanup();
    }
    show({ text: 'We can name ten animals.', outcome: null });
    expect(screen.getByTestId('summary-goal').textContent).toContain(en['summary.goalNotAnswered']);
  });

  it('shows no goal row without a goal or with the module off', () => {
    show(null);
    expect(screen.getByTestId('lesson-summary')).toBeTruthy();
    expect(screen.queryByTestId('summary-goal')).toBeNull();
    expect(screen.queryByText(en['summary.goal'])).toBeNull();
  });
});
