/**
 * Routines on the classroom device (RTN-1..3), contributed through the routines manifest (D-069):
 * the Start Lesson routine choice (adds `routineTemplateId` to 'lesson.start') and the stage stepper
 * beside the lesson timer (dashboard `stage` region). On the "Learning goal" stage the stepper also
 * shows the lesson's topics ("Today's focus", S13a 7).
 */
import { DEFAULT_ROUTINE_ID, LEARNING_GOAL_STAGE_ID } from '../../../domain/routines.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconCheck, IconNext, IconPrev } from '../../ui/icons.tsx';
import { patchLesson, sendLessonCommand, useRoutines } from '../lessons/lessonClient.ts';
import { FocusTopics } from '../lessons/TopicsClassroom.tsx';
import { startStep, type ClassroomContext, type DashboardSlot, type StartStepProps } from '../types.ts';

// ---------------------------------------------------------------- Start Lesson step
/** The routine the teacher picked; null = the class default (or the built-in default routine). */
type RoutineChoice = string | null;

const chosenRoutine = (choice: RoutineChoice, defaultTemplateId: string | null | undefined) => choice ?? defaultTemplateId ?? DEFAULT_ROUTINE_ID;

function RoutineStartStep({ context, value, onChange }: StartStepProps<RoutineChoice>) {
  const { t, locale } = useI18n();
  const routines = useRoutines(context.id);
  const chosen = chosenRoutine(value, routines.data?.defaultTemplateId);
  return (
    <fieldset className="cc-stack cc-fieldset">
      <legend className="cc-h2">{t('lesson.chooseRoutine')}</legend>
      {routines.data?.templates.map((r) => (
        <label key={r.id} className="cc-choice" data-selected={r.id === chosen ? '' : undefined}>
          <input type="radio" name="routine" value={r.id} checked={r.id === chosen} onChange={() => onChange(() => r.id)} />
          <span className="cc-choice__title">{pickText(r.name, locale)}</span>
          <span className="cc-muted">{r.stages.map((s) => pickText(s.name, locale)).join(' → ')}</span>
        </label>
      ))}
    </fieldset>
  );
}

function useRoutineStartContribution(context: ClassroomContext, value: RoutineChoice, enabled: boolean) {
  const routines = useRoutines(enabled ? context.id : null);
  if (!enabled) return { input: {}, ready: true };
  return { input: { routineTemplateId: chosenRoutine(value, routines.data?.defaultTemplateId) }, ready: true };
}

export const routineStartStep = startStep<RoutineChoice>({
  key: 'routine',
  module: 'routines',
  order: 90,
  title: 'lesson.step.routine',
  initial: () => null,
  Component: RoutineStartStep,
  useContribution: useRoutineStartContribution,
});

// ---------------------------------------------------------------- during the lesson
function RoutineStepper({ lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t, locale } = useI18n();
  const stages = lesson.routine.stages;
  if (stages.length === 0) return null;
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
        {current?.id === LEARNING_GOAL_STAGE_ID && lesson.topics.length ? (
          <div className="cc-routine__focus" data-testid="stage-focus">
            <span className="cc-routine__now-label">{t('lesson.topic.todaysFocus')}</span>
            <FocusTopics topics={lesson.topics} />
          </div>
        ) : null}
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

export const routineDashboardSlot: DashboardSlot = { key: 'routine', module: 'routines', order: 50, region: 'stage', Component: RoutineStepper };
