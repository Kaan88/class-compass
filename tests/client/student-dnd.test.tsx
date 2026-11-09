// @vitest-environment jsdom
/**
 * S14c (D-150): the shared student drag-and-drop lists (`ui/StudentDnd.tsx`) used by the teacher's
 * group editor and the classroom group screen (GRP-3, GRP-5, UX-8). The tap path (tap a name, then
 * "Move here"), the keyboard drag (Enter, Tab to a list, Enter) and the react-aria strings in the
 * class or teacher language. Fictional names only.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { UNPLACED } from '../../src/shared/contracts/grouping.ts';
import type { Locale } from '../../src/shared/i18n/index.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { StudentDnd, StudentDropList } from '../../src/client/ui/StudentDnd.tsx';

afterEach(cleanup);

const NAMES: Record<string, string> = { s1: 'Ayşe Nur Kaya', s2: 'Çınar Öztürk', s3: 'Oliver Smith' };

function Harness({ locale = 'en', moves }: { locale?: Locale; moves: Array<[string, string]> }) {
  const [lists, setLists] = useState<Record<string, string[]>>({ g1: ['s1', 's2'], g2: ['s3'], [UNPLACED]: [] });
  const [picked, setPicked] = useState<string | null>(null);
  const onMove = (studentId: string, to: string) => {
    moves.push([studentId, to]);
    setPicked(null);
    setLists((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, k === to ? [...v.filter((x) => x !== studentId), studentId] : v.filter((x) => x !== studentId)])));
  };
  const names = { g1: 'Group 1', g2: 'Group 2', [UNPLACED]: 'Not in a group' } as Record<string, string>;
  return (
    <I18nProvider locale={locale}>
      <p data-testid="picked">{picked ?? ''}</p>
      <StudentDnd picked={picked} onPick={setPicked} onMove={onMove}>
        {Object.keys(lists).map((id) => (
          <StudentDropList
            key={id}
            id={id}
            name={names[id]!}
            students={lists[id]!.map((s) => ({ id: s, name: NAMES[s]! }))}
            renderStudent={(s) => <span>{s.name}</span>}
            itemTestId="member"
            testId={`list-${id}`}
          />
        ))}
      </StudentDnd>
    </I18nProvider>
  );
}

/** Lets react-aria's drag session start (it waits for an animation frame) outside RTL's polling. */
const frames = () => act(() => new Promise<void>((r) => setTimeout(r, 60)));
const list = (id: string) => within(screen.getByTestId(`list-${id}`));
const row = (name: string) => screen.getByRole('row', { name });

describe('StudentDnd tap path (S14c, D-150, UX-8)', () => {
  it('a tap picks a name, "Move here" appears on every other list, and moving clears the pick', () => {
    const moves: Array<[string, string]> = [];
    render(<Harness moves={moves} />);
    expect(screen.getAllByRole('grid')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Move here/ })).toBeNull();
    // The empty "Not in a group" list says it takes drops.
    expect(list(UNPLACED).getByText('No one here yet.')).toBeTruthy();

    fireEvent.click(row(NAMES.s1!));
    expect(row(NAMES.s1!).hasAttribute('data-picked')).toBe(true);
    expect(screen.getByTestId('picked').textContent).toBe('s1');
    // Not on its own list, on the two others.
    expect(list('g1').queryByRole('button', { name: /^Move here/ })).toBeNull();
    expect(list('g2').getByRole('button', { name: 'Move here: Group 2' })).toBeTruthy();
    expect(list(UNPLACED).getByRole('button', { name: 'Move here: Not in a group' })).toBeTruthy();

    // A second tap on the same name puts it back.
    fireEvent.click(row(NAMES.s1!));
    expect(screen.getByTestId('picked').textContent).toBe('');
    expect(screen.queryByRole('button', { name: /^Move here/ })).toBeNull();

    // Picking another name moves the pick (one picked name across all lists).
    fireEvent.click(row(NAMES.s1!));
    fireEvent.click(row(NAMES.s3!));
    expect(screen.getByTestId('picked').textContent).toBe('s3');
    expect(row(NAMES.s1!).hasAttribute('data-picked')).toBe(false);
    expect(list('g1').getByRole('button', { name: 'Move here: Group 1' })).toBeTruthy();

    fireEvent.click(list(UNPLACED).getByRole('button', { name: 'Move here: Not in a group' }));
    expect(moves).toEqual([['s3', UNPLACED]]);
    expect(list(UNPLACED).getByRole('row', { name: NAMES.s3 })).toBeTruthy();
    expect(screen.getByTestId('picked').textContent).toBe('');
    // Group 2 is empty now and still a drop target.
    expect(list('g2').getByText('No one here yet.')).toBeTruthy();
  });

  it('Enter on a name picks it from the keyboard, then "Move here" works like a tap', () => {
    const moves: Array<[string, string]> = [];
    render(<Harness moves={moves} />);
    const r = row(NAMES.s3!);
    act(() => r.focus());
    fireEvent.keyDown(r, { key: 'Enter' });
    fireEvent.keyUp(r, { key: 'Enter' });
    expect(screen.getByTestId('picked').textContent).toBe('s3');
    expect(row(NAMES.s3!).hasAttribute('data-picked')).toBe(true);
    fireEvent.click(list('g1').getByRole('button', { name: 'Move here: Group 1' }));
    expect(moves).toEqual([['s3', 'g1']]);
  });

  it('rows carry the test id and student id the e2e specs use', () => {
    render(<Harness moves={[]} />);
    const rows = screen.getAllByTestId('member');
    expect(rows.map((r) => r.getAttribute('data-student-id'))).toEqual(['s1', 's2', 's3']);
  });
});

