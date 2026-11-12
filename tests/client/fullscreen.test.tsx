// @vitest-environment jsdom
/**
 * S18 (D-167): full screen during lessons with a stubbed Fullscreen API (jsdom has none). Begin lesson
 * asks for full screen inside the press (LES-1), Save and end lesson leaves it (LES-3); neither touches
 * full screen when the teacher's preference is off or the browser has no full screen (UX-2); the board
 * button shows "Full screen" (while a lesson runs) or "Leave full screen" (whenever the page is in full
 * screen) and nothing where unsupported.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client/modules/registry.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/modules/registry.ts')>()),
  startStepsFor: () => [],
  initialStartValues: () => ({}),
  useStartContributions: () => ({ input: {}, ready: true }),
  endStepUis: () => [],
}));
const sent: string[] = [];
const payloads: unknown[] = [];
vi.mock('../../src/client/modules/lessons/lessonClient.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/modules/lessons/lessonClient.ts')>()),
  sendLessonCommand: (type: string, payload: unknown) => {
    sent.push(type);
    payloads.push(payload);
    return Promise.resolve('op-1');
  },
  awaitCommand: () => Promise.resolve(null),
  awaitOrQueued: () => Promise.resolve({ queued: false, result: null }),
}));

const { StartLessonFlow, emptyStartDraft } = await import('../../src/client/modules/lessons/StartLesson.tsx');
const { EndLessonFlow } = await import('../../src/client/modules/lessons/EndLesson.tsx');
const { FullscreenButton, lessonPrefsKey } = await import('../../src/client/modules/lessons/fullscreen.tsx');
const { enterFullscreen, exitFullscreen, fullscreenSupported } = await import('../../src/client/lib/fullscreen.ts');

const context = { id: 'ctx1', classId: 'c1', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, timezone: 'Europe/Istanbul', modules: {} } as never;
const lesson = { id: 'lesson1', endSteps: [] } as never;

/** A minimal Fullscreen API on the jsdom document. */
function stubFullscreen(enabled: boolean) {
  let element: Element | null = null;
  const request = vi.fn(() => {
    element = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    element = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => enabled });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
  return { request, exit, set: (on: boolean) => (element = on ? document.documentElement : null) };
}
function removeFullscreen() {
  for (const k of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[k];
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
}

function wrap(node: ReactNode, fullscreenPref: boolean | null = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  if (fullscreenPref !== null) qc.setQueryData(lessonPrefsKey, { fullscreen: fullscreenPref });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const start = (pref: boolean | null = true) =>
  wrap(<StartLessonFlow context={context} draft={emptyStartDraft()} onDraft={() => undefined} onCancel={() => undefined} onStarted={() => undefined} onQueued={() => undefined} />, pref);
const end = (pref: boolean | null = true) =>
  wrap(<EndLessonFlow context={context} lesson={lesson} draft={null} onDraft={() => ({})} onCancel={() => undefined} onEnded={() => undefined} onQueued={() => undefined} />, pref);
const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
};

describe('full screen during lessons (S18, D-167)', () => {
  beforeEach(() => {
    sent.length = 0;
    payloads.length = 0;
  });
  afterEach(() => {
    cleanup();
    removeFullscreen();
  });

  it('Begin lesson asks for full screen before the start command is sent (LES-1)', async () => {
    const fs = stubFullscreen(true);
    // Record what had been sent when full screen was asked for (an expect inside the stub would be
    // swallowed by enterFullscreen's try/catch).
    let sentAtRequest: string[] | null = null;
    fs.request.mockImplementation(() => {
      sentAtRequest = [...sent];
      return Promise.resolve();
    });
    start();
    await press('Begin lesson');
    expect(fs.request).toHaveBeenCalledTimes(1);
    expect(sentAtRequest).toEqual([]);
    expect(sent).toEqual(['lesson.start']);
  });

  it('AUDIT lesson.start replay: the start carries the class local day it was made on (D-190)', async () => {
    stubFullscreen(false);
    start(false);
    await press('Begin lesson');
    const { localDate } = await import('../../src/domain/dates.ts');
    expect(payloads).toEqual([{ contextId: 'ctx1', localDate: localDate(Date.now(), 'Europe/Istanbul') }]);
  });

  it('uses the default (off, owner 2026-11-12) before the preference is loaded', async () => {
    const fs = stubFullscreen(true);
    start(null);
    await press('Begin lesson');
    expect(fs.request).not.toHaveBeenCalled();
  });

  it('Save and end lesson leaves full screen (LES-3)', async () => {
    const fs = stubFullscreen(true);
    fs.set(true);
    end();
    await press('Save and end lesson');
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(['lesson.end']);
  });

  it('touches nothing when the preference is off', async () => {
    const fs = stubFullscreen(true);
    start(false);
    await press('Begin lesson');
    cleanup();
    fs.set(true);
    end(false);
    await press('Save and end lesson');
    expect(fs.request).not.toHaveBeenCalled();
    expect(fs.exit).not.toHaveBeenCalled();
    expect(sent).toEqual(['lesson.start', 'lesson.end']);
  });

  it('calls nothing where the browser has no full screen (UX-2: e.g. iPhone)', async () => {
    const fs = stubFullscreen(false);
    expect(fullscreenSupported()).toBe(false);
    start();
    await press('Begin lesson');
    expect(fs.request).not.toHaveBeenCalled();
    removeFullscreen();
    // No API at all: still no error.
    expect(fullscreenSupported()).toBe(false);
    expect(() => enterFullscreen()).not.toThrow();
    expect(() => exitFullscreen()).not.toThrow();
  });

  it('does not exit when the page is not in full screen, and swallows a refused request', async () => {
    const fs = stubFullscreen(true);
    exitFullscreen();
    expect(fs.exit).not.toHaveBeenCalled();
    fs.request.mockImplementation(() => Promise.reject(new Error('denied')));
    expect(() => enterFullscreen()).not.toThrow();
    await Promise.resolve();
    fs.request.mockImplementation(() => {
      throw new TypeError('no gesture');
    });
    expect(() => enterFullscreen()).not.toThrow();
  });

  it('the board button: Full screen outside, Leave full screen inside, nothing where unsupported', async () => {
    const fs = stubFullscreen(true);
    wrap(<FullscreenButton />);
    await press('Full screen');
    expect(fs.request).toHaveBeenCalledTimes(1);
    const leave = screen.getByRole('button', { name: 'Leave full screen' });
    expect(leave.textContent).toBe('');
    await press('Leave full screen');
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeTruthy();
    // Esc (the browser leaves on its own): the button follows fullscreenchange.
    fs.set(true);
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(screen.getByRole('button', { name: 'Leave full screen' })).toBeTruthy();
    fs.set(false);
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeTruthy();
    cleanup();

    stubFullscreen(false);
    const r = wrap(<FullscreenButton />);
    expect(r.container.innerHTML).toBe('');
  });

  it('Leave full screen stays offered whenever the page is in full screen, also where entering is not (summary, failed start, teacher area)', async () => {
    const fs = stubFullscreen(true);
    const r = wrap(<FullscreenButton canEnter={false} />);
    // Not in full screen and no lesson running: nothing.
    expect(r.container.innerHTML).toBe('');
    fs.set(true);
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    await press('Leave full screen');
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(r.container.innerHTML).toBe('');
    expect(fs.request).not.toHaveBeenCalled();
  });
});
