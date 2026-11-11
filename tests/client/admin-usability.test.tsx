// @vitest-environment jsdom
/**
 * Admin usability fixes (usability audit, November 2026): stacked admin tables on narrow screens,
 * audit codes in words (every code the server writes has a label in EN and TR), chart axis labels,
 * the prefilled new-year form, and the administrator's PIN in Profile. Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from '../../src/client/ui/Layout.tsx';
import { auditLabel } from '../../src/client/routes/admin/auditLabels.ts';
import { axisLabel, labelLayout, rowLabels } from '../../src/client/reports/chartLabels.ts';
import { suggestNextYear } from '../../src/client/routes/admin/rollover.ts';
import { ME_KEY, type Me } from '../../src/client/lib/session.ts';
import { ProfilePage } from '../../src/client/routes/teacher/Teacher.tsx';
import type { ReportTable } from '../../src/shared/contracts/reports.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  Link: ({ children }: { children: unknown }) => children,
}));

afterEach(cleanup);

describe('DataTable stack mode (admin tables on phones and tablets)', () => {
  it('labels every cell with its column header and marks the actions cell', () => {
    render(
      <DataTable
        stack
        caption="Classes"
        rows={[{ id: 'c1', name: '3-A' }]}
        rowKey={(r) => r.id}
        emptyText="None"
        columns={[
          { key: 'name', header: 'Class name', sortValue: (r) => r.name, render: (r) => r.name },
          { key: 'actions', header: 'Actions', render: () => <button type="button">Edit</button> },
        ]}
      />,
    );
    const table = screen.getByRole('table');
    expect(table.className).toContain('cc-table--stack');
    const cells = table.querySelectorAll('tbody td');
    expect(cells[0]!.getAttribute('data-label')).toBe('Class name');
    expect(cells[1]!.className).toContain('cc-table__actions');
    // A header without sorting is plain (hidden in the stacked layout); a sortable one stays a button.
    expect(table.querySelector('th.cc-table__th--plain')?.textContent).toBe('Actions');
    expect(screen.getByRole('button', { name: /Class name/ })).toBeTruthy();
  });

  it('is a normal table without the flag', () => {
    render(<DataTable caption="X" rows={[]} rowKey={() => 'x'} emptyText="None" columns={[{ key: 'a', header: 'A', render: () => null }]} />);
    expect(screen.getByRole('table').className).toBe('cc-table');
  });
});

describe('audit log codes in words (ACC-9)', () => {
  /** Every literal action / record type passed to audit() in the server, also the ones chosen by a condition. */
  function serverCodes() {
    const root = path.resolve(__dirname, '../../src/server');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(path.join(d, f.name));
        else if (f.name.endsWith('.ts') && f.name !== 'schema.ts') files.push(path.join(d, f.name));
      }
    };
    walk(root);
    const actions = new Set<string>();
    const entities = new Set<string>();
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const line of text.split('\n')) {
        const a = /\baction: (.*?)(, entity\b|$)/u.exec(line);
        if (a) for (const m of a[1]!.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/gu)) actions.add(m[1]!);
        const e = /\bentity: (.*?)(, entityId|$)/u.exec(line);
        // Comparisons inside a condition (`kind === 'category'`) are not record types.
        if (e) for (const m of e[1]!.replace(/=== '[a-z_]+'/gu, '').matchAll(/'([a-z_]+)'/gu)) entities.add(m[1]!);
      }
      // saveTemplate(ctx, row, patch, 'grouping.template_…', …) passes the action positionally.
      for (const m of text.matchAll(/'(grouping\.template_[a-z_]+)'/gu)) actions.add(m[1]!);
    }
    // homework.${kind}: the two kinds the marking service uses.
    actions.add('homework.marks_set');
    actions.add('homework.marks_remaining');
    return { actions, entities };
  }

  it('has an EN and a TR label for every action and record type the server writes', () => {
    const { actions, entities } = serverCodes();
    expect(actions.size).toBeGreaterThan(150);
    const missing = [
      ...[...actions].filter((c) => !(`audit.action.${c}` in en) || !(`audit.action.${c}` in tr)),
      ...[...entities].filter((c) => !(`audit.entity.${c}` in en) || !(`audit.entity.${c}` in tr)),
    ];
    expect(missing).toEqual([]);
  });

  it('translates known codes and shows unknown ones as they are', () => {
    expect(auditLabel('tr', 'action', 'auth.invite_issue')).toBe(tr['audit.action.auth.invite_issue']);
    expect(auditLabel('en', 'entity', 'teaching_context')).toBe('Class and subject');
    expect(auditLabel('tr', 'action', 'future.thing')).toBe('future.thing');
  });
});

