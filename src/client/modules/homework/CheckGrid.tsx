/**
 * The homework checking grid (HW-3, HW-4, ATT-1, UX-9), shared by the teacher page and the classroom
 * dialog (only when the class allows checking in the classroom, D-075):
 * - one row per student with avatar, name, the day's attendance (read-only, from the attendance
 *   tables; changing homework never changes attendance) and a status select;
 * - a student without a mark shows "Not checked" (never "Missing", HW-4);
 * - "Mark selected as …" and "Mark all remaining as …" bulk actions; every action shows an 8-second
 *   Undo that restores the previous marks (the server skips a student changed again since);
 * - private notes only in the teacher area (`withNotes`).
 * S13a (bug 1a, feedback round 1): the bulk bar stays in view (sticky) while the list scrolls, the
 * whole student row (avatar + name) selects the student, and the classroom dialog is wide, so a
 * selection made at the bottom of the list can always be applied.
 */
import { useState } from 'react';
import type { ClassroomHomeworkCheck, HomeworkCheck, HomeworkStatusDef } from '../../../shared/contracts/homework.ts';
import { NOT_CHECKED } from '../../../shared/contracts/homework.ts';
import { formatDate, pickText, type Locale } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast, showUndoToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { IconCheck, IconNote } from '../../ui/icons.tsx';
import { AttendanceChip, Avatar } from '../../ui/Students.tsx';
import { StudentStatsButton } from '../../ui/StudentName.tsx';

type AnyCheck = HomeworkCheck | ClassroomHomeworkCheck;
type Row = AnyCheck['rows'][number] & { note?: string | null };
export type MarkChange = { studentId: string; status: string; note?: string | null };

export interface CheckActions {
  set: (batchId: string, changes: MarkChange[]) => Promise<{ changed: number; check: AnyCheck }>;
  remaining: (batchId: string, status: string) => Promise<{ changed: number; check: AnyCheck }>;
  undo: (batchId: string) => Promise<{ undone: number; skipped: number; check: AnyCheck }>;
}

export const statusLabel = (statuses: readonly HomeworkStatusDef[], key: string, locale: Locale) => pickText(statuses.find((s) => s.key === key)?.label, locale) || key;

/** 'YYYY-MM-DD' as "Sunday 8 November" / "8 Kasım Pazar" (never the ISO form on screen). */
export const longDay = (date: string, locale: Locale) => formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' });

const newBatchId = () => crypto.randomUUID();

/** Counts per status, e.g. "Completed 12 · Missing 2 · Not checked 5". */
export function StatusSummary({ statuses, byStatus }: { statuses: readonly HomeworkStatusDef[]; byStatus: Record<string, number> }) {
  const { locale } = useI18n();
  return (
    <p className="cc-row cc-muted" data-testid="homework-summary">
      {statuses
        .filter((s) => byStatus[s.key])
        .map((s) => (
          <span key={s.key} className="cc-chip" data-status-kind={s.kind}>
            {pickText(s.label, locale)} {byStatus[s.key]}
          </span>
        ))}
    </p>
  );
}

