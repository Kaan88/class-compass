// @vitest-environment jsdom
/**
 * React component tests (SX): the theme provider applies a theme's tokens, the student card shows the
 * count as number + text (never colour only, UX-7), and the lock screen renders none of the protected
 * children (PIN-2/3). Fictional data only.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../src/client/lib/session.ts';
import { ME_KEY } from '../../src/client/lib/session.ts';
import { STYLE_ELEMENT_ID, installThemeStyles, themeTokens } from '../../src/client/themes/css.ts';
import { THEMES, ThemeProvider, useTheme } from '../../src/client/themes/index.tsx';
import { StudentCard } from '../../src/client/ui/Students.tsx';
import { SensitiveGate } from '../../src/client/routes/Lock.tsx';
import { en } from '../../src/shared/i18n/en.ts';
import { THEME_KEYS } from '../../src/shared/themes.ts';

const path = { current: '/teacher/students' };
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: path.current } }),
}));

afterEach(cleanup);

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  it.each(THEME_KEYS)('applies the %s theme: data-theme on the subtree, its complete token block in the stylesheet, its slots in context', (key) => {
    installThemeStyles(document);
    function Probe() {
      return <span data-testid="probe">{useTheme().key}</span>;
    }
    render(
      <ThemeProvider theme={key} testId="scope">
        <Probe />
      </ThemeProvider>,
    );
    const scope = screen.getByTestId('scope');
    expect(scope.getAttribute('data-theme')).toBe(key);
    expect(screen.getByTestId('probe').textContent).toBe(key);

    const css = document.getElementById(STYLE_ELEMENT_ID)?.textContent ?? '';
    const start = css.indexOf(`[data-theme='${key}'] {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    for (const [name, value] of themeTokens(THEMES[key])) expect(block).toContain(`${name}: ${value};`);

    // jsdom resolves custom properties through the cascade: the subtree really gets this theme's values.
    const bg = getComputedStyle(scope).getPropertyValue('--cc-bg').trim();
    if (bg !== '') expect(bg.toLowerCase()).toBe(THEMES[key].colors.bg.toLowerCase());
  });

  it('installThemeStyles is idempotent (one style element)', () => {
    installThemeStyles(document);
    installThemeStyles(document);
    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
  });
});

describe('StudentCard', () => {
  const ada = { id: 'fictional-1', fullName: 'Ada Yıldız' };

  it('shows the weekly count as a number with an accessible text name and the level as a word, not colour only', () => {
    render(<StudentCard student={ada} weeklyCount={4} level={2} onAdd={() => undefined} />);
    const count = screen.getByTestId('student-count');
    expect(count.textContent).toBe('4');
    expect(count.getAttribute('aria-label')).toBe('4 reminders this week');
    expect(screen.getByText(en['card.level.2'])).toBeTruthy();
    expect(screen.getByText(en['card.thisWeek'])).toBeTruthy();
  });

  it('shows no fake zero when no counter value is given', () => {
    render(<StudentCard student={ada} />);
    expect(screen.queryByTestId('student-count')).toBeNull();
  });

  it('marks an absent student with text, not only styling', () => {
    render(<StudentCard student={ada} absent weeklyCount={1} level={0} />);
    expect(screen.getByText(en['card.absent'])).toBeTruthy();
    expect(screen.queryByTestId('student-count')).toBeNull();
  });
});

describe('SensitiveGate / LockScreen', () => {
  const me = (patch: Partial<Me>): Me =>
    ({
      kind: 'user',
      id: 'fictional-teacher',
      displayName: 'Deniz Öğretmen',
      role: 'teacher',
      locale: 'en',
      textScale: 1,
      mustChangePassword: false,
      hasPin: true,
      signInMethod: 'password',
      hasEmail: false,
      reauthFresh: false,
      classroomMode: true,
      pinUnlockedUntil: null,
      pinUnlocked: false,
      ...patch,
    }) as Me;

  function withSession(m: Me, children: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_KEY, m);
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  it('while locked renders only the lock screen: the protected children never mount', () => {
    const mounted = vi.fn();
    function Secret() {
      mounted();
      return <p>sensitive-content</p>;
    }
    render(withSession(me({}), <SensitiveGate><Secret /></SensitiveGate>));
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(screen.queryByText('sensitive-content')).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    // The lock screen says nothing about the page behind it.
    expect(screen.getByTestId('lock-screen').textContent).not.toContain('students');
  });

  it('when not in classroom mode renders the children', () => {
    path.current = '/teacher';
    render(withSession(me({ classroomMode: false, pinUnlocked: true }), <SensitiveGate><p>sensitive-content</p></SensitiveGate>));
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByText('sensitive-content')).toBeTruthy();
    path.current = '/teacher/students';
  });
});
