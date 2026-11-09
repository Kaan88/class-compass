// @vitest-environment jsdom
/**
 * The classroom board (S14b, D-148; DSH-1, DSH-3, LES-4): the teacher's layout (or the default) healed
 * for the modules that are on, the dock with its buttons, badges and full-screen views, and the
 * layout editor's keyboard operations (pick up, move, put down, resize, Escape, Undo) with their
 * announcements. Fictional data only.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { LessonBoard } from '../../src/client/modules/lessons/board/Board.tsx';
import { isLayoutEditing, layoutKey, setLayoutEditing } from '../../src/client/modules/lessons/board/layoutClient.ts';
import { lessonKey, rosterKey } from '../../src/client/modules/lessons/lessonClient.ts';
import type { ClassroomContext } from '../../src/client/modules/types.ts';
import { toDock } from '../../src/domain/classroomLayout.ts';
import { cloneLayout, DEFAULT_LAYOUT, type ClassroomLayout } from '../../src/shared/classroomLayout.ts';
import type { LessonState } from '../../src/shared/contracts/lessons.ts';

afterEach(() => {
  setLayoutEditing(null);
  cleanup();
});

const ctx = (modules: ClassroomContext['modules']): ClassroomContext => ({ id: 'ctx-board-1', classId: 'cls-1', className: '3-A', subjectName: { en: 'English' }, timezone: 'Europe/Istanbul', modules });
const lesson = {
  id: 'lesson-board-1',
  contextId: 'ctx-board-1',
  status: 'active',
  routine: { templateId: null, name: { en: 'Default routine' }, stages: [] },
  stageIndex: 0,
  timer: { durationMs: 300_000, startedAt: null, remainingMs: 300_000, running: false },
  topics: [],
  display: { assistantVisible: null },
  endSteps: ['reflection'],
} as unknown as LessonState;

function renderBoard(context: ClassroomContext, stored: ClassroomLayout | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } });
  qc.setQueryData(layoutKey(context.id), { layout: stored, source: stored ? 'class' : 'default' });
  qc.setQueryData(rosterKey(context.id, lesson.id), {
    localDate: '2026-11-09',
    attendanceEnabled: false,
    students: [
      { id: 'stu-1', fullName: 'Ada Example', initials: 'AE', avatarHue: 10, daily: null, exception: null, effective: 'not_recorded' },
      { id: 'stu-2', fullName: 'Can Example', initials: 'CE', avatarHue: 20, daily: null, exception: null, effective: 'not_recorded' },
    ],
  });
  qc.setQueryData(lessonKey(context.id), {
    etag: null,
    data: {
      lesson,
      today: { localDate: '2026-11-09', weekday: 1, timezone: 'Europe/Istanbul' },
      serverNow: Date.UTC(2026, 10, 9, 8),
      attendanceStamp: 'off',
      counters: null,
      secret: null,
      grouping: null,
      assistant: {
        localDate: '2026-11-09',
        schoolDay: true,
        assistant: { id: 'stu-1', fullName: 'Ada Example', initials: 'AE', avatarHue: 10 },
        responsibilities: [
          { id: 'r1', label: { en: 'Board' } },
          { id: 'r2', label: { en: 'Books' } },
        ],
        thanked: false,
        checked: ['r2'],
        showPanel: true,
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LessonBoard context={context} lesson={lesson} onEnd={() => undefined} />
    </QueryClientProvider>,
  );
}

const rows = () =>
  [...document.querySelectorAll<HTMLElement>('.cc-lesson-row:not([data-dock-row])')].map((r) => [...r.querySelectorAll<HTMLElement>(':scope > .cc-lesson-box')].map((b) => `${b.dataset.box}:${b.dataset.w}`).join(' '));

describe('classroom board (D-148)', () => {
  it('with every module off: the timer, today\'s focus, the student grid and the dock with End lesson', () => {
    renderBoard(ctx({}), null);
    expect(rows()).toEqual(['core.timer:12', 'focus:12', 'core.students:12']);
    const dock = screen.getByTestId('lesson-dock');
    expect(within(dock).getByRole('button', { name: 'End lesson' })).toBeTruthy();
    expect(within(dock).queryAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('uses the teacher\'s layout, healed for the modules that are on; dock buttons carry badges and open full-screen views', () => {
    const stored = cloneLayout(toDock(DEFAULT_LAYOUT, 'counters'));
    stored.rows[0]!.boxes.reverse();
    renderBoard(ctx({ assistant: true }), stored);
    // Routines and counters are off: the timer takes the routine's width, focus the counter's.
    expect(rows()).toEqual(['core.timer:12', 'focus:12', 'core.students:12']);
    const button = screen.getByTestId('dock-assistant');
    expect(button.textContent).toContain('Daily Assistant');
    expect(button.querySelector('.cc-dock__badge')?.textContent).toBe('1 / 2');
    expect(screen.queryByTestId('dock-groups')).toBeNull();
    fireEvent.click(button);
    const view = screen.getByTestId('dock-view-assistant');
    expect(within(view).getByTestId('assistant-panel')).toBeTruthy();
    expect(within(view).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('the layout editor: Enter picks a box up, arrows move it, Enter puts it down, Shift+arrows resize, Escape cancels, Undo goes back', async () => {
    setLayoutEditing('ctx-board-1');
    renderBoard(ctx({ routines: true, counters: true }), null);
    expect(screen.getByTestId('layout-editor')).toBeTruthy();
    const announce = screen.getByTestId('layout-announce');
    const handle = () => document.querySelector<HTMLElement>('[data-handle="core.timer"]')!;
    // The board under the frames is inert while editing.
    expect(document.querySelector('.cc-lesson-box__body')?.hasAttribute('inert')).toBe(true);
    expect(rows()).toEqual(['routine:8 core.timer:4', 'focus:4 counters:8', 'core.students:12']);
    fireEvent.keyDown(handle(), { key: 'Enter' });
    expect(announce.textContent).toContain('Timer picked up');
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(announce.textContent).toBe('Timer: row 1, place 1, 4/12 wide, 3/12 high.');
    fireEvent.keyDown(handle(), { key: 'Enter' });
    expect(announce.textContent).toBe('Timer put down.');
    expect(rows()[0]).toBe('core.timer:4 routine:8');
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(rows()[0]).toBe('core.timer:5 routine:7');
    // A move that is not put down is cancelled with Escape.
    fireEvent.keyDown(handle(), { key: 'Enter' });
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(rows()[0]).toBe('routine:12');
    fireEvent.keyDown(handle(), { key: 'Escape' });
    expect(rows()[0]).toBe('core.timer:5 routine:7');
    // Not picked up, the arrows move between the boxes (one tab stop).
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-handle')).toBe('routine');
    // Put the counter in the dock with its button, then undo twice.
    await act(async () => {
      fireEvent.click(screen.getByTestId('layout-to-dock-counters'));
    });
    expect(rows()[1]).toBe('focus:12');
    expect(document.querySelector('[data-dock-item="counters"]')).not.toBeNull();
    const undo = within(screen.getByTestId('layout-editor')).getByRole('button', { name: 'Undo' });
    await act(async () => {
      fireEvent.click(undo);
    });
    expect(rows()[1]).toBe('focus:4 counters:8');
    await act(async () => {
      fireEvent.click(undo);
    });
    expect(rows()[0]).toBe('core.timer:4 routine:8');
  });

  it('the editor belongs to one class: leaving its board (another class) closes it', async () => {
    setLayoutEditing('ctx-board-1');
    const view = renderBoard(ctx({}), null);
    expect(screen.getByTestId('layout-editor')).toBeTruthy();
    const other = { ...ctx({}), id: 'ctx-board-2' };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LessonBoard key={other.id} context={other} lesson={{ ...lesson, contextId: other.id }} onEnd={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('layout-editor')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(isLayoutEditing()).toBe(false);
  });
});