describe('StudentDnd keyboard drag and drop (S14c, D-150)', () => {
  it('Enter on the drag handle of a name starts a drag, Tab goes to another list, Enter drops there', async () => {
    const moves: Array<[string, string]> = [];
    render(<Harness moves={moves} />);
    const source = screen.getByRole('button', { name: `Drag ${NAMES.s2}` });
    act(() => source.focus());
    fireEvent.keyDown(source, { key: 'Enter' });
    fireEvent.keyUp(source, { key: 'Enter' });
    await frames();
    // The drag session starts on the next animation frame and moves to the first valid list.
    await waitFor(() => expect(document.activeElement?.closest('[data-testid="list-g2"]')).toBeTruthy());
    // Tab: the next list ("Not in a group"); its own list is never a target.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    await waitFor(() => expect(document.activeElement?.closest(`[data-testid="list-${UNPLACED}"]`)).toBeTruthy());
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    fireEvent.keyUp(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(moves).toEqual([['s2', UNPLACED]]));
    expect(list(UNPLACED).getByRole('row', { name: NAMES.s2 })).toBeTruthy();
    // react-aria selects what a drop inserts; picking is not selection here, so nothing is picked.
    await frames();
    expect(screen.getByTestId('picked').textContent).toBe('');
    expect(list(UNPLACED).getByRole('row', { name: NAMES.s2 }).hasAttribute('data-picked')).toBe(false);
  });

  it('Escape cancels a keyboard drag without a move', async () => {
    const moves: Array<[string, string]> = [];
    render(<Harness moves={moves} />);
    const source = screen.getByRole('button', { name: `Drag ${NAMES.s1}` });
    act(() => source.focus());
    fireEvent.keyDown(source, { key: 'Enter' });
    fireEvent.keyUp(source, { key: 'Enter' });
    await frames();
    await waitFor(() => expect(document.activeElement?.closest('[data-testid="list-g2"]')).toBeTruthy());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(source));
    expect(moves).toEqual([]);
  });
});

describe('StudentDnd language (S14c, D-099)', () => {
  it.each([
    ['en', `Drag ${NAMES.s1}`, 'Move here: Group 2'],
    ['tr', `${NAMES.s1}’i sürükle`, 'Buraya taşı: Group 2'],
  ] as const)('speaks %s: the react-aria drag handle and our own labels', (locale, handle, moveHere) => {
    render(<Harness locale={locale} moves={[]} />);
    expect(screen.getByRole('button', { name: handle })).toBeTruthy();
    fireEvent.click(row(NAMES.s1!));
    expect(screen.getByRole('button', { name: moveHere })).toBeTruthy();
  });
});
