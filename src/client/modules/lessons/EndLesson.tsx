/**
 * End Lesson (LES-3): the screens of the End Lesson steps the server lists for this lesson (module
 * steps first, then the core reflection), then one 'lesson.end' command and a summary. Works with
 * every optional module switched off (only the reflection remains). Save and end leaves full screen
 * when the teacher's "Full screen during lessons" is on (S18, D-167).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as L from '../../../shared/contracts/lessons.ts';
import type { LessonState, LessonSummary } from '../../../shared/contracts/lessons.ts';
import { formatDate, pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconFace, IconFlag, IconPrev } from '../../ui/icons.tsx';
import { MetricCell } from '../../ui/Students.tsx';
import { classLabel } from './labels.ts';
import { ThemeIllustration } from '../../ui/Mascot.tsx';
import { playEvent } from '../../themes/index.tsx';
import { awaitCommand, sendLessonCommand } from './lessonClient.ts';
import { exitLessonFullscreen, useLessonPrefs } from './fullscreen.tsx';
import { endStepUis, type ClassroomContext } from '../registry.ts';
import type { ReflectionValue } from './ReflectionStep.tsx';


/** Values typed into the End Lesson steps so far; kept by the classroom page per class and lesson (LES-4). */
export type EndDraft = Record<string, unknown>;

export function EndLessonFlow({
  context,
  lesson,
  draft,
  onDraft,
  onCancel,
  onEnded,
}: {
  context: ClassroomContext;
  lesson: LessonState;
  /** null = nothing typed yet (each step starts from its initial value). */
  draft: EndDraft | null;
  onDraft: (update: (d: EndDraft | null) => EndDraft) => void;
  onCancel: () => void;
  onEnded: (summary: LessonSummary | null) => void;
}) {
  const { t, locale } = useI18n();
  const uis = endStepUis(lesson.endSteps);
  const initial = (): EndDraft => Object.fromEntries(uis.map((u) => [u.key, u.initial()]));
  const values: EndDraft = { ...initial(), ...draft };
  const setValues = (fn: (v: EndDraft) => EndDraft) => onDraft((d) => fn({ ...initial(), ...d }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = classLabel(context, locale);
  const prefs = useLessonPrefs();

  const finish = async () => {
    // S18 (D-167): Save and end leaves full screen (Back to lesson keeps it).
    exitLessonFullscreen(prefs);
    setBusy(true);
    setError(null);
    playEvent('lessonEnd');
    const steps = { ...values };
    const r = steps.reflection as ReflectionValue | undefined;
    if (r) steps.reflection = { rating: r.rating, note: r.note.trim() ? r.note.trim() : null };
    try {
      const opId = await sendLessonCommand('lesson.end', { contextId: context.id, lessonId: lesson.id, steps });
      const summary = (await awaitCommand(opId)) as LessonSummary | null;
      showToast({ message: t('lesson.toast.ended', { cls: label }), kind: 'success', scope: 'classroom' });
      onEnded(summary);
    } catch {
      setError(t('lesson.endFailed'));
      setBusy(false);
    }
  };

  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-end-title" data-testid="end-lesson">
      <div className="cc-flow-head">
        <ThemeIllustration name="endLesson" width={150} />
        <h2 id="cc-end-title" className="cc-h1">
          {t('lesson.endTitle', { cls: label })}
        </h2>
      </div>
      {uis.map(({ key, title, Component }) => (
        <section key={key} className="cc-stack" aria-label={t(title)}>
          <h3 className="cc-h2">{t(title)}</h3>
          <Component lesson={lesson} value={values[key]} onChange={(v) => setValues((s) => ({ ...s, [key]: v }))} />
        </section>
      ))}
      {error ? <Alert>{error}</Alert> : null}
      {busy && !error ? (
        <p role="status" className="cc-muted">
          {t('lesson.ending')}
        </p>
      ) : null}
      {/* Pinned to the bottom of the screen: Save is in reach however long the steps are (D-139). */}
      <div className="cc-row cc-end-actions" data-testid="end-lesson-actions">
        <Button size="big" onPress={onCancel} isDisabled={busy}>
          <IconPrev />
          {t('lesson.backToLesson')}
        </Button>
        <Button size="big" variant="danger" className="cc-push-right" onPress={() => void finish()} isDisabled={busy}>
          <IconFlag />
          {t('lesson.saveAndEnd')}
        </Button>
      </div>
    </section>
  );
}

/** After End Lesson: what was saved (LES-3), then back to the class picker. */
export function LessonSummaryView({ lessonId, timezone, initial, onDone }: { lessonId: string; timezone: string; initial: LessonSummary | null; onDone: () => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['classroom', 'summary', lessonId], queryFn: () => call(L.lessonSummary, { lessonId }), ...(initial ? { initialData: initial } : {}) });
  const s = q.data;
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-summary-title" data-testid="lesson-summary">
      <h2 id="cc-summary-title" className="cc-h1">
        {t('summary.title')}
      </h2>
      {s ? (
        <dl className="cc-summary">
          <dt>{t('summary.class')}</dt>
          <dd>{classLabel({ className: s.className, subjectName: s.subjectName }, locale)}</dd>
          <dt>{t('summary.time')}</dt>
          <dd>
            {formatDate(s.startedAt, locale, timezone, { weekday: 'long', day: 'numeric', month: 'long' })} · {formatDate(s.startedAt, locale, timezone, { hour: '2-digit', minute: '2-digit' })}
            {s.endedAt
              ? `–${formatDate(s.endedAt, locale, timezone, { hour: '2-digit', minute: '2-digit' })} (${t('summary.minutes', { count: Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000)) })})`
              : ''}
          </dd>
          {s.stageCount > 0 ? (
            <>
              <dt>{t('summary.routine')}</dt>
              <dd>{t('summary.stages', { name: pickText(s.routineName, locale), reached: s.stageReached, total: s.stageCount })}</dd>
            </>
          ) : null}
          {s.attendance ? (
            <>
              <dt>{t('summary.attendance')}</dt>
              <dd className="cc-row">
                {(['present', 'late', 'absent', 'excused', 'not_recorded'] as const).map((k) => (
                  <span key={k}>
                    {t(`attendance.status.${k}`)}: <MetricCell value={s.attendance![k]} />
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          <dt>{t('reflection.title')}</dt>
          <dd className="cc-row">
            {s.reflection?.rating ? (
              <span className="cc-row">
                <IconFace level={s.reflection.rating as 1 | 2 | 3 | 4} />
                {t(`reflection.rating.${s.reflection.rating as 1 | 2 | 3 | 4}`)}
              </span>
            ) : (
              <span className="cc-muted">{t('reflection.none')}</span>
            )}
            {s.reflection?.note ? <span>“{s.reflection.note}”</span> : null}
          </dd>
        </dl>
      ) : (
        <p className="cc-muted">{q.isError ? t('summary.pending') : t('common.loading')}</p>
      )}
      <div>
        <Button size="big" variant="primary" onPress={onDone}>
          {t('summary.backToClasses')}
        </Button>
      </div>
    </section>
  );
}