function NoteField({ row, onSave }: { row: Row; onSave: (note: string | null) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? row.note ?? '';
  return (
    <div className="cc-row" style={{ alignItems: 'flex-end' }}>
      <TextField label={t('homework.noteFor', { name: row.student.fullName })} value={value} onChange={setDraft} />
      {draft !== null && draft.trim() !== (row.note ?? '') ? (
        <Button
          onPress={() => {
            onSave(draft.trim() || null);
            setDraft(null);
          }}
        >
          <IconNote />
          {t('homework.saveNote')}
        </Button>
      ) : null}
    </div>
  );
}

export function CheckGrid({ check, actions, onCheck, withNotes, scope }: { check: AnyCheck; actions: CheckActions; onCheck: (c: AnyCheck) => void; withNotes: boolean; scope: 'classroom' | 'sensitive' }) {
  const { t, locale } = useI18n();
  const run = useRun();
  const statuses = check.assignment.statuses;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState(statuses.find((s) => s.kind === 'completed')?.key ?? statuses[1]?.key ?? NOT_CHECKED);
  const [remainingStatus, setRemainingStatus] = useState(bulkStatus);
  const items = statuses.map((s) => ({ id: s.key, label: pickText(s.label, locale) || s.key }));
  const rows = check.rows as Row[];
  const notChecked = rows.filter((r) => !r.reviewed).length;

  const withUndo = async (batchId: string, p: Promise<{ changed: number; check: AnyCheck }>) => {
    const r = await run(() => p);
    if (!r) return;
    onCheck(r.check);
    if (!r.changed) return;
    showUndoToast(
      t('homework.toast.marked', { count: r.changed }),
      async () => {
        const u = await run(() => actions.undo(batchId));
        if (!u) return;
        onCheck(u.check);
        if (u.skipped) showToast({ message: t('homework.toast.undoSkipped', { count: u.skipped }), kind: 'info', scope });
      },
      { scope },
    );
  };
  const setMarks = (changes: MarkChange[]) => {
    const id = newBatchId();
    void withUndo(id, actions.set(id, changes));
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="cc-stack" data-testid="homework-check">
      <div className="cc-hw-bulk cc-stack" data-testid="homework-bulk">
      {/* The counts and how many are selected on one line, above the controls they belong to. */}
      <div className="cc-row cc-hw-bulk__head">
        <StatusSummary statuses={statuses} byStatus={check.assignment.counts.byStatus} />
        <span className="cc-chip cc-push-right" role="status" data-testid="homework-selected">
          {t('homework.selectedCount', { count: selected.size })}
        </span>
      </div>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select label={t('homework.markSelectedAs')} items={items} value={bulkStatus} onChange={setBulkStatus} />
        <Button
          variant="primary"
          isDisabled={selected.size === 0}
          onPress={() => {
            setMarks([...selected].map((studentId) => ({ studentId, status: bulkStatus })));
            setSelected(new Set());
          }}
        >
          <IconCheck />
          {t('homework.applyToSelected', { count: selected.size })}
        </Button>
        <Button onPress={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.student.id)))}>
          {selected.size === rows.length ? t('homework.selectNone') : t('homework.selectAll')}
        </Button>
      </div>
      <div className="cc-row" style={{ alignItems: 'flex-end' }}>
        <Select label={t('homework.markRemainingAs', { count: notChecked })} items={items.filter((i) => i.id !== NOT_CHECKED)} value={remainingStatus} onChange={setRemainingStatus} />
        <Button
          isDisabled={notChecked === 0}
          onPress={() => {
            const id = newBatchId();
            void withUndo(id, actions.remaining(id, remainingStatus));
          }}
        >
          {t('homework.applyRemaining')}
        </Button>
      </div>
      </div>
      {check.attendanceEnabled && rows.some((r) => r.attendance && r.attendance !== 'not_recorded') ? <p className="cc-muted">{t('homework.attendanceOn', { date: longDay(check.attendanceDate, locale) })}</p> : null}
      <ul className="cc-hw-grid" aria-label={t('homework.gridLabel', { title: check.assignment.title })}>
        {rows.map((r) => (
          <li key={r.student.id} className="cc-hw-row" data-testid="homework-row" data-reviewed={r.reviewed ? 'yes' : 'no'} data-selected={selected.has(r.student.id) ? '' : undefined}>
            <div className="cc-row">
              {/* The whole name area is the selection target (S13a), not only the box. */}
              <label className="cc-hw-pick">
                <input type="checkbox" checked={selected.has(r.student.id)} onChange={() => toggle(r.student.id)} aria-label={t('homework.selectStudent', { name: r.student.fullName })} />
                <Avatar name={r.student.fullName} id={r.student.id} hue={r.student.avatarHue} initials={r.student.initials} size="sm" />
                <strong>{r.student.fullName}</strong>
              </label>
              {/* The name selects the row; statistics have their own button (teacher area only, S14e2). */}
              <StudentStatsButton id={r.student.id} name={r.student.fullName} contextId={check.assignment.contextId} />
              {/* Only when attendance was taken, and named, so "Not recorded" is never read as "not handed in". */}
              {r.attendance && r.attendance !== 'not_recorded' ? <AttendanceChip status={r.attendance} prefix={t('homework.attendanceChipPrefix')} /> : null}
              {!r.enrolled ? <span className="cc-chip">{t('homework.leftClass')}</span> : null}
              <Select
                className="cc-push-right"
                label={t('homework.statusFor', { name: r.student.fullName })}
                hideLabel
                items={items}
                value={r.status}
                onChange={(status) => setMarks([{ studentId: r.student.id, status }])}
              />
            </div>
            {withNotes && r.reviewed ? <NoteField row={r} onSave={(note) => setMarks([{ studentId: r.student.id, status: r.status, note }])} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
