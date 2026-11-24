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
import { Suspense, useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GOAL_OUTCOMES, type Goal, type StudentGoalsSection, type StudentPageSection } from '../../src/shared/contracts/goals.ts';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { en, tr } from '../messages.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { HOME, navHref, navSearch, readNav, type NavApi, type StudentNav } from '../../src/client/student/nav.ts';
import { chipText, SentenceStarters } from '../../src/client/student/SentenceStarters.tsx';
import { preloadWritingScreens, tilesOf } from '../../src/client/student/sections.tsx';
import { MyGoals } from '../../src/client/student/screens/MyGoals.tsx';
import { NewGoal } from '../../src/client/student/screens/NewGoal.tsx';
import { openLink, StudentApp, type OpenResult } from '../../src/client/student/StudentApp.tsx';
import { queueSeen, SEEN_RETRY_MS } from '../../src/client/student/AchievementsSection.tsx';
import { CELEBRATION_MS } from '../../src/client/themes/Celebration.tsx';
import { sounds, themeOf } from '../../src/client/themes/index.tsx';
import { getDisplay, setDisplay } from '../../src/client/lib/display.ts';
import { DEFAULT_THEME } from '../../src/shared/themes.ts';
import { generatedAvatar } from '../../src/shared/avatarDefaults.ts';

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
const media = { photos: false, audio: false, documents: true, video: false };

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

