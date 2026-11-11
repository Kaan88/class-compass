// @vitest-environment jsdom
/**
 * S22d (D-178): Compact / Normal / Large in the teacher and admin areas (UX-6, THM-6). The Profile
 * select saves the account's choice, the layouts put it on `<html data-area-density>`, and app.css
 * changes only the `--cc-area-*` layout variables: Normal is exactly the look before S22d and no density
 * touches the touch target size. Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AREA_DENSITIES, type Me } from '../../src/shared/contracts/auth.ts';
import { en, tr } from '../messages.ts';

const calls: Array<{ path: string; input: unknown }> = [];
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: vi.fn(async (ep: { path: string }, input: Record<string, unknown>) => {
    calls.push({ path: ep.path, input });
    return { ...ME, ...input };
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  Link: ({ children }: { children: unknown }) => children,
}));

const { ProfilePage } = await import('../../src/client/routes/teacher/Teacher.tsx');
const { ME_KEY } = await import('../../src/client/lib/session.ts');
const { useAreaDensity } = await import('../../src/client/lib/areaDensity.ts');

const ME: Me = {
  kind: 'user',
  id: 'fictional-teacher',
  displayName: 'Deniz Öğretmen',
  role: 'teacher',
  locale: 'en',
  textScale: 100,
  density: 'normal',
  mustChangePassword: false,
  hasPin: true,
  signInMethod: 'password',
  hasEmail: false,
  reauthFresh: false,
  classroomMode: false,
  pinUnlockedUntil: null,
  pinUnlocked: true,
};

afterEach(() => {
  cleanup();
  calls.length = 0;
  delete document.documentElement.dataset.areaDensity;
});

describe('Profile → Spacing (S22d, D-178)', () => {
  it('offers Compact, Normal and Large beside the text size and saves the choice for the account (UX-6)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    qc.setQueryData(ME_KEY, ME);
    render(
      <QueryClientProvider client={qc}>
        <ProfilePage />
      </QueryClientProvider>,
    );
    const select = screen.getByLabelText(en['profile.density']) as HTMLSelectElement;
    expect(select.value).toBe('normal');
    expect([...select.options].map((o) => o.textContent)).toEqual([en['profile.density.compact'], en['profile.density.normal'], en['profile.density.large']]);
    // Beside the text size, in the same section.
    expect(select.closest('section')?.contains(screen.getByLabelText(en['profile.textSize']))).toBe(true);
    // The hint is a line of its own under the row, but still the select's accessible description
    // (S22d review: WCAG 1.3.1 / 3.3.2).
    const hint = screen.getByText(en['profile.densityHint']);
    expect(hint.id).toBeTruthy();
    expect(select.getAttribute('aria-describedby')?.split(' ')).toContain(hint.id);
    expect(screen.getByRole('combobox', { name: en['profile.density'], description: en['profile.densityHint'] })).toBe(select);
    fireEvent.change(select, { target: { value: 'compact' } });
    await waitFor(() => expect(qc.getQueryData<Me>(ME_KEY)?.density).toBe('compact'));
    expect(calls).toEqual([{ path: '/api/auth/preferences', input: { density: 'compact' } }]);
  });

  it('has natural Turkish words for every choice (UX-3)', () => {
    for (const d of AREA_DENSITIES) expect(tr[`profile.density.${d}`]).toBeTruthy();
    expect([tr['profile.density.compact'], tr['profile.density.large']]).toEqual(['Sık', 'Geniş']);
  });
});

function Area({ density }: { density: Me['density'] | undefined }) {
  useAreaDensity(density);
  return null;
}

describe('useAreaDensity (S22d, D-178)', () => {
  it('puts the account density on <html> while a teacher or admin layout is mounted and removes it after', () => {
    const html = document.documentElement;
    const view = render(<Area density={undefined} />);
    expect(html.dataset.areaDensity).toBe('normal');
    act(() => view.rerender(<Area density="large" />));
    expect(html.dataset.areaDensity).toBe('large');
    view.unmount();
    // The classroom screen, the student page and Super Speakers never carry it.
    expect(html.dataset.areaDensity).toBeUndefined();
  });
});

describe('app.css area density variables (S22d, D-178)', () => {
  const css = fs.readFileSync(path.resolve('src/client/styles/app.css'), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  };
  const vars = (text: string) => Object.fromEntries([...text.matchAll(/(--cc-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  const rem = (v: string) => Number(v.replace('rem', ''));

  it('keeps Normal exactly as before S22d', () => {
    const root = vars(block(':root'));
    expect(root).toMatchObject({
      '--cc-area-page-top': '1.25rem',
      '--cc-area-gap': '1rem',
      '--cc-area-row-gap': '0.75rem',
      '--cc-area-card-pad': '1.25rem',
      '--cc-area-cell-y': '0.55rem',
      '--cc-area-cell-x': '0.8rem',
    });
  });

  it('Compact is tighter and Large roomier, and neither changes a touch target (UX-6)', () => {
    const root = vars(block(':root'));
    const compact = vars(block("html[data-area-density='compact']"));
    const large = vars(block("html[data-area-density='large']"));
    const names = Object.keys(root).filter((k) => k.startsWith('--cc-area-'));
    expect(Object.keys(compact).sort()).toEqual([...names].sort());
    expect(Object.keys(large).sort()).toEqual([...names].sort());
    for (const k of names) {
      expect(rem(compact[k]!)).toBeLessThan(rem(root[k]!));
      expect(rem(large[k]!)).toBeGreaterThan(rem(root[k]!));
    }
    // Nothing outside the area variables follows the density (buttons and fields keep --cc-touch).
    expect(css).not.toMatch(/data-area-density[^{]*\{[^}]*--cc-touch/);
  });
});