describe('chart labels (RPT, usability audit)', () => {
  const table: ReportTable = {
    key: 'contexts',
    title: { raw: 'Contexts' },
    columns: [
      { key: 'class', label: { raw: 'Class' } },
      { key: 'subject', label: { raw: 'Subject' } },
      { key: 'lessons', label: { raw: 'Lessons' }, numeric: true },
    ],
    rows: [
      { key: 'a', cells: [{ t: 'label', v: { raw: '3-A' } }, { t: 'label', v: { raw: 'English' } }, { t: 'n', v: 4 }] },
      { key: 'b', cells: [{ t: 'label', v: { raw: '3-A' } }, { t: 'label', v: { raw: 'Maths' } }, { t: 'n', v: 2 }] },
      { key: 'c', cells: [{ t: 'label', v: { raw: '3-B' } }, { t: 'label', v: { raw: 'English' } }, { t: 'n', v: 1 }] },
    ],
  };

  it('shows weeks and dates as short dates', () => {
    expect(axisLabel({ t: 'range', from: '2026-08-31', to: '2026-09-06' }, 'en')).toBe('31 Aug');
    expect(axisLabel({ t: 'date', v: '2026-08-31' }, 'tr')).toBe('31 Ağu');
  });

  it('tells rows with the same label apart by the next text column', () => {
    expect(rowLabels(table, table.rows, 0, 'en')).toEqual(['3-A · English', '3-A · Maths', '3-B']);
  });

  it('keeps short labels straight and turns or thins long, crowded ones', () => {
    expect(labelLayout(['3-A', '3-B'], 600, 12)).toEqual({ step: 1, rotate: false, maxChars: 3 });
    const weeks = Array.from({ length: 12 }, () => '31 Aug');
    expect(labelLayout(weeks, 300, 12).rotate).toBe(true);
    expect(labelLayout(Array.from({ length: 60 }, () => '31 Aug'), 300, 12).step).toBeGreaterThan(1);
  });
});

describe('new school year form', () => {
  it('is prefilled with the old year moved on by one year', () => {
    expect(suggestNextYear({ name: '2026–2027', startsOn: '2026-09-01', endsOn: '2027-06-30' })).toEqual({ name: '2027–2028', startsOn: '2027-09-01', endsOn: '2028-06-30' });
    expect(suggestNextYear({ name: 'Year', startsOn: '2027-02-29', endsOn: '2028-02-29' }).startsOn).toBe('2028-02-28');
    expect(suggestNextYear(undefined)).toEqual({ name: '', startsOn: '', endsOn: '' });
  });
});

describe('Profile PIN for administrators (D-138)', () => {
  it('offers the PIN form on an administrator account, explaining what it is for', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const me = {
      id: 'u-admin',
      login: 'admin',
      displayName: 'Demo Admin',
      role: 'admin',
      locale: 'en',
      textScale: 100,
      density: 'normal',
      hasPin: false,
      signInMethod: 'password',
      classroomMode: false,
      pinUnlocked: false,
      pinUnlockedUntil: null,
      mustChangePassword: false,
      reauthFresh: false,
    } as unknown as Me;
    qc.setQueryData(ME_KEY, me);
    render(
      <QueryClientProvider client={qc}>
        <ProfilePage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: en['profile.pinSet'] })).toBeTruthy();
    expect(screen.getByText(en['profile.pinHintAdmin'])).toBeTruthy();
  });
});
