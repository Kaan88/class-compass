/**
 * The student statistics drawer (S14e2, D-154), opened by a student name anywhere in the teacher area
 * (`ui/StudentName.tsx`; loaded lazily). It shows one student in one class+subject and period:
 * - a class+subject picker (the teacher's own class+subjects the student was in, current first) and a
 *   period picker (week, month, term, school year);
 * - the student's report with the built-in "Student overview" view (`contextReport` with `studentId`
 *   and its sections), drawn compactly (no charts, no CSV links);
 * - the student's latest timeline events (at most 20, newest first);
 * - "Open full report": the reports page deep link with this class+subject, student, view and period.
 * Everything is teacher-only data: the queries are `['sensitive', …]` (purged on lock) and the drawer
 * lives inside the PIN gate of the teacher area. It is never shown on the classroom screen.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { presetRange, type PeriodPreset } from '../../domain/periods.ts';
import * as R from '../../shared/contracts/reports.ts';
import { formatDay, pickText, type MessageKey } from '../../shared/i18n/index.ts';
import { BUILTIN_VIEWS, sectionsParam } from '../../shared/reportViews.ts';
import { call } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { SENSITIVE } from '../lib/queryClient.ts';
import { Modal } from '../ui/Dialog.tsx';
import { Alert, EmptyState } from '../ui/Feedback.tsx';
import { Select } from '../ui/Fields.tsx';
import { IconChart } from '../ui/icons.tsx';
import type { StudentStatsTarget } from '../ui/StudentName.tsx';
import { linkSearch } from './ReportsPage.tsx';
import { SectionView, useLabel } from './ReportView.tsx';

/** The periods the drawer offers (the full report has every preset). */
export const DRAWER_PERIODS = ['week', 'month', 'term', 'year'] as const satisfies readonly PeriodPreset[];
type DrawerPeriod = (typeof DRAWER_PERIODS)[number];
/** How many timeline events the drawer lists. */
export const DRAWER_EVENTS = 20;
const OVERVIEW_SECTIONS = sectionsParam(BUILTIN_VIEWS.studentOverview);

/** The class+subject to show first: the page's own, else a current one of the page's class, else the first (current first). */
export function preferredContext(list: readonly R.ReportContextInfo[], target: Pick<StudentStatsTarget, 'contextId' | 'classId'>): R.ReportContextInfo | undefined {
  return list.find((c) => c.id === target.contextId) ?? list.find((c) => c.classId === target.classId && !c.ended) ?? list.find((c) => c.classId === target.classId) ?? list[0];
}

export function StudentStatsDrawer({ target, onClose }: { target: StudentStatsTarget; onClose: () => void }) {
  const { t, locale } = useI18n();
  const label = useLabel();
  const contexts = useQuery({
    queryKey: [SENSITIVE, 'teacher', 'studentStats', 'contexts', target.studentId],
    queryFn: () => call(R.studentReportContexts, { studentId: target.studentId }),
  });
  const list = contexts.data?.contexts ?? [];
  const [chosen, setChosen] = useState('');
  const [period, setPeriod] = useState<DrawerPeriod>('term');
  const info = list.find((c) => c.id === chosen) ?? preferredContext(list, target);

  const range = useMemo(() => {
    if (!info) return null;
    const cal = { today: info.today, weekStartsOn: info.weekStartsOn, year: { from: info.year.startsOn, to: info.year.endsOn }, terms: info.terms.map((x) => ({ from: x.startsOn, to: x.endsOn })) };
    const r = presetRange(period, cal);
    // Nothing is recorded in the future: a period that is still running ends today.
    return info.today >= r.from && info.today < r.to ? { from: r.from, to: info.today } : r;
  }, [info, period]);

  // The same keys as the reports page, so opening the full report reuses what is loaded.
  const input = { contextId: info?.id ?? '', from: range?.from, to: range?.to, studentId: target.studentId };
  const report = useQuery({
    queryKey: [SENSITIVE, 'teacher', 'reports', input, OVERVIEW_SECTIONS ?? null],
    queryFn: () => call(R.contextReport, { ...input, sections: OVERVIEW_SECTIONS }),
    enabled: Boolean(info && range),
  });
  const timeline = useQuery({
    queryKey: [SENSITIVE, 'teacher', 'reports', 'timeline', input],
    queryFn: () => call(R.studentTimeline, { contextId: input.contextId, studentId: target.studentId, from: range?.from, to: range?.to }),
    enabled: Boolean(info && range),
  });
  const events = (timeline.data?.events ?? []).slice(-DRAWER_EVENTS).reverse();
  const ctxLabel = (c: R.ReportContextInfo) => `${c.className} · ${pickText(c.subjectName, locale)} · ${c.year.name}${c.ended ? ` (${t('report.ui.ended')})` : ''}`;

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} title={t('studentStats.title', { name: target.name })} size="drawer" testId="student-stats" closeButton>
      <p className="cc-muted">{t('studentStats.private')}</p>
      {contexts.error ? <Alert>{errorText(t, contexts.error)}</Alert> : null}
      {contexts.isLoading ? <p className="cc-muted">{t('common.loading')}</p> : null}
      {contexts.data && !info ? <EmptyState title={t('studentStats.noContexts', { name: target.name })} mascot={false} /> : null}
      {info ? (
        <>
          <div className="cc-stats-filters">
            <Select label={t('report.ui.context')} items={list.map((c) => ({ id: c.id, label: ctxLabel(c) }))} value={info.id} onChange={setChosen} />
            <Select label={t('report.ui.period')} items={DRAWER_PERIODS.map((p) => ({ id: p, label: t(`report.preset.${p}` as MessageKey) }))} value={period} onChange={(v) => setPeriod(v as DrawerPeriod)} />
          </div>
          {range ? <p className="cc-muted">{t('report.ui.header', { from: formatDay(range.from, locale), to: formatDay(range.to, locale), teacher: info.teacherName, year: info.year.name })}</p> : null}
          <Link
            to="/teacher/$page"
            params={{ page: 'reports' }}
            search={linkSearch({ contextId: info.id, studentId: target.studentId, view: 'studentOverview', period })}
            className="cc-btn cc-btn--primary cc-btn--md cc-stats-full"
            onClick={onClose}
          >
            <IconChart />
            {t('studentStats.openFull')}
          </Link>
          {report.error ? <Alert>{errorText(t, report.error)}</Alert> : null}
          {report.data ? (
            <div className="cc-stack cc-stats-report" data-testid="student-stats-report">
              {report.data.sections.map((s) => (
                <SectionView key={s.key} section={s} compact />
              ))}
            </div>
          ) : report.isLoading ? (
            <p className="cc-muted">{t('common.loading')}</p>
          ) : null}
          {timeline.data ? (
            <section className="cc-card cc-stack" aria-labelledby="stats-recent">
              <h3 className="cc-h2" id="stats-recent">
                {t('studentStats.recent')}
              </h3>
              {events.length ? (
                <>
                  <p className="cc-muted">{t('studentStats.recentNote', { count: events.length })}</p>
                  <ol className="cc-timeline" data-testid="student-stats-events">
                    {events.map((e, i) => (
                      <li key={i}>
                        <time dateTime={e.date}>{formatDay(e.date, locale)}</time>
                        <strong>{label(e.what)}</strong>
                        {e.detail ? ` – ${label(e.detail)}` : ''}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="cc-muted">{t('report.ui.noEvents')}</p>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
