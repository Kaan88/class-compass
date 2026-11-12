// @vitest-environment jsdom
/**
 * S27b (D-194, GOL-4, STU-2): "Add my work" on each goal in My goals opens the shared evidence steps
 * for that goal (1 how → 2 the work; no "which goal" step), sends the evidence linked to the goal,
 * then goes back to the goal list with a calm note at that goal; each goal lists its own work. Only
 * while the child may write, never on an archived goal; a stale address goes back to the list.
 * Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GOAL_OUTCOMES, type Evidence, type Goal, type StudentGoalsSection } from '../../src/shared/contracts/goals.ts';
import { en, tr } from '../messages.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { HOME, type NavApi, type StudentNav } from '../../src/client/student/nav.ts';
import { ADD_WORK_FIRST_STEP, MyGoals } from '../../src/client/student/screens/MyGoals.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <I18nProvider locale="en">{node}</I18nProvider>
  </QueryClientProvider>
);

const goal = (id: string, text: string, over: Partial<Goal> = {}): Goal => ({
  id,
  subjectId: 'sub-en',
  category: { id: 'c1', name: { en: 'Reading', tr: 'Okuma' }, nameAtCreation: { en: 'Reading', tr: 'Okuma' } },
  authorType: 'student',
  presetId: null,
  presetText: null,
  text,
  practiceChoices: [],
  reviewOn: '2026-11-20',
  status: 'active',
  createdAt: Date.UTC(2026, 10, 9),
  updatedAt: Date.UTC(2026, 10, 9),
  entries: [],
  assessments: [],
  ...over,
});
const evidence = (id: string, goalId: string | null, body: string): Evidence => ({
  id,
  goalId,
  kind: 'text',
  body,
  url: null,
  file: null,
  authorType: 'student',
  createdAt: Date.UTC(2026, 10, 10),
  updatedAt: Date.UTC(2026, 10, 10),
});
const READ = 'I will read a fictional story every week.';
const SPELL = 'I will learn five new spelling words.';
const OLD = 'I will practise my times tables.';
const section = (over: Partial<StudentGoalsSection> = {}): StudentGoalsSection => ({
  goals: [goal('g-read', READ), goal('g-spell', SPELL), goal('g-old', OLD, { status: 'archived' })],
  evidence: [],
  feedback: [],
  categories: [{ id: 'c1', name: { en: 'Reading', tr: 'Okuma' }, icon: 'book', subjectId: null, custom: false, archived: false, schoolArchived: false }],
  presets: [],
  outcomes: DEFAULT_GOAL_OUTCOMES,
  canWrite: true,
  textLimits: { minGoalWords: 3, minGoalLetters: 12 },
  starters: [],
  ...over,
});
const media = { photos: true, audio: false, documents: true, video: false };

/** My goals with the page navigation in memory; `finish` goes to its target like the real page. */
function Harness({ data, start, onGo }: { data: StudentGoalsSection; start: StudentNav; onGo?: (n: StudentNav, replace: boolean) => void }) {
  const [nav, setNav] = useState(start);
  const go: NavApi['go'] = (next, opts) => {
    const n = { subject: null, goal: null, step: 1, ...next };
    onGo?.(n, Boolean(opts?.replace));
    setNav(n);
  };
  const finish: NavApi['finish'] = (next) => setNav({ subject: null, goal: null, step: 1, ...next });
  return (
    <div data-nav={`${nav.goal ?? '-'}:${nav.step}`}>
      <MyGoals data={data} subjectId="sub-en" media={media} nav={nav} go={go} finish={finish} titleId="t" />
    </div>
  );
}

