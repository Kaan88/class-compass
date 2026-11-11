// @vitest-environment jsdom
/**
 * Teacher-area usability fixes (usability audit, November 2026): copying a student link without the
 * Clipboard API, stacked teacher tables, short week headers, chart axis labels, badge picture names
 * and the attendance chip next to homework statuses. Fictional data only.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearManualCopy, copyText } from '../../src/client/lib/clipboard.ts';
import { I18nProvider, useI18n } from '../../src/client/lib/i18n.tsx';
import { clearSensitiveToasts } from '../../src/client/lib/toast.ts';
import { axisLabel } from '../../src/client/reports/chartLabels.ts';
import { ChartView } from '../../src/client/reports/ReportView.tsx';
import { copyLink } from '../../src/client/routes/teacher/StudentLinks.tsx';
import { ManualCopyDialog } from '../../src/client/ui/Dialog.tsx';
import { DataTable } from '../../src/client/ui/Layout.tsx';
import { AttendanceChip } from '../../src/client/ui/Students.tsx';
import { BADGE_ICONS } from '../../src/shared/achievements.ts';
import type { ReportTable } from '../../src/shared/contracts/reports.ts';
import { en, tr } from '../messages.ts';
import { formatWeekRange } from '../../src/shared/i18n/index.ts';

const withLocale = (locale: 'en' | 'tr', node: ReactNode) => render(<I18nProvider locale={locale}>{node}</I18nProvider>);

afterEach(() => {
  cleanup();
  clearManualCopy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom has no execCommand; give the document one that answers `ok`. */
function stubExecCommand(ok: boolean) {
  const fn = vi.fn(() => ok);
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true });
  return fn;
}

describe('copying a student link on a plain-HTTP school network', () => {
  it('uses the Clipboard API when the page has it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    expect(await copyText('http://192.168.0.20/s#k=demo')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('http://192.168.0.20/s#k=demo');
  });

  it('falls back to the old copy command when there is no Clipboard API', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const exec = stubExecCommand(true);
    expect(await copyText('http://192.168.0.20/s#k=demo')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull(); // the helper field is removed again
  });

  it('shows the address, selected, in a dialog when nothing could copy it', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    stubExecCommand(false);
    let tr0: ReturnType<typeof useI18n>['t'] | null = null;
    function Grab() {
      tr0 = useI18n().t;
      return null;
    }
    withLocale(
      'tr',
      <>
        <Grab />
        <ManualCopyDialog />
      </>,
    );
    await act(async () => {
      await copyLink(tr0!, 'http://192.168.0.20/s#k=demo', 'Asya Şimşek');
    });
    const field = screen.getByLabelText('Asya Şimşek için bağlantı') as HTMLInputElement;
    expect(field.value).toBe('http://192.168.0.20/s#k=demo');
    expect(field.readOnly).toBe(true);
    expect(screen.getByText(tr['copy.manualHint'])).toBeTruthy();
    // Locking the teacher area removes it, like a sensitive toast (PIN-3).
    act(() => clearSensitiveToasts());
    expect(screen.queryByLabelText('Asya Şimşek için bağlantı')).toBeNull();
  });

  it('no longer tells the teacher to select an address that is not shown', () => {
    expect('links.copyFailed' in en).toBe(false);
    expect('links.copyFailed' in tr).toBe(false);
  });
});

describe('teacher tables on phones (DataTable stack roles)', () => {
  it('makes the name the card heading and leaves wide-only columns out of the card', () => {
    render(
      <DataTable
        stack
        caption="3-A"
        rows={[{ id: 's1', name: 'Asya Şimşek', since: '1 Eyl 2026' }]}
        rowKey={(r) => r.id}
        emptyText="None"
        columns={[
          { key: 'name', header: 'Name', stackRole: 'title', render: (r) => r.name },
          { key: 'since', header: 'Joined', stackRole: 'hidden', render: (r) => r.since },
          { key: 'actions', header: 'Actions', render: () => <button type="button">Remove</button> },
        ]}
      />,
    );
    const cells = screen.getByRole('table').querySelectorAll('tbody td');
    expect(cells[0]!.className).toBe('cc-table__title');
    expect(cells[1]!.className).toBe('cc-table__wide-only');
    expect(cells[2]!.className).toBe('cc-table__actions');
    expect(screen.getByRole('table').querySelector('thead th.cc-table__wide-only')?.textContent).toBe('Joined');
  });

  it('lets short counts flow side by side with compact (attendance history)', () => {
    render(<DataTable stack compact caption="History" rows={[{ id: 'd1' }]} rowKey={(r) => r.id} emptyText="None" columns={[{ key: 'a', header: 'Present', render: () => 17 }]} />);
    expect(screen.getByRole('table').className).toBe('cc-table cc-table--stack cc-table--compact');
  });
});

describe('counter history week headers (CNT-7)', () => {
  it('gives the explicit Monday–Sunday range without repeating the timezone', () => {
    expect(formatWeekRange('2026-11-02', '2026-11-08', 'en')).toBe('Mon 2 Nov – Sun 8 Nov');
    expect(formatWeekRange('2026-11-02', '2026-11-08', 'tr')).toBe('Pzt 2 Kas – Paz 8 Kas');
    expect(formatWeekRange('2026-11-02', '2026-11-08', 'en', { year: true })).toBe('Mon 2 Nov – Sun 8 Nov 2026');
    expect(formatWeekRange('2026-11-02', '2026-11-08', 'tr')).not.toContain('Europe');
  });
});

describe('report charts', () => {
  it('labels self-assessment bars with the step number, not "5 üzerinden" cut short', () => {
    expect(axisLabel({ t: 'label', v: { k: 'report.goals.confidenceValue', p: { value: 4 } } }, 'tr')).toBe('4');
    expect(axisLabel({ t: 'label', v: { k: 'report.goals.confidenceValue', p: { value: 1 } } }, 'en')).toBe('1');
  });

  it('draws no empty chart when every value is 0 (the table still shows the zeros)', () => {
    const table: ReportTable = {
      key: 'x',
      title: { raw: 'Counts' },
      columns: [
        { key: 'day', label: { raw: 'Day' }, numeric: false },
        { key: 'n', label: { raw: 'Taps' }, numeric: true },
      ],
      rows: [
        { key: 'a', cells: [{ t: 'date', v: '2026-11-02' }, { t: 'n', v: 0 }] },
        { key: 'b', cells: [{ t: 'date', v: '2026-11-03' }, { t: 'n', v: 0 }] },
      ],
      chart: { kind: 'bar', labelColumn: 'day', valueColumns: ['n'] },
    } as ReportTable;
    const { container } = withLocale('en', <ChartView table={table} chart={table.chart!} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('badges', () => {
  it('every badge picture has a name in English and Turkish (no raw keys like "star" in the list)', () => {
    for (const icon of BADGE_ICONS) {
      const key = `achievements.iconName.${icon}`;
      expect(key in en, key).toBe(true);
      expect(key in tr, key).toBe(true);
      expect((tr as Record<string, string>)[key]).not.toBe(icon);
    }
  });
});

describe('attendance next to homework statuses', () => {
  it('names the chip as attendance, so "Absent" is not read as a homework status', () => {
    withLocale('tr', <AttendanceChip status="absent" prefix="Yoklama" />);
    expect(screen.getByText('Yoklama: Yok')).toBeTruthy();
  });
});
