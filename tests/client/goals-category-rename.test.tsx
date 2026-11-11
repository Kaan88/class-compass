// @vitest-environment jsdom
/**
 * S22b review fix (D-176): the rename form for a goal category. A default arrives with the school's
 * name in both languages; changing one language clears the other language's inherited school text
 * (so "Needs translation" shows, and a language that is off does not keep a stale school name), and
 * only the languages shown can enable Save. Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '../../src/shared/contracts/goals.ts';
import { en } from '../messages.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { CategoryRename, renameEdit } from '../../src/client/routes/teacher/Goals.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reading: Category = { id: 'c1', name: { en: 'Reading', tr: 'Okuma' }, icon: 'book', subjectId: null, custom: false, archived: false, schoolArchived: false };
const wrap = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider locale="en">{node}</I18nProvider>
    </QueryClientProvider>,
  );
const stubFetch = () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(reading), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const save = () => screen.getByRole('button', { name: en['common.save'] });
const disabled = (b: HTMLElement) => b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('data-disabled');

describe('renameEdit (D-176 review fix)', () => {
  const school = { en: 'Reading', tr: 'Okuma' };
  it('clears the other language while it still holds the school text', () => {
    expect(renameEdit(school, { en: 'Reading club', tr: 'Okuma' }, school, [])).toEqual({ value: { en: 'Reading club', tr: '' }, touched: ['en'] });
  });
  it('keeps a language the teacher typed in, and keeps everything for an own category', () => {
    expect(renameEdit({ en: 'Reading club', tr: 'Okuma' }, { en: 'Reading clubs', tr: 'Okuma' }, school, ['tr']).value).toEqual({ en: 'Reading clubs', tr: 'Okuma' });
    expect(renameEdit(school, { en: 'Reading club', tr: 'Okuma' }, null, []).value).toEqual({ en: 'Reading club', tr: 'Okuma' });
  });
  it('a language the teacher wrote earlier (not the school text) is kept', () => {
    expect(renameEdit({ en: 'Books', tr: 'Kitaplar' }, { en: 'Books and comics', tr: 'Kitaplar' }, school, []).value).toEqual({ en: 'Books and comics', tr: 'Kitaplar' });
  });
});

describe('CategoryRename (D-176 review fix)', () => {
  it('bilingual: renaming the English name marks the Turkish one "Needs translation"; both are sent once filled', async () => {
    const fetchMock = stubFetch();
    wrap(<CategoryRename contextId="ctx" category={reading} locales={['en', 'tr']} onClose={() => {}} />);
    expect(screen.queryByTestId('needs-translation')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name (English)'), { target: { value: 'Reading club' } });
    expect((screen.getByLabelText('Name (Turkish)') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('needs-translation').closest('[data-lang]')!.getAttribute('data-lang')).toBe('tr');
    fireEvent.change(screen.getByLabelText('Name (Turkish)'), { target: { value: 'Okuma kulübü' } });
    expect(screen.queryByTestId('needs-translation')).toBeNull();
    await act(async () => {
      fireEvent.click(save());
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/teacher/goal-categories/c1');
    expect(JSON.parse(String(init.body))).toEqual({ contextId: 'ctx', name: { en: 'Reading club', tr: 'Okuma kulübü' } });
  });

  it('English-only classes: the hidden Turkish school name is not kept with a new English name', async () => {
    const fetchMock = stubFetch();
    wrap(<CategoryRename contextId="ctx" category={reading} locales={['en']} onClose={() => {}} />);
    expect(screen.queryByLabelText('Name (Turkish)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name (English)'), { target: { value: 'Reading club' } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ contextId: 'ctx', name: { en: 'Reading club' } });
  });

  it('English-only classes: clearing the English field disables Save (the hidden Turkish text does not count)', () => {
    stubFetch();
    wrap(<CategoryRename contextId="ctx" category={reading} locales={['en']} onClose={() => {}} />);
    expect(disabled(save())).toBe(false);
    fireEvent.change(screen.getByLabelText('Name (English)'), { target: { value: '' } });
    expect(disabled(save())).toBe(true);
  });

  it('an own category keeps its hidden language text, but Save still needs a shown language', () => {
    stubFetch();
    wrap(<CategoryRename contextId="ctx" category={{ ...reading, id: 'o1', custom: true, name: { en: 'Comics', tr: 'Çizgi roman' } }} locales={['en']} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name (English)'), { target: { value: '' } });
    expect(disabled(save())).toBe(true);
  });
});
