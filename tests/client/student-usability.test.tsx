// @vitest-environment jsdom
/**
 * S13 usability fixes on the personal student page (STU-2, UX-2..4): homework folded to open and
 * recent items with tinted, iconed status chips; badges folded to the newest with the tier word on
 * every card; big translated file pickers for evidence; the full goal sentence under a goal select;
 * a subject jump bar and Help in the top bar. Fictional data only.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentAchievementsSection } from '../../src/shared/contracts/achievements.ts';
import type { StudentHomeworkSection } from '../../src/shared/contracts/goals.ts';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { FilePick } from '../../src/client/modules/goals/FilePick.tsx';
import { chosenGoalHint } from '../../src/client/modules/goals/shared.tsx';
import { AchievementsSection, EARNED_FIRST, LOCKED_FIRST } from '../../src/client/student/AchievementsSection.tsx';
import { HOMEWORK_FIRST, HomeworkSection, homeworkVisibleCount } from '../../src/client/student/HomeworkSection.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: ReactNode, locale: Locale = 'en') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <I18nProvider locale={locale}>{node}</I18nProvider>
  </QueryClientProvider>
);

const label = (en: string) => ({ en, tr: en });

describe('homework on the student page (HW-4, S13 usability)', () => {
  const items = (n: number, firstDue = '2026-11-20'): StudentHomeworkSection['assignments'] =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.parse(`${firstDue}T12:00:00Z`) - i * 7 * 86_400_000).toISOString().slice(0, 10);
      return { id: `hw-${i}`, title: `Fictional task ${i + 1}`, details: null, assignedOn: d, dueOn: d, status: i === 0 ? null : { key: 'done', label: label('Completed'), kind: i === 1 ? 'missing' : 'completed' } };
    });

  it('shows every item not yet due and at least the newest few', () => {
    expect(homeworkVisibleCount(items(10), '2026-11-08')).toBe(HOMEWORK_FIRST);
    // Weekly items due 20 Dec back to 8 Nov (today included): all seven stay in view.
    expect(homeworkVisibleCount(items(10, '2026-12-20'), '2026-11-08')).toBe(7);
  });

  it('folds older homework behind "Show older homework" and marks each status with an icon and a tone', () => {
    render(wrap(<HomeworkSection data={{ assignments: items(9) }} subjectId="s1" />));
    expect(screen.getAllByTestId('student-homework-item').length).toBeLessThan(9);
    const more = screen.getByTestId('student-homework-older');
    expect(more?.textContent).toMatch(/Show older homework/u);
    fireEvent.click(more);
    expect(screen.getAllByTestId('student-homework-item')).toHaveLength(9);
    const missing = document.querySelector('[data-status-kind="missing"]')!;
    expect(missing.className).toContain('cc-chip--warning');
    expect(missing.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('[data-status-kind="completed"]')!.className).toContain('cc-chip--success');
    // Not checked keeps its words (never colour alone).
    expect(document.querySelector('[data-status-kind="not_checked"]')?.textContent).toContain('Not checked yet');
  });

  it('writes the due date with full day and month names in Turkish', () => {
    render(wrap(<HomeworkSection data={{ assignments: [{ id: 'a', title: 'Ödev', details: null, assignedOn: '2026-10-05', dueOn: '2026-10-09', status: null }] }} subjectId="s1" />, 'tr'));
    expect(screen.getByText(/Teslim: 9 Ekim Cuma/u)).toBeTruthy();
  });
});

describe('badges on the student page (D-121, S13 usability)', () => {
  const badge = (id: string, name: string, tier: 'bronze' | 'silver' | 'gold', desc: string) => ({ id, name: label(name), description: label(desc), icon: 'check' as const, tier, category: 'homework' as const });
  const data = (earned: number): StudentAchievementsSection => ({
    earned: Array.from({ length: earned }, (_, i) => ({ ...badge(`e${i}`, 'Homework hero', 'bronze', `Complete ${i + 1} tasks.`), awardedAt: Date.parse('2026-10-27T10:00:00Z') - i * 86_400_000, by: null, isNew: false })),
    locked: [{ ...badge('l1', 'On a roll', 'silver', 'Complete 5 homework tasks on time in a row.'), progress: { current: 4, target: 5 } }],
    level: null,
  });

  it('shows the newest earned badges first, with what each is for, and the rest behind "Show all my badges"', () => {
    render(wrap(<AchievementsSection data={data(EARNED_FIRST + 3)} subjectId="s1" />));
    expect(screen.getAllByTestId('student-badge')).toHaveLength(EARNED_FIRST);
    expect(screen.getByText('Complete 1 tasks.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('student-badges-earned-all'));
    expect(screen.getAllByTestId('student-badge')).toHaveLength(EARNED_FIRST + 3);
    expect(LOCKED_FIRST).toBeGreaterThan(0);
  });

  it('names the tier of a badge still to earn, and its progress fits on one line in Turkish', () => {
    render(wrap(<AchievementsSection data={data(1)} subjectId="s1" />, 'tr'));
    const locked = screen.getByTestId('student-badge-locked');
    expect(locked?.textContent).toContain(tr['achievements.tier.silver']);
    expect(locked.querySelector('.cc-badge__count')?.textContent).toContain('4/5');
  });
});

describe('evidence file pickers (D-119, S13 usability)', () => {
  it('is a translated button that labels the hidden input, with a translated "nothing chosen" line', () => {
    const onFiles = vi.fn();
    render(wrap(<FilePick id="pick" label={tr['evidence.choosePictures']} icon={null} accept="image/*" multiple status={tr['evidence.noFileYet']} onFiles={onFiles} />, 'tr'));
    const input = screen.getByLabelText(tr['evidence.choosePictures']);
    expect(input.getAttribute('type')).toBe('file');
    expect(input.className).toContain('cc-visually-hidden');
    expect(screen.getByText('Henüz dosya seçilmedi')).toBeTruthy();
    const file = new File(['x'], 'drawing.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});

describe('goal selects (S13 usability)', () => {
  it('repeats a long chosen goal in full under the select, but not a short one', () => {
    const items = [
      { id: 'a', label: 'I will write three sentences about my weekend.' },
      { id: 'b', label: 'Read more' },
    ];
    expect(chosenGoalHint(items, 'a')).toBe(items[0]!.label);
    expect(chosenGoalHint(items, 'b')).toBeUndefined();
    expect(chosenGoalHint(items, '')).toBeUndefined();
  });
});
