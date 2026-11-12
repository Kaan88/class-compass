/**
 * Start Lesson (LES-1): the Start Lesson steps of the enabled modules in manifest order (D-069) —
 * attendance (everyone present by default; one tap per change), today's assistant, the routine
 * choice — then the lesson begins. Each step adds its part to ONE 'lesson.start' outbox command
 * (e.g. the confirmed attendance, the routine), so the start is idempotent and never creates a
 * second lesson; if one is already running the device simply resumes it (LES-2). Begin also enters
 * full screen when the teacher's "Full screen during lessons" is on (S18, D-167).
 */
import { useEffect, useState } from 'react';
import type { StartLessonResult } from '../../../shared/contracts/lessons.ts';
import type { z } from 'zod';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, useOutboxStatus } from '../../lib/outbox-client.ts';
import { showToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconCheck, IconCloudOff, IconNext, IconPlay, IconPrev, IconSync } from '../../ui/icons.tsx';
import { classLabel } from './labels.ts';
import { ThemeIllustration } from '../../ui/Mascot.tsx';
import { playEvent } from '../../themes/index.tsx';
import { awaitCommand, awaitOrQueued, sendLessonCommand } from './lessonClient.ts';
import { enterLessonFullscreen, useLessonPrefs } from './fullscreen.tsx';
import { initialStartValues, startStepsFor, useStartContributions, useStartWarmup, type ClassroomContext } from '../registry.ts';

/**
 * What the teacher has chosen on the start screen so far: the current step and each step's value by
 * step key. Kept by the classroom page per class, so switching to another class and back keeps it,
 * and one class's choices never leak into another's (LES-4).
 */
export interface StartDraft {
  at: number;
  values: Record<string, unknown>;
}
export const emptyStartDraft = (): StartDraft => ({ at: 0, values: initialStartValues() });

type T = ReturnType<typeof useI18n>['t'];

/** The toasts after the server accepted a start (right away, or later from the outbox). */
function startedToasts(t: T, label: string, result: z.infer<typeof StartLessonResult> | null) {
  if (result && !result.started) showToast({ message: t('lesson.toast.resumed', { cls: label }), scope: 'classroom' });
  else showToast({ message: t('lesson.toast.started', { cls: label }), kind: 'success', scope: 'classroom' });
  if (result?.attendanceKept) showToast({ message: t('lesson.toast.attendanceKept', { cls: label, count: result.attendanceKept }), kind: 'error', durationMs: 12_000, scope: 'classroom' });
  if (result?.dutiesDropped) showToast({ message: t('lesson.toast.dutiesDropped', { cls: label, count: result.dutiesDropped, panel: t('assistant.title') }), kind: 'error', durationMs: 12_000, scope: 'classroom' });
  if (result?.dutiesSkipped) showToast({ message: t('lesson.toast.dutiesSkipped', { cls: label, count: result.dutiesSkipped, panel: t('assistant.title') }), kind: 'error', durationMs: 12_000, scope: 'classroom' });
}

/**
 * Renders nothing: loads what the Start Lesson steps show while the classroom says "no lesson", so
 * the data is on the device for an offline start (S26b, D-190).
 */
export function StartWarmup({ context }: { context: ClassroomContext }) {
  useStartWarmup(context);
  return null;
}

/**
 * A lesson start that waits in the outbox (S26b, D-190; D-006): this device is offline (or the server
 * could not be reached), so the start is saved here and sent, in order with anything queued before
 * it, when the connection returns. Then the lesson state is read again and the board appears. While
 * offline the teacher can take the start back (nothing has reached the server yet).
 */
