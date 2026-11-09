// @vitest-environment jsdom
/**
 * Student name → statistics (S14e2, D-154): `StudentName` is a button only inside the teacher area's
 * `StudentStatsProvider` (plain text on the classroom screen, in the admin area and in the drawer),
 * the separate statistics button for names that already do something, report student cells, the
 * classroom card's name button apart from the + button, and the drawer's choice of class+subject.
 * Fictional data only.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CellView } from '../../src/client/reports/ReportView.tsx';
import { preferredContext } from '../../src/client/reports/StudentStatsDrawer.tsx';
import { StudentName, StudentStatsButton, StudentStatsProvider } from '../../src/client/ui/StudentName.tsx';
import { StudentCard } from '../../src/client/ui/Students.tsx';
import type { ReportContextInfo } from '../../src/shared/contracts/reports.ts';
import { en } from '../../src/shared/i18n/en.ts';

afterEach(cleanup);
const ada = { id: 'fictional-ada', fullName: 'Ada Yıldız' };

describe('StudentName (D-154)', () => {
  it('is plain text outside the teacher area (classroom, admin, the drawer itself)', () => {
    render(<StudentName id={ada.id} name={ada.fullName} />);
    expect(screen.getByText(ada.fullName).tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a button inside the teacher area, announced as opening the statistics', () => {
    render(
      <StudentStatsProvider>
        <StudentName id={ada.id} name={ada.fullName} contextId="ctx-1" />
      </StudentStatsProvider>,
    );
    const button = screen.getByRole('button', { name: ada.fullName });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    const hint = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe(en['studentStats.nameHint']);
  });

  it('the separate statistics button exists only in the teacher area and names the student', () => {
    const { unmount } = render(<StudentStatsButton id={ada.id} name={ada.fullName} />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(
      <StudentStatsProvider>
        <StudentStatsButton id={ada.id} name={ada.fullName} />
      </StudentStatsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Statistics for Ada Yıldız' })).toBeTruthy();
  });

  it('a student cell of a report is the name, which opens statistics in the teacher area only (RPT-5 cells unchanged)', () => {
    const cell = { t: 'student' as const, id: ada.id, name: ada.fullName };
    const { unmount } = render(<CellView cell={cell} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(ada.fullName)).toBeTruthy();
    unmount();
    render(
      <StudentStatsProvider>
        <CellView cell={cell} />
      </StudentStatsProvider>,
    );
    expect(screen.getByRole('button', { name: ada.fullName })).toBeTruthy();
  });
});

describe('classroom student card name (D-154, CRD-1)', () => {
  it('the name is its own button that opens the card; the + button stays the counter tap', () => {
    const onOpen = vi.fn();
    const onAdd = vi.fn();
    render(<StudentCard student={ada} weeklyCount={1} level={0} onAdd={onAdd} onOpen={onOpen} />);
    const name = screen.getByRole('button', { name: ada.fullName });
    const add = screen.getByRole('button', { name: `Add a reminder for ${ada.fullName}` });
    expect(name).not.toBe(add);
    expect(name.contains(add) || add.contains(name)).toBe(false);
    expect(name.className).toContain('cc-student-card__name');
    fireEvent.click(name);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('without onOpen the name stays plain text (catalogue, theme previews)', () => {
    render(<StudentCard student={ada} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('drawer class+subject (D-154)', () => {
  const info = (id: string, classId: string, ended = false) => ({ id, classId, ended }) as unknown as ReportContextInfo;
  const list = [info('c1', 'k1'), info('c2', 'k2'), info('c3', 'k2', true)];

  it('prefers the page’s own class+subject, then a current one of the page’s class, then the first', () => {
    expect(preferredContext(list, { contextId: 'c3' })?.id).toBe('c3');
    expect(preferredContext(list, { classId: 'k2' })?.id).toBe('c2');
    expect(preferredContext([info('c3', 'k2', true)], { classId: 'k2' })?.id).toBe('c3');
    expect(preferredContext(list, { contextId: 'gone', classId: 'gone' })?.id).toBe('c1');
    expect(preferredContext([], {})).toBeUndefined();
  });
});
