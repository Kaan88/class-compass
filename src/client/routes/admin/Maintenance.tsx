/**
 * Admin: Maintenance (OPS-2..5), data exports (DAT-4/5), the school-year rollover wizard (DAT-1/2)
 * and reports (RPT-1, school-wide usage). Backups and verification need the administrator's PIN;
 * the full export and the rollover need typed confirmation. Everything is audited server-side.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as M from '../../../shared/contracts/maintenance.ts';
import * as R from '../../../shared/contracts/reports.ts';
import * as School from '../../../shared/contracts/school.ts';
import * as St from '../../../shared/contracts/students.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { call, urlFor } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useRun } from '../../lib/useRun.ts';
import { ReportsPage } from '../../reports/ReportsPage.tsx';
import { SectionView } from '../../reports/ReportView.tsx';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive, Modal } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { PinPad } from '../../ui/PinPad.tsx';
import { Tabs } from '../../ui/Tabs.tsx';
import { ADMIN } from './Admin.tsx';

const KEY = [...ADMIN, 'maintenance'] as const;

function bytes(n: number | null, locale: string): string {
  if (n === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 1 }).format(v)} ${units[i]}`;
}

function RunLine({ run, label }: { run: M.BackupRunDto | null; label: string }) {
  const { t, locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="cc-report-metric">
      <dt>{label}</dt>
      <dd>
        {run ? (
          <>
            <span className="cc-metric" data-state={run.status === 'ok' ? 'value' : 'not-recorded'}>
              {run.status === 'ok' ? t('maint.ok') : t('maint.failed')}
            </span>{' '}
            <span className="cc-muted">{fmt.format(run.finishedAt)}</span>
          </>
        ) : (
          <span className="cc-metric" data-state="not-recorded">
            — {t('maint.never')}
          </span>
        )}
      </dd>
    </div>
  );
}

function PinAction({ label, busyLabel, onPin }: { label: string; busyLabel: string; onPin: (pin: string) => Promise<unknown> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="primary" onPress={() => setOpen(true)} isDisabled={busy}>
        {busy ? busyLabel : label}
      </Button>
      <Modal isOpen={open} onOpenChange={setOpen} title={label}>
        <p>{t('maint.pinExplain')}</p>
        <PinPad
          busy={busy}
          error={error}
          submitLabel={label}
          onSubmit={async (pin) => {
            setBusy(true);
            setError(null);
            try {
              await onPin(pin);
              setOpen(false);
            } catch (err) {
              setError(errorText(t, err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Modal>
    </>
  );
}

export function MaintenancePanel() {
  const { t, locale } = useI18n();
  const run = useRun();
  const status = useQuery({ queryKey: [...KEY, 'status'], queryFn: () => call(M.maintenanceStatus, {}) });
  const s = status.data;
  if (!s) return status.error ? <Alert>{errorText(t, status.error)}</Alert> : <p className="cc-muted">{t('common.loading')}</p>;
  const fmt = new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="cc-stack">
      {s.offsiteStale ? <Alert kind="warning">{t('maint.offsiteStale', { hours: s.offsiteStaleHours })}</Alert> : null}
      {s.lastLocal && s.lastLocal.status === 'failed' ? <Alert>{t('maint.lastLocalFailed')}</Alert> : null}
      {s.migration.pending > 0 ? <Alert kind="warning">{t('maint.pendingMigrations', { count: s.migration.pending })}</Alert> : null}
      <dl className="cc-report-metrics">
        <RunLine run={s.lastLocal} label={t('maint.lastLocal')} />
        <RunLine run={s.lastOffsite} label={t('maint.lastOffsite')} />
        <RunLine run={s.lastVerify} label={t('maint.lastVerify')} />
        <RunLine run={s.lastRestore} label={t('maint.lastRestore')} />
        <div className="cc-report-metric">
          <dt>{t('maint.disk')}</dt>
          <dd>{t('maint.diskFree', { free: bytes(s.disk.freeBytes, locale), total: bytes(s.disk.totalBytes, locale) })}</dd>
        </div>
        <div className="cc-report-metric">
          <dt>{t('maint.dataSize')}</dt>
          <dd>{t('maint.dataSizes', { db: bytes(s.disk.databaseBytes, locale), uploads: bytes(s.disk.uploadsBytes, locale), backups: bytes(s.disk.backupsBytes, locale) })}</dd>
        </div>
        <div className="cc-report-metric">
          <dt>{t('maint.version')}</dt>
          <dd>
            <code>{s.appVersion}</code>
          </dd>
        </div>
        <div className="cc-report-metric">
          <dt>{t('maint.migration')}</dt>
          <dd>
            <span className="cc-metric">
              {s.migration.applied}
              <span className="cc-metric__den"> / {s.migration.shipped}</span>
            </span>{' '}
            <code>{s.migration.latestTag ?? '—'}</code>
          </dd>
        </div>
      </dl>
      <p className="cc-muted">{s.offsiteConfigured ? t('maint.offsiteConfigured') : t('maint.offsiteNotConfigured')}</p>
      <p className="cc-muted">{t('maint.retention', { hourly: s.retention.hourly, daily: s.retention.daily, monthly: s.retention.monthly })}</p>
      <div className="cc-row">
        <PinAction
          label={t('maint.backupNow')}
          busyLabel={t('maint.backingUp')}
          onPin={async (pin) => {
            const r = await call(M.runBackupNow, { pin });
            await run(async () => r, { success: r.run.status === 'ok' ? t('maint.backupDone') : t('maint.failed'), invalidate: [KEY] });
          }}
        />
        <PinAction
          label={t('maint.verifyNow')}
          busyLabel={t('maint.verifying')}
          onPin={async (pin) => {
            const r = await call(M.verifyLatestBackup, { pin });
            await run(async () => r, { success: r.run.status === 'ok' ? t('maint.verifyDone') : t('maint.verifyFailed'), invalidate: [KEY] });
          }}
        />
      </div>
      <div className="cc-table-wrap">
        <table className="cc-table">
          <caption>{t('maint.backups')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('maint.file')}</th>
              <th scope="col">{t('maint.kind')}</th>
              <th scope="col">{t('maint.when')}</th>
              <th scope="col" className="cc-num">
                {t('maint.size')}
              </th>
            </tr>
          </thead>
          <tbody>
            {s.backups.length ? (
              s.backups.map((b) => (
                <tr key={b.name}>
                  <th scope="row">
                    <code>{b.name}</code>
                  </th>
                  <td>{t(`maint.kind.${b.kind}` as MessageKey)}</td>
                  <td>{fmt.format(b.at)}</td>
                  <td className="cc-num">{bytes(b.size, locale)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="cc-muted">
                  {t('maint.noBackups')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="cc-muted">{t('maint.cliHint')}</p>
    </div>
  );
}

function ExportReadyLink({ ready }: { ready: M.ExportReady }) {
  const { t, locale } = useI18n();
  return (
    <Alert kind="success">
      {t('export.ready', { size: bytes(ready.sizeBytes, locale) })}{' '}
      <a href={urlFor(M.downloadExport, { token: ready.token })} download={ready.fileName}>
        {t('export.download')}
      </a>
    </Alert>
  );
}

export function ExportsPanel() {
  const { t } = useI18n();
  const run = useRun();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [includeUploads, setIncludeUploads] = useState(true);
  const [full, setFull] = useState<M.ExportReady | null>(null);
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState('');
  const [one, setOne] = useState<M.ExportReady | null>(null);
  const found = useQuery({
    queryKey: [...KEY, 'students', q],
    queryFn: () => call(St.adminListStudents, { q, includeDeactivated: true, page: 1, pageSize: 50 }),
    enabled: q.trim().length >= 2,
  });
  return (
    <div className="cc-stack">
      <section className="cc-card cc-stack" aria-labelledby="exp-full">
        <h2 className="cc-h2" id="exp-full">
          {t('export.fullTitle')}
        </h2>
        <p>{t('export.fullExplain')}</p>
        <Toggle label={t('export.includeUploads')} isSelected={includeUploads} onChange={setIncludeUploads} />
        <div className="cc-row">
          <Button variant="primary" onPress={() => setConfirmOpen(true)}>
            {t('export.prepare')}
          </Button>
        </div>
        {full ? <ExportReadyLink ready={full} /> : null}
        <ConfirmDestructive
          isOpen={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('export.fullTitle')}
          description={t('export.confirmExplain', { word: M.FULL_EXPORT_CONFIRM })}
          confirmText={M.FULL_EXPORT_CONFIRM}
          actionLabel={t('export.prepare')}
          onConfirm={async () => {
            const r = await call(M.createFullExport, { confirm: M.FULL_EXPORT_CONFIRM, includeUploads });
            setFull(r);
          }}
        />
      </section>
      <section className="cc-card cc-stack" aria-labelledby="exp-one">
        <h2 className="cc-h2" id="exp-one">
          {t('export.studentTitle')}
        </h2>
        <p>{t('export.studentExplain')}</p>
        <div className="cc-report-filters">
          <TextField label={t('export.search')} value={q} onChange={setQ} />
          <Select
            label={t('report.ui.student')}
            items={(found.data?.students ?? []).map((s) => ({ id: s.id, label: s.fullName }))}
            value={studentId}
            onChange={setStudentId}
            placeholder={t('export.pickStudent')}
          />
          <Button
            isDisabled={!studentId}
            onPress={async () => {
              const r = await run(() => call(M.createStudentExport, { studentId }));
              if (r) setOne(r);
            }}
          >
            {t('export.prepare')}
          </Button>
        </div>
        {one ? <ExportReadyLink ready={one} /> : null}
      </section>
    </div>
  );
}

export function RolloverPanel() {
  const { t } = useI18n();
  const run = useRun();
  const years = useQuery({ queryKey: [...ADMIN, 'years'], queryFn: () => call(School.listYears, {}) });
  const list = years.data?.years ?? [];
  const [fromYearId, setFromYearId] = useState('');
  const from = list.find((y) => y.id === (fromYearId || list.find((x) => !x.archived)?.id));
  const [form, setForm] = useState({ name: '', startsOn: '', endsOn: '' });
  const [opts, setOpts] = useState({ copyClasses: true, copyAssignments: true, promote: true, archiveOld: true });
  const [plan, setPlan] = useState<M.RolloverPlan | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const input = from ? { fromYearId: from.id, ...form, ...opts } : null;
  const ready = Boolean(input && form.name && form.startsOn && form.endsOn);
  return (
    <section className="cc-card cc-stack" aria-labelledby="roll">
      <h2 className="cc-h2" id="roll">
        {t('rollover.title')}
      </h2>
      <p>{t('rollover.explain')}</p>
      <div className="cc-report-filters">
        <Select label={t('rollover.fromYear')} items={list.map((y) => ({ id: y.id, label: y.archived ? `${y.name} (${t('report.ui.ended')})` : y.name }))} value={from?.id ?? ''} onChange={setFromYearId} />
        <TextField label={t('rollover.newName')} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="2027–2028" />
        <TextField label={t('rollover.startsOn')} value={form.startsOn} onChange={(v) => setForm((f) => ({ ...f, startsOn: v }))} placeholder="2027-09-01" />
        <TextField label={t('rollover.endsOn')} value={form.endsOn} onChange={(v) => setForm((f) => ({ ...f, endsOn: v }))} placeholder="2028-06-30" />
      </div>
      <div className="cc-stack">
        <Toggle label={t('rollover.copyClasses')} isSelected={opts.copyClasses} onChange={(v) => setOpts((o) => ({ ...o, copyClasses: v, copyAssignments: v && o.copyAssignments, promote: v && o.promote }))} />
        <Toggle label={t('rollover.copyAssignments')} isSelected={opts.copyAssignments} isDisabled={!opts.copyClasses} onChange={(v) => setOpts((o) => ({ ...o, copyAssignments: v }))} />
        <Toggle label={t('rollover.promote')} isSelected={opts.promote} isDisabled={!opts.copyClasses} onChange={(v) => setOpts((o) => ({ ...o, promote: v }))} />
        <Toggle label={t('rollover.archiveOld')} isSelected={opts.archiveOld} onChange={(v) => setOpts((o) => ({ ...o, archiveOld: v }))} />
      </div>
      <div className="cc-row">
        <Button
          isDisabled={!ready}
          onPress={async () => {
            const p = await run(() => call(M.rolloverPreview, input!));
            if (p) setPlan(p);
          }}
        >
          {t('rollover.preview')}
        </Button>
        <Button variant="danger" isDisabled={!plan || plan.problems.length > 0} onPress={() => setConfirm(true)}>
          {t('rollover.apply')}
        </Button>
      </div>
      {plan ? (
        <div className="cc-stack">
          {plan.problems.map((p, i) => (
            <Alert key={i}>{t(`rollover.problem.${p.reason}` as MessageKey)}</Alert>
          ))}
          <div className="cc-table-wrap">
            <table className="cc-table">
              <caption>{t('rollover.planCaption', { year: plan.fromYear.name })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('rollover.oldClass')}</th>
                  <th scope="col">{t('rollover.newClass')}</th>
                  <th scope="col" className="cc-num">
                    {t('rollover.students')}
                  </th>
                  <th scope="col" className="cc-num">
                    {t('rollover.assignments')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.classes.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td>{opts.copyClasses ? c.newName : '—'}</td>
                    <td className="cc-num">{c.activeStudents}</td>
                    <td className="cc-num">{c.assignments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {done ? <Alert kind="success">{done}</Alert> : null}
      {plan && input ? (
        <ConfirmDestructive
          isOpen={confirm}
          onOpenChange={setConfirm}
          title={t('rollover.apply')}
          description={t('rollover.confirmExplain', { year: plan.fromYear.name })}
          confirmText={plan.fromYear.name}
          actionLabel={t('rollover.apply')}
          onConfirm={async () => {
            const r = await call(M.rolloverApply, { ...input, confirm: plan.fromYear.name });
            setDone(t('rollover.done', { classes: r.classesCreated, assignments: r.assignmentsCreated, students: r.studentsPromoted }));
            setPlan(null);
          }}
        />
      ) : null}
    </section>
  );
}

function UsagePanel() {
  const { t, locale } = useI18n();
  const usage = useQuery({ queryKey: [...ADMIN, 'usage'], queryFn: () => call(R.usageReport, {}) });
  if (!usage.data) return usage.error ? <Alert>{errorText(t, usage.error)}</Alert> : <p className="cc-muted">{t('common.loading')}</p>;
  const u = usage.data;
  return (
    <div className="cc-stack cc-print-sheet">
      <p className="cc-muted">{t('report.ui.usageHeader', { school: u.schoolName, from: u.from, to: u.to })}</p>
      {u.sections.map((s) => (
        <SectionView key={s.key} section={s} csvHref={(table) => urlFor(R.usageReportCsv, { section: s.key, table, delimiter: locale === 'tr' ? 'semicolon' : 'comma' })} />
      ))}
    </div>
  );
}

export function AdminReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState('usage');
  return (
    <main className="cc-page cc-page--wide cc-stack">
      <h1 className="cc-h1">{t('admin.reports')}</h1>
      <Tabs
        label={t('admin.reports')}
        selectedKey={tab}
        onSelectionChange={setTab}
        items={[
          { id: 'usage', label: t('report.ui.usage'), content: <UsagePanel /> },
          { id: 'contexts', label: t('report.ui.byContext'), content: <ReportsPage viewer="admin" /> },
        ]}
      />
    </main>
  );
}

export function MaintenancePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState('backups');
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('admin.maintenance')}</h1>
      <Tabs
        label={t('admin.maintenance')}
        selectedKey={tab}
        onSelectionChange={setTab}
        items={[
          { id: 'backups', label: t('maint.backupsTab'), content: <MaintenancePanel /> },
          { id: 'exports', label: t('maint.exportsTab'), content: <ExportsPanel /> },
          { id: 'rollover', label: t('maint.rolloverTab'), content: <RolloverPanel /> },
        ]}
      />
    </main>
  );
}

