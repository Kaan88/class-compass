// @vitest-environment jsdom
/**
 * S22c (D-177), S27c (D-195): the classroom student cards. The fit's choice of size (CRD-3: grows
 * into free height, DSH-1 the board), the card marks (this lesson's achievements and the group number:
 * an icon and a number with a spoken name, never colour only, UX-6/UX-7), and the add-ons that give
 * them: nothing while a module is off or has nothing to show. Fictional data only.
 */
import 'fake-indexeddb/auto';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { achievementsCardAddon, achievementsKey } from '../../src/client/modules/achievements/AchievementsPanel.tsx';
import { groupsCardAddon } from '../../src/client/modules/grouping/GroupsPanel.tsx';
import { FIT_START, FIT_STEPS, chooseFitStep, type FitMeasure } from '../../src/client/modules/lessons/board/cardFit.ts';
import { lessonKey } from '../../src/client/modules/lessons/lessonClient.ts';
import type { ClassroomContext } from '../../src/client/modules/types.ts';
import { StudentCard } from '../../src/client/ui/Students.tsx';
import { IconTrophy } from '../../src/client/ui/icons.tsx';

afterEach(cleanup);

describe('chooseFitStep (CRD-3, DSH-1)', () => {
  const N = FIT_STEPS.length;
  /** Every step up to `fits` shows every card; above it `fullAt(step)` whole cards. */
  const ladder = (fits: number, fullAt: (step: number) => number = () => 10) => {
    const asked: number[] = [];
    const measure = (step: number): FitMeasure => {
      asked.push(step);
      return step <= fits ? { all: true, full: 40 } : { all: false, full: fullAt(step) };
    };
    return { measure, asked };
  };

  // S27c (D-195): one automatic size; the fit always starts at the middle step and ends at the largest
  // step where every card fits.
  const base = FIT_START;

  it('grows from the start while every card fits, up to the largest step', () => {
    expect(chooseFitStep(base, N, ladder(base + 3).measure)).toBe(base + 3);
    expect(chooseFitStep(base, N, ladder(N - 1).measure)).toBe(N - 1);
  });

  it('stays at the start when the next step does not fit', () => {
    expect(chooseFitStep(base, N, ladder(base).measure)).toBe(base);
  });

  it('shrinks to the largest step where every card fits', () => {
    const { measure, asked } = ladder(3);
    expect(chooseFitStep(base, N, measure)).toBe(3);
    // Measured once per step, from the start down.
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked[0]).toBe(base);
  });

  it('ends at the largest step where every card fits, wherever that is on the ladder', () => {
    for (let fits = 0; fits < N; fits += 1) expect(chooseFitStep(base, N, ladder(fits).measure), `fits up to ${fits}`).toBe(fits);
  });

  it('when no step fits every card, takes the one with the most whole cards, a tie going to the larger', () => {
    expect(chooseFitStep(base, N, ladder(-1, (s) => (s === 0 ? 16 : 8)).measure)).toBe(0);
    expect(chooseFitStep(base, N, ladder(-1, () => 8).measure)).toBe(base);
    // A step that breaks a name inside a word (full -1) is never chosen over one that does not.
    expect(chooseFitStep(base, N, ladder(-1, (s) => (s === base ? -1 : 6)).measure)).toBe(base - 1);
  });

  it('starts at the middle step (the old Normal size), with the readable minimum at the bottom', () => {
    expect(FIT_STEPS[FIT_START]!.key).toBe('s2');
    expect(FIT_STEPS.at(-1)!.key).toBe('s3');
    expect(FIT_STEPS[0]).toMatchObject({ key: 'tight', tight: true });
  });

  it('never makes the + button smaller than a touch target, and the sizes grow along the ladder', () => {
    const rem = (v: string | undefined) => parseFloat(v ?? 'NaN');
    for (const step of FIT_STEPS) expect(step.vars['--cc-card-add']).toMatch(/^calc\(var\(--cc-touch\) \+ [\d.]+rem\)$/u);
    for (const name of ['--cc-card-min', '--cc-card-h', '--cc-card-avatar', '--cc-card-name']) {
      const values = FIT_STEPS.map((s) => rem(s.vars[name]));
      expect(values, name).toEqual([...values].sort((a, b) => a - b));
    }
  });
});

