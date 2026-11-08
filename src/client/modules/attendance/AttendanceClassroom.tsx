/**
 * Attendance on the classroom device (LES-1, ATT-2, ACC-8), contributed through the attendance
 * manifest (D-069): the Start Lesson step (everyone present by default; one tap per change), the
 * in-lesson attendance button + dialog (dashboard `actions` region) and the attendance chip + counts
 * on the student grid (student-card add-on).
 */
import { useRef, useState } from 'react';
import { effectiveAttendance, nextStatus, type AttendanceStatus, type EffectiveAttendance } from '../../../domain/attendance.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { dismissToast, showUndoToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Toggle } from '../../ui/Fields.tsx';
import { IconCheck, IconUsers } from '../../ui/icons.tsx';
import { classLabel } from '../lessons/labels.ts';
import { patchRoster, sendLessonCommand, useLessonRoster, type RosterStudent } from '../lessons/lessonClient.ts';
import { startStep, type ClassroomContext, type DashboardSlot, type StartStepProps, type StudentCardAddon, type StudentCardExtras } from '../types.ts';
import { AttendanceCountsLine, AttendanceList } from './AttendanceList.tsx';
import { playEvent } from '../../themes/index.tsx';

// ---------------------------------------------------------------- Start Lesson step
/** Only the students the teacher tapped (or set with "All present"). */
type StartChoices = Record<string, AttendanceStatus>;

function AttendanceStartStep({ context, value: choices, onChange }: StartStepProps<StartChoices>) {
  const { t, locale } = useI18n();
  const roster = useLessonRoster(context.id, null);
  const students = roster.data?.students ?? [];
  // Everyone is present by default; a status another teacher recorded today is kept (ACC-8).
  const statusOf = (id: string): AttendanceStatus => choices[id] ?? students.find((s) => s.id === id)?.daily ?? 'present';
  return (
    <div className="cc-stack">
      <p className="cc-muted">{t('lesson.attendanceHint')}</p>
      <div className="cc-row">
        <Button size="big" onPress={() => onChange(() => Object.fromEntries(students.map((s) => [s.id, 'present' as const])))}>
          <IconCheck />
          {t('attendance.allPresent')}
        </Button>
        <AttendanceCountsLine statuses={students.map((s) => statusOf(s.id) as EffectiveAttendance)} />
      </div>
      {roster.isLoading ? <p>{t('common.loading')}</p> : null}
      <AttendanceList
        label={t('attendance.listLabel', { cls: classLabel(context, locale) })}
        students={students.map((s) => ({ id: s.id, fullName: s.fullName, initials: s.initials, avatarHue: s.avatarHue, status: statusOf(s.id) }))}
        onTap={(id) => onChange((c) => ({ ...c, [id]: nextStatus(statusOf(id)) }))}
      />
    </div>
  );
}

/**
 * Only what the teacher actually changed is sent, with the status the screen showed, so a newer
 * record by a colleague is never overwritten; everyone still without a record becomes present on the
 * server when the command runs (ACC-8, D-053).
 */
function useAttendanceStartContribution(context: ClassroomContext, choices: StartChoices, enabled: boolean) {
  const roster = useLessonRoster(enabled ? context.id : null, null);
  if (!enabled) return { input: {}, ready: true };
  const students = roster.data?.students ?? [];
  const attendance = students.filter((s) => choices[s.id] !== undefined && choices[s.id] !== s.daily).map((s) => ({ studentId: s.id, status: choices[s.id]!, expected: s.daily }));
  return { input: { ...(attendance.length ? { attendance } : {}), othersPresent: true }, ready: !roster.isLoading };
}

export const attendanceStartStep = startStep<StartChoices>({
  key: 'attendance',
  module: 'attendance',
  order: 10,
  title: 'lesson.step.attendance',
  initial: () => ({}),
  Component: AttendanceStartStep,
  useContribution: useAttendanceStartContribution,
});

