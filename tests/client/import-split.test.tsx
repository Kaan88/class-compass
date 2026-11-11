// @vitest-environment jsdom
/**
 * The split preview of a list with several classes (S20c review fixes, D-171): an administrator sees
 * "No class with this name" (a teacher "Not one of your classes"); classes with the same name in two
 * open school years are offered first and told apart by their year; rows listed under two classes are
 * shown; and the drafts' status is never announced as "all handled" while the list is still loading.
 * Fictional data only.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, tr } from '../messages.ts';

let scope: 'school' | 'taught' = 'school';
const never = new Promise<never>(() => undefined);

vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: (ep: { path: string; method: string }) => {
    if (ep.path === '/api/import/split/preview') {
      return Promise.resolve({
        sourceType: 'paste',
        fileName: null,
        notices: [],
        sheets: null,
        classColumn: 'Sınıfı',
        scope,
        groups: [
          { key: '3a', labels: ['3/A'], rows: 3, status: 'ambiguous', classId: null, className: null, candidateIds: ['y1-3a', 'y2-3a'], candidates: [{ id: 'y1-3a', name: '3-A', yearName: '2026–2027' }, { id: 'y2-3a', name: '3-A', yearName: '2027–2028' }], alsoElsewhere: 1, sameNameElsewhere: 0 },
          { key: '3b', labels: ['3/B'], rows: 2, status: 'matched', classId: 'y1-3b', className: '3-B', candidateIds: [], candidates: [], alsoElsewhere: 1, sameNameElsewhere: 1 },
          { key: '9z', labels: ['9/Z'], rows: 1, status: 'unknown', classId: null, className: null, candidateIds: [], candidates: [], alsoElsewhere: 0, sameNameElsewhere: 0 },
        ],
      });
    }
    if (ep.path === '/api/import/split') {
      return Promise.resolve({
        splitId: 'sp1',
        skippedRows: 1,
        batches: [
          { id: 'b1', sourceType: 'paste', fileName: null, classId: 'y1-3b', className: '3-B', status: 'draft', counts: {}, createdAt: 1, createdByName: 'Demo Admin', committedAt: null, revertedAt: null, split: { id: 'sp1', labels: ['3/B'] } },
        ],
      });
    }
    // The history and the split's batch list never answer: the page must not claim anything meanwhile.
    return never;
  },
}));

const { Importer } = await import('../../src/client/routes/teacher/Import.tsx');

afterEach(cleanup);

function renderImporter() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const classes = [
    { id: 'y1-3a', name: '3-A', label: '3-A (0 students)' },
    { id: 'y2-3a', name: '3-A', label: '3-A (0 students)' },
    { id: 'y1-3b', name: '3-B', label: '3-B (0 students)' },
  ];
  render(
    <QueryClientProvider client={qc}>
      <Importer classes={classes} tz="Europe/Istanbul" showCreator />
    </QueryClientProvider>,
  );
}

async function openSplit() {
  fireEvent.click(screen.getByRole('switch', { name: new RegExp(en['import.split.toggle']) }));
  fireEvent.change(screen.getByLabelText(new RegExp(en['import.pasteLabel'])), { target: { value: 'Adı Soyadı\tSınıfı\nAda Kurgu\t3/A' } });
  fireEvent.click(screen.getByRole('button', { name: en['import.preview'] }));
  return screen.findByTestId('import-split-preview');
}

describe('split preview (S20c review fixes, D-171)', () => {
  it('admin wording for an unknown class; same-named classes first, with their school year', async () => {
    scope = 'school';
    renderImporter();
    const preview = await openSplit();
    expect(within(preview).getByText(en['import.split.status.unknownSchool'])).toBeTruthy();
    expect(within(preview).queryByText(en['import.split.status.unknown'])).toBeNull();
    const select = within(preview).getByLabelText('Import “3/A” into') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels.slice(0, 3)).toEqual([en['import.split.skip'], '3-A · 2026–2027', '3-A · 2027–2028']);
    // The other classes still follow, once each.
    expect(labels.slice(3)).toEqual(['3-B (0 students)']);
    // Rows under two classes of the list are shown before anything is made.
    expect(within(preview).getAllByText('1 also listed under another class')).toHaveLength(2);
    expect(within(preview).getByText('1 with the same name under another class')).toBeTruthy();
  });

  it('teacher wording for a class they do not teach', async () => {
    scope = 'taught';
    renderImporter();
    const preview = await openSplit();
    expect(within(preview).getByText(en['import.split.status.unknown'])).toBeTruthy();
    expect(within(preview).queryByText(en['import.split.status.unknownSchool'])).toBeNull();
  });

  it('after "Make previews" the status says what is still open, never "all handled" first', async () => {
    scope = 'school';
    renderImporter();
    await openSplit();
    fireEvent.click(screen.getByRole('button', { name: /Make the preview|Make previews/ }));
    const section = await screen.findByTestId('import-split-batches');
    const status = within(section).getByRole('status');
    expect(status.textContent).toBe('1 class still to check and confirm.');
    await waitFor(() => expect(status.textContent).not.toBe(en['import.split.batchesDone']));
  });

  it('has the new strings in Turkish', () => {
    for (const k of ['import.split.status.unknownSchool', 'import.split.alsoElsewhere_one', 'import.split.sameNameElsewhere_other', 'import.flag.duplicate_other_class', 'error.IMPORT_SPLIT_TOO_MANY_ROWS', 'error.IMPORT_SPLIT_CLASS_TOO_BIG'] as const) {
      expect(tr[k]).toBeTruthy();
      expect(tr[k]).not.toBe(en[k]);
    }
  });
});
