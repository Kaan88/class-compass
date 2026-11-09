/**
 * Routines on the classroom device (RTN-1..3), contributed through the routines manifest (D-069):
 * the Start Lesson routine choice (adds `routineTemplateId` to 'lesson.start') and the stage stepper
 * beside the lesson timer (the board's routine box, S14b). On the "Learning goal" stage the stepper also
 * shows the lesson's topics ("Today's focus", S13a 7).
 */
import { useEffect, useRef } from 'react';
import { DEFAULT_ROUTINE_ID, LEARNING_GOAL_STAGE_ID } from '../../../domain/routines.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconCheck, IconList, IconNext, IconPrev } from '../../ui/icons.tsx';
import { patchLesson, sendLessonCommand, useRoutines } from '../lessons/lessonClient.ts';
import { FocusTopics } from '../lessons/TopicsClassroom.tsx';
import { startStep, type ClassroomContext, type DashboardSlot, type DashboardSlotProps, type StartStepProps } from '../types.ts';
import { playEvent } from '../../themes/index.tsx';

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
/** Scroll `el` (only if it scrolls) so that `item` is fully visible inside it. */
function revealIn(el: HTMLElement | null, item: Element) {
  if (!el || (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)) return;
  const box = el.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  if (r.left < box.left) el.scrollLeft -= box.left - r.left + 8;
  else if (r.right > box.right) el.scrollLeft += r.right - box.right + 8;
  if (r.top < box.top) el.scrollTop -= box.top - r.top + 8;
  else if (r.bottom > box.bottom) el.scrollTop += r.bottom - box.bottom + 8;
}

/**
 * The routine on the classroom board (S14b, D-148): name, the current stage in big type, Previous /
 * Next, and every stage as a chip (no sideways strip). In a box at least 40rem wide the chips keep to
 * one line and a chip that does not fit shortens its name with an ellipsis (its full name is its
 * accessible name), so long stage names (Turkish) never take a second line from the student grid; in
 * a narrower box they wrap. When a teacher's own layout makes the box too small for all chips, the box
 * scrolls and the current chip is kept in view.
 */
function RoutineStepper({ lesson }: DashboardSlotProps) {
  const { t, locale } = useI18n();
  const listRef = useRef<HTMLOListElement | null>(null);
  const stages = lesson.routine.stages;
  const idx = lesson.stageIndex;
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector('[aria-current="step"]');
    if (!list || !current) return;
    revealIn(list, current);
    revealIn(list.closest<HTMLElement>('.cc-lesson-box__body'), current);
  }, [idx, stages.length]);
  if (stages.length === 0) return null;
  const go = (i: number) => {
    if (i < 0 || i >= stages.length || i === idx) return;
    playEvent('stageChange');
    patchLesson(lesson.contextId, (l) => ({ ...l, stageIndex: i }));
    void sendLessonCommand('lesson.setStage', { contextId: lesson.contextId, lessonId: lesson.id, stageIndex: i });
  };
  const current = stages[idx];
  return (
    <section className="cc-card cc-routine" aria-labelledby="cc-routine-title">
      <div className="cc-routine__head">
        <div className="cc-routine__now" data-testid="current-stage">
          <h2 id="cc-routine-title" className="cc-routine__title">
            {pickText(lesson.routine.name, locale) || t('routine.title')}
          </h2>
          <span className="cc-routine__now-label">{t('routine.now', { n: idx + 1, total: stages.length })}</span>
          <span className="cc-routine__now-name">{current ? pickText(current.name, locale) : ''}</span>
          {current?.id === LEARNING_GOAL_STAGE_ID && lesson.topics.length ? (
            <div className="cc-routine__focus" data-testid="stage-focus">
              <span className="cc-routine__now-label">{t('lesson.topic.todaysFocus')}</span>
              <FocusTopics topics={lesson.topics} />
            </div>
          ) : null}
        </div>
        <div className="cc-routine__nav">
          {/* Short words on screen, the full name for screen readers (the visible word is part of it). */}
          <Button onPress={() => go(idx - 1)} isDisabled={idx === 0} aria-label={t('routine.prev')}>
            <IconPrev />
            {t('routine.prevShort')}
          </Button>
          <Button variant="primary" onPress={() => go(idx + 1)} isDisabled={idx >= stages.length - 1} aria-label={t('routine.next')}>
            {t('routine.nextShort')}
            <IconNext />
          </Button>
        </div>
      </div>
      <ol ref={listRef} className="cc-stepper" aria-label={t('routine.stages')} data-testid="routine-stages">
        {stages.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'current' : 'next';
          return (
            <li key={s.id} data-state={state} aria-current={i === idx ? 'step' : undefined}>
              <Button size="small" className="cc-stepper__btn" onPress={() => go(i)} aria-label={t('routine.goTo', { name: pickText(s.name, locale), n: i + 1 })}>
                <span className="cc-stepper__num" aria-hidden="true">
                  {state === 'done' ? <IconCheck /> : i + 1}
                </span>
                <span className="cc-stepper__name">{pickText(s.name, locale)}</span>
                {state === 'current' ? <span className="cc-stepper__mark">{t('routine.current')}</span> : null}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Dock badge: the stage the lesson is at ("2 / 6"). */
function useRoutineBadge(_context: ClassroomContext, lesson: LessonState) {
  const n = lesson.routine.stages.length;
  return n ? `${Math.min(lesson.stageIndex + 1, n)} / ${n}` : null;
}

export const routineDashboardSlot: DashboardSlot = {
  key: 'routine',
  module: 'routines',
  order: 50,
  dock: { Icon: IconList, label: 'routine.title', useBadge: useRoutineBadge },
  Component: RoutineStepper,
};
