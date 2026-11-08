/**
 * Reports page (RPT-1..6) for the teacher area (own class+subject contexts) and the admin area
 * (every context, without the teacher's lesson notes). Filters: class+subject, student, period preset
 * (day / week / month / term / school year / custom). Each table has a CSV link; Print gives an A4
 * summary with a header. A chosen student also gets their timeline (teacher area).
 */
import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '../../domain/periods.ts';
import * as R from '../../shared/contracts/reports.ts';
import { formatDay, pickText, type MessageKey } from '../../shared/i18n/index.ts';
import { call, urlFor } from '../lib/api.ts';
import { errorText } from '../lib/errors.ts';
import { useI18n } from '../lib/i18n.tsx';
import { SENSITIVE } from '../lib/queryClient.ts';
import { Button } from '../ui/Button.tsx';
import { Alert, EmptyState } from '../ui/Feedback.tsx';
import { Select } from '../ui/Fields.tsx';
import { IconPrint } from '../ui/icons.tsx';
import { SectionView, useLabel } from './ReportView.tsx';

/** Native date input (calendar picker on touch devices) with the usual field chrome. */
function DateInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="cc-field">
      <label htmlFor={id} className="cc-field__label">
        {label}
      </label>
      <input id={id} type="date" className="cc-input" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint ? (
        <span id={`${id}-h`} className="cc-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

type Viewer = 'teacher' | 'admin';
const presetKey = (p: PeriodPreset) => `report.preset.${p}` as MessageKey;

export function ReportsPage({ viewer, initialContextId }: { viewer: Viewer; initialContextId?: string | undefined }) {
  const { t, locale } = useI18n();
  const label = useLabel();
  const contexts = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', 'contexts'],
    queryFn: () => call(viewer === 'admin' ? R.adminReportContexts : R.reportContexts, {}),
  });
  const list = contexts.data?.contexts ?? [];
  const [chosen, setChosen] = useState<string>(initialContextId ?? '');
  const contextId = chosen || list[0]?.id || '';
  const info = list.find((c) => c.id === contextId);
  const [preset, setPreset] = useState<PeriodPreset>('year');
  const [anchor, setAnchor] = useState('');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [studentId, setStudentId] = useState('');

  const range = useMemo(() => {
    if (!info) return null;
    const cal = { today: info.today, weekStartsOn: info.weekStartsOn, year: { from: info.year.startsOn, to: info.year.endsOn }, terms: info.terms.map((x) => ({ from: x.startsOn, to: x.endsOn })) };
    const r = presetRange(preset, cal, anchor || undefined, custom.from && custom.to ? custom : undefined);
    // The school year runs to today at most (nothing is recorded in the future).
    return preset === 'year' && info.today >= r.from && info.today < r.to ? { from: r.from, to: info.today } : r;
  }, [info, preset, anchor, custom]);

  const input = { contextId, from: range?.from, to: range?.to, studentId: studentId || undefined };
  const report = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', input],
    queryFn: () => call(viewer === 'admin' ? R.adminContextReport : R.contextReport, input),
    enabled: Boolean(contextId && range),
  });
  const timeline = useQuery({
    queryKey: [SENSITIVE, viewer, 'reports', 'timeline', input],
    queryFn: () => call(R.studentTimeline, { contextId, studentId, from: range?.from, to: range?.to }),
    enabled: viewer === 'teacher' && Boolean(contextId && range && studentId),
  });
  const csvHref = (section: string) => (table: string) =>
    urlFor(viewer === 'admin' ? R.adminContextReportCsv : R.contextReportCsv, { ...input, section, table, delimiter: locale === 'tr' ? 'semicolon' : 'comma' });

  if (contexts.isLoading) return <p className="cc-muted">{t('common.loading')}</p>;
  if (!list.length) return <EmptyState title={t('report.ui.noContexts')} />;
  const data = report.data;
  const ctxLabel = (c: R.ReportContextInfo) => `${c.className} · ${pickText(c.subjectName, locale)}${viewer === 'admin' ? ` · ${c.teacherName}` : ''} · ${c.year.name}${c.ended ? ` (${t('report.ui.ended')})` : ''}`;
  return (
    <div className="cc-stack">
      <div className="cc-report-filters cc-noprint">
        <Select
          label={t('report.ui.context')}
          items={list.map((c) => ({ id: c.id, label: ctxLabel(c) }))}
          value={contextId}
          onChange={(v) => {
            setChosen(v);
            setStudentId('');
          }}
        />
        <Select label={t('report.ui.period')} items={PERIOD_PRESETS.map((p) => ({ id: p, label: t(presetKey(p)) }))} value={preset} onChange={(v) => setPreset(v as PeriodPreset)} />
        {preset === 'custom' ? (
          <>
            <DateInput label={t('report.ui.from')} value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
            <DateInput label={t('report.ui.to')} value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </>
        ) : preset !== 'year' ? (
          <DateInput label={t('report.ui.anchor')} value={anchor} onChange={setAnchor} hint={t('report.ui.anchorHint')} />
        ) : null}
        <Select
          label={t('report.ui.student')}
          items={[{ id: '', label: t('report.ui.wholeClass') }, ...(data?.students ?? []).map((s) => ({ id: s.id, label: s.active ? s.fullName : `${s.fullName} (${t('report.ui.inactive')})` }))]}
          value={studentId}
          onChange={setStudentId}
        />
        <Button onPress={() => window.print()}>
          <IconPrint />
          {t('report.ui.print')}
        </Button>
      </div>
      {report.error ? <Alert>{errorText(t, report.error)}</Alert> : null}
      {data ? (
        <div className="cc-stack cc-print-sheet" data-testid="report">
          <header className="cc-stack">
            <p className="cc-print-only">{data.schoolName}</p>
            <h2 className="cc-h2">
              {data.context.className} · {pickText(data.context.subjectName, locale)}
              {data.student ? ` · ${data.student.fullName}` : ''}
            </h2>
            <p className="cc-muted">
              {t('report.ui.header', { from: formatDay(data.from, locale), to: formatDay(data.to, locale), teacher: data.context.teacherName, year: data.context.year.name })}
            </p>
            <p className="cc-print-only cc-muted">{t('report.ui.generated', { at: new Date(data.generatedAt).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB') })}</p>
            {data.context.classNames.some((n) => n !== data.context.className) ? <p className="cc-muted">{t('report.ui.renamedClass', { names: data.context.classNames.join(', '), now: data.context.className })}</p> : null}
            <p className="cc-muted">{t('report.ui.rpt5')}</p>
          </header>
          {data.sections.map((s) => (
            <SectionView key={s.key} section={s} csvHref={csvHref(s.key)} />
          ))}
          {viewer === 'teacher' && studentId && timeline.data ? (
            <section className="cc-card cc-stack" aria-labelledby="sec-timeline">
              <h3 className="cc-h2" id="sec-timeline">
                {t('report.ui.timeline')}
              </h3>
              {timeline.data.truncated ? <p className="cc-muted">{t('report.ui.timelineTruncated')}</p> : null}
              {timeline.data.events.length ? (
                <ol className="cc-timeline">
                  {timeline.data.events.map((e, i) => (
                    <li key={i}>
                      <time dateTime={e.date}>{e.date}</time>
                      <strong>{label(e.what)}</strong>
                      {e.detail ? ` – ${label(e.detail)}` : ''}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cc-muted">{t('report.ui.noEvents')}</p>
              )}
            </section>
          ) : null}
        </div>
      ) : report.isLoading ? (
        <p className="cc-muted">{t('common.loading')}</p>
      ) : null}
    </div>
  );
}

/** Teacher-area page (manifest teacher page `/teacher/reports`). */
export function TeacherReportsPage({ search }: { search: Readonly<Record<string, string | undefined>> }) {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-page--wide cc-stack">
      <h1 className="cc-h1">{t('teacher.reports')}</h1>
      <ReportsPage viewer="teacher" initialContextId={search.contextId} />
    </main>
  );
}
