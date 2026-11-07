/**
 * Classroom dashboard during a lesson (DSH-1..8, RTN-3, LES-2/4): routine stepper, timer, student
 * cards with attendance, quick attendance, module slots (only for enabled modules that contribute
 * one) and End Lesson. Every write is an outbox command naming this lesson.
 */
import { useRef, useState } from 'react';
import { nextStatus, type AttendanceStatus, type EffectiveAttendance } from '../../../domain/attendance.ts';
import { effectiveAttendance } from '../../../domain/attendance.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { dismissToast, showUndoToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Toggle } from '../../ui/Fields.tsx';
import { IconCheck, IconChevronDown, IconChevronUp, IconFlag, IconNext, IconPrev, IconUsers } from '../../ui/icons.tsx';
import { StudentCard, StudentGrid } from '../../ui/Students.tsx';
import { AttendanceCountsLine, AttendanceList } from './AttendanceList.tsx';
import { LessonTimer } from './LessonTimer.tsx';
import { patchLesson, patchRoster, sendLessonCommand, useLessonRoster, type RosterStudent } from './lessonClient.ts';
import { dashboardSlotsFor, type ClassroomContext } from './registry.ts';

export const classLabel = (c: { className: string; subjectName: ClassroomContext['subjectName'] }, locale: 'en' | 'tr') => `${c.className} · ${pickText(c.subjectName, locale)}`;

const GRID_KEY = 'cc.studentGridOpen';
const readGridOpen = () => {
  try {
    return localStorage.getItem(GRID_KEY) !== 'closed';
  } catch {
    return true;
  }
};

function RoutineStepper({ lesson }: { lesson: LessonState }) {
  const { t, locale } = useI18n();
  const stages = lesson.routine.stages;
  const idx = lesson.stageIndex;
  const go = (i: number) => {
    if (i < 0 || i >= stages.length || i === idx) return;
    patchLesson(lesson.contextId, (l) => ({ ...l, stageIndex: i }));
    void sendLessonCommand('lesson.setStage', { contextId: lesson.contextId, lessonId: lesson.id, stageIndex: i });
  };
  const current = stages[idx];
  return (
    <section className="cc-card cc-stack cc-routine" aria-labelledby="cc-routine-title">
      <h2 id="cc-routine-title" className="cc-h2">
        {pickText(lesson.routine.name, locale) || t('routine.title')}
      </h2>
      <div className="cc-routine__now" data-testid="current-stage">
        <span className="cc-routine__now-label">{t('routine.now', { n: idx + 1, total: stages.length })}</span>
        <span className="cc-routine__now-name">{current ? pickText(current.name, locale) : ''}</span>
      </div>
      <ol className="cc-stepper" aria-label={t('routine.stages')}>
        {stages.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'current' : 'next';
          return (
            <li key={s.id} data-state={state} aria-current={i === idx ? 'step' : undefined}>
              <Button size="small" className="cc-stepper__btn" onPress={() => go(i)} aria-label={t('routine.goTo', { name: pickText(s.name, locale), n: i + 1 })}>
                <span className="cc-stepper__num" aria-hidden="true">
                  {state === 'done' ? <IconCheck /> : i + 1}
                </span>
                <span>{pickText(s.name, locale)}</span>
                {state === 'current' ? <span className="cc-stepper__mark">{t('routine.current')}</span> : null}
              </Button>
            </li>
          );
        })}
      </ol>
      <div className="cc-row">
        <Button size="big" onPress={() => go(idx - 1)} isDisabled={idx === 0}>
          <IconPrev />
          {t('routine.prev')}
        </Button>
        <Button size="big" variant="primary" onPress={() => go(idx + 1)} isDisabled={idx >= stages.length - 1}>
          {t('routine.next')}
          <IconNext />
        </Button>
      </div>
    </section>
  );
}

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

export function LessonDashboard({ context, lesson, onEnd }: { context: ClassroomContext; lesson: LessonState; onEnd: () => void }) {
  const { t } = useI18n();
  const roster = useLessonRoster(context.id, lesson.id);
  const [gridOpen, setGridOpen] = useState(readGridOpen);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const attendanceOn = context.modules.attendance === true && roster.data?.attendanceEnabled !== false;
  const routinesOn = context.modules.routines === true && lesson.routine.stages.length > 0;
  const students = roster.data?.students ?? [];
  const slots = dashboardSlotsFor(context);

  const toggleGrid = () => {
    const next = !gridOpen;
    setGridOpen(next);
    try {
      localStorage.setItem(GRID_KEY, next ? 'open' : 'closed');
    } catch {
      /* per-tab only */
    }
  };

  return (
    <div className="cc-stack" data-testid="lesson-dashboard" data-lesson-id={lesson.id}>
      <div className="cc-lesson-grid">
        {routinesOn ? <RoutineStepper lesson={lesson} /> : null}
        <LessonTimer lesson={lesson} />
      </div>
      <div className="cc-row">
        {attendanceOn ? (
          <Button size="big" onPress={() => setAttendanceOpen(true)}>
            <IconUsers />
            {t('attendance.open')}
          </Button>
        ) : null}
        <Button size="big" variant="danger" onPress={onEnd} className="cc-push-right">
          <IconFlag />
          {t('lesson.end')}
        </Button>
      </div>
      {slots.length ? (
        <section className="cc-dashboard" aria-label={t('classroom.dashboard')}>
          {slots.map(({ key, Component }) => (
            <Component key={key} context={context} lesson={lesson} />
          ))}
        </section>
      ) : null}
      <section className="cc-stack" aria-labelledby="cc-students-title">
        <div className="cc-row">
          <h2 id="cc-students-title" className="cc-h2">
            {t('lesson.students', { count: students.length })}
          </h2>
          <Button onPress={toggleGrid} aria-expanded={gridOpen} aria-controls="cc-student-grid">
            {gridOpen ? <IconChevronUp /> : <IconChevronDown />}
            {gridOpen ? t('lesson.hideStudents') : t('lesson.showStudents')}
          </Button>
          {attendanceOn ? <AttendanceCountsLine statuses={students.map((s) => s.effective)} /> : null}
        </div>
        {gridOpen ? (
          <div id="cc-student-grid">
            <StudentGrid count={students.length} label={t('lesson.studentCards')}>
              {students.map((s) => (
                <StudentCard key={s.id} student={s} {...(attendanceOn ? { attendance: s.effective } : {})} />
              ))}
            </StudentGrid>
          </div>
        ) : null}
      </section>
      {attendanceOn ? <AttendanceDialog context={context} lesson={lesson} students={students} isOpen={attendanceOpen} onOpenChange={setAttendanceOpen} /> : null}
    </div>
  );
}