describe('add my work from My goals (S27b, D-194)', () => {
  it('offers "Add my work" on each goal the child can still work on, named with the goal', () => {
    render(wrap(<Harness data={section()} start={{ ...HOME, screen: 'goals', subject: 'sub-en' }} />));
    expect(screen.getByRole('button', { name: `Add my work: ${READ}` }).textContent).toContain(en['student.goals.addWork']);
    expect(screen.getByRole('button', { name: `Add my work: ${SPELL}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Add my work: ${OLD}` })).toBeNull();
  });

  it('shows no "Add my work" on a read-only page', () => {
    render(wrap(<Harness data={section({ canWrite: false })} start={{ ...HOME, screen: 'goals', subject: 'sub-en' }} />));
    expect(screen.queryByRole('button', { name: /^Add my work/u })).toBeNull();
  });

  it('lists each goal\'s own work under that goal only', () => {
    const data = section({ evidence: [evidence('e1', 'g-read', 'My reading log page'), evidence('e2', null, 'A poster for all my learning')] });
    render(wrap(<Harness data={data} start={{ ...HOME, screen: 'goals', subject: 'sub-en' }} />));
    const lists = screen.getAllByTestId('student-goal-work');
    expect(lists).toHaveLength(1);
    expect(lists[0]!.getAttribute('aria-label')).toBe(en['student.goals.work']);
    expect(lists[0]!.closest('[data-testid="student-goal"]')?.textContent).toContain(READ);
    expect(lists[0]!.textContent).toContain('My reading log page');
    expect(screen.queryByText('A poster for all my learning')).toBeNull();
  });

  it('opens the evidence steps for that goal, saves the work linked to it and comes back to the goal with a calm note', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(evidence('e9', 'g-spell', 'x')), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const moves: StudentNav[] = [];
    const { container } = render(wrap(<Harness data={section()} start={{ ...HOME, screen: 'goals', subject: 'sub-en' }} onGo={(n) => moves.push(n)} />));
    fireEvent.click(screen.getByRole('button', { name: `Add my work: ${SPELL}` }));
    expect(moves.at(-1)).toMatchObject({ screen: 'goals', subject: 'sub-en', goal: 'g-spell', step: ADD_WORK_FIRST_STEP });

    // Step 1 of 2: how, with the goal named; every way the media flags allow (the same EvidenceAdder).
    const form = screen.getByTestId('evidence-form');
    expect(form.getAttribute('data-step')).toBe('how');
    expect(form.textContent).toContain(en['student.step'].replace('{n}', '1').replace('{total}', '2'));
    expect(screen.getByTestId('evidence-for-goal').textContent).toBe(`Goal: ${SPELL}`);
    expect(screen.getByRole('button', { name: en['evidence.mode.picture'] })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['evidence.mode.voice'] })).toBeNull();
    expect(screen.queryByTestId('student-goals')).toBeNull();

    // Step 2 of 2: the work (no "which goal" step).
    fireEvent.click(screen.getByRole('button', { name: en['evidence.mode.text'] }));
    expect(container.querySelector('[data-nav]')?.getAttribute('data-nav')).toBe(`g-spell:${ADD_WORK_FIRST_STEP + 1}`);
    expect(screen.getByTestId('evidence-form').getAttribute('data-step')).toBe('work');
    expect(screen.queryByText(en['student.work.which'])).toBeNull();
    expect(screen.getByTestId('evidence-for-goal').textContent).toBe(`Goal: ${SPELL}`);
    fireEvent.change(screen.getByLabelText(en['student.work.words']), { target: { value: 'I wrote my five new words in a fictional story.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['student.work.save'] }));
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/student/evidence');
    expect(JSON.parse(String(init.body))).toMatchObject({ subjectId: 'sub-en', goalId: 'g-spell', kind: 'text', body: 'I wrote my five new words in a fictional story.' });
    // Back at the list (the steps' entries left behind), with the note at that goal.
    expect(container.querySelector('[data-nav]')?.getAttribute('data-nav')).toBe('-:1');
    const note = screen.getByRole('status');
    expect(note.textContent).toBe(en['student.goals.workAdded']);
    expect(note.closest('[data-testid="student-goal"]')?.textContent).toContain(SPELL);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`Add my work: ${SPELL}`);
  });

  it('goes back to the list when the address names a goal that can no longer take work', () => {
    const moves: Array<[StudentNav, boolean]> = [];
    render(wrap(<Harness data={section()} start={{ screen: 'goals', subject: 'sub-en', goal: 'g-old', step: 3 }} onGo={(n, replace) => moves.push([n, replace])} />));
    expect(moves).toEqual([[{ screen: 'goals', subject: 'sub-en', goal: null, step: 1 }, true]]);
    expect(screen.getByTestId('student-goals')).toBeTruthy();
  });

  it('a goal id that is not one of the child’s own goals goes back to the list and never opens the evidence steps', () => {
    const moves: Array<[StudentNav, boolean]> = [];
    render(wrap(<Harness data={section()} start={{ screen: 'goals', subject: 'sub-en', goal: 'g-not-mine', step: 3 }} onGo={(n, replace) => moves.push([n, replace])} />));
    expect(moves).toEqual([[{ screen: 'goals', subject: 'sub-en', goal: null, step: 1 }, true]]);
    expect(screen.queryByTestId('evidence-form')).toBeNull();
    expect(screen.queryByTestId('student-goal-add-work')).toBeNull();
    expect(screen.getByTestId('student-goals')).toBeTruthy();
  });

  it('deleting work on the goal takes the "saved" note away (no note that contradicts the deleted work)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(evidence('e9', 'g-spell', 'x')), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const data = section({ evidence: [evidence('e1', 'g-spell', 'My spelling list')] });
    render(wrap(<Harness data={data} start={{ ...HOME, screen: 'goals', subject: 'sub-en' }} />));
    fireEvent.click(screen.getByRole('button', { name: `Add my work: ${SPELL}` }));
    fireEvent.click(screen.getByRole('button', { name: en['evidence.mode.text'] }));
    fireEvent.change(screen.getByLabelText(en['student.work.words']), { target: { value: 'I wrote my five new words in a fictional story.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['student.work.save'] }));
    });
    expect(screen.getByRole('status').textContent).toBe(en['student.goals.workAdded']);

    const work = screen.getByTestId('student-goal-work');
    fireEvent.click(within(work).getByRole('button', { name: en['student.delete'] }));
    await act(async () => {
      fireEvent.click(within(work).getByRole('button', { name: en['student.confirm.yes'] }));
    });
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(url).toContain('/api/student/evidence/e1');
    expect(init.method).toBe('DELETE');
    expect(screen.queryByText(en['student.goals.workAdded'])).toBeNull();
  });

  it('has natural Turkish words for the new labels', () => {
    expect(tr['student.goals.addWork']).toBe('Çalışmamı ekle');
    expect(tr['student.goals.addWorkFor']).toContain('{goal}');
    expect(tr['student.goals.workAdded']).not.toBe(en['student.goals.workAdded']);
  });
});
