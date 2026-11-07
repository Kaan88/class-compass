/**
 * Start Lesson (LES-1): confirm attendance (everyone present by default; one tap per change) →
 * module start steps (S7: today's assistant) → choose/confirm the routine → the lesson begins.
 * The start is one outbox command carrying the confirmed attendance, so it is idempotent and never
 * creates a second lesson; if one is already running the device simply resumes it (LES-2).
 */
import { useMemo, useState } from 'react';
import { nextStatus, type AttendanceStatus, type EffectiveAttendance } from '../../../domain/attendance.ts';
import { DEFAULT_ROUTINE_ID } from '../../../domain/routines.ts';
import type { StartLessonResult } from '../../../shared/contracts/lessons.ts';
import type { z } from 'zod';
import { pickText } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconCheck, IconNext, IconPlay, IconPrev } from '../../ui/icons.tsx';
import { AttendanceCountsLine, AttendanceList } from './AttendanceList.tsx';
import { classLabel } from './Dashboard.tsx';
import { awaitCommand, sendLessonCommand, useLessonRoster, useRoutines } from './lessonClient.ts';
import { startStepsFor, type ClassroomContext } from './registry.ts';

type Step = { key: 'attendance' } | { key: 'module'; index: number } | { key: 'routine' };

/**
 * What the teacher has chosen on the start screen so far. Kept by the classroom page per class, so
 * switching to another class and back keeps it, and one class's choices never leak into another's
 * (LES-4).
 */
export interface StartDraft {
  at: number;
  /** Only the students the teacher tapped (or set with "All present"). */
  choices: Record<string, AttendanceStatus>;
  routineId: string | null;
}
export const emptyStartDraft = (): StartDraft => ({ at: 0, choices: {}, routineId: null });

