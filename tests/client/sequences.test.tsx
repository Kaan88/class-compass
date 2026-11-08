// @vitest-environment jsdom
/**
 * Choreographed sequences under reduced motion (S13b item 1 Tests line, D-110, review fix): the
 * celebration and the Secret Student reveal play their loud cues only with full motion; with reduced
 * motion (OS setting) or animations off for the class they play one soft chime, and the celebration
 * overlay is still (reduced) or absent (off). Sounds still follow the sound switches.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDisplay } from '../../src/client/lib/display.ts';
import { CelebrationLayer, celebrate } from '../../src/client/themes/Celebration.tsx';
import { themeOf } from '../../src/client/themes/registry.ts';
import { celebrationCues, revealCue, type RevealStep } from '../../src/client/themes/sequences.ts';
import { sounds } from '../../src/client/themes/soundManager.ts';
import { SOUND_EVENTS, type SoundEvent, type SoundSpec } from '../../src/client/themes/types.ts';

const STEPS: RevealStep[] = ['countdown', 'drumroll', 'card', 'end'];
const LOUD: SoundEvent[] = ['fanfare', 'clapping', 'fireworks', 'secretDrumroll'];

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

describe('sequence cues per motion mode (pure)', () => {
  it('full motion plays the whole show', () => {
    expect(STEPS.map((s) => revealCue('full', s))).toEqual(['tap', 'secretDrumroll', 'secretReveal', 'fanfare']);
    expect(celebrationCues('full').map((c) => c.event)).toEqual(['fanfare', 'clapping', 'fireworks']);
  });

  it('reduced motion and animations off: no loud cue, one soft chime at the end', () => {
    for (const mode of ['reduced', 'none'] as const) {
      const reveal = STEPS.map((s) => revealCue(mode, s));
      expect(reveal).toEqual([null, null, null, 'softChime']);
      expect(celebrationCues(mode)).toEqual([{ event: 'softChime', at: 0 }]);
    }
    expect(SOUND_EVENTS).toContain('softChime');
  });
});

describe('CelebrationLayer under reduced motion', () => {
  let played: SoundSpec[];
  beforeEach(() => {
    vi.useFakeTimers();
    played = [];
    vi.spyOn(sounds, 'play').mockImplementation((spec: SoundSpec) => {
      played.push(spec);
      return true;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const eventsPlayed = () => {
    const pack = themeOf('classroom').sounds!;
    return played.map((spec) => SOUND_EVENTS.find((e) => pack[e] === spec));
  };

  it('OS reduced motion: still mascot overlay, no particles, only the soft chime', () => {
    stubReducedMotion(true);
    setDisplay({ theme: 'classroom', classAnimations: true, classSounds: true, deviceSounds: true });
    const view = render(<CelebrationLayer />);
    act(() => celebrate('Well done, Ada!'));
    act(() => void vi.advanceTimersByTime(1500));
    const layer = view.getByTestId('celebration');
    expect(layer.dataset.mode).toBe('reduced');
    expect(layer.querySelector('canvas')).toBeNull();
    expect(layer.textContent).toContain('Well done, Ada!');
    expect(eventsPlayed()).toEqual(['softChime']);
    for (const e of LOUD) expect(eventsPlayed()).not.toContain(e);
    act(() => void vi.advanceTimersByTime(2000));
    expect(view.queryByTestId('celebration')).toBeNull();
  });

  it('animations off for the class: no overlay, only the soft chime; sounds off: nothing', () => {
    stubReducedMotion(false);
    setDisplay({ theme: 'classroom', classAnimations: false, classSounds: true, deviceSounds: true });
    const view = render(<CelebrationLayer />);
    act(() => celebrate());
    act(() => void vi.advanceTimersByTime(1500));
    expect(view.queryByTestId('celebration')).toBeNull();
    expect(eventsPlayed()).toEqual(['softChime']);
    played.length = 0;
    act(() => setDisplay({ classSounds: false }));
    act(() => celebrate());
    act(() => void vi.advanceTimersByTime(1500));
    expect(played).toEqual([]);
  });
});