describe('student card marks (UX-6)', () => {
  it('shows each mark as an icon and a number with a spoken name, after the count', () => {
    render(
      <I18nProvider locale="en">
        <StudentCard student={{ id: 's1', fullName: 'Ada Example', avatar: null } as never} weeklyCount={2} marks={[{ key: 'achievements', Icon: IconTrophy, value: '3', label: '3 achievements this lesson' }]} />
      </I18nProvider>,
    );
    const mark = screen.getByRole('img', { name: '3 achievements this lesson' });
    expect(mark).toHaveProperty('textContent', '3');
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(mark.dataset.mark).toBe('achievements');
  });
});

describe('card add-ons: achievements and groups', () => {
  const context: ClassroomContext = { id: 'ctx-1', classId: 'c-1', className: '3-A', subjectName: { en: 'English' }, timezone: 'Europe/Istanbul', modules: {} };
  const lesson = { id: 'lesson-1' } as never;
  let client: QueryClient;
  beforeEach(() => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchInterval: false } } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    client.clear();
  });
  const wrapper = (locale: 'en' | 'tr') =>
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <I18nProvider locale={locale}>{children}</I18nProvider>
        </QueryClientProvider>
      );
    };

  it('counts this lesson’s achievements per student, in English and Turkish, and nothing for a student without one', () => {
    client.setQueryData(achievementsKey(context.id, 'lesson-1'), { enabled: true, badges: [], lessonAwards: [{ studentId: 'a' }, { studentId: 'a' }, { studentId: 'b' }] });
    const en = renderHook(() => achievementsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('en') }).result.current!;
    expect(en.cardProps('a', 'A').marks).toMatchObject([{ key: 'achievements', value: '2', label: '2 achievements this lesson' }]);
    expect(en.cardProps('b', 'B').marks).toMatchObject([{ value: '1', label: '1 achievement this lesson' }]);
    expect(en.cardProps('c', 'C').marks).toBeUndefined();
    const tr = renderHook(() => achievementsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('tr') }).result.current!;
    expect(tr.cardProps('a', 'A').marks).toMatchObject([{ label: 'Bu derste 2 başarı' }]);
  });

  it('gives nothing while the achievements module is off, switched off for the school, or nothing was given', () => {
    client.setQueryData(achievementsKey(context.id, 'lesson-1'), { enabled: true, badges: [], lessonAwards: [{ studentId: 'a' }] });
    expect(renderHook(() => achievementsCardAddon.useAddon(context, lesson, false), { wrapper: wrapper('en') }).result.current).toBeNull();
    client.setQueryData(achievementsKey(context.id, 'lesson-1'), { enabled: false, badges: [], lessonAwards: [{ studentId: 'a' }] });
    expect(renderHook(() => achievementsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('en') }).result.current).toBeNull();
    client.setQueryData(achievementsKey(context.id, 'lesson-1'), { enabled: true, badges: [], lessonAwards: [] });
    expect(renderHook(() => achievementsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('en') }).result.current).toBeNull();
  });

  const lessonWithGroups = (applied: boolean) => ({
    etag: null,
    data: {
      grouping: {
        applied,
        groups: [
          { icon: 'g5', members: [{ id: 'a' }, { id: 'b' }] },
          { icon: 'star', members: [{ id: 'c' }] },
        ],
      },
    },
  });

  it('shows the group number while groups are shown: the "Group N" icon’s number, else the group’s place', () => {
    client.setQueryData(lessonKey(context.id), lessonWithGroups(true));
    const en = renderHook(() => groupsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('en') }).result.current!;
    expect(en.cardProps('a', 'A').marks).toMatchObject([{ key: 'group', value: '5', label: 'In group 5' }]);
    expect(en.cardProps('c', 'C').marks).toMatchObject([{ value: '2', label: 'In group 2' }]);
    expect(en.cardProps('z', 'Z').marks).toBeUndefined();
    const tr = renderHook(() => groupsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('tr') }).result.current!;
    expect(tr.cardProps('a', 'A').marks).toMatchObject([{ label: '5. grupta' }]);
  });

  it('gives nothing while the grouping module is off or no groups are shown', () => {
    client.setQueryData(lessonKey(context.id), lessonWithGroups(true));
    expect(renderHook(() => groupsCardAddon.useAddon(context, lesson, false), { wrapper: wrapper('en') }).result.current).toBeNull();
    client.setQueryData(lessonKey(context.id), lessonWithGroups(false));
    expect(renderHook(() => groupsCardAddon.useAddon(context, lesson, true), { wrapper: wrapper('en') }).result.current).toBeNull();
  });
});
