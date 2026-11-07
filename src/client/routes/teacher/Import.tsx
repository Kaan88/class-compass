/**
 * Student list importer (S9: IMP-1..7, D-013). Paste a list or choose a file (e-Okul Excel first,
 * CSV, Word, PDF, a photo of a typed list) → preview with the field mapping and flags → fix rows and
 * decide → confirm → report. Earlier imports can be undone (IMP-5, DAT-5). Everything is read on
 * this server; photos go through local OCR (IMP-7, D-011), so the notice is always visible.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { ACCEPT_HINT, uploadFile } from '../../../shared/contracts/files.ts';
import * as Imp from '../../../shared/contracts/import.ts';
import * as School from '../../../shared/contracts/school.ts';
import { en } from '../../../shared/i18n/en.ts';
import { formatDate, type MessageKey } from '../../../shared/i18n/index.ts';
import { sortByName } from '../../../shared/text/turkish.ts';
import { call, upload } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive, DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextArea, TextField, Toggle } from '../../ui/Fields.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { IconAlert, IconCheck, IconDot, IconMinus, IconNote, IconUsers } from '../../ui/icons.tsx';

type Batch = Imp.ImportBatch;
type Row = Imp.ImportRow;
type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const KEY = [SENSITIVE, 'teacher', 'import'] as const;
const has = (k: string): k is MessageKey => k in en;
const FIELD_KEYS: Record<Imp.ImportField, MessageKey> = {
  fullName: 'import.field.fullName',
  givenNames: 'import.field.givenNames',
  familyName: 'import.field.familyName',
  studentNumber: 'import.field.studentNumber',
  className: 'import.field.className',
};

/** A row reason / outcome code ("ALREADY_IN_CLASS+NUMBER_TAKEN") as translated text. */
function codeText(t: T, prefix: 'import.reason' | 'import.revert', code: string | null): string {
  if (!code) return '';
  return code
    .split('+')
    .map((c) => (has(`${prefix}.${c}`) ? t(`${prefix}.${c}` as MessageKey) : has(`error.${c}`) ? t(`error.${c}` as MessageKey) : t('common.error')))
    .join(' · ');
}

const WARN_FLAGS = new Set<Imp.ImportFlag>([
  'low_confidence',
  'duplicate_in_file',
  'possible_match',
  'missing_name',
  'number_elsewhere',
  'class_mismatch',
  'possible_heading',
  'same_name_in_file',
  'name_elsewhere',
  'number_conflict',
]);

/** Flags as chips: icon + text, never colour only (UX-7). */
function FlagChips({ row }: { row: Row }) {
  const { t } = useI18n();
  return (
    <span className="cc-import-flags">
      {row.flags.map((f) => (
        <span key={f} className={`cc-chip ${f === 'number_match' ? 'cc-chip--success' : WARN_FLAGS.has(f) ? 'cc-chip--warning' : ''}`}>
          {f === 'number_match' ? <IconCheck /> : WARN_FLAGS.has(f) ? <IconAlert /> : <IconDot />}
          {f === 'low_confidence' && row.ocrConfidence !== null ? t('import.flag.low_confidence_pct', { pct: row.ocrConfidence }) : t(`import.flag.${f}`)}
        </span>
      ))}
      {row.needsChoice ? (
        <span className="cc-chip cc-chip--danger">
          <IconAlert />
          {t('import.needsChoice')}
        </span>
      ) : null}
    </span>
  );
}

const candidateLabel = (t: T, c: Row['candidates'][number]) =>
  [c.fullName, c.className ?? t('import.noClass'), c.studentNumber ? `#${c.studentNumber}` : null, c.active ? null : t('import.inactive')].filter(Boolean).join(' · ');

