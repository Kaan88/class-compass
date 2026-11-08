/**
 * School-wide students (ACC-7, DAT-2/3, D-021/D-022/D-027): search, add, move, history, deactivate;
 * permanent deletion of a deactivated student with a dry-run summary and typed confirmation (S13b, D-109).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import * as S from '../../../shared/contracts/school.ts';
import * as L from '../../../shared/contracts/links.ts';
import * as St from '../../../shared/contracts/students.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive, DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { IconAlert, IconCheck, IconCopy, IconPrint, IconUserOff } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { whenText } from '../../modules/goals/shared.tsx';
import { AddStudentDialog } from '../teacher/Classes.tsx';
import { copyLink, EmergencyLinkDialog, LinkCardSheets, QrCode } from '../teacher/StudentLinks.tsx';
import { ADMIN } from './Admin.tsx';

type AdminStudent = z.infer<typeof St.AdminStudent>;
const STUDENTS = [...ADMIN, 'students'];

function HistoryDialog({ studentId, onClose }: { studentId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const detail = useQuery({ queryKey: [...STUDENTS, 'detail', studentId], queryFn: () => call(St.adminGetStudent, { studentId: studentId! }), enabled: Boolean(studentId) });
  return (
    <Modal isOpen={studentId !== null} onOpenChange={(o) => !o && onClose()} title={detail.data?.fullName ?? t('common.loading')}>
      {detail.data ? (
        <DataTable
          stack
          caption={t('students.history')}
          rows={detail.data.enrolments}
          rowKey={(e) => e.id}
          emptyText={t('students.noHistory')}
          columns={[
            { key: 'class', header: t('assign.class'), render: (e) => e.className },
            { key: 'from', header: t('common.startDate'), render: (e) => e.fromDate },
            { key: 'to', header: t('common.endDate'), render: (e) => e.toDate ?? '—' },
            { key: 'reason', header: t('students.reason'), render: (e) => t(`students.reason.${e.reason}`) },
          ]}
        />
      ) : null}
      <DialogActions>
        <Button variant="primary" onPress={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

/**
 * The student's permanent link (D-115) with the emergency actions (D-118): show, copy and print the
 * card; revoke it or make a new one only in an emergency (typed name, reason, audited).
 */
