// @vitest-environment jsdom
/**
 * The teacher home's notices about forgotten lessons (S37, D-218), in English and Turkish: "still
 * running since" with when it ends by itself, End lesson (to the classroom's End Lesson for that
 * class+subject) and Still teaching (a queued classroom command; the banner goes at once), and "ended
 * by itself" with Got it (dismissed on the server, gone at once). The board's note with Still
 * teaching; End Lesson keeps the lesson alive while open and keeps its draft when the lesson ended
 * underneath; a late end's summary names what could not be saved; `?endLesson=` decisions.
 * Status regions with words and an icon, never colour alone. The Lesson saved summary of a lesson that
 * ended by itself says so and shows no length. Filling in End Lesson after an automatic end: the
 * notice says until when, with Fill in End Lesson; the flow (teacher area) shows a step it cannot
 * apply as not available; after the deadline it says it is closed. Fictional data only.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const queued: Array<{ type: string; payload: unknown; meta?: unknown }> = [];
vi.mock('../../src/client/lib/outbox-client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/outbox-client.ts')>()),
  getOutbox: () => ({
    enqueue: (type: string, payload: unknown, meta?: unknown) => {
      queued.push({ type, payload, meta });
      return Promise.resolve(`op-${queued.length}`);
    },
  }),
}));
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => {
  const api = await importOriginal<typeof import('../../src/client/lib/api.ts')>();
  return {
    ...api,
    call: (ep: { path: string }, input: unknown) => {
      calls.push({ path: ep.path, input });
      // Only reached when a test has not put the fill-in data in the cache: the window is closed.
      if (ep.path.endsWith('/fill-in')) return Promise.reject(new api.ApiError(409, 'CONFLICT', 'closed', { reason: 'LESSON_FILL_IN_CLOSED' }));
      return Promise.resolve({ ok: true });
    },
  };
});

const { queryClient } = await import('../../src/client/lib/queryClient.ts');
const { I18nProvider } = await import('../../src/client/lib/i18n.tsx');
const { LessonNotices, LESSON_NOTICES_KEY } = await import('../../src/client/modules/lessons/LessonNotices.tsx');
const { LessonSummaryView } = await import('../../src/client/modules/lessons/EndLesson.tsx');
const { deepLink } = await import('../../src/client/modules/notifications/NotificationsPage.tsx');
const { OverdueNote } = await import('../../src/client/modules/lessons/OverdueNote.tsx');
const { EndLessonFlow, END_LESSON_IDLE_MS, END_LESSON_KEEPALIVE_MS } = await import('../../src/client/modules/lessons/EndLesson.tsx');
const { endLessonTarget } = await import('../../src/client/routes/Classroom.tsx');
const { endStepUis } = await import('../../src/client/modules/registry.ts');
const { LateEndLesson, lessonFillInKey } = await import('../../src/client/modules/lessons/LateEndLesson.tsx');

const tz = 'Europe/Istanbul';
const startedAt = Date.UTC(2026, 10, 9, 7, 5); // 10:05 in Istanbul
const notices: Notices = {
  running: [{ lessonId: 'lesson-run', contextId: 'ctx-3a', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-09', startedAt, autoEndAt: startedAt + 2 * 3600_000, timezone: tz }],
  autoEnded: [{ lessonId: 'lesson-auto', contextId: 'ctx-3a', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-06', startedAt: Date.UTC(2026, 10, 6, 9, 0), endedAt: Date.UTC(2026, 10, 6, 11, 0), fillInUntil: Date.UTC(2026, 10, 9, 21, 0), timezone: tz }],
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
  queued.length = 0;
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, refetchInterval: false, refetchOnMount: false } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('teacher home notices (S37, D-218)', () => {
  for (const [locale, m, subject, date, until] of [
    ['en', en, 'English', 'Friday 6 November', 'Monday 9 November'],
    ['tr', tr, 'İngilizce', '6 Kasım Cuma', '9 Kasım Pazartesi'],
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
      fireEvent.click(screen.getByRole('button', { name: m['lessonNotice.stillTeaching'] }));
      expect(queued).toEqual([{ type: 'lesson.stillTeaching', payload: { contextId: 'ctx-3a', lessonId: 'lesson-run' }, meta: { contextId: 'ctx-3a', lessonId: 'lesson-run' } }]);
      await waitFor(() => expect(screen.queryByTestId('lesson-notice-running')).toBeNull());
      act(() => queryClient.setQueryData(LESSON_NOTICES_KEY, notices));

      const auto = screen.getByTestId('lesson-notice-auto-ended');
      // S37 (D-218): until when it can be filled in (the server's deadline, shown as weekday and date), with the button.
      expect(auto.textContent).toContain(fill(m['lessonNotice.autoEnded'], { cls: `3-A · ${subject}`, date, time: '14:00', until }));
      const fillIn = screen.getByRole('link', { name: m['lessonNotice.fillIn'] });
      expect(fillIn.getAttribute('href')).toBe('/teacher');
      expect(JSON.parse(fillIn.getAttribute('data-search')!)).toEqual({ fillIn: 'lesson-auto' });
      expect(fillIn.className).toContain('primary');
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

const live = { id: 'lesson-run', contextId: 'ctx-3a', status: 'active', startedAt, endedAt: null, localDate: '2026-11-09', endSteps: [], overdue: true, autoEndAt: startedAt + 150 * 60_000 } as never;
const ctx3a = { id: 'ctx-3a', classId: 'c-3a', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, timezone: tz, modules: {} } as never;

describe('the board and End Lesson keep a lesson in use alive (S37, D-218)', () => {
  for (const [locale, m] of [
    ['en', en],
    ['tr', tr],
  ] as const) {
    it(`the board note says when it ends by itself and Still teaching sends the command (${locale})`, () => {
      wrap(locale, <OverdueNote lesson={live} timezone={tz} />);
      const note = screen.getByTestId('lesson-overdue-note');
      expect(note.getAttribute('role')).toBe('status');
      expect(note.textContent).toContain(fill(m['lessonNotice.board'], { time: '12:35' }));
      fireEvent.click(screen.getByRole('button', { name: m['lessonNotice.stillTeaching'] }));
      expect(queued.map((q) => [q.type, q.payload])).toEqual([['lesson.stillTeaching', { contextId: 'ctx-3a', lessonId: 'lesson-run' }]]);
    });
  }

  it('an open End Lesson says Still teaching when it opens and every few minutes, and stops once the lesson ended', () => {
    vi.useFakeTimers();
    try {
      const props = { context: ctx3a, lesson: live, draft: null, onDraft: () => {}, onCancel: () => {}, onEnded: () => {}, onQueued: () => {} };
      const view = wrap('en', <EndLessonFlow {...props} live />);
      expect(queued.map((q) => q.type)).toEqual(['lesson.stillTeaching']);
      act(() => vi.advanceTimersByTime(END_LESSON_KEEPALIVE_MS));
      expect(queued).toHaveLength(2);
      expect(screen.queryByTestId('end-lesson-ended-underneath')).toBeNull();
      // The lesson ended underneath: the flow stays (with Save), a note says so, no more pings.
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en">
            <EndLessonFlow {...props} live={false} />
          </I18nProvider>
        </QueryClientProvider>,
      );
      expect(screen.getByTestId('end-lesson-ended-underneath').textContent).toBe(en['lesson.endedUnderneath']);
      expect(screen.getByRole('button', { name: en['lesson.saveAndEnd'] })).toBeTruthy();
      act(() => vi.advanceTimersByTime(3 * END_LESSON_KEEPALIVE_MS));
      expect(queued).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an End Lesson nobody touches for 30 minutes stops the pings; any input starts them again', () => {
    vi.useFakeTimers();
    try {
      wrap('en', <EndLessonFlow context={ctx3a} lesson={live} live draft={null} onDraft={() => {}} onCancel={() => {}} onEnded={() => {}} onQueued={() => {}} />);
      expect(END_LESSON_IDLE_MS).toBe(3 * END_LESSON_KEEPALIVE_MS);
      act(() => vi.advanceTimersByTime(2 * END_LESSON_KEEPALIVE_MS));
      expect(queued).toHaveLength(3); // on opening, at 10 and at 20 minutes
      act(() => vi.advanceTimersByTime(3 * END_LESSON_KEEPALIVE_MS));
      expect(queued).toHaveLength(3); // idle since the opening: no ping at 30, 40, 50
      fireEvent.pointerDown(screen.getByRole('heading', { level: 2 }));
      expect(queued).toHaveLength(4); // input: at once
      act(() => vi.advanceTimersByTime(END_LESSON_KEEPALIVE_MS));
      expect(queued).toHaveLength(5);
      fireEvent.keyDown(screen.getByTestId('end-lesson'), { key: 'Tab' });
      act(() => vi.advanceTimersByTime(2 * END_LESSON_KEEPALIVE_MS));
      expect(queued).toHaveLength(7); // a key also counts
      expect(queued.every((q) => q.type === 'lesson.stillTeaching')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late End Lesson summary names the steps it could not save', () => {
    const late = { id: 'lesson-auto', contextId: 'ctx-3a', status: 'ended', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, localDate: '2026-11-09', startedAt, endedAt: startedAt + 3600_000, routineName: { en: 'Default', tr: 'Varsayılan' }, stageCount: 0, stageReached: 0, attendance: null, reflection: { rating: 4, note: null }, lessonGoal: null, autoEnded: false, notApplied: ['secretStudents'] } satisfies LessonSummary;
    wrap('en', <LessonSummaryView lessonId="lesson-auto" timezone={tz} initial={late} onDone={() => {}} />);
    const title = en[endStepUis(['secretStudents'])[0]!.title as keyof typeof en];
    expect(screen.getByTestId('summary-not-applied').textContent).toBe(fill(en['summary.notApplied'], { steps: title }));
    expect(screen.queryByTestId('summary-auto-ended')).toBeNull();
  });
});

describe('filling in End Lesson for a lesson that ended by itself (S37, D-218)', () => {
  const endedAt = Date.UTC(2026, 10, 6, 11, 0); // Friday 14:00 in Istanbul
  const data = {
    state: {
      lesson: { id: 'lesson-auto', contextId: 'ctx-3a', status: 'ended', startedAt: endedAt - 3600_000, endedAt, localDate: '2026-11-06', version: 3, className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' }, routine: { templateId: null, name: { en: 'Default' }, stages: [] }, stageIndex: 0, timer: { running: false, startedAt: null, remainingMs: 0, durationMs: 0 }, topics: [], display: { assistantVisible: null }, endSteps: ['secretStudents', 'reflection'], overdue: false, autoEndAt: endedAt },
      today: { localDate: '2026-11-06', weekday: 5, timezone: tz, closure: null },
      serverNow: endedAt,
      attendanceStamp: 'off',
      counters: null,
      secret: null,
      assistant: null,
      grouping: null,
      lessonGoal: null,
    },
    contextId: 'ctx-3a',
    className: '3-A',
    subjectName: { en: 'English', tr: 'İngilizce' },
    timezone: tz,
    endedAt,
    fillInUntil: Date.UTC(2026, 10, 9, 21, 0),
    notAvailable: ['secretStudents'],
  };
  for (const [locale, m, until] of [
    ['en', en, 'Monday 9 November'],
    ['tr', tr, '9 Kasım Pazartesi'],
  ] as const) {
    it(`opens the normal End Lesson for that lesson, says until when, and shows a step it cannot apply as not available (${locale})`, () => {
      queryClient.setQueryData(lessonFillInKey('lesson-auto'), data);
      wrap(locale, <LateEndLesson lessonId="lesson-auto" onClose={() => {}} onSaved={() => {}} />);
      expect(screen.getByTestId('end-lesson-fill-in').textContent).toBe(fill(m['lessonFillIn.intro'], { time: '14:00', until }));
      const title = m[endStepUis(['secretStudents'])[0]!.title as keyof typeof m];
      expect(screen.getByTestId('end-step-not-available').textContent).toBe(fill(m['summary.notApplied'], { steps: title }));
      expect(screen.getByRole('heading', { name: m['reflection.title'] })).toBeTruthy();
      expect(screen.getByRole('button', { name: m['lesson.saveAndEnd'] })).toBeTruthy();
      // Not a running lesson: no "Still teaching" pings, no "ended underneath" note.
      expect(queued).toEqual([]);
      expect(screen.queryByTestId('end-lesson-ended-underneath')).toBeNull();
    });

    it(`after the deadline it says the window is closed and offers no flow (${locale})`, async () => {
      wrap(locale, <LateEndLesson lessonId="lesson-closed" onClose={() => {}} onSaved={() => {}} />);
      await waitFor(() => expect(screen.getByTestId('lesson-fill-in-closed')).toBeTruthy());
      expect(screen.getByTestId('lesson-fill-in-closed').textContent).toContain(m['error.LESSON_FILL_IN_CLOSED']);
      expect(screen.queryByTestId('end-lesson')).toBeNull();
      expect(screen.getByRole('link', { name: m['lessonFillIn.back'] })).toBeTruthy();
    });
  }
});

describe('?endLesson= on the classroom page (S37, D-218)', () => {
  const base = { wanted: 'ctx-3a', ids: ['ctx-3a', 'ctx-3b'], activeId: 'ctx-3a', lessonLoaded: true, lessonId: 'lesson-run' };
  it('opens End Lesson for a running lesson of that class+subject', () => {
    expect(endLessonTarget({ ...base, activeId: 'ctx-3b' })).toBe('switch');
    expect(endLessonTarget({ ...base, lessonLoaded: false })).toBe('wait');
    expect(endLessonTarget(base)).toBe('open');
  });
  it('drops a wrong id, and only shows the class when its lesson ended meanwhile', () => {
    expect(endLessonTarget({ ...base, wanted: 'ctx-someone-else' })).toBe('clear');
    expect(endLessonTarget({ ...base, lessonId: null })).toBe('clear');
  });
});

describe('lesson lines on the notifications page (S37, D-218)', () => {
  it('a notice about a lesson has no student and opens no teacher page', () => {
    const item = { id: 'n1', category: 'lessonAutoEnded', student: null, context: { id: 'ctx-3a', classId: 'c-3a', className: '3-A', subjectName: { en: 'English' } }, entity: 'lesson', goalId: null, count: 1, localDate: '2026-11-09', createdAt: 1, updatedAt: 1, read: false, snippet: null, label: null, gone: false, fillIn: null } satisfies NotificationItem;
    expect(deepLink(item)).toBeNull();
  });
});
