// @vitest-environment jsdom
/**
 * Evidence from the teacher Goals page (S20b, D-170, GOL-4): the page controls the evidence form's
 * goal ("Add evidence" on a goal card), a document goes up through the given upload function (the S9
 * teacher upload endpoint) and is attached for that goal; the media flags decide the choices; the
 * list shows which goal an item is for. Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Evidence } from '../../src/shared/contracts/goals.ts';
import { en } from '../messages.ts';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { EvidenceAdder, type NewEvidence, type UploadKind } from '../../src/client/modules/goals/EvidenceAdder.tsx';
import { EvidenceView } from '../../src/client/modules/goals/shared.tsx';

afterEach(cleanup);

const wrap = (node: ReactNode) => <I18nProvider locale="en">{node}</I18nProvider>;
const GOALS = [
  { id: 'g1', label: 'I will read a short book every week.' },
  { id: 'g2', label: 'I will learn five new words.' },
];

function Harness({ media, upload, add, start = '' }: { media: { photos: boolean; audio: boolean; documents: boolean }; upload: (k: UploadKind, f: Blob, n: string) => Promise<{ id: string }>; add: (i: NewEvidence) => Promise<unknown>; start?: string }) {
  const [goalId, setGoalId] = useState(start);
  return (
    <>
      <button type="button" onClick={() => setGoalId('g2')}>
        {GOALS[1]!.label}
      </button>
      <EvidenceAdder idPrefix="t" goals={GOALS} media={media} goalId={goalId} onGoalChange={setGoalId} upload={upload} add={add} run={(fn) => fn()} />
    </>
  );
}

describe('evidence from the Goals page (S20b, D-170)', () => {
  it('GOL-4: the page chooses the goal; a document is uploaded and attached for it', async () => {
    const upload = vi.fn(async () => ({ id: 'file-1' }));
    const add = vi.fn(async () => ({}));
    render(wrap(<Harness media={{ photos: false, audio: false, documents: true }} upload={upload} add={add} />));
    const goalSelect = screen.getByLabelText(en['student.evidenceGoal']) as HTMLSelectElement;
    expect(goalSelect.value).toBe('');
    // What "Add evidence" on a goal card does: the page sets the goal.
    fireEvent.click(screen.getByRole('button', { name: GOALS[1]!.label }));
    expect(goalSelect.value).toBe('g2');
    fireEvent.click(screen.getByRole('button', { name: en['evidence.mode.document'] }));
    const doc = new File(['My reading log'], 'reading-log.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(en['evidence.chooseDocuments']), { target: { files: [doc] } });
    });
    expect(screen.getByTestId('evidence-pending').textContent).toContain('reading-log.pdf');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['student.addEvidence'] }));
    });
    expect(upload).toHaveBeenCalledWith('document', doc, 'reading-log.pdf');
    expect(add).toHaveBeenCalledWith({ kind: 'file', fileId: 'file-1', goalId: 'g2' });
    // The form's own goal choice goes back to the page.
    fireEvent.change(goalSelect, { target: { value: 'g1' } });
    expect(goalSelect.value).toBe('g1');
  });

  it('D-014: picture and voice choices appear only while the media flags allow them', () => {
    const noop = async () => ({ id: 'x' });
    const { unmount } = render(wrap(<Harness media={{ photos: false, audio: false, documents: true }} upload={noop} add={noop} />));
    expect(screen.queryByRole('button', { name: en['evidence.mode.picture'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['evidence.mode.voice'] })).toBeNull();
    expect(screen.getByRole('button', { name: en['evidence.mode.document'] })).toBeTruthy();
    unmount();
    render(wrap(<Harness media={{ photos: true, audio: true, documents: false }} upload={noop} add={noop} />));
    expect(screen.getByRole('button', { name: en['evidence.mode.picture'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: en['evidence.mode.voice'] })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['evidence.mode.document'] })).toBeNull();
  });

  it('the evidence list names the goal an item is for', () => {
    const item: Evidence = {
      id: 'e1',
      goalId: 'g1',
      kind: 'file',
      body: null,
      url: null,
      file: { id: 'f1', mime: 'application/pdf', size: 2048, name: 'reading-log.pdf', hasThumbnail: false },
      authorType: 'teacher',
      createdAt: Date.UTC(2026, 10, 10, 9),
      updatedAt: Date.UTC(2026, 10, 10, 9),
    };
    render(
      wrap(
        <ul>
          <EvidenceView item={item} fileUrl={(id) => `/f/${id}`} goalLabel={GOALS[0]!.label} />
        </ul>,
      ),
    );
    expect(screen.getByText(en['student.forGoal'].replace('{goal}', GOALS[0]!.label))).toBeTruthy();
    expect(screen.getByRole('link', { name: /reading-log\.pdf/u }).getAttribute('href')).toBe('/f/f1');
  });
});
