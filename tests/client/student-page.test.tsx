// @vitest-environment jsdom
/**
 * Personal student page (S10 review fixes): only a refused link (401) shows "this link no longer works";
 * a busy server (429), a server error or no connection offers "try again" with the token kept in
 * memory (STU-1, STU-3, STU-4). The goals section has unique heading ids per subject (UX-2, axe
 * duplicate-id-aria) and shows the review date as a calendar date in the page language (UX-3).
 * Fictional data only.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GOAL_OUTCOMES, type Goal, type StudentGoalsSection } from '../../src/shared/contracts/goals.ts';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { GoalsSection } from '../../src/client/student/GoalsSection.tsx';
import { openLink, StudentApp, type OpenResult } from '../../src/client/student/StudentApp.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: ReactNode, locale: Locale = 'en') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <I18nProvider locale={locale}>{node}</I18nProvider>
  </QueryClientProvider>
);

describe('opening a link (STU-1, STU-3, STU-4)', () => {
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('maps only a 401 to "invalid"; 429, 5xx and network errors can be retried', async () => {
    vi.stubGlobal('fetch', answer(401, { error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: 'LINK_INVALID' } } }));
    expect(await openLink('t')).toBe('invalid');
    vi.stubGlobal('fetch', answer(429, { error: { code: 'RATE_LIMITED', message: 'x' } }));
    expect(await openLink('t')).toBe('retry');
    vi.stubGlobal('fetch', answer(503, null));
    expect(await openLink('t')).toBe('retry');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await openLink('t')).toBe('retry');
    vi.stubGlobal('fetch', answer(200, { ok: true }));
    expect(await openLink('t')).toBe('ok');
  });

  it('a busy server shows "try again", which posts the same token again; a refused link shows the gone page', async () => {
    const results: OpenResult[] = ['retry', 'invalid'];
    const open = vi.fn<(token: string) => Promise<OpenResult>>(async () => results.shift()!);
    render(wrap(<StudentApp token="tok-123" open={open} />));
    expect(await screen.findByTestId('student-link-retry')).toBeTruthy();
    expect(screen.queryByTestId('student-link-gone')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['student.retry.button'] }));
    expect(await screen.findByTestId('student-link-gone')).toBeTruthy();
    expect(open.mock.calls).toEqual([['tok-123'], ['tok-123']]);
  });
});

const goal = (id: string, subjectId: string): Goal => ({
  id,
  subjectId,
  category: { id: 'c1', name: { en: 'Reading', tr: 'Okuma' }, nameAtCreation: { en: 'Reading', tr: 'Okuma' } },
  authorType: 'student',
  presetId: null,
  presetText: null,
  text: 'I will read every week.',
  practiceChoices: [],
  reviewOn: '2026-11-20',
  status: 'active',
  createdAt: Date.UTC(2026, 10, 9),
  updatedAt: Date.UTC(2026, 10, 9),
  entries: [],
  assessments: [],
});
const section = (subjectId: string): StudentGoalsSection => ({
  goals: [goal(`g-${subjectId}`, subjectId)],
  evidence: [],
  feedback: [],
  categories: [],
  presets: [],
  outcomes: DEFAULT_GOAL_OUTCOMES,
  canWrite: false,
  textLimits: { minGoalWords: 3, minGoalLetters: 12 },
});
const media = { photos: false, audio: false, documents: true };

describe('goals section (UX-2, UX-3)', () => {
  it('two subjects on one page have unique ids and each aria-labelledby points at its own heading', () => {
    const { container } = render(
      wrap(
        <>
          <GoalsSection data={section('sub-en')} subjectId="sub-en" media={media} />
          <GoalsSection data={section('sub-sci')} subjectId="sub-sci" media={media} />
        </>,
      ),
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const el of container.querySelectorAll('[aria-labelledby]')) {
      const target = container.querySelector(`#${CSS.escape(el.getAttribute('aria-labelledby')!)}`);
      expect(target && el.contains(target)).toBe(true);
    }
  });

  it.each([
    ['en', en['goals.reviewOn'].replace('{date}', '20 Nov 2026')],
    ['tr', tr['goals.reviewOn'].replace('{date}', '20 Kas 2026')],
  ] as const)('shows the review date as a calendar date in %s', (locale, text) => {
    render(wrap(<GoalsSection data={section('sub-en')} subjectId="sub-en" media={media} />, locale));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/2026-11-20/u)).toBeNull();
  });

  it('live hints use the school’s goal limits and cover practice choices, evidence words and link addresses (D-123, review fix)', () => {
    const writable = (limits: { minGoalWords: number; minGoalLetters: number }): StudentGoalsSection => ({ ...section('sub-en'), canWrite: true, textLimits: limits });
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const { unmount } = render(wrap(<GoalsSection data={writable({ minGoalWords: 3, minGoalLetters: 12 })} subjectId="sub-en" media={media} />));
    type(en['student.myGoalWords'], 'Read books');
    expect(screen.getByText(en['textCheck.TOO_SHORT'], { exact: false })).toBeTruthy();
    unmount();
    // The admin lowered the goal minimum to two words: the hint agrees with the server.
    render(wrap(<GoalsSection data={writable({ minGoalWords: 2, minGoalLetters: 20 })} subjectId="sub-en" media={media} />));
    type(en['student.myGoalWords'], 'Read books');
    expect(screen.queryByText(en['textCheck.TOO_SHORT'], { exact: false })).toBeNull();
    type(en['student.practice'], 'read aloud, fuck this');
    expect(screen.getAllByText(en['textCheck.BLOCKED_WORD'], { exact: false })).toHaveLength(1);
    type(en['student.evidenceWords'], 'asdfgh qwerty zxcvb');
    expect(screen.getByText(en['textCheck.KEYBOARD_MASH'], { exact: false })).toBeTruthy();
  });
});
