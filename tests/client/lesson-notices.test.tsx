// @vitest-environment jsdom
/**
 * The teacher home's notices about forgotten lessons (S37, D-218), in English and Turkish: "still
 * running since" with when it ends by itself and End lesson (to the classroom's End Lesson for that
 * class+subject), and "ended automatically" with Got it (dismissed on the server, gone at once).
 * Status regions with words and an icon, never colour alone. The Lesson saved summary of a lesson that
 * ended by itself says so and shows no length. Fictional data only.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonNotices as Notices, LessonSummary } from '../../src/shared/contracts/lessons.ts';
import type { NotificationItem } from '../../src/shared/contracts/notifications.ts';
import { en, tr } from '../messages.ts';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, search, className }: { children: ReactNode; to: string; search?: unknown; className?: string }) => (
    <a href={to} data-search={JSON.stringify(search ?? {})} className={className}>
      {children}
    </a>
  ),
}));
const calls: Array<{ path: string; input: unknown }> = [];
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: (ep: { path: string }, input: unknown) => {
    calls.push({ path: ep.path, input });
    return Promise.resolve({ ok: true });
  },
}));

const { queryClient } = await import('../../src/client/lib/queryClient.ts');
const { I18nProvider } = await import('../../src/client/lib/i18n.tsx');
const { LessonNotices, LESSON_NOTICES_KEY } = await import('../../src/client/modules/lessons/LessonNotices.tsx');
const { LessonSummaryView } = await import('../../src/client/modules/lessons/EndLesson.tsx');
const { deepLink } = await import('../../src/client/modules/notifications/NotificationsPage.tsx');

const tz = 'Europe/Istanbul';
const startedAt = Date.UTC(2026, 10, 9, 7, 5); // 10:05 in Istanbul
const notices: Notices = {
  running: [{ lessonId: 'lesson-run', contextId: 'ctx-3a', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-09', startedAt, autoEndAt: startedAt + 2 * 3600_000, timezone: tz }],
  autoEnded: [{ lessonId: 'lesson-auto', contextId: 'ctx-3a', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-06', startedAt: Date.UTC(2026, 10, 6, 9, 0), endedAt: Date.UTC(2026, 10, 6, 11, 0), timezone: tz }],
};
const wrap = (locale: 'en' | 'tr', node: ReactNode) =>
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/gu, (_, k: string) => vars[k] ?? '');

beforeEach(() => {
  calls.length = 0;
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, refetchInterval: false, refetchOnMount: false } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('teacher home notices (S37, D-218)', () => {
  for (const [locale, m, subject, date] of [
    ['en', en, 'English', 'Friday 6 November'],
    ['tr', tr, 'İngilizce', '6 Kasım Cuma'],
  ] as const) {
    it(`shows the running lesson with End lesson and the automatic end with Got it (${locale})`, async () => {
      queryClient.setQueryData(LESSON_NOTICES_KEY, notices);
      wrap(locale, <LessonNotices />);
      const region = screen.getByRole('region', { name: m['lessonNotice.region'] });
      const statuses = screen.getAllByRole('status');
      expect(statuses).toHaveLength(2);
      expect(region.contains(statuses[0]!)).toBe(true);

      const running = screen.getByTestId('lesson-notice-running');
      expect(running.textContent).toContain(fill(m['lessonNotice.running'], { cls: `3-A · ${subject}`, time: '10:05' }));
      expect(running.textContent).toContain(fill(m['lessonNotice.runningAutoEnd'], { time: '12:05' }));
      expect(running.querySelector('svg')).not.toBeNull(); // an icon beside the words, not colour alone
      const end = screen.getByRole('link', { name: m['lessonNotice.endNow'] });
      expect(end.getAttribute('href')).toBe('/classroom');
      expect(JSON.parse(end.getAttribute('data-search')!)).toEqual({ endLesson: 'ctx-3a' });

      const auto = screen.getByTestId('lesson-notice-auto-ended');
      expect(auto.textContent).toContain(fill(m['lessonNotice.autoEnded'], { cls: `3-A · ${subject}`, date, time: '14:00' }));
      fireEvent.click(screen.getByRole('button', { name: m['lessonNotice.gotIt'] }));
      await waitFor(() => expect(screen.queryByTestId('lesson-notice-auto-ended')).toBeNull());
      expect(calls).toEqual([{ path: '/api/teacher/lesson-notices/:lessonId/seen', input: { lessonId: 'lesson-auto' } }]);
      expect(screen.getByTestId('lesson-notice-running')).toBeTruthy();
    });
  }

  it('renders nothing without a notice', () => {
    queryClient.setQueryData(LESSON_NOTICES_KEY, { running: [], autoEnded: [] });
    const { container } = wrap('en', <LessonNotices />);
    expect(container.textContent).toBe('');
  });
});

describe('Lesson saved after an automatic end (S37, D-218)', () => {
  const summary: LessonSummary = {
    id: 'lesson-auto',
    contextId: 'ctx-3a',
    status: 'ended',
    className: '3-A',
    subjectName: { en: 'English', tr: 'İngilizce' },
    localDate: '2026-11-09',
    startedAt,
    endedAt: startedAt + 2 * 3600_000,
    routineName: { en: 'Default', tr: 'Varsayılan' },
    stageCount: 0,
    stageReached: 0,
    attendance: null,
    reflection: null,
    lessonGoal: null,
    autoEnded: true,
  };
  for (const [locale, m] of [
    ['en', en],
    ['tr', tr],
  ] as const) {
    it(`says it ended by itself and shows no length (${locale})`, () => {
      wrap(locale, <LessonSummaryView lessonId="lesson-auto" timezone={tz} initial={summary} onDone={() => {}} />);
      const box = screen.getByTestId('lesson-summary');
      expect(screen.getByTestId('summary-auto-ended').textContent).toBe(m['summary.autoEndedNote']);
      expect(box.textContent).toContain(fill(m['summary.autoEnded'], { time: '12:05' }));
      expect(box.textContent).not.toContain(fill(m['summary.minutes'], { count: '120' }));
      expect(box.textContent).toContain(m['reflection.none']);
    });
  }
});

describe('lesson lines on the notifications page (S37, D-218)', () => {
  it('a notice about a lesson has no student and opens no teacher page', () => {
    const item = { id: 'n1', category: 'lessonAutoEnded', student: null, context: { id: 'ctx-3a', classId: 'c-3a', className: '3-A', subjectName: { en: 'English' } }, entity: 'lesson', goalId: null, count: 1, localDate: '2026-11-09', createdAt: 1, updatedAt: 1, read: false, snippet: null, label: null, gone: false } satisfies NotificationItem;
    expect(deepLink(item)).toBeNull();
  });
});