function LinkDialog({ student, onClose, onReactivate }: { student: AdminStudent | null; onClose: () => void; onReactivate: () => Promise<unknown> }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const key = [...STUDENTS, 'link', student?.id];
  const q = useQuery({ queryKey: key, queryFn: () => call(L.adminStudentLink, { studentId: student!.id }), enabled: Boolean(student), staleTime: 0 });
  const [emergency, setEmergency] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);
  if (!student) return null;
  const d = q.data;
  const url = d?.link?.url ?? null;
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} title={t('links.adminTitle', { name: student.fullName })}>
      {!d ? <p className="cc-muted">{t('common.loading')}</p> : null}
      {d && url && !student.active ? (
        // A deactivated student's link does not work: no QR code or address that could be printed or
        // handed out as if it did; reactivating the student is offered instead (usability audit).
        <div className="cc-stack" data-testid="admin-link-inactive">
          <Alert kind="warning">{t('links.inactive')}</Alert>
          <div>
            <Button onPress={() => void onReactivate()}>{t('links.reactivateStudent')}</Button>
          </div>
        </div>
      ) : null}
      {d && url && student.active ? (
        <div className="cc-stack" data-testid="admin-link">
          <QrCode text={url} label={t('links.qrFor', { name: student.fullName })} />
          <code className="cc-link-url">{url}</code>
          {d.link?.replacedAt ? <Alert kind="warning">{t('links.replacedOn', { date: whenText(d.link.replacedAt, locale) })}</Alert> : null}
          {student.active ? (
            <div className="cc-row">
              <Button onPress={() => void copyLink(t, url, student.fullName)}>
                <IconCopy />
                {t('links.copy')}
              </Button>
              <Button onPress={() => setPrinting(true)}>
                <IconPrint />
                {t('links.printOne')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {d && !url ? <Alert kind="warning">{d.revokedAt ? t('links.revokedOn', { date: whenText(d.revokedAt, locale) }) : student.active ? t('links.none') : t('links.inactive')}</Alert> : null}
      <p className="cc-muted">{t('links.warning')}</p>
      <DialogActions>
        {/* A deactivated student's leaked link can still be revoked (not replaced) at once (item 14a). */}
        <Button variant="ghost" isDisabled={!student.active && !d?.link} onPress={() => setEmergency(true)}>
          <IconAlert />
          {t('links.emergency.open')}
        </Button>
        <Button variant="primary" onPress={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
      {emergency ? (
        <EmergencyLinkDialog
          student={{ id: student.id, fullName: student.fullName, hasLink: Boolean(d?.link) }}
          revokeOnly={!student.active}
          onClose={() => setEmergency(false)}
          endpoint={L.adminEmergencyLink}
          onDone={(state) => qc.setQueryData(key, state)}
        />
      ) : null}
      {printing && url && d && student.active ? <LinkCardSheets cards={[{ id: student.id, fullName: student.fullName, className: d.className ?? '', url }]} size="small" cardLanguage={d.cardLanguage} mode="print" /> : null}
    </Modal>
  );
}

function MoveDialog({ ids, classes, onDone }: { ids: string[]; classes: Array<z.infer<typeof S.SchoolClass>>; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const targets = classes.filter((c) => !c.archived && !c.yearArchived);
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="cc-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const r = await call(St.moveStudents, { studentIds: ids, toClassId: to, ...(date ? { date } : {}) });
          void qc.invalidateQueries({ queryKey: ADMIN });
          showToast({ message: t('students.moveReport', { moved: r.moved.length, skipped: r.skipped.length }), kind: 'success' });
          onDone();
        } catch (err) {
          setError(errorText(t, err));
        }
      }}
    >
      <p>{t('students.moveExplain', { count: ids.length })}</p>
      <Select label={t('students.moveTo')} value={to} onChange={setTo} items={targets.map((c) => ({ id: c.id, label: c.name }))} />
      <TextField label={t('students.moveDate')} description={t('students.moveDateHint')} type="date" value={date} onChange={setDate} />
      {error ? <Alert>{error}</Alert> : null}
      <DialogActions>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isDisabled={!to}>
          {t('students.move')}
        </Button>
      </DialogActions>
    </form>
  );
}

/** Dry run of a permanent deletion: what will be removed, in counts only. */
function ErasePreviewText({ studentId }: { studentId: string }) {
  const { t } = useI18n();
  const p = useQuery({ queryKey: [...STUDENTS, 'erase', studentId], queryFn: () => call(St.erasePreview, { studentId }), staleTime: 0 });
  if (!p.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const rows = p.data.tables.reduce((a, x) => a + x.rows, 0);
  return (
    <div className="cc-stack" data-testid="erase-preview">
      <p>{t('students.eraseExplain', { name: p.data.fullName })}</p>
      <ul>
        <li>{t('students.eraseRows', { count: rows, tables: p.data.tables.length })}</li>
        <li>{t('students.eraseFiles', { count: p.data.files })}</li>
        <li>{t('students.eraseHistory', { count: p.data.auditEvents + p.data.importRows + p.data.privateNotes })}</li>
      </ul>
      <p className="cc-muted">{t('students.eraseKeeps')}</p>
    </div>
  );
}

export function AdminStudentsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const run = useRun();
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [includeDeactivated, setIncludeDeactivated] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addClass, setAddClass] = useState('');
  const [history, setHistory] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<AdminStudent | null>(null);
  const [deactivating, setDeactivating] = useState<AdminStudent | null>(null);
  const [erasing, setErasing] = useState<AdminStudent | null>(null);
  const classes = useQuery({ queryKey: [...ADMIN, 'classes', 'all'], queryFn: () => call(S.listClasses, { includeArchived: true }) });
  const pageSize = 100;
  const students = useQuery({
    queryKey: [...STUDENTS, q, classId, includeDeactivated, page],
    queryFn: () => call(St.adminListStudents, { q: q || undefined, classId: classId || undefined, includeDeactivated, page, pageSize }),
  });
  const classList = classes.data?.classes ?? [];
  const writable = classList.filter((c) => !c.archived && !c.yearArchived);
  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const total = students.data?.total ?? 0;
  return (
    <main className="cc-page cc-stack">
      <div className="cc-row">
        <h1 className="cc-h1" style={{ marginRight: 'auto' }}>
          {t('admin.students')}
        </h1>
        <Button onPress={() => setMoving(true)} isDisabled={selected.size === 0}>
          {t('students.moveSelected', { count: selected.size })}
        </Button>
        <Button variant="primary" onPress={() => setAdding(true)} isDisabled={writable.length === 0}>
          {t('students.add')}
        </Button>
      </div>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <TextField
          label={t('students.search')}
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          type="search"
        />
        <Select
          label={t('assign.class')}
          value={classId}
          onChange={(v) => {
            setClassId(v);
            setPage(1);
          }}
          items={[{ id: '', label: t('students.allClasses') }, ...classList.map((c) => ({ id: c.id, label: c.name }))]}
        />
        <Toggle label={t('students.includeDeactivated')} isSelected={includeDeactivated} onChange={setIncludeDeactivated} />
      </div>
      <DataTable
        stack
        caption={t('students.found', { count: total })}
        rows={students.data?.students ?? []}
        rowKey={(s) => s.id}
        emptyText={students.isLoading ? t('common.loading') : t('students.none')}
        columns={[
          {
            key: 'sel',
            header: t('students.select'),
            render: (s) => (
              <input
                type="checkbox"
                style={{ width: '1.6rem', height: '1.6rem' }}
                checked={selected.has(s.id)}
                onChange={() => toggleSel(s.id)}
                aria-label={t('students.selectName', { name: s.fullName })}
                disabled={!s.active}
              />
            ),
          },
          {
            key: 'name',
            header: t('students.name'),
            sortValue: (s) => s.fullName,
            render: (s) => (
              <span className="cc-row">
                <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
                {s.fullName}
              </span>
            ),
          },
          { key: 'number', header: t('students.number'), sortValue: (s) => s.studentNumber ?? '', render: (s) => s.studentNumber ?? '—' },
          { key: 'class', header: t('assign.class'), sortValue: (s) => s.currentClassName ?? '', render: (s) => s.currentClassName ?? '—' },
          {
            key: 'state',
            header: t('users.status'),
            render: (s) =>
              s.active ? (
                <span className="cc-chip cc-chip--success">
                  <IconCheck />
                  {t('users.active')}
                </span>
              ) : (
                <span className="cc-chip cc-chip--danger">
                  <IconUserOff />
                  {t('users.deactivated')}
                </span>
              ),
          },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (s) => (
              <div className="cc-row" style={{ gap: '0.4rem' }}>
                <Button size="small" onPress={() => setHistory(s.id)}>
                  {t('students.history')}
                </Button>
                <Button size="small" onPress={() => setLinkFor(s)}>
                  {t('links.adminButton')}
                </Button>
                {s.active ? (
                  <Button size="small" variant="danger-outline" onPress={() => setDeactivating(s)}>
                    {t('users.deactivate')}
                  </Button>
                ) : (
                  <>
                    <Button size="small" onPress={() => void run(() => call(St.reactivateStudent, { studentId: s.id }), { invalidate: [STUDENTS] })}>
                      {t('users.reactivate')}
                    </Button>
                    <Button size="small" variant="danger" onPress={() => setErasing(s)}>
                      {t('students.erase')}
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      {total > pageSize ? (
        <div className="cc-row">
          <Button isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </Button>
          <span>{t('common.pageOf', { page, pages: Math.ceil(total / pageSize) })}</span>
          <Button isDisabled={page * pageSize >= total} onPress={() => setPage((p) => p + 1)}>
            {t('common.next')}
          </Button>
        </div>
      ) : null}
      <Modal isOpen={moving} onOpenChange={setMoving} title={t('students.move')}>
        <MoveDialog
          ids={[...selected]}
          classes={classList}
          onDone={() => {
            setMoving(false);
            setSelected(new Set());
          }}
        />
      </Modal>
      <AddStudentDialog
        isOpen={adding}
        onOpenChange={setAdding}
        extra={<Select label={t('assign.class')} value={addClass || writable[0]?.id || ''} onChange={setAddClass} items={writable.map((c) => ({ id: c.id, label: c.name }))} />}
        onAdd={(input) => call(St.adminAddStudent, { classId: addClass || writable[0]!.id, ...input })}
        onDone={() => void qc.invalidateQueries({ queryKey: ADMIN })}
      />
      <HistoryDialog studentId={history} onClose={() => setHistory(null)} />
      <LinkDialog
        key={linkFor?.id ?? 'none'}
        student={linkFor}
        onClose={() => setLinkFor(null)}
        onReactivate={async () => {
          const s = linkFor!;
          const r = await run(() => call(St.reactivateStudent, { studentId: s.id }), { success: t('links.reactivated'), invalidate: [STUDENTS] });
          if (r) setLinkFor({ ...s, active: true });
        }}
      />
      <ConfirmDestructive
        isOpen={deactivating !== null}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={t('students.deactivateTitle')}
        description={t('students.deactivateExplain')}
        confirmText={deactivating?.fullName ?? ''}
        actionLabel={t('users.deactivate')}
        onConfirm={async () => {
          await call(St.deactivateStudent, { studentId: deactivating!.id });
          await qc.invalidateQueries({ queryKey: STUDENTS });
        }}
      />
      <ConfirmDestructive
        isOpen={erasing !== null}
        onOpenChange={(o) => !o && setErasing(null)}
        title={t('students.eraseTitle')}
        description={erasing ? <ErasePreviewText studentId={erasing.id} /> : null}
        confirmText={erasing?.fullName ?? ''}
        actionLabel={t('students.erase')}
        onConfirm={async () => {
          await call(St.eraseStudent, { studentId: erasing!.id, confirm: erasing!.fullName });
          await qc.invalidateQueries({ queryKey: ADMIN });
          showToast({ message: t('students.erased'), kind: 'success' });
        }}
      />
    </main>
  );
}
