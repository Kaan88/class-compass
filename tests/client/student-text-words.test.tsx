// @vitest-environment jsdom
/**
 * The student page and the larger word lists (S28b, D-198; GOL-5, budget D-151): the page checks with
 * our small lists first; a text they cannot read is sent and the server (which always has the large
 * lists) decides, while the page loads the large lists for its next checks. Keyboard mashing is shown
 * at once, without them. Fictional data only.
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GOAL_OUTCOMES, type StudentGoalsSection } from '../../src/shared/contracts/goals.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { loadLargeWords, useSaveCheck } from '../../src/client/student/common.tsx';
import { en } from '../messages.ts';

const data: StudentGoalsSection = {
  goals: [],
  evidence: [],
  feedback: [],
  categories: [],
  presets: [],
  outcomes: DEFAULT_GOAL_OUTCOMES,
  canWrite: true,
  textLimits: { minGoalWords: 3, minGoalLetters: 12 },
  starters: [],
};

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider locale="en">{children}</I18nProvider>;

describe('student page save check with the larger word lists (D-198)', () => {
  it('sends what the small lists cannot read until the large lists are here, then checks with them', async () => {
    const { result } = renderHook(() => useSaveCheck(data), { wrapper });
    const check = result.current;
    // Mashing never waits for the large lists.
    expect(check('I will asdf qwer', 'reflection')).toEqual({ hint: `${en['textCheck.KEYBOARD_MASH']} ${en['textCheck.example.reflection']}`, send: false });
    // Not loaded yet: the server decides (it accepts the first, refuses the second).
    expect(check('Glaciers carve canyons', 'goal')).toEqual({ send: true });
    expect(check('blorf zintu quabbo', 'reflection')).toEqual({ send: true });
    await loadLargeWords();
    expect(check('Glaciers carve canyons', 'goal')).toEqual({ send: true });
    expect(check('Yanardağlar lav püskürtür', 'reflection')).toEqual({ send: true });
    expect(check('blorf zintu quabbo', 'reflection')).toEqual({ hint: `${en['textCheck.UNKNOWN_WORDS']} ${en['textCheck.example.reflection']}`, send: false });
    expect(check('I will asdf qwer', 'reflection').send).toBe(false);
  });
});