// ---------------------------------------------------------------- during the lesson
/** Attendance during the lesson: daily (shared, ACC-8) or "only this lesson" exceptions (ATT-2). */
function AttendanceDialog({ context, lesson, students, isOpen, onOpenChange }: { context: ClassroomContext; lesson: LessonState; students: RosterStudent[]; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, locale } = useI18n();
  const [lessonOnly, setLessonOnly] = useState(false);
  const lastUndo = useRef<number | null>(null);
  const label = classLabel(context, locale);

  const write = (studentId: string, kind: 'daily' | 'exception', status: AttendanceStatus | null) => {
    patchRoster(context.id, lesson.id, (s) => {
      if (s.id !== studentId) return s;
      const daily = kind === 'daily' ? status : s.daily;
      const exception = kind === 'exception' ? status : s.exception;
      return { ...s, daily, exception, effective: effectiveAttendance(exception, daily) };
    });
    const ref = { contextId: context.id, lessonId: lesson.id, studentId, status };
    playEvent('tap');
    void sendLessonCommand(kind === 'daily' ? 'attendance.setDaily' : 'attendance.setLessonException', ref);
  };

  const tap = (id: string) => {
    const s = students.find((x) => x.id === id);
    if (!s) return;
    const kind = lessonOnly ? 'exception' : 'daily';
    const before = kind === 'daily' ? s.daily : s.exception;
    const shown: EffectiveAttendance = kind === 'daily' ? (s.daily ?? 'not_recorded') : s.effective;
    const next = nextStatus(shown);
    write(id, kind, next);
    if (lastUndo.current !== null) dismissToast(lastUndo.current);
    lastUndo.current = showUndoToast(
      t('attendance.toast.changed', { cls: label, name: s.fullName, status: t(`attendance.status.${next}`) }),
      () => write(id, kind, before),
      { scope: 'classroom' },
    );
  };

  const entries = students.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    initials: s.initials,
    avatarHue: s.avatarHue,
    status: lessonOnly ? s.effective : ((s.daily ?? 'not_recorded') as EffectiveAttendance),
    lessonOnly: s.exception !== null,
  }));

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('attendance.dialogTitle', { cls: label })}>
      <p className="cc-muted">{lessonOnly ? t('attendance.lessonOnlyHint') : t('attendance.dailyHint')}</p>
      <Toggle label={t('attendance.lessonOnly')} isSelected={lessonOnly} onChange={setLessonOnly} />
      <AttendanceCountsLine statuses={entries.map((e) => e.status)} />
      <AttendanceList students={entries} onTap={tap} label={t('attendance.listLabel', { cls: label })} />
      <DialogActions>
        {!lessonOnly ? (
          <Button
            onPress={() => {
              patchRoster(context.id, lesson.id, (s) => (s.daily ? s : { ...s, daily: 'present', effective: effectiveAttendance(s.exception, 'present') }));
              void sendLessonCommand('attendance.markAllPresent', { contextId: context.id, lessonId: lesson.id });
            }}
          >
            <IconCheck />
            {t('attendance.markRestPresent')}
          </Button>
        ) : null}
        <Button variant="primary" onPress={() => onOpenChange(false)}>
          {t('common.done')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

/** The attendance button (and its dialog) in the dashboard's action row. */
function AttendanceAction({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const roster = useLessonRoster(context.id, lesson.id);
  const [open, setOpen] = useState(false);
  if (roster.data?.attendanceEnabled === false) return null;
  return (
    <>
      <Button size="big" onPress={() => setOpen(true)}>
        <IconUsers />
        {t('attendance.open')}
      </Button>
      <AttendanceDialog context={context} lesson={lesson} students={roster.data?.students ?? []} isOpen={open} onOpenChange={setOpen} />
    </>
  );
}

export const attendanceDashboardSlot: DashboardSlot = { key: 'attendance', module: 'attendance', order: 40, region: 'actions', Component: AttendanceAction };

/** Attendance chip on each student card and the counts line beside the student heading. */
function useAttendanceCards(context: ClassroomContext, lesson: LessonState, enabled: boolean) {
  const roster = useLessonRoster(context.id, lesson.id);
  if (!enabled || roster.data?.attendanceEnabled === false) return null;
  const students = roster.data?.students ?? [];
  const byId = new Map(students.map((s) => [s.id, s.effective]));
  return {
    summary: <AttendanceCountsLine statuses={students.map((s) => s.effective)} />,
    cardProps: (studentId: string): StudentCardExtras => {
      const attendance = byId.get(studentId);
      return attendance === undefined ? {} : { attendance };
    },
  };
}

export const attendanceCardAddon: StudentCardAddon = { key: 'attendance', module: 'attendance', useAddon: useAttendanceCards };