describe('lazy writing screens (S26c, D-191)', () => {
  it('a writing screen opened after the preload renders at once, without a "Loading…" fallback', async () => {
    await preloadWritingScreens();
    const tiles = tilesOf([{ key: 'goals', data: section('sub-en', { canWrite: true }) }]);
    for (const screenKey of ['newGoal', 'howIsItGoing', 'showMyWork'] as const) {
      const tile = tiles.find((x) => x.screen === screenKey)!;
      // act() without awaiting: whatever is on screen right after the synchronous render.
      act(() => {
        render(
          wrap(
            <Suspense fallback={<p data-testid="fallback">{en['common.loading']}</p>}>
              <div data-testid="screen">{tile.render({ subjectId: 'sub-en', media, nav: { ...HOME, screen: screenKey }, go: () => undefined, finish: () => undefined, titleId: 't' })}</div>
            </Suspense>,
          ),
        );
      });
      expect(screen.queryByTestId('fallback'), screenKey).toBeNull();
      expect(screen.getByTestId('screen').textContent, screenKey).not.toBe('');
      cleanup();
    }
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

describe('new achievement celebration in the class language (D-099, D-122)', () => {
  // `celebrated` in AchievementsSection.tsx is module-level on purpose (one visit = one page load), so an
  // award celebrated by one test is never celebrated again in this file: every test takes fresh ids.
  let next = 0;
  const badge = (name = { en: 'Kind helper', tr: 'Nazik yardımcı' }) => ({
    id: `badge-${++next}`,
    awardId: `award-${next}`,
    name,
    description: { en: 'Helped a classmate', tr: 'Bir arkadaşına yardım etti' },
    icon: 'star',
    tier: 'none',
    category: 'teacher',
    awardedAt: Date.UTC(2026, 10, 20),
    by: null,
    isNew: true,
  });
  type Language = { mainLanguage: 'en' | 'tr'; secondLanguageEnabled: boolean };
  const page = (language: Language, earned: unknown[] = [badge()], theme = 'default') => ({
    student: { fullName: 'Deniz Örnek', initials: 'DÖ', avatarHue: 120 },
    className: '3-Demo',
    theme,
    language,
    media: { photos: false, audio: false, documents: false, video: false },
    subjects: [{ subjectId: 'subject-1', name: { en: 'English', tr: 'İngilizce' }, sections: [{ key: 'achievements', data: { earned, locked: [], level: null } }] }],
    avatar: {
      spec: null,
      generated: generatedAvatar('student-1'),
      locked: false,
      fallback: 'initials',
      earned: [],
      picture: { state: 'off', approvedUrl: null, pending: null, refused: null },
    },
    textLimits: { minGoalWords: 1, minGoalLetters: 1 },
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  /** Serves the pages in turn (the last one again and again) and the "seen" answers in turn (then ok). */
  const serve = (pages: unknown[], seen: Array<() => Response | Promise<Response>> = []) =>
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/student/page')) return json(pages.length > 1 ? pages.shift() : pages[0]);
      return (seen.shift() ?? (() => json({ ok: true })))();
    });
  const seenRequests = (f: ReturnType<typeof serve>) => (f.mock.calls as unknown as Array<[string, RequestInit?]>).filter(([u]) => String(u).includes('/achievements/seen'));
  const seenCalls = (f: ReturnType<typeof serve>) => seenRequests(f).length;
  /** The award ids each "seen" request named, in order. */
  const seenBodies = (f: ReturnType<typeof serve>) => seenRequests(f).map(([, init]) => (JSON.parse(String(init?.body)) as { awardIds: string[] }).awardIds);
  const pageCalls = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([u]) => String(u).includes('/api/student/page')).length;
  const newBadge = (locale: Locale, name: string) => (locale === 'tr' ? tr : en)['achievements.newBadge'].replace('{name}', name);
  /** Like the student page: the StudentApp in its own QueryClient (returned for refetches). */
  const renderPage = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <StudentApp token={null} />
      </QueryClientProvider>,
    );
    return qc;
  };
  const english = { mainLanguage: 'en', secondLanguageEnabled: false } as const;

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('a Turkish-only class celebrates in Turkish even when this device last showed English', async () => {
    localStorage.clear(); // a fresh device: the saved student locale is English
    const fetch = serve([page({ mainLanguage: 'tr', secondLanguageEnabled: false })]);
    vi.stubGlobal('fetch', fetch);
    renderPage();
    const shown = await screen.findByTestId('celebration');
    expect(shown.textContent).toContain(newBadge('tr', 'Nazik yardımcı'));
    expect(shown.textContent).not.toContain('New achievement');
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(1));
  });

  it('a class with two languages celebrates at once in the language this device saved (Turkish)', async () => {
    localStorage.setItem('cc.studentLocale', 'tr');
    const fetch = serve([page({ mainLanguage: 'en', secondLanguageEnabled: true })]);
    vi.stubGlobal('fetch', fetch);
    renderPage();
    const shown = await screen.findByTestId('celebration');
    expect(shown.textContent).toContain(newBadge('tr', 'Nazik yardımcı'));
    expect(document.documentElement.lang).toBe('tr');
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(1));
  });

  it('an English-only class waits for English when this device saved Turkish', async () => {
    localStorage.setItem('cc.studentLocale', 'tr');
    const fetch = serve([page(english)]);
    vi.stubGlobal('fetch', fetch);
    renderPage();
    const shown = await screen.findByTestId('celebration');
    expect(shown.textContent).toContain(newBadge('en', 'Kind helper'));
    expect(shown.textContent).not.toContain('Nazik yardımcı');
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(1));
  });

  it('a badge that arrives on a later refetch is celebrated and reported as seen too, each badge once', async () => {
    const first = badge();
    const later = badge({ en: 'Brave reader', tr: 'Cesur okur' });
    const old = (b: typeof first) => ({ ...b, isNew: false });
    // The first page brings one new badge; the refetch after "seen" has none; a later refetch brings another.
    const fetch = serve([page(english, [first]), page(english, [old(first)]), page(english, [later, old(first)]), page(english, [old(later), old(first)])]);
    vi.stubGlobal('fetch', fetch);
    const qc = renderPage();
    expect((await screen.findByTestId('celebration')).textContent).toContain(newBadge('en', 'Kind helper'));
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(1));
    await vi.waitFor(() => expect(fetch.mock.calls.length).toBe(3)); // page, seen, page again
    await act(() => qc.invalidateQueries());
    await vi.waitFor(() => expect(screen.getByTestId('celebration').textContent).toContain(newBadge('en', 'Brave reader')));
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(2));
    // The page after the second report has nothing new: wait for it and a while after it, then no third report.
    await vi.waitFor(() => expect(pageCalls(fetch)).toBe(4));
    await act(() => qc.invalidateQueries());
    await vi.waitFor(() => expect(pageCalls(fetch)).toBe(5));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(seenBodies(fetch)).toEqual([[first.awardId], [later.awardId]]);
  });

  it('a failed "seen" report is tried again (no unhandled rejection, no second celebration); a refused one is given up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A busy server, then no connection, then success.
    const fetch = serve([page(english)], [() => json({ error: { code: 'RATE_LIMITED', message: 'x' } }, 429), () => Promise.reject(new TypeError('Failed to fetch'))]);
    vi.stubGlobal('fetch', fetch);
    renderPage();
    await screen.findByTestId('celebration');
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(SEEN_RETRY_MS[0]));
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(SEEN_RETRY_MS[1]));
    await vi.waitFor(() => expect(seenCalls(fetch)).toBe(3));
    // Success refetches the page (this server still says "new"): not celebrated again this visit, no more reports.
    await act(() => vi.advanceTimersByTimeAsync(CELEBRATION_MS + 100));
    expect(screen.queryByTestId('celebration')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(SEEN_RETRY_MS[2] * 2));
    expect(screen.queryByTestId('celebration')).toBeNull();
    expect(seenCalls(fetch)).toBe(3);
    cleanup();

    // A refused request (the link was revoked) is not retried.
    const refused = serve([page(english)], [() => json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401)]);
    vi.stubGlobal('fetch', refused);
    renderPage();
    await screen.findByTestId('celebration');
    await vi.waitFor(() => expect(seenCalls(refused)).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(SEEN_RETRY_MS.reduce((a, x) => a + x, 0) + 1000));
    expect(seenCalls(refused)).toBe(1);
  });

  it('the sounds use the class theme the overlay shows, also when the page is ready at once', async () => {
    const fetch = serve([page(english, [badge()], 'animals')]);
    vi.stubGlobal('fetch', fetch);
    const play = vi.spyOn(sounds, 'play').mockReturnValue(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      await screen.findByTestId('celebration');
      await act(() => vi.advanceTimersByTimeAsync(1000));
      const animals = themeOf('animals').sounds!;
      expect(animals.fanfare).not.toEqual(themeOf(DEFAULT_THEME).sounds!.fanfare);
      expect(play.mock.calls.map(([sound, , event]) => [event, sound])).toEqual([
        ['fanfare', animals.fanfare],
        ['clapping', animals.clapping],
        ['fireworks', animals.fireworks],
      ]);
      expect(getDisplay().theme).toBe('animals');
      await vi.waitFor(() => expect(seenCalls(fetch)).toBe(1));
    } finally {
      play.mockRestore();
      setDisplay({ theme: DEFAULT_THEME });
    }
  });
});

