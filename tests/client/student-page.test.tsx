// @vitest-environment jsdom
/**
 * Personal student page (S10 review fixes; S14d home tiles and short steps, D-151; sentence starters,
 * D-152): only a refused link (401) shows "this link no longer works"; a busy server (429), a server
 * error or no connection offers "try again" with the token kept in memory (STU-1, STU-3, STU-4).
 * Screens live in the query string, never in the fragment that carries the token; tiles show only for
 * sections that exist; hints show when Save is pressed (STARTER_UNFINISHED included); a starter chip
 * fills the box and selects its blank, and asks before replacing the child's own words; deleting asks
 * in the page. Review dates are calendar dates in the page language (UX-3). Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GOAL_OUTCOMES, type Goal, type StudentGoalsSection, type StudentPageSection } from '../../src/shared/contracts/goals.ts';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { HOME, navHref, navSearch, readNav, type NavApi, type StudentNav } from '../../src/client/student/nav.ts';
import { chipText, SentenceStarters } from '../../src/client/student/SentenceStarters.tsx';
import { tilesOf } from '../../src/client/student/sections.tsx';
import { MyGoals } from '../../src/client/student/screens/MyGoals.tsx';
import { NewGoal } from '../../src/client/student/screens/NewGoal.tsx';
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

describe('screens in the query string (D-151)', () => {
  const SUBJECT = '0190aaaa-0000-7000-8000-000000000001';

  it('reads only the query string: a token in the fragment is never a screen, unknown values fall back to home', () => {
    expect(readNav('')).toEqual(HOME);
    expect(readNav(`?screen=newGoal&subject=${SUBJECT}&step=2`)).toEqual({ screen: 'newGoal', subject: SUBJECT, goal: null, step: 2 });
    expect(readNav('?screen=admin')).toEqual(HOME);
    expect(readNav('?screen=goals&step=99&goal=../x').step).toBe(1);
    expect(readNav('?screen=goals&goal=<script>').goal).toBeNull();
    // What looks like a link token after "#" never reaches the screen state (main.tsx removes it first).
    expect(readNav(new URL('https://school.example.org/s?screen=homework#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd').search).screen).toBe('homework');
  });

  it('writes screens as path + query, never with a fragment', () => {
    expect(navSearch(HOME)).toBe('');
    const href = navHref({ screen: 'howIsItGoing', subject: SUBJECT, goal: 'g1', step: 3 }, '/s');
    expect(href).toBe(`/s?screen=howIsItGoing&subject=${SUBJECT}&goal=g1&step=3`);
    expect(href).not.toContain('#');
  });
});

const goal = (id: string, subjectId: string, over: Partial<Goal> = {}): Goal => ({
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
  ...over,
});
const section = (subjectId: string, over: Partial<StudentGoalsSection> = {}): StudentGoalsSection => ({
  goals: [goal(`g-${subjectId}`, subjectId)],
  evidence: [],
  feedback: [],
  categories: [{ id: 'c1', name: { en: 'Reading', tr: 'Okuma' }, icon: 'book', subjectId: null, custom: false, archived: false, schoolArchived: false }],
  presets: [],
  outcomes: DEFAULT_GOAL_OUTCOMES,
  canWrite: false,
  textLimits: { minGoalWords: 3, minGoalLetters: 12 },
  starters: [
    { id: 's1', kind: 'goal', categoryId: null, text: { en: 'I want to get better at ___.' } },
    { id: 's2', kind: 'goal', categoryId: null, text: { en: 'I will practise ___ every day.' } },
    { id: 's3', kind: 'practice', categoryId: null, text: { en: 'Read ___ at bedtime.' } },
  ],
  ...over,
});
const media = { photos: false, audio: false, documents: true };

/** A screen with the page's navigation kept in memory. */
function Harness({ render: show, start }: { render: (p: { nav: StudentNav; go: NavApi['go'] }) => ReactNode; start: StudentNav }) {
  const [nav, setNav] = useState(start);
  const go: NavApi['go'] = (next) => setNav({ subject: null, goal: null, step: 1, ...next });
  return <div data-screen={nav.screen}>{show({ nav, go })}</div>;
}

describe('home tiles (D-151)', () => {
  it('shows a tile only for a section that exists, in the home order; writing tiles only when the student may write', () => {
    const sections = (canWrite: boolean): StudentPageSection[] => [
      { key: 'homework', data: { assignments: [] } },
      { key: 'goals', data: section('s1', { canWrite }) },
    ];
    expect(tilesOf(sections(true)).map((x) => x.screen)).toEqual(['goals', 'newGoal', 'howIsItGoing', 'showMyWork', 'homework']);
    expect(tilesOf(sections(false)).map((x) => x.screen)).toEqual(['goals', 'showMyWork', 'homework']);
    expect(tilesOf([{ key: 'homework', data: { assignments: [] } }]).map((x) => x.screen)).toEqual(['homework']);
    expect(tilesOf([])).toEqual([]);
  });
});