export function QueuedStartCard({ context, opId, onStarted }: { context: ClassroomContext; opId: string; onStarted: () => void }) {
  const { t, locale } = useI18n();
  const label = classLabel(context, locale);
  const status = useOutboxStatus();
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let live = true;
    awaitCommand(opId).then(
      (result) => {
        if (!live) return;
        startedToasts(t, label, result as z.infer<typeof StartLessonResult> | null);
        onStarted();
      },
      // A refused start is listed in "Needs attention" (with the class), like any refused command.
      () => undefined,
    );
    return () => {
      live = false;
    };
    // The start is followed once per queued command (the label and handler of the first render).
  }, [opId]);

  const canCancel = !status.online && !status.sending;
  return (
    <section className="cc-card cc-stack cc-queued-start" data-testid="queued-start" aria-labelledby="cc-queued-start-title">
      <h2 id="cc-queued-start-title" className="cc-h2 cc-row">
        {status.online ? <IconSync /> : <IconCloudOff />}
        {t('lesson.queued.title', { cls: label })}
      </h2>
      <p role="status">{status.online ? t('lesson.queued.sending') : t('lesson.queued.offline')}</p>
      <p className="cc-muted">{t('lesson.queued.meanwhile')}</p>
      {canCancel ? (
        <div>
          <Button
            isDisabled={cancelling}
            onPress={() => {
              setCancelling(true);
              void getOutbox()
                .dismiss(opId)
                .finally(() => setCancelling(false));
            }}
          >
            {t('lesson.queued.cancel')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function StartLessonFlow({
  context,
  draft,
  onDraft,
  onCancel,
  onStarted,
  onQueued,
}: {
  context: ClassroomContext;
  draft: StartDraft;
  onDraft: (update: (d: StartDraft) => StartDraft) => void;
  onCancel: () => void;
  onStarted: (lessonId: string) => void;
  /** The start could not be sent now and waits in the outbox (S26b, D-190). */
  onQueued: () => void;
}) {
  const { t, locale } = useI18n();
  const label = classLabel(context, locale);
  const steps = startStepsFor(context);
  const { at } = draft;
  const values = { ...initialStartValues(), ...draft.values };
  const setAt = (n: number) => onDraft((d) => ({ ...d, at: n }));
  const contribution = useStartContributions(context, values);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefs = useLessonPrefs();

  const start = async () => {
    // S18 (D-167): full screen needs the user gesture, so it is asked for before anything is awaited.
    enterLessonFullscreen(prefs);
    setStarting(true);
    setError(null);
    playEvent('lessonStart');
    try {
      const opId = await sendLessonCommand('lesson.start', { ...contribution.input, contextId: context.id });
      // Offline (D-190): the start waits in the outbox and the classroom shows it as saved.
      const outcome = await awaitOrQueued(opId);
      if (outcome.queued) {
        onQueued();
        return;
      }
      const result = outcome.result as z.infer<typeof StartLessonResult> | null;
      startedToasts(t, label, result);
      onStarted(result?.lessonId ?? opId);
    } catch {
      setError(t('lesson.startFailed'));
      setStarting(false);
    }
  };

  const step = steps[at];
  const last = at >= steps.length - 1;
  const StepView = step?.Component;

  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-start-title" data-testid="start-lesson">
      <div className="cc-flow-head">
        <ThemeIllustration name="startLesson" width={150} />
        <h2 id="cc-start-title" className="cc-h1">
          {t('lesson.startTitle', { cls: label })}
        </h2>
      </div>
      {steps.length > 1 ? (
        <ol className="cc-steps" aria-label={t('lesson.startSteps')}>
          {steps.map((s, i) => (
            <li key={s.key} aria-current={i === at ? 'step' : undefined} data-state={i < at ? 'done' : i === at ? 'current' : 'next'}>
              {i < at ? <IconCheck /> : <span aria-hidden="true">{i + 1}</span>}
              {t(s.title)}
            </li>
          ))}
        </ol>
      ) : null}

      {step && StepView ? (
        <StepView
          key={step.key}
          context={context}
          value={values[step.key]}
          onChange={(update) => onDraft((d) => ({ ...d, values: { ...d.values, [step.key]: update(step.key in d.values ? d.values[step.key] : step.initial()) } }))}
        />
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
          <Button size="big" variant="primary" className="cc-push-right" onPress={() => void start()} isDisabled={starting || !contribution.ready}>
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