describe('the "seen" queue: one request at a time, one retry chain (D-122)', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const busy = () => json({ error: { code: 'INTERNAL', message: 'x' } }, 503);
  /** Each "seen" request waits for the test to answer it; returns the requests' award ids and the answer hooks. */
  const manual = () => {
    const bodies: string[][] = [];
    const answers: Array<(r: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push((JSON.parse(String(init?.body)) as { awardIds: string[] }).awardIds);
        return new Promise<Response>((resolve) => answers.push(resolve));
      }),
    );
    const answer = async (r: Response) => {
      answers.shift()!(r);
      await vi.advanceTimersByTimeAsync(0);
    };
    return { bodies, answer };
  };
  let n = 0;
  const id = () => `queue-award-${++n}`;

  afterEach(() => void vi.useRealTimers());

  it('a badge celebrated while a retry waits joins that retry: no second chain, the backoff is kept, three retries in all', async () => {
    vi.useFakeTimers();
    const { bodies, answer } = manual();
    const [a, b] = [id(), id()];
    const seen = vi.fn();
    queueSeen([a], seen);
    expect(bodies).toEqual([[a]]);
    await answer(json({ error: { code: 'RATE_LIMITED', message: 'x' } }, 429));
    // During the wait: queued, but no request of its own and the wait is not cut short.
    queueSeen([b], seen);
    await vi.advanceTimersByTimeAsync(SEEN_RETRY_MS[0] - 1);
    expect(bodies).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bodies).toEqual([[a], [a, b]]);
    await answer(busy());
    await vi.advanceTimersByTimeAsync(SEEN_RETRY_MS[1]);
    await answer(busy());
    await vi.advanceTimersByTimeAsync(SEEN_RETRY_MS[2]);
    expect(bodies).toHaveLength(4);
    await answer(busy()); // the last try: given up
    await vi.advanceTimersByTimeAsync(120_000);
    expect(bodies).toHaveLength(4);
    expect(seen).not.toHaveBeenCalled();
    // The next celebration reports at once with a fresh count, only its own badge.
    const c = id();
    queueSeen([c], seen);
    expect(bodies[4]).toEqual([c]);
    await answer(json({ ok: true }));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a badge added during the last failing request is sent after the give-up; one added during a successful request after it', async () => {
    vi.useFakeTimers();
    const { bodies, answer } = manual();
    const [a, b, c] = [id(), id(), id()];
    const seen = vi.fn();
    queueSeen([a], seen);
    await answer(busy());
    for (const wait of SEEN_RETRY_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      if (wait !== SEEN_RETRY_MS[2]) await answer(busy());
    }
    expect(bodies).toEqual([[a], [a], [a], [a]]);
    queueSeen([b], seen); // while the last try runs
    expect(bodies).toHaveLength(4);
    await answer(busy());
    expect(bodies[4]).toEqual([b]);
    queueSeen([c], seen); // while that one runs
    await answer(json({ ok: true }));
    expect(bodies[5]).toEqual([c]);
    await answer(json({ ok: true }));
    expect(seen).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(bodies).toHaveLength(6);
  });

  it('a refused request is given up at once, and the queue keeps working', async () => {
    vi.useFakeTimers();
    const { bodies, answer } = manual();
    const [a, b] = [id(), id()];
    queueSeen([a], () => undefined);
    await answer(json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(bodies).toEqual([[a]]);
    queueSeen([b], () => undefined);
    await answer(json({ ok: true }));
    expect(bodies).toEqual([[a], [b]]);
  });
});
