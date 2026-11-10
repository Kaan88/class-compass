// @vitest-environment jsdom
/**
 * S16c (D-165): the board's screen reporter sends once per mount (after a short delay) and on a
 * debounced resize at most once a minute; the user agent is reduced to a short browser/OS text.
 */
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplaySample } from '../../src/shared/contracts/displayInfo.ts';

const calls: unknown[] = [];
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: (_ep: unknown, input: unknown) => {
    calls.push(input);
    return Promise.resolve({ ok: true });
  },
}));

const { DisplayReporter, MIN_GAP_MS, MOUNT_DELAY_MS, RESIZE_SETTLE_MS } = await import('../../src/client/modules/displayInfo/Reporter.tsx');
const { parseUserAgent, readSample } = await import('../../src/client/modules/displayInfo/sample.ts');

const context = { id: 'ctx1', classId: 'c1', className: '3-A', subjectName: { en: 'English' }, timezone: 'Europe/Istanbul', modules: {} };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DisplayReporter context={context} layoutSource="class" />
    </QueryClientProvider>,
  );
}
const resize = () => act(() => void window.dispatchEvent(new Event('resize')));

describe('DisplayReporter (S16c, D-165)', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('sends once on mount, with a valid sample', () => {
    mount();
    expect(calls).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(MOUNT_DELAY_MS));
    expect(calls).toHaveLength(1);
    const s = DisplaySample.parse(calls[0]);
    expect(s.layout).toBe('class');
    act(() => void vi.advanceTimersByTime(10 * MIN_GAP_MS));
    expect(calls).toHaveLength(1);
  });

  it('sends nothing when unmounted before the delay', () => {
    const r = mount();
    r.unmount();
    act(() => void vi.advanceTimersByTime(MIN_GAP_MS));
    expect(calls).toHaveLength(0);
  });

  it('debounces resizes and sends at most once a minute', () => {
    mount();
    act(() => void vi.advanceTimersByTime(MOUNT_DELAY_MS));
    expect(calls).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      resize();
      act(() => void vi.advanceTimersByTime(500));
    }
    expect(calls).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(MIN_GAP_MS));
    expect(calls).toHaveLength(2);
    // Long after: a resize is sent once the window is still.
    act(() => void vi.advanceTimersByTime(2 * MIN_GAP_MS));
    resize();
    act(() => void vi.advanceTimersByTime(RESIZE_SETTLE_MS - 1));
    expect(calls).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(calls).toHaveLength(3);
  });

  it('sends again after a full screen change and records it (S18, D-167)', () => {
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
    try {
      mount();
      act(() => void vi.advanceTimersByTime(MOUNT_DELAY_MS));
      expect(DisplaySample.parse(calls[0]).fullscreen).toBe(false);
      act(() => void vi.advanceTimersByTime(MIN_GAP_MS));
      element = document.documentElement;
      act(() => void document.dispatchEvent(new Event('fullscreenchange')));
      act(() => void vi.advanceTimersByTime(RESIZE_SETTLE_MS));
      expect(calls).toHaveLength(2);
      expect(DisplaySample.parse(calls[1]).fullscreen).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
    }
  });
});

describe('parseUserAgent (S16c)', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', 'Chrome 142', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', 'Edge 142', 'Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox 140', 'Linux'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari 18', 'iOS'],
    ['Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Safari/537.36', 'Samsung Internet 25', 'Android'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Chrome 140', 'ChromeOS'],
    ['something else', 'Other', 'Other'],
  ])('%s', (ua, browser, os) => {
    expect(parseUserAgent(ua)).toEqual({ browser, os });
  });

  it('builds a sample the contract accepts, without the user agent', () => {
    const s = readSample({ density: 'large', theme: 'explorer', layout: null, textScale: 125 });
    expect(s).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain('Mozilla');
  });
});