describe('my goals (UX-3, D-151)', () => {
  it.each([
    ['en', en['goals.reviewOn'].replace('{date}', '20 Nov 2026')],
    ['tr', tr['goals.reviewOn'].replace('{date}', '20 Kas 2026')],
  ] as const)('shows the review date as a calendar date in %s', (locale, text) => {
    render(wrap(<MyGoals data={section('sub-en')} subjectId="sub-en" media={media} nav={HOME} go={() => undefined} finish={() => undefined} titleId="t" />, locale));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/2026-11-20/u)).toBeNull();
  });

  it('asks in the page before deleting a goal; No keeps it and gives the focus back', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(wrap(<MyGoals data={section('sub-en', { canWrite: true })} subjectId="sub-en" media={media} nav={HOME} go={() => undefined} finish={() => undefined} titleId="t" />));
    fireEvent.click(screen.getByRole('button', { name: en['student.deleteGoal'] }));
    const box = screen.getByTestId('inline-confirm');
    expect(box.textContent).toContain(en['student.confirm.delete']);
    expect(document.activeElement?.textContent).toBe(en['student.confirm.no']);
    fireEvent.click(screen.getByRole('button', { name: en['student.confirm.no'] }));
    expect(screen.queryByTestId('inline-confirm')).toBeNull();
    expect(document.activeElement?.textContent).toBe(en['student.deleteGoal']);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en['student.deleteGoal'] }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['student.confirm.yes'] }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/api/student/goals/g-sub-en');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

function StarterBox({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <SentenceStarters starters={['I want to get better at ___.', 'Today I learned ___.']} value={value} onChange={setValue} target={ref} />
      <textarea aria-label="box" ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
    </>
  );
}

describe('sentence starters (D-152)', () => {
  it('shows the blank as "…"; a tap fills the empty box and selects the blank', () => {
    render(wrap(<StarterBox />));
    expect(chipText('I want to get better at ___.')).toBe('I want to get better at …');
    fireEvent.click(screen.getByRole('button', { name: 'I want to get better at …' }));
    const box = screen.getByLabelText('box') as HTMLTextAreaElement;
    expect(box.value).toBe('I want to get better at ___.');
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([24, 27]);
    // Still only a starter: another tap replaces it without asking.
    fireEvent.click(screen.getByRole('button', { name: 'Today I learned …' }));
    expect(box.value).toBe('Today I learned ___.');
  });

  it('asks "Replace your words?" before replacing the child’s own words; after No the focus is back on the chip', () => {
    render(wrap(<StarterBox initial="I like foxes." />));
    fireEvent.click(screen.getByRole('button', { name: 'Today I learned …' }));
    expect(screen.getByTestId('inline-confirm').textContent).toContain(en['starters.replace']);
    expect(document.activeElement?.textContent).toBe(en['starters.replaceNo']);
    fireEvent.click(screen.getByRole('button', { name: en['starters.replaceNo'] }));
    expect((screen.getByLabelText('box') as HTMLTextAreaElement).value).toBe('I like foxes.');
    expect(screen.queryByTestId('inline-confirm')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Today I learned …' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today I learned …' }));
    fireEvent.click(screen.getByRole('button', { name: en['starters.replaceYes'] }));
    expect((screen.getByLabelText('box') as HTMLTextAreaElement).value).toBe('Today I learned ___.');
  });

  it('new goal: own words with starters; the hint shows only when Next is pressed, an unfinished starter never reaches the server', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const data = section('sub-en', { canWrite: true });
    render(wrap(<Harness start={{ ...HOME, screen: 'newGoal' }} render={({ nav, go }) => <NewGoal data={data} subjectId="sub-en" media={media} nav={nav} go={go} finish={go} titleId="t" />} />));
    fireEvent.click(screen.getByRole('button', { name: /Reading/u }));
    // No presets in this category: own words straight away, with the goal starters.
    expect(screen.getByTestId('new-goal-own')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I want to get better at …' }));
    expect(screen.queryByText(en['textCheck.STARTER_UNFINISHED'], { exact: false })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['student.next'] }));
    expect(screen.getByText(en['textCheck.STARTER_UNFINISHED'], { exact: false })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    // Only the end blank deleted: still unfinished, and the hint does not talk about a ___ that is gone.
    fireEvent.change(screen.getByLabelText(en['student.myGoalWords']), { target: { value: 'I want to get better at.' } });
    fireEvent.click(screen.getByRole('button', { name: en['student.next'] }));
    expect(screen.getByText(en['starters.addWords'], { exact: false })).toBeTruthy();
    expect(screen.queryByText(en['textCheck.STARTER_UNFINISHED'], { exact: false })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // Typing clears the hint; a finished sentence moves on to the practice ideas.
    fireEvent.change(screen.getByLabelText(en['student.myGoalWords']), { target: { value: 'I want to get better at reading stories.' } });
    expect(screen.queryByText(en['textCheck.STARTER_UNFINISHED'], { exact: false })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['student.next'] }));
    expect(screen.getByRole('heading', { name: en['student.newGoal.practice'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read … at bedtime.' })).toBeTruthy();
    // A real practice idea that is a starter without its middle blank is accepted (S14d review, D-123).
    fireEvent.change(screen.getByLabelText(en['student.newGoal.idea']), { target: { value: 'Read at bedtime' } });
    fireEvent.click(screen.getByRole('button', { name: en['student.newGoal.addIdea'] }));
    expect(screen.getByRole('list', { name: en['student.newGoal.ideas'] }).textContent).toContain('Read at bedtime');
    expect(screen.queryByText(en['starters.addWords'], { exact: false })).toBeNull();
  });
});
