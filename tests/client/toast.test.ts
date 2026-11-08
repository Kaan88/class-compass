/**
 * Toast store (UX-9 undo window, PIN-3 nothing sensitive left on the classroom display).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASSROOM_NOTE_MS, clearAllToasts, clearSensitiveToasts, currentToasts, MAX_VISIBLE, NOTE_MS, showToast, showUndoToast, UNDO_MS } from '../../src/client/lib/toast.ts';

beforeEach(() => {
  vi.useFakeTimers();
  clearAllToasts();
});
afterEach(() => {
  clearAllToasts();
  vi.useRealTimers();
});

const messages = () => currentToasts().map((t) => t.message);

describe('toast store', () => {
  it('keeps plain notes on the classroom display shorter than elsewhere; errors and undo keep their time (usability pass D-139)', () => {
    showToast({ message: 'lesson started', kind: 'success', scope: 'classroom' });
    showToast({ message: 'saved', kind: 'success' });
    showToast({ message: 'failed', kind: 'error', scope: 'classroom' });
    expect(currentToasts().map((t) => t.durationMs)).toEqual([CLASSROOM_NOTE_MS, NOTE_MS, NOTE_MS]);
    vi.advanceTimersByTime(CLASSROOM_NOTE_MS);
    expect(messages()).toEqual(['saved', 'failed']);
    clearAllToasts();
    showUndoToast('undo', () => undefined, { scope: 'classroom' });
    expect(currentToasts()[0]!.durationMs).toBe(UNDO_MS);
  });

  it('keeps an undo toast for its full 8 s even when more toasts arrive (UX-9)', () => {
    showUndoToast('undo me', () => undefined);
    for (let i = 1; i <= 5; i++) showToast({ message: `info ${i}` });
    expect(messages()).toContain('undo me');
    expect(currentToasts()).toHaveLength(MAX_VISIBLE);
    expect(messages()).toEqual(['undo me', 'info 4', 'info 5']); // plain toasts are evicted first
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(messages()).toContain('undo me');
    vi.advanceTimersByTime(1);
    expect(messages()).not.toContain('undo me');
  });

  it('never evicts undo toasts, even when there are more than the visible limit', () => {
    for (let i = 1; i <= 4; i++) showUndoToast(`undo ${i}`, () => undefined);
    showToast({ message: 'error', kind: 'error' });
    expect(messages()).toEqual(['undo 1', 'undo 2', 'undo 3', 'undo 4']);
  });

  it('runs an undo at most once', async () => {
    const undo = vi.fn();
    showUndoToast('x', undo);
    const t = currentToasts()[0]!;
    await t.undo?.();
    await t.undo?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('clears teacher-area toasts on lock but keeps classroom-safe ones (PIN-3)', () => {
    showToast({ message: 'Student added: Ada Yıldız', kind: 'success' });
    showUndoToast('Reminder recorded', () => undefined, { scope: 'classroom' });
    clearSensitiveToasts();
    expect(messages()).toEqual(['Reminder recorded']);
    clearAllToasts();
    expect(currentToasts()).toEqual([]);
  });
});
