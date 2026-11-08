/** Teacher class settings (ACC-5, CFG-1/2; display settings S13b, D-105) and class roster (ACC-4/7; remove from class, D-109). */
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCEPT_HINT, removeStudentPhoto, uploadStudentPhoto } from '../../../shared/contracts/files.ts';
import * as School from '../../../shared/contracts/school.ts';
import * as Students from '../../../shared/contracts/students.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { sortByName } from '../../../shared/text/turkish.ts';
import { call, upload } from '../../lib/api.ts';
import { errorText, reasonOf } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { showToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { Modal, DialogActions } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField, Toggle } from '../../ui/Fields.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { ClassDisplaySection } from './ClassDisplay.tsx';
import { settingsPanelFor } from '../../modules/registry.ts';
import { ClassLanguageSelect } from '../../ui/ClassLanguageSelect.tsx';

export const moduleLabelKey = (m: string) => `module.${m}` as MessageKey;

function useMyContexts() {
  return useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
}

export function ClassSettingsPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const contexts = useMyContexts();
  const list = contexts.data?.contexts ?? [];
  const [selected, setSelected] = useState<string>('');
  const ctx = list.find((c) => c.id === selected) ?? list[0];
  const modules = useQuery({
    queryKey: [SENSITIVE, 'teacher', 'modules', ctx?.id],
    queryFn: () => call(School.getContextModules, { contextId: ctx!.id }),
    enabled: Boolean(ctx),
  });
  const set = useMutation({
    mutationFn: (v: { module: School.ContextModule; enabled: boolean }) => call(School.setContextModule, { contextId: ctx!.id, module: v.module, enabled: v.enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [SENSITIVE, 'teacher', 'modules', ctx?.id] });
      void qc.invalidateQueries({ queryKey: ['classroom', 'contexts'] });
      showToast({ message: t('save.saved'), kind: 'success' });
    },
    onError: (err) => showToast({ message: errorText(t, err), kind: 'error' }),
  });
  if (contexts.isSuccess && list.length === 0) return <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} />;
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('teacher.classSettings')}</h1>
      {ctx ? (
        <>
          <Select
            label={t('teacher.chooseClass')}
            value={ctx.id}
            onChange={setSelected}
            items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))}
          />
          <section className="cc-card cc-stack" aria-labelledby="cc-class-language" data-testid="class-language">
            <h2 id="cc-class-language" className="cc-h2">
              {t('classLanguage.title')}
            </h2>
            <p className="cc-muted">{t('classLanguage.teacherHint', { cls: ctx.className })}</p>
            <ClassLanguageSelect
              value={ctx}
              onChange={(v) =>
                void call(School.setClassLanguage, { classId: ctx.classId, ...v })
                  .then(() => {
                    void qc.invalidateQueries({ queryKey: ['classroom', 'contexts'] });
                    showToast({ message: t('save.saved'), kind: 'success' });
                  })
                  .catch((err: unknown) => showToast({ message: errorText(t, err), kind: 'error' }))
              }
            />
          </section>
          <section className="cc-card cc-stack">
            <h2 className="cc-h2">{t('teacher.modules')}</h2>
            <p className="cc-muted">{t('teacher.modulesHint')}</p>
            {modules.data?.modules.map((m) => {
              // A module's own settings panel (client manifest) appears under its switch while it is on.
              const Panel = m.effective ? settingsPanelFor(m.module)?.Component : undefined;
              return (
                <Fragment key={m.module}>
                  <Toggle
                    label={t(moduleLabelKey(m.module))}
                    isSelected={m.effective}
                    isDisabled={!m.available || set.isPending}
                    description={m.available ? undefined : t('teacher.moduleOffByAdmin')}
                    onChange={(v) => set.mutate({ module: m.module, enabled: v })}
                  />
                  {Panel ? <Panel key={`${ctx.id}-${m.module}`} contextId={ctx.id} /> : null}
                </Fragment>
              );
            })}
          </section>
          <ClassDisplaySection ctx={ctx} hasClip={contexts.data?.timeUpClip ?? false} />
        </>
      ) : null}
    </main>
  );
}

