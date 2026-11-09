// @vitest-environment jsdom
/**
 * Sentence starters in the teacher's Goals library and in Admin → Modules (S14d, D-152, D-116):
 * grouped by where students see them, default / own marks, hide for my classes, "Archived by the
 * school" without a restore button, a new starter for a kind and a category; the admin list archives
 * and restores. Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, Starter } from '../../src/shared/contracts/goals.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { AdminStarters, TeacherStarters } from '../../src/client/modules/goals/StartersLibrary.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: ReactNode) => <I18nProvider locale="en">{node}</I18nProvider>;
const starter = (id: string, over: Partial<Starter>): Starter => ({ id, kind: 'goal', categoryId: null, text: { en: 'I will ___.' }, custom: false, archived: false, schoolArchived: false, ...over });
const reading: Category = { id: 'c1', name: { en: 'Reading', tr: 'Okuma' }, icon: 'book', subjectId: null, custom: false, archived: false, schoolArchived: false };

describe('teacher starters (D-152)', () => {
  it('groups starters by kind, marks defaults and own ones, and archives through the API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(starter('d1', { archived: true })), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const run = vi.fn((fn: () => Promise<unknown>) => fn());
    const list = [
      starter('d1', { text: { en: 'I want to get better at ___.' } }),
      starter('o1', { kind: 'practice', custom: true, categoryId: 'c1', text: { en: 'Read ___ with my family.' } }),
      starter('s1', { kind: 'note', schoolArchived: true, archived: true, text: { en: 'Remember to ___.' } }),
    ];
    render(wrap(<TeacherStarters contextId="ctx" starters={list} categories={[reading]} showArchived={true} run={run} />));
    const section = screen.getByTestId('library-starters');
    expect(within(section).getByRole('heading', { name: en['goals.starters.kind.practice'] })).toBeTruthy();
    const own = screen.getAllByTestId('library-starter').find((li) => li.textContent?.includes('Read ___ with my family.'))!;
    expect(own.textContent).toContain(en['goals.custom']);
    expect(own.textContent).toContain('Reading');
    const school = screen.getAllByTestId('library-starter').find((li) => li.textContent?.includes('Remember to'))!;
    expect(school.textContent).toContain(en['goals.schoolArchived']);
    expect(within(school).queryByRole('button')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${en['goals.archive']}: I want to get better at ___.` }));
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/api/teacher/starters/d1');
  });

  it('adds a starter for the chosen kind and category', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(starter('n1', { custom: true })), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(wrap(<TeacherStarters contextId="ctx" starters={[]} categories={[reading]} showArchived={false} run={(fn) => fn()} />));
    fireEvent.change(screen.getByLabelText(en['goals.starters.kind']), { target: { value: 'reflection' } });
    fireEvent.change(screen.getByLabelText(en['goals.starters.category']), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(en['goals.starters.textEn']), { target: { value: 'Today we read ___.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['goals.starters.add'] }));
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/teacher/contexts/ctx/starters');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'reflection', categoryId: 'c1', text: { en: 'Today we read ___.' } });
  });
});

describe('admin starters (D-116, D-152)', () => {
  it('archives and restores a default for the school', () => {
    const toggle = vi.fn();
    render(wrap(<AdminStarters starters={[starter('d1', {}), starter('d2', { kind: 'caption', archived: true, text: { en: 'My ___.' } })]} toggle={toggle} />));
    fireEvent.click(screen.getByRole('button', { name: `${en['goals.archive']}: I will ___.` }));
    fireEvent.click(screen.getByRole('button', { name: `${en['goals.restore']}: My ___.` }));
    expect(toggle.mock.calls).toEqual([
      ['d1', true],
      ['d2', false],
    ]);
  });
});