export function StartLessonFlow({
  context,
  draft,
  onDraft,
  onCancel,
  onStarted,
}: {
  context: ClassroomContext;
  draft: StartDraft;
  onDraft: (update: (d: StartDraft) => StartDraft) => void;
  onCancel: () => void;
  onStarted: (lessonId: string) => void;
}) {
  const { t, locale } = useI18n();
  const label = classLabel(context, locale);
  const attendanceOn = context.modules.attendance === true;
  const routinesOn = context.modules.routines === true;
  const moduleSteps = startStepsFor(context);
  const steps: Step[] = useMemo(
    () => [...(attendanceOn ? [{ key: 'attendance' as const }] : []), ...moduleSteps.map((_, index) => ({ key: 'module' as const, index })), ...(routinesOn ? [{ key: 'routine' as const }] : [])],
    [attendanceOn, routinesOn, moduleSteps],
  );
  const { at, choices, routineId } = draft;
  const setAt = (n: number) => onDraft((d) => ({ ...d, at: n }));
  const setChoices = (fn: (c: Record<string, AttendanceStatus>) => Record<string, AttendanceStatus>) => onDraft((d) => ({ ...d, choices: fn(d.choices) }));
  const setRoutineId = (id: string) => onDraft((d) => ({ ...d, routineId: id }));
  const roster = useLessonRoster(context.id, null);
  const routines = useRoutines(routinesOn ? context.id : null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Everyone is present by default; a status another teacher recorded today is kept (ACC-8).
  const students = roster.data?.students ?? [];
  const statusOf = (id: string): AttendanceStatus => choices[id] ?? students.find((s) => s.id === id)?.daily ?? 'present';
  const chosenRoutine = routineId ?? routines.data?.defaultTemplateId ?? DEFAULT_ROUTINE_ID;

  const start = async () => {
    setStarting(true);
    setError(null);
    // Only what the teacher actually changed is sent, with the status the screen showed, so a newer
    // record by a colleague is never overwritten; everyone still without a record becomes present on
    // the server when the command runs (ACC-8, D-053).
    const attendance = attendanceOn
      ? students.filter((s) => choices[s.id] !== undefined && choices[s.id] !== s.daily).map((s) => ({ studentId: s.id, status: choices[s.id]!, expected: s.daily }))
      : [];
    try {
      const opId = await sendLessonCommand('lesson.start', {
        contextId: context.id,
        ...(routinesOn ? { routineTemplateId: chosenRoutine } : {}),
        ...(attendance.length ? { attendance } : {}),
        ...(attendanceOn ? { othersPresent: true } : {}),
      });
      const result = (await awaitCommand(opId)) as z.infer<typeof StartLessonResult> | null;
      if (result && !result.started) showToast({ message: t('lesson.toast.resumed', { cls: label }), scope: 'classroom' });
      else showToast({ message: t('lesson.toast.started', { cls: label }), kind: 'success', scope: 'classroom' });
      if (result?.attendanceKept) showToast({ message: t('lesson.toast.attendanceKept', { cls: label, count: result.attendanceKept }), kind: 'error', durationMs: 12_000, scope: 'classroom' });
      onStarted(result?.lessonId ?? opId);
    } catch {
      setError(t('lesson.startFailed'));
      setStarting(false);
    }
  };

  const step = steps[at];
  const last = at >= steps.length - 1;
  const ModuleStep = step?.key === 'module' ? moduleSteps[step.index]?.Component : undefined;

  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-start-title" data-testid="start-lesson">
      <h2 id="cc-start-title" className="cc-h1">
        {t('lesson.startTitle', { cls: label })}
      </h2>
      {steps.length > 1 ? (
        <ol className="cc-steps" aria-label={t('lesson.startSteps')}>
          {steps.map((s, i) => (
            <li key={i} aria-current={i === at ? 'step' : undefined} data-state={i < at ? 'done' : i === at ? 'current' : 'next'}>
              {i < at ? <IconCheck /> : <span aria-hidden="true">{i + 1}</span>}
              {s.key === 'attendance' ? t('lesson.step.attendance') : s.key === 'routine' ? t('lesson.step.routine') : t(moduleSteps[s.index]!.title)}
            </li>
          ))}
        </ol>
      ) : null}

      {step?.key === 'attendance' ? (
        <div className="cc-stack">
          <p className="cc-muted">{t('lesson.attendanceHint')}</p>
          <div className="cc-row">
            <Button size="big" onPress={() => setChoices(() => Object.fromEntries(students.map((s) => [s.id, 'present' as const])))}>
              <IconCheck />
              {t('attendance.allPresent')}
            </Button>
            <AttendanceCountsLine statuses={students.map((s) => statusOf(s.id) as EffectiveAttendance)} />
          </div>
          {roster.isLoading ? <p>{t('common.loading')}</p> : null}
          <AttendanceList
            label={t('attendance.listLabel', { cls: label })}
            students={students.map((s) => ({ id: s.id, fullName: s.fullName, initials: s.initials, avatarHue: s.avatarHue, status: statusOf(s.id) }))}
            onTap={(id) => setChoices((c) => ({ ...c, [id]: nextStatus(statusOf(id)) }))}
          />
        </div>
      ) : null}

      {ModuleStep ? <ModuleStep context={context} /> : null}

      {step?.key === 'routine' ? (
        <fieldset className="cc-stack cc-fieldset">
          <legend className="cc-h2">{t('lesson.chooseRoutine')}</legend>
          {routines.data?.templates.map((r) => (
            <label key={r.id} className="cc-choice" data-selected={r.id === chosenRoutine ? '' : undefined}>
              <input type="radio" name="routine" value={r.id} checked={r.id === chosenRoutine} onChange={() => setRoutineId(r.id)} />
              <span className="cc-choice__title">{pickText(r.name, locale)}</span>
              <span className="cc-muted">{r.stages.map((s) => pickText(s.name, locale)).join(' → ')}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {steps.length === 0 ? <p className="cc-muted">{t('lesson.readyToStart')}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      {starting && !error ? (
        <p role="status" className="cc-muted">
          {t('lesson.starting')}
        </p>
      ) : null}

      <div className="cc-row">
        <Button size="big" onPress={() => (at === 0 ? onCancel() : setAt(at - 1))} isDisabled={starting}>
          <IconPrev />
          {at === 0 ? t('common.cancel') : t('common.back')}
        </Button>
        {last || steps.length === 0 ? (
          <Button size="big" variant="primary" className="cc-push-right" onPress={() => void start()} isDisabled={starting || (attendanceOn && roster.isLoading)}>
            <IconPlay />
            {t('lesson.begin')}
          </Button>
        ) : (
          <Button size="big" variant="primary" className="cc-push-right" onPress={() => setAt(at + 1)}>
            {t('common.next')}
            <IconNext />
          </Button>
        )}
      </div>
    </section>
  );
}
