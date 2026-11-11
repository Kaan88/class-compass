// @vitest-environment jsdom
/**
 * S25c (D-187, GRP-3): the Levels tab of the Grouping page with an ordered level list per class+subject.
 * Without a list the level is a text field (as before); with a list it is a picker (No level + the
 * list), a level outside the list is shown and can be changed, the order used says it comes from the
 * list, and "Make a list from the levels used now" starts from today's order and can be reordered with
 * the keyboard. Fictional names only.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupingOverview } from '../../src/shared/contracts/grouping.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { LevelsTab } from '../../src/client/routes/teacher/Grouping.tsx';
import { en } from '../messages.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const student = (id: string, fullName: string, level: string | null) => ({ id, fullName, initials: fullName.slice(0, 2), avatarHue: 10, level });
const overview = (levelList: string[]): GroupingOverview => ({
  contextId: 'ctx',
  canUseNewDefaults: false,
  templates: [],
  rules: [],
  levelList,
  students: [student('s1', 'Ada Deniz', 'Star'), student('s2', 'Bora Ekin', 'starter'), student('s3', 'Cem Fidan', 'Expert'), student('s4', 'Duru Gök', null)],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
function stub(o: GroupingOverview) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (init?.method && init.method !== 'GET' ? json({ labels: [] }) : json(url.includes('/grouping') ? o : {})));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider locale="en">
        <LevelsTab contextId="ctx" />
      </I18nProvider>
    </QueryClientProvider>,
  );
const sent = (fetchMock: ReturnType<typeof stub>, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).includes(path) && (init as RequestInit | undefined)?.method === 'PUT').map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe('Levels tab without a level list', () => {
  it('keeps free-text fields and the order used today', async () => {
    stub(overview([]));
    renderTab();
    const field = await screen.findByLabelText('Level of Ada Deniz');
    expect(field.tagName).toBe('INPUT');
    // Starter is a known word (lowest); the others alphabetically after it.
    expect(screen.getByTestId('level-order').textContent).toBe('Order used, lowest first: starter < Expert < Star');
    expect(screen.getByText(en['grouping.levelList.none'])).toBeTruthy();
  });

  it('"Make a list from the levels used now" starts in today’s order; up / down keep the focus on the moved level', async () => {
    const fetchMock = stub(overview([]));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: en['grouping.levelList.fromUsed'] }));
    const values = () => screen.getAllByTestId('level-list-row').map((r) => (within(r).getByRole('textbox') as HTMLInputElement).value);
    expect(values()).toEqual(['starter', 'Expert', 'Star']);
    // Move "Star" above "Expert": the focus follows it.
    const up = screen.getByRole('button', { name: 'Move level 3 up' });
    up.focus();
    fireEvent.click(up);
    expect(values()).toEqual(['starter', 'Star', 'Expert']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move level 2 up' }));
    // Rename, add a level, and a duplicate disables saving.
    fireEvent.change(screen.getByLabelText('Level 1'), { target: { value: 'Starter' } });
    fireEvent.click(screen.getByRole('button', { name: en['grouping.levelList.add'] }));
    fireEvent.change(screen.getByLabelText('Level 4'), { target: { value: 'STAR' } });
    expect(screen.getByText(en['grouping.levelList.needNames'])).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Level 4'), { target: { value: 'Champion' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['grouping.levelList.saveList'] }));
    });
    expect(sent(fetchMock, '/grouping/level-list')).toEqual([{ labels: ['Starter', 'Star', 'Expert', 'Champion'] }]);
  });
});

describe('Levels tab with a level list (D-187)', () => {
  it('the level is a picker; a level outside the list is shown and can be changed; the order says it comes from the list', async () => {
    const fetchMock = stub(overview(['Starter', 'Growing', 'Strong', 'Star']));
    renderTab();
    const ada = (await screen.findByLabelText('Level of Ada Deniz')) as HTMLSelectElement;
    expect(ada.tagName).toBe('SELECT');
    expect([...ada.options].map((o) => o.text)).toEqual(['No level', 'Starter', 'Growing', 'Strong', 'Star']);
    expect(ada.value).toBe('Star');
    // "starter" matches the list entry (case ignored).
    expect((screen.getByLabelText('Level of Bora Ekin') as HTMLSelectElement).value).toBe('Starter');
    const cem = screen.getByLabelText('Level of Cem Fidan') as HTMLSelectElement;
    expect(cem.value).toBe('Expert');
    expect([...cem.options].map((o) => o.text)).toContain('Expert (not in the list)');
    expect((screen.getByLabelText('Level of Duru Gök') as HTMLSelectElement).value).toBe('');
    const order = screen.getByTestId('level-order').textContent;
    expect(order).toContain('Order used, lowest first (your level list): Starter < Growing < Strong < Star');
    expect(order).toContain('Then the levels that are not in the list: Expert');
    // Pick a level and save.
    fireEvent.change(screen.getByLabelText('Level of Duru Gök'), { target: { value: 'Growing' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['common.save'] }));
    });
    expect(sent(fetchMock, '/levels')).toEqual([{ levels: [{ studentId: 's4', level: 'Growing' }] }]);
    // Map the level that is not in the list.
    const panel = screen.getByTestId('levels-not-in-list');
    expect(within(panel).getByText('Expert: 1 student')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Change Expert to'), { target: { value: 'Star' } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Change Expert' }));
    });
    expect(sent(fetchMock, '/levels').at(-1)).toEqual({ levels: [{ studentId: 's3', level: 'Star' }] });
  });

  it('review fix: the student’s own level outside the list can be picked again after a slip, and nothing is sent', async () => {
    const fetchMock = stub(overview(['Starter', 'Growing', 'Strong', 'Star']));
    renderTab();
    const cem = (await screen.findByLabelText('Level of Cem Fidan')) as HTMLSelectElement;
    fireEvent.change(cem, { target: { value: 'Star' } });
    expect(cem.value).toBe('Star');
    expect([...cem.options].map((o) => o.text)).toContain('Expert (not in the list)');
    fireEvent.change(cem, { target: { value: 'Expert' } });
    expect(cem.value).toBe('Expert');
    expect((screen.getByRole('button', { name: en['common.save'] }) as HTMLButtonElement).disabled).toBe(true);
    expect(sent(fetchMock, '/levels')).toEqual([]);
  });

  it('review fix: spellings of one level ("Expert" / "expert") are one row that counts each student once', async () => {
    const o = overview(['Starter', 'Star']);
    o.students.push(student('s5', 'Eda Hun', 'expert'));
    const fetchMock = stub(o);
    renderTab();
    const panel = await screen.findByTestId('levels-not-in-list');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1);
    expect(within(panel).getByText('Expert / expert: 2 students')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Change Expert / expert to'), { target: { value: 'Star' } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole('button', { name: 'Change Expert / expert' }));
    });
    expect(sent(fetchMock, '/levels')).toEqual([{ levels: [{ studentId: 's3', level: 'Star' }, { studentId: 's5', level: 'Star' }] }]);
  });
});

describe('"Make a list from the levels used now" (review fixes)', () => {
  it('keeps one spelling per level, so the new list can be saved', async () => {
    const o = overview([]);
    o.students.push(student('s5', 'Eda Hun', 'expert'));
    stub(o);
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: en['grouping.levelList.fromUsed'] }));
    const values = screen.getAllByTestId('level-list-row').map((r) => (within(r).getByRole('textbox') as HTMLInputElement).value);
    expect(values).toEqual(['starter', 'Expert', 'Star']);
    expect(screen.queryByText(en['grouping.levelList.needNames'])).toBeNull();
    expect(screen.queryByTestId('level-list-cut')).toBeNull();
  });

  it('says so when more levels are used than a list holds (20)', async () => {
    const o = overview([]);
    o.students = Array.from({ length: 23 }, (_, i) => student(`s${i}`, `Kid ${i}`, `L${String(i).padStart(2, '0')}`));
    stub(o);
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: en['grouping.levelList.fromUsed'] }));
    expect(screen.getAllByTestId('level-list-row')).toHaveLength(20);
    expect(screen.getByTestId('level-list-cut').textContent).toBe(
      'A list holds at most 20 levels, so only the first 20 levels used now were added. The other 3 stay outside the list and come after it.',
    );
    // Starting again from an empty list clears the note.
    fireEvent.click(screen.getByRole('button', { name: en['common.cancel'] }));
    fireEvent.click(screen.getByRole('button', { name: en['grouping.levelList.startEmpty'] }));
    expect(screen.queryByTestId('level-list-cut')).toBeNull();
  });
});