/** Fix a row and choose what happens to it (IMP-2, IMP-4). */
function RowDialog({ batch, row, onClose, onSaved }: { batch: Batch; row: Row; onClose: () => void; onSaved: (b: Batch) => void }) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState(row.parsed.fullName);
  const [given, setGiven] = useState(row.parsed.givenNames ?? '');
  const [family, setFamily] = useState(row.parsed.familyName ?? '');
  const [number, setNumber] = useState(row.parsed.studentNumber ?? '');
  const [decision, setDecision] = useState<string>(row.decision);
  const [match, setMatch] = useState(row.matchedStudentId ?? row.candidates[0]?.id ?? '');
  const [fill, setFill] = useState(row.fillNumber);
  const [error, setError] = useState<string | null>(null);
  const showParts = batch.mapping.givenNames !== null || batch.mapping.familyName !== null || row.parsed.givenNames !== null;
  const save = async () => {
    setError(null);
    const input: z.input<typeof Imp.updateImportRow.input> = { batchId: batch.id, rowId: row.id };
    if (fullName.trim() !== row.parsed.fullName) input.fullName = fullName.trim();
    if (showParts && (given.trim() || null) !== row.parsed.givenNames) input.givenNames = given.trim() || null;
    if (showParts && (family.trim() || null) !== row.parsed.familyName) input.familyName = family.trim() || null;
    if ((number.trim() || null) !== row.parsed.studentNumber) input.studentNumber = number.trim() || null;
    if (decision !== row.decision || decision === 'match' || row.needsChoice) {
      input.decision = decision as Imp.ImportDecision;
      if (decision === 'match') input.matchedStudentId = match || null;
    }
    try {
      let b = await call(Imp.updateImportRow, input);
      const after = b.rows.find((r) => r.id === row.id);
      if (after?.canFillNumber && fill !== after.fillNumber) b = await call(Imp.updateImportRow, { batchId: batch.id, rowId: row.id, fillNumber: fill });
      onSaved(b);
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  return (
    <Modal isOpen onOpenChange={(o) => (o ? null : onClose())} title={t('import.editRow', { n: row.idx + 1 })}>
      <form
        className="cc-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {row.raw.length ? <p className="cc-import-raw">{t('import.rawText', { text: row.raw.filter(Boolean).join(' | ') })}</p> : null}
        <TextField label={t('import.field.fullName')} value={fullName} onChange={setFullName} autoFocus />
        {showParts ? (
          <div className="cc-row">
            <TextField label={t('import.field.givenNames')} value={given} onChange={setGiven} />
            <TextField label={t('import.field.familyName')} value={family} onChange={setFamily} />
          </div>
        ) : null}
        <TextField label={t('import.field.studentNumber')} value={number} onChange={setNumber} />
        <FlagChips row={row} />
        <Select
          label={t('import.decision')}
          value={decision}
          onChange={setDecision}
          items={Imp.IMPORT_DECISIONS.map((d) => ({ id: d, label: t(`import.decision.${d}`), disabled: d === 'match' && row.candidates.length === 0 }))}
        />
        {decision === 'match' && row.candidates.length ? (
          <Select label={t('import.matchWith')} value={match} onChange={setMatch} items={row.candidates.map((c) => ({ id: c.id, label: candidateLabel(t, c) }))} />
        ) : null}
        {decision === 'match' && row.canFillNumber ? <Toggle label={t('import.fillNumber', { number: row.parsed.studentNumber ?? '' })} isSelected={fill} onChange={setFill} /> : null}
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

function MappingEditor({ batch, onSaved }: { batch: Batch; onSaved: (b: Batch) => void }) {
  const { t } = useI18n();
  const run = useRun();
  const columns = [{ id: '', label: t('import.mapping.none') }, ...batch.columns.map((c, i) => ({ id: String(i), label: c.trim() || t('import.mapping.column', { n: i + 1 }) }))];
  const set = async (field: Imp.ImportField, v: string) => {
    const mapping = { ...batch.mapping, [field]: v === '' ? null : Number(v) };
    const b = await run(() => call(Imp.setImportMapping, { batchId: batch.id, mapping }));
    if (b) onSaved(b);
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby="imp-mapping">
      <h2 id="imp-mapping" className="cc-h2">
        {t('import.mapping.title')}
      </h2>
      <p className="cc-muted">{t('import.mapping.hint')}</p>
      <div className="cc-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {Imp.IMPORT_FIELDS.map((f) => (
          <Select key={f} label={t(FIELD_KEYS[f])} value={batch.mapping[f] === null ? '' : String(batch.mapping[f])} onChange={(v) => void set(f, v)} items={columns} />
        ))}
      </div>
    </section>
  );
}