export function TeacherStudentsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const contexts = useMyContexts();
  const classes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of contexts.data?.contexts ?? []) seen.set(c.classId, c.className);
    return sortByName([...seen].map(([id, name]) => ({ id, name })), (c) => c.name);
  }, [contexts.data]);
  const [classId, setClassId] = useState('');
  const cid = classId || classes[0]?.id || '';
  const roster = useQuery({ queryKey: [SENSITIVE, 'teacher', 'roster', cid], queryFn: () => call(Students.teacherRoster, { classId: cid }), enabled: Boolean(cid) });
  const [adding, setAdding] = useState(false);
  const [photoFor, setPhotoFor] = useState<{ id: string; fullName: string; photoUrl: string | null } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; fullName: string } | null>(null);
  // Photo controls only while the admin has turned student photos on (D-014); the server enforces it too.
  const photosOn = contexts.data?.media['media.studentPhotos'] === true;
  if (contexts.isSuccess && classes.length === 0) return <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} />;
  return (
    <main className="cc-page cc-stack">
      <h1 className="cc-h1">{t('teacher.students')}</h1>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select label={t('teacher.chooseClass')} value={cid} onChange={setClassId} items={classes.map((c) => ({ id: c.id, label: c.name }))} />
        <Button variant="primary" onPress={() => setAdding(true)} isDisabled={!cid}>
          {t('students.add')}
        </Button>
      </div>
      {roster.data ? (
        <DataTable
          caption={t('students.rosterCaption', { className: roster.data.className, count: roster.data.students.length })}
          rows={roster.data.students}
          rowKey={(s) => s.id}
          emptyText={t('students.none')}
          columns={[
            {
              key: 'name',
              header: t('students.name'),
              sortValue: (s) => s.fullName,
              render: (s) => (
                <span className="cc-row">
                  <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} photoUrl={s.photoUrl} photoAllowed={photosOn && Boolean(s.photoUrl)} size="sm" />
                  {s.fullName}
                </span>
              ),
            },
            { key: 'number', header: t('students.number'), sortValue: (s) => s.studentNumber ?? '', render: (s) => s.studentNumber ?? '—' },
            { key: 'since', header: t('students.since'), render: (s) => s.enrolledFrom ?? '—' },
            ...(photosOn
              ? [
                  {
                    key: 'photo',
                    header: t('students.photo.title'),
                    render: (s: (typeof roster.data.students)[number]) => (
                      <Button size="small" onPress={() => setPhotoFor({ id: s.id, fullName: s.fullName, photoUrl: s.photoUrl ?? null })}>
                        {s.photoUrl ? t('students.photo.change') : t('students.photo.add')}
                      </Button>
                    ),
                  },
                ]
              : []),
            {
              key: 'remove',
              header: t('common.actions'),
              render: (s) => (
                <Button size="small" variant="danger" onPress={() => setRemoving({ id: s.id, fullName: s.fullName })}>
                  {t('students.removeFromClass')}
                </Button>
              ),
            },
          ]}
        />
      ) : null}
      <Modal isOpen={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} title={t('students.removeFromClass')} role="alertdialog">
        <p>{t('students.removeExplain', { name: removing?.fullName ?? '', cls: roster.data?.className ?? '' })}</p>
        <DialogActions>
          <Button onPress={() => setRemoving(null)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onPress={async () => {
              const s = removing!;
              try {
                await call(Students.removeStudentFromClass, { classId: cid, studentId: s.id });
                showToast({ message: t('students.removed', { name: s.fullName }), kind: 'success' });
                void qc.invalidateQueries({ queryKey: [SENSITIVE, 'teacher', 'roster', cid] });
                void qc.invalidateQueries({ queryKey: ['classroom'] });
              } catch (err) {
                showToast({ message: errorText(t, err), kind: 'error' });
              } finally {
                setRemoving(null);
              }
            }}
          >
            {t('students.removeFromClass')}
          </Button>
        </DialogActions>
      </Modal>
      <AddStudentDialog
        isOpen={adding}
        onOpenChange={setAdding}
        onAdd={(input) => call(Students.addStudentToClass, { classId: cid, ...input })}
        onDone={() => void qc.invalidateQueries({ queryKey: [SENSITIVE, 'teacher', 'roster', cid] })}
      />
      {photoFor ? (
        <StudentPhotoDialog
          student={photoFor}
          onClose={() => setPhotoFor(null)}
          onDone={() => {
            setPhotoFor(null);
            void qc.invalidateQueries({ queryKey: [SENSITIVE, 'teacher', 'roster', cid] });
            void qc.invalidateQueries({ queryKey: ['classroom'] });
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * Student photo (CRD-1, D-014): only offered while the admin enabled student photos. The teacher
 * confirms that consent was given; the confirmation is stored and audited on the server. The image is
 * re-encoded on the server (EXIF/GPS removed).
 */
function StudentPhotoDialog({ student, onClose, onDone }: { student: { id: string; fullName: string; photoUrl: string | null }; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      showToast({ message, kind: 'success' });
      onDone();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onOpenChange={(o) => (o ? null : onClose())} title={t('students.photo.dialogTitle', { name: student.fullName })}>
      <div className="cc-stack">
        <p className="cc-muted">{t('students.photo.hint')}</p>
        <label className="cc-field">
          <span className="cc-field__label">{t('students.photo.file')}</span>
          <input type="file" className="cc-file-input" accept={ACCEPT_HINT.image} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="cc-row">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t('students.photo.consent')}</span>
        </label>
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          {student.photoUrl ? (
            <Button variant="danger" isDisabled={busy} onPress={() => void act(() => call(removeStudentPhoto, { studentId: student.id }), t('students.photo.removed'))}>
              {t('students.photo.remove')}
            </Button>
          ) : null}
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!file || !consent || busy} onPress={() => void act(() => upload(uploadStudentPhoto, { studentId: student.id, consent: true }, file!), t('students.photo.saved'))}>
            {t('students.photo.save')}
          </Button>
        </DialogActions>
      </div>
    </Modal>
  );
}

export interface NewStudentInput {
  fullName: string;
  givenNames: string | null;
  familyName: string | null;
  studentNumber: string | null;
  allowDuplicateName?: boolean;
}

/**
 * Add a student; a possible duplicate (same name) asks for confirmation that it is a different
 * child (D-022) — never merged automatically.
 */
export function AddStudentDialog({
  isOpen,
  onOpenChange,
  onAdd,
  onDone,
  extra,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (input: NewStudentInput) => Promise<unknown>;
  onDone: () => void;
  extra?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [given, setGiven] = useState('');
  const [family, setFamily] = useState('');
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState(false);
  const reset = () => {
    setGiven('');
    setFamily('');
    setNumber('');
    setError(null);
    setDupWarning(false);
  };
  const submit = async (allowDuplicateName: boolean) => {
    setError(null);
    const fullName = `${given.trim()} ${family.trim()}`.trim();
    if (!fullName) return setError(t('students.nameRequired'));
    try {
      await onAdd({ fullName, givenNames: given.trim() || null, familyName: family.trim() || null, studentNumber: number.trim() || null, allowDuplicateName });
      showToast({ message: t('students.added', { name: fullName }), kind: 'success' });
      close(false);
      onDone();
    } catch (err) {
      if (reasonOf(err) === 'POSSIBLE_DUPLICATE') setDupWarning(true);
      else setError(errorText(t, err));
    }
  };
  // Every way of closing (Cancel, Escape, the close button, success) clears what was typed, so a
  // reopened dialog never carries stale names or a stale "Add anyway" confirmation.
  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };
  return (
    <Modal isOpen={isOpen} onOpenChange={close} title={t('students.add')}>
      <form
        className="cc-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {extra}
        <TextField label={t('students.givenNames')} value={given} onChange={setGiven} isRequired autoFocus />
        <TextField label={t('students.familyName')} value={family} onChange={setFamily} />
        <TextField label={t('students.numberOptional')} value={number} onChange={setNumber} />
        {error ? <Alert>{error}</Alert> : null}
        {dupWarning ? (
          <Alert kind="warning">
            <p style={{ margin: 0 }}>{t('error.POSSIBLE_DUPLICATE')}</p>
            <Button variant="primary" size="small" onPress={() => void submit(true)}>
              {t('students.addAnyway')}
            </Button>
          </Alert>
        ) : null}
        <DialogActions>
          <Button onPress={() => close(false)}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('students.add')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}
