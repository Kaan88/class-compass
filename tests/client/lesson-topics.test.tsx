// @vitest-environment jsdom
/**
 * Lesson topics on the classroom screen (S13a 7, D-101, review fixes): "Today's focus" hides when no
 * topic is set (only a small "Choose a topic" action stays), and the routine's "Learning goal" stage
 * shows the topics with their icons. Fictional data only.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROUTINE_STAGES } from '../../src/domain/routines.ts';
import type { LessonState } from '../../src/shared/contracts/lessons.ts';
import { en } from '../messages.ts';
import { focusDashboardSlot } from '../../src/client/modules/lessons/TopicsClassroom.tsx';
import { routineDashboardSlot } from '../../src/client/modules/routines/RoutineClassroom.tsx';
import type { ClassroomContext } from '../../src/client/modules/types.ts';

afterEach(cleanup);

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
const context = { id: 'context-fictional-1' } as unknown as ClassroomContext;
const listening = { id: 'topic-fictional-1', name: { en: 'Listening', tr: 'Dinleme' }, icon: 'ear' as const };

function lesson(stageIndex: number, topics: LessonState['topics']): LessonState {
  return {
    id: 'lesson-fictional-1',
    contextId: context.id,
    routine: { templateId: null, name: { en: 'Default routine', tr: 'Varsayılan rutin' }, stages: DEFAULT_ROUTINE_STAGES.map((s) => ({ ...s })) },
    stageIndex,
    topics,
  } as unknown as LessonState;
}
const learningGoal = DEFAULT_ROUTINE_STAGES.findIndex((s) => s.id === 'learning-goal');

describe("Today's focus (S13a 7)", () => {
  const Focus = focusDashboardSlot.Component;

  it('shows the topic with its name when one is set', () => {
    wrap(<Focus context={context} lesson={lesson(0, [listening])} presentation="box" />);
    expect(screen.getByTestId('todays-focus').textContent).toContain('Listening');
    expect(screen.getByText(en['lesson.topic.todaysFocus'])).toBeTruthy();
  });

  it('hides the focus strip when no topic is set and keeps only a small "Choose a topic" action', () => {
    wrap(<Focus context={context} lesson={lesson(0, [])} presentation="box" />);
    expect(screen.queryByTestId('todays-focus')).toBeNull();
    expect(screen.queryByText(en['lesson.topic.todaysFocus'])).toBeNull();
    expect(screen.getByTestId('todays-focus-empty').textContent).toBe(en['lesson.topic.choose']);
  });
});

describe('Learning goal routine stage (S13a 7)', () => {
  const Stepper = routineDashboardSlot.Component;

  it('shows the lesson topics on the Learning goal stage', () => {
    wrap(<Stepper context={context} lesson={lesson(learningGoal, [listening])} presentation="box" />);
    expect(screen.getByTestId('stage-focus').textContent).toContain('Listening');
  });

  it('shows nothing extra on other stages or when no topic is set', () => {
    wrap(<Stepper context={context} lesson={lesson(0, [listening])} presentation="box" />);
    expect(screen.queryByTestId('stage-focus')).toBeNull();
    cleanup();
    wrap(<Stepper context={context} lesson={lesson(learningGoal, [])} presentation="box" />);
    expect(screen.queryByTestId('stage-focus')).toBeNull();
  });
});