function Preview({ batch, onChange, onClose }: { batch: Batch; onChange: (b: Batch) => void; onClose: () => void }) {
  const { t } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const rows = batch.rows.filter((r) => showIgnored || !r.flags.includes('heading_ignored'));
  const open = batch.rows.filter((r) => r.needsChoice);
  const n = (d: Imp.ImportDecision) => batch.rows.filter((r) => r.decision === d && !r.flags.includes('heading_ignored')).length;
  const setDecision = async (row: Row, decision: string) => {
    const b = await run(() =>
      call(Imp.updateImportRow, { batchId: batch.id, rowId: row.id, decision: decision as Imp.ImportDecision, ...(decision === 'match' ? { matchedStudentId: row.matchedStudentId ?? row.candidates[0]?.id ?? null } : {}) }),
    );
    if (b) onChange(b);
  };
  const bulk = async (decision: Imp.ImportDecision) => {
    const b = await run(() => call(Imp.setImportDecisions, { batchId: batch.id, rowIds: open.map((r) => r.id), decision }));
    if (b) onChange(b);
  };
  const commit = async () => {
    const b = await run(() => call(Imp.commitImportBatch, { batchId: batch.id }), { success: t('import.done'), invalidate: [KEY, [SENSITIVE, 'teacher', 'roster'], ['classroom']] });
    if (b) {
      onChange(b);
      void qc.invalidateQueries({ queryKey: [SENSITIVE] });
    }
  };
  return (
    <div className="cc-stack" data-testid="import-preview">
      <h2 className="cc-h2">{t('import.previewTitle', { className: batch.className })}</h2>
      <p className="cc-muted">{t(`import.source.${batch.sourceType}`)}{batch.fileName ? ` · ${batch.fileName}` : ''}</p>
      {batch.notices.map((code) =>
        has(`import.notice.${code}`) ? (
          <Alert key={code} kind="warning">
            {t(`import.notice.${code}` as MessageKey)}
          </Alert>
        ) : null,
      )}
      {batch.columns.length > 1 ? <MappingEditor batch={batch} onSaved={onChange} /> : null}
      <p role="status">{t('import.summary', { add: n('add'), match: n('match'), skip: n('skip') })}</p>
      {open.length ? (
        <Alert kind="warning">
          <span className="cc-stack">
            <span>{t('import.openChoices', { count: open.length })}</span>
            <span className="cc-row">
              <Button size="small" onPress={() => void bulk('add')}>
                {t('import.bulk.addAll')}
              </Button>
              <Button size="small" onPress={() => void bulk('skip')}>
                {t('import.bulk.skipAll')}
              </Button>
            </span>
          </span>
        </Alert>
      ) : null}
      <Toggle label={t('import.showIgnored')} isSelected={showIgnored} onChange={setShowIgnored} />
      <DataTable
        caption={t('import.rowsCaption', { count: rows.length })}
        rows={rows}
        rowKey={(r) => r.id}
        emptyText={t('import.noRows')}
        columns={[
          { key: 'idx', header: t('import.col.row'), sortValue: (r) => r.idx, render: (r) => (r.page ? t('import.rowOnPage', { n: r.idx + 1, page: r.page }) : String(r.idx + 1)) },
          {
            key: 'name',
            header: t('import.field.fullName'),
            sortValue: (r) => r.parsed.fullName,
            render: (r) => (
              <span className="cc-stack" style={{ gap: '0.2rem' }}>
                <strong>{r.parsed.fullName || '—'}</strong>
                {r.parsed.givenNames !== null || r.parsed.familyName !== null ? (
                  <span className="cc-muted">{t('import.parts', { given: r.parsed.givenNames ?? '—', family: r.parsed.familyName ?? '—' })}</span>
                ) : null}
                {r.edited ? <span className="cc-muted">{t('import.edited')}</span> : null}
              </span>
            ),
          },
          { key: 'number', header: t('import.field.studentNumber'), sortValue: (r) => r.parsed.studentNumber ?? '', render: (r) => r.parsed.studentNumber ?? '—' },
          { key: 'flags', header: t('import.col.check'), render: (r) => <FlagChips row={r} /> },
          {
            key: 'decision',
            header: t('import.decision'),
            render: (r) =>
              r.flags.includes('heading_ignored') ? (
                t('import.decision.skip')
              ) : (
                <span className="cc-stack" style={{ gap: '0.2rem' }}>
                  <Select
                    label={t('import.decisionFor', { name: r.parsed.fullName || String(r.idx + 1) })}
                    hideLabel
                    value={r.decision}
                    onChange={(d) => void setDecision(r, d)}
                    items={Imp.IMPORT_DECISIONS.map((d) => ({ id: d, label: t(`import.decision.${d}`), disabled: d === 'match' && r.candidates.length === 0 }))}
                  />
                  {r.decision === 'match' && r.matchedStudentId ? (
                    <span className="cc-muted">{candidateLabel(t, r.candidates.find((c) => c.id === r.matchedStudentId) ?? { id: '', fullName: '—', className: null, studentNumber: null, active: true, score: 0 })}</span>
                  ) : null}
                </span>
              ),
          },
          {
            key: 'edit',
            header: t('common.actions'),
            render: (r) => (
              <Button size="small" onPress={() => setEditing(r)} aria-label={t('import.editRow', { n: r.idx + 1 })}>
                <IconNote />
              </Button>
            ),
          },
        ]}
      />
      <div className="cc-row">
        <Button variant="primary" isDisabled={open.length > 0} onPress={() => void commit()}>
          {t('import.confirm', { add: n('add'), match: n('match') })}
        </Button>
        <Button onPress={onClose}>{t('import.later')}</Button>
      </div>
      {editing ? (
        <RowDialog
          batch={batch}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(b) => {
            onChange(b);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Report({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const { t } = useI18n();
  const c = batch.counts;
  const reverted = batch.status === 'reverted';
  return (
    <div className="cc-stack" data-testid="import-report">
      <h2 className="cc-h2">{t(reverted ? 'import.revertedTitle' : 'import.reportTitle', { className: batch.className })}</h2>
      <p role="status">{t('import.reportSummary', { added: c.added ?? 0, matched: c.matched ?? 0, skipped: c.skipped ?? 0, failed: c.failed ?? 0 })}</p>
      {reverted ? <p>{t('import.revertSummary', { removed: c.revert_removed ?? 0, deactivated: c.revert_deactivated ?? 0 })}</p> : null}
      <DataTable
        caption={t('import.reportCaption')}
        rows={batch.rows.filter((r) => !r.flags.includes('heading_ignored'))}
        rowKey={(r) => r.id}
        emptyText={t('import.noRows')}
        columns={[
          { key: 'idx', header: t('import.col.row'), sortValue: (r) => r.idx, render: (r) => String(r.idx + 1) },
          { key: 'name', header: t('import.field.fullName'), sortValue: (r) => r.parsed.fullName, render: (r) => r.parsed.fullName || '—' },
          { key: 'number', header: t('import.field.studentNumber'), render: (r) => r.parsed.studentNumber ?? '—' },
          {
            key: 'outcome',
            header: t('import.col.outcome'),
            sortValue: (r) => r.outcome ?? '',
            render: (r) => (
              <span className={`cc-chip ${r.outcome === 'added' || r.outcome === 'matched' ? 'cc-chip--success' : r.outcome === 'failed' ? 'cc-chip--danger' : ''}`}>
                {r.outcome === 'failed' ? <IconAlert /> : r.outcome === 'skipped' ? <IconMinus /> : <IconCheck />}
                {r.outcome ? t(`import.outcome.${r.outcome}`) : '—'}
              </span>
            ),
          },
          { key: 'reason', header: t('import.col.reason'), render: (r) => codeText(t, 'import.reason', r.reason) || '—' },
          ...(reverted ? [{ key: 'revert', header: t('import.col.revert'), render: (r: Row) => codeText(t, 'import.revert', r.revertOutcome) || '—' }] : []),
        ]}
      />
      <div className="cc-row">
        <Button variant="primary" onPress={onClose}>
          {t('import.another')}
        </Button>
      </div>
    </div>
  );
}

function Start({ classes, onCreated }: { classes: { id: string; name: string }[]; onCreated: (b: Batch) => void }) {
  const { t } = useI18n();
  const [classId, setClassId] = useState('');
  const cid = classId || classes[0]?.id || '';
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const go = async (source: 'text' | 'file') => {
    setBusy(true);
    setError(null);
    try {
      if (source === 'text') onCreated(await call(Imp.createImportBatch, { classId: cid, text }));
      else if (file) {
        const meta = await upload(uploadFile, { kind: 'import_source' }, file);
        onCreated(await call(Imp.createImportBatch, { classId: cid, fileId: meta.id }));
      }
      setText('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cc-stack">
      <Select label={t('import.intoClass')} value={cid} onChange={setClassId} items={classes.map((c) => ({ id: c.id, label: c.name }))} />
      <section className="cc-card cc-stack" aria-labelledby="imp-file">
        <h2 id="imp-file" className="cc-h2">
          {t('import.fileTitle')}
        </h2>
        <p className="cc-muted">{t('import.fileHint')}</p>
        <label className="cc-field">
          <span className="cc-field__label">{t('import.fileLabel')}</span>
          <input ref={fileRef} type="file" className="cc-file-input" accept={ACCEPT_HINT.import_source} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="cc-row">
          <Button variant="primary" isDisabled={!file || !cid || busy} onPress={() => void go('file')}>
            {busy ? t('import.reading') : t('import.readFile')}
          </Button>
        </div>
      </section>
      <section className="cc-card cc-stack" aria-labelledby="imp-paste">
        <h2 id="imp-paste" className="cc-h2">
          {t('import.pasteTitle')}
        </h2>
        <TextArea label={t('import.pasteLabel')} description={t('import.pasteHint')} value={text} onChange={setText} rows={10} />
        <div className="cc-row">
          <Button variant="primary" isDisabled={!text.trim() || !cid || busy} onPress={() => void go('text')}>
            {t('import.preview')}
          </Button>
        </div>
      </section>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

function History({ tz, onOpen }: { tz: string; onOpen: (id: string) => void }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: [...KEY, 'list'], queryFn: () => call(Imp.listImportBatches, {}) });
  const [reverting, setReverting] = useState<Imp.ImportBatchSummary | null>(null);
  if (!list.data) return null;
  return (
    <section className="cc-stack" aria-labelledby="imp-history">
      <h2 id="imp-history" className="cc-h2">
        {t('import.historyTitle')}
      </h2>
      <DataTable
        caption={t('import.historyCaption')}
        rows={list.data.batches}
        rowKey={(b) => b.id}
        emptyText={t('import.noHistory')}
        columns={[
          { key: 'at', header: t('audit.when'), sortValue: (b) => b.createdAt, render: (b) => formatDate(b.createdAt, locale, tz, { dateStyle: 'medium', timeStyle: 'short' }) },
          { key: 'class', header: t('import.col.class'), sortValue: (b) => b.className, render: (b) => b.className },
          { key: 'source', header: t('import.col.source'), render: (b) => b.fileName ?? t(`import.source.${b.sourceType}`) },
          { key: 'status', header: t('import.col.status'), render: (b) => t(`import.status.${b.status}`) },
          { key: 'counts', header: t('import.col.result'), render: (b) => (b.status === 'draft' ? '—' : t('import.countsShort', { added: b.counts.added ?? 0, matched: b.counts.matched ?? 0 })) },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (b) => (
              <span className="cc-row">
                <Button size="small" onPress={() => onOpen(b.id)}>
                  {t('import.open')}
                </Button>
                {b.status === 'committed' ? (
                  <Button size="small" variant="danger" onPress={() => setReverting(b)}>
                    {t('import.revert')}
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {reverting ? (
        <ConfirmDestructive
          isOpen
          onOpenChange={(o) => (o ? null : setReverting(null))}
          title={t('import.revertTitle')}
          description={t('import.revertBody', { className: reverting.className })}
          confirmText={reverting.className}
          actionLabel={t('import.revert')}
          onConfirm={async () => {
            const b = await call(Imp.revertImportBatch, { batchId: reverting.id, confirm: true });
            showToast({ message: t('import.reverted'), kind: 'success' });
            qc.setQueryData([...KEY, 'batch', b.id], b);
            void qc.invalidateQueries({ queryKey: [SENSITIVE] });
            void qc.invalidateQueries({ queryKey: ['classroom'] });
            setReverting(null);
            onOpen(b.id);
          }}
        />
      ) : null}
    </section>
  );
}

export function ImportPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const contexts = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  const classes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of contexts.data?.contexts ?? []) seen.set(c.classId, c.className);
    return sortByName([...seen].map(([id, name]) => ({ id, name })), (c) => c.name);
  }, [contexts.data]);
  const tz = contexts.data?.contexts[0]?.timezone ?? 'UTC';
  const [batchId, setBatchId] = useState<string | null>(null);
  const batch = useQuery({ queryKey: [...KEY, 'batch', batchId], queryFn: () => call(Imp.getImportBatch, { batchId: batchId! }), enabled: Boolean(batchId) });
  const show = (b: Batch) => {
    qc.setQueryData([...KEY, 'batch', b.id], b);
    setBatchId(b.id);
    void qc.invalidateQueries({ queryKey: [...KEY, 'list'] });
  };
  const close = () => {
    setBatchId(null);
    void qc.invalidateQueries({ queryKey: [...KEY, 'list'] });
  };
  if (contexts.isSuccess && classes.length === 0) return <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} />;
  return (
    <main className="cc-page cc-stack" data-testid="import-page">
      <h1 className="cc-h1">{t('import.title')}</h1>
      <Alert kind="warning">
        <span data-testid="import-ocr-notice">{t('import.localNotice')}</span>
      </Alert>
      {batchId && batch.data ? (
        batch.data.status === 'draft' ? (
          <Preview batch={batch.data} onChange={show} onClose={close} />
        ) : (
          <Report batch={batch.data} onClose={close} />
        )
      ) : (
        <Start classes={classes} onCreated={show} />
      )}
      <History tz={tz} onOpen={setBatchId} />
      <p className="cc-muted">
        <IconUsers /> {t('import.namesRule')}
      </p>
    </main>
  );
}
