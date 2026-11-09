// @vitest-environment jsdom
/**
 * Admin → Import students (S16a, D-163; IMP-1..7): open classes with their counts, empty classes
 * marked in words (not by colour only), the shared importer with the "By" column. Fictional data only.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminImportPage } from '../../src/client/routes/admin/ImportAdmin.tsx';
import { ADMIN } from '../../src/client/routes/admin/Admin.tsx';
import { SENSITIVE } from '../../src/client/lib/queryClient.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  Link: ({ children }: { children: unknown }) => children,
}));

afterEach(cleanup);

const cls = (id: string, name: string, studentCount: number, extra: Record<string, unknown> = {}) => ({ id, name, studentCount, archived: false, yearArchived: false, ...extra });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData([...ADMIN, 'classes', 'current'], {
    classes: [cls('c1', '3-A', 0), cls('c2', '3-B', 1), cls('c3', '4-A', 24), cls('c4', '2-C', 0, { yearArchived: true })],
  });
  qc.setQueryData([...ADMIN, 'settings'], { timezone: 'Europe/Istanbul' });
  qc.setQueryData([SENSITIVE, 'teacher', 'import', 'list'], {
    batches: [
      { id: 'b1', sourceType: 'csv', fileName: 'liste.csv', classId: 'c3', className: '4-A', status: 'committed', counts: { added: 24, matched: 0 }, createdAt: Date.UTC(2026, 8, 1), createdByName: 'Demo Admin', committedAt: null, revertedAt: null },
    ],
  });
  render(
    <QueryClientProvider client={qc}>
      <AdminImportPage />
    </QueryClientProvider>,
  );
}

describe('admin student importer (S16a)', () => {
  it('lists the classes of open years with counts and marks empty ones in words', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: en['admin.importTitle'] })).toBeTruthy();
    expect(screen.getByTestId('admin-import-empty-count').textContent).toBe('1 class still has no students.');
    const table = screen.getByRole('table', { name: en['admin.importClassesCaption'] });
    expect(within(table).queryByText('2-C')).toBeNull();
    expect(within(table).getAllByText(en['admin.importEmpty'])).toHaveLength(1);
    // The history shows who imported (an administrator sees every batch).
    const history = screen.getByRole('table', { name: en['import.historyCaptionAll'] });
    expect(within(history).getByText('Demo Admin')).toBeTruthy();
    expect(within(history).getByRole('columnheader', { name: en['import.col.by'] })).toBeTruthy();
  });

  it('"Import into" chooses the class for the importer', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'Import into 3-B' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts on the first empty class, shown as the chosen one (review fix)', async () => {
    renderPage();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Import into 3-A' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Import into 3-B' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('locks the class buttons while an import is open and says why (review fix)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: en['import.open'] }));
    await waitFor(() => expect(screen.getByTestId('admin-import-busy').textContent).toBe(en['admin.importBusy']));
    expect((screen.getByRole('button', { name: 'Import into 3-B' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has every new string in Turkish with singular and plural forms', () => {
    for (const k of ['admin.import', 'admin.importTitle', 'admin.importIntro', 'admin.importEmptyCount_one', 'admin.importClassLabel_other', 'admin.importBusy', 'import.col.by'] as const) {
      expect(tr[k]).toBeTruthy();
      expect(tr[k]).not.toBe(en[k]);
    }
  });
});
