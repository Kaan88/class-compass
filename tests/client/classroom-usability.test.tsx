// @vitest-environment jsdom
/**
 * Classroom usability pass (November 2026 audit, D-139). Fictional data only.
 * - The device settings (size, class language, sounds) are behind one "Display" button in the top bar.
 * - The attendance count line reads as a sentence in Turkish ("Bugün: 19 Var").
 * - The homework check names the attendance day in words, never as an ISO date.
 * - Panel headers keep the icon and the title on one line, with the actions beside them.
 * - The badge recipient picker is marked as a choice (not struck through like a done duty), and
 *   small avatars fill their circle inside buttons.
 */
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { AttendanceCountsLine } from '../../src/client/modules/attendance/AttendanceList.tsx';
import { longDay } from '../../src/client/modules/homework/CheckGrid.tsx';
import { ClassroomTopBar } from '../../src/client/ui/ClassroomTopBar.tsx';
import { PanelHead } from '../../src/client/ui/Layout.tsx';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';

afterEach(cleanup);

const withLocale = (locale: 'en' | 'tr', node: ReactNode) => render(<I18nProvider locale={locale}>{node}</I18nProvider>);

const context = {
  id: 'ctx-1',
  classId: 'class-1',
  className: '3-A',
  subjectName: { en: 'English', tr: 'İngilizce' },
  mainLanguage: 'en' as const,
  secondLanguageEnabled: true,
};

describe('classroom top bar (D-139)', () => {
  it('keeps size, class language and sounds in the Display popover, not in the bar', () => {
    let density = 'normal';
    withLocale(
      'en',
      <ClassroomTopBar
        context={context as never}
        dayLabel="Sunday"
        dateLabel="8 November 2026"
        timeLabel="09:00"
        density="normal"
        onDensity={(d) => (density = d)}
        onLocale={() => undefined}
        settings={<span data-testid="sounds-setting">sounds</span>}
        tools={<span data-testid="tools">tools</span>}
      />,
    );
    expect(screen.queryByTestId('density-control')).toBeNull();
    expect(screen.queryByTestId('class-language-switch')).toBeNull();
    expect(screen.queryByTestId('sounds-setting')).toBeNull();
    fireEvent.click(screen.getByTestId('classroom-settings'));
    const size = screen.getByTestId('density-control');
    expect(size.textContent).toContain(en['classroom.size.compact']);
    expect(screen.getByTestId('class-language-switch')).toBeTruthy();
    expect(screen.getByTestId('sounds-setting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en['classroom.size.large'] }));
    expect(density).toBe('large');
  });

  it('calls Compact "Küçük" in Turkish (pairs with Büyük)', () => {
    expect(tr['classroom.size.compact']).toBe('Küçük');
  });
});

describe('Turkish wording on the classroom screen', () => {
  it('reads the attendance count as a sentence in Turkish and keeps "19 Present" in English', () => {
    const statuses = Array.from({ length: 19 }, () => 'present' as const);
    withLocale('tr', <AttendanceCountsLine statuses={statuses} />);
    expect(screen.getByTestId('attendance-counts').textContent).toBe('Bugün: 19 Var');
    cleanup();
    withLocale('en', <AttendanceCountsLine statuses={statuses} />);
    expect(screen.getByTestId('attendance-counts').textContent).toBe('19 Present');
  });

  it('names the attendance day of a homework check in words', () => {
    expect(longDay('2026-11-08', 'en')).toMatch(/Sunday.*8.*November/u);
    expect(longDay('2026-11-08', 'tr')).toMatch(/8 Kasım.*Pazar|Pazar.*8 Kasım/u);
    expect(longDay('2026-11-08', 'tr')).not.toContain('2026-11-08');
  });
});

describe('panel header', () => {
  it('puts the icon inside the title and the actions beside it', () => {
    withLocale(
      'en',
      <PanelHead id="t" title="Homework" icon={<svg data-testid="icon" />}>
        <button type="button">Check</button>
      </PanelHead>,
    );
    const heading = screen.getByRole('heading', { name: 'Homework' });
    expect(heading.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(heading.parentElement?.querySelector('.cc-panel-head__actions button')?.textContent).toBe('Check');
  });
});

describe('stylesheet rules from the audit', () => {
  const css = readFileSync('src/client/styles/app.css', 'utf8');
  it('strikes through only ticked assistant duties, never a chosen badge recipient', () => {
    expect(css).not.toMatch(/(^|\n)\.cc-tick:has\(input:checked\) span/u);
    expect(css).toContain('.cc-assistant__ticks .cc-tick:has(input:checked) span');
  });
  it('lets avatar art fill its circle even inside buttons that size every svg', () => {
    expect(css).toMatch(/\.cc-avatar\.cc-avatar--art > svg\.cc-avatar-art \{\s*width: 100%;\s*height: 100%;/u);
  });
});
