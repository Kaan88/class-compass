/**
 * Routines on the classroom device (RTN-1..3), contributed through the routines manifest (D-069):
 * the Start Lesson routine choice (adds `routineTemplateId` to 'lesson.start') and the stage stepper
 * beside the lesson timer (the board's routine box, S14b). On the "Learning goal" stage the stepper also
 * shows the lesson's topics ("Today's focus", S13a 7) and, when the lesson has one, today's goal
 * sentence (S28a, D-197). The goal comes from the polled lesson state's `lessonGoal`, which the server
 * fills only while Lesson goals is on for the class+subject: this module reads no other module's data
 * and imports nothing from it.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_ROUTINE_ID, LEARNING_GOAL_STAGE_ID } from '../../../domain/routines.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { useLayoutFit } from '../../ui/useLayoutFit.ts';
import { IconCheck, IconList, IconNext, IconPrev, IconTarget } from '../../ui/icons.tsx';
import { lessonQueryOptions, patchLesson, sendLessonCommand, useRoutines } from '../lessons/lessonClient.ts';
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
 * How the stage chips fit (S29, D-200): names on one line, names on two lines, the chips with their
 * names on more than one line of chips when the box has room for that below them (larger text, S29
 * review), or compact.
 */
export const STEPPER_FITS = ['one', 'two', 'wrap', 'compact'] as const;
export type StepperFit = (typeof STEPPER_FITS)[number];

/** Do the chips of `list`, as laid out now, fit: one line of chips (unless `wrap`), no name over `maxLines` lines? */
function stepperFits(list: HTMLElement, maxLines: number): boolean {
  if (list.scrollWidth > list.clientWidth + 1) return false;
  for (const name of list.querySelectorAll<HTMLElement>('.cc-stepper__name')) {
    const box = name.getBoundingClientRect();
    if (box.width <= 1) continue; // hidden (compact)
    if (name.scrollWidth > name.clientWidth + 1) return false;
    const line = parseFloat(getComputedStyle(name).lineHeight);
    if (Number.isFinite(line) && box.height > maxLines * line + 1) return false;
  }
  return true;
}

/**
 * Choose the first fit at which every chip shows its whole name in whole words (S29, D-200): one line
 * of names, then names on up to two balanced lines (the chips keep the touch height); when neither fits
 * on one line of chips, the chips with their names wrapped onto further lines (`wrap`) if the routine
 * box has room for them as it is, without growing or scrolling (larger text in a box the board made
 * high enough, S29 review), and otherwise `compact`, where the chips other than the current one show
 * only their number (the name stays their accessible name) and the current chip and the stage name
 * above it are shown in full. Sets `data-fit` on the list; in a box narrower than 40rem the chips wrap
 * and every fit looks the same. While it measures, `data-fitting` turns transitions off, so no size is
 * read in the middle of one (the reduced-motion rule gives every property a tiny one; S29 review).
 */
export function fitStepper(list: HTMLElement): StepperFit {
  list.dataset.fitting = '';
  try {
    for (const fit of ['one', 'two'] as const) {
      list.dataset.fit = fit;
      if (stepperFits(list, fit === 'one' ? 1 : 2)) return fit;
    }
    list.dataset.fit = 'compact';
    const box = list.closest<HTMLElement>('.cc-lesson-box');
    const body = list.closest<HTMLElement>('.cc-lesson-box__body');
    if (!box || !body) return 'compact';
    const height = box.getBoundingClientRect().height;
    const scrolls = body.scrollHeight > body.clientHeight + 1;
    list.dataset.fit = 'wrap';
    if (!scrolls && stepperFits(list, 2) && box.getBoundingClientRect().height <= height + 0.5 && body.scrollHeight <= body.clientHeight + 1) return 'wrap';
    list.dataset.fit = 'compact';
    return 'compact';
  } finally {
    delete list.dataset.fitting;
  }
}

/** Head stage-name sizes: the big size, then two smaller ones on the same line height (S29 review). */
const STAGE_NAME_FITS = ['', 'small', 'smaller'] as const;

/**
 * Keep the big stage name above the chips to one line when a smaller size on the same line height
 * does it (S29 review): a long Turkish name ("Tarih ve hava durumu" at 1280×720) used to take two
 * lines, so the routine box grew on that stage only and the student grid lost a row of cards and jumped
 * back on the next stage. A name that needs two lines even at the smallest size keeps the big size.
 */
export function fitStageName(name: HTMLElement): void {
  name.dataset.fitting = '';
  try {
    for (const fit of STAGE_NAME_FITS) {
      if (fit) name.dataset.fit = fit;
      else delete name.dataset.fit;
      const line = parseFloat(getComputedStyle(name).lineHeight);
      const height = name.getBoundingClientRect().height;
      if (!Number.isFinite(line) || height <= line * 1.5) return;
    }
    delete name.dataset.fit;
  } finally {
    delete name.dataset.fitting;
  }
}

/**
 * The routine on the classroom board (S14b, D-148): name, the current stage in big type, Previous /
 * Next, and every stage as a chip (no sideways strip). In a box at least 40rem wide the chips keep to
 * one line and the fit (S29, D-200, `fitStepper`) chooses names on one line, on two lines of whole
 * words, or compact chips (numbers, the current chip named), so long stage names (Turkish) are never
 * cut mid-word and never take a second line of chips from the student grid; in a narrower box they
 * wrap. When a teacher's own layout makes the box too small for all chips, the box scrolls and the
 * current chip is kept in view.
 */
function RoutineStepper({ lesson }: DashboardSlotProps) {
  const { t, locale } = useI18n();
  const listRef = useRef<HTMLOListElement | null>(null);
  const stages = lesson.routine.stages;
  const idx = lesson.stageIndex;
  const stageNames = stages.map((s) => pickText(s.name, locale)).join('\n');
  const nameRef = useRef<HTMLSpanElement | null>(null);
  // The fits run before paint and again when the width, the fonts or the display settings change.
  useLayoutFit(listRef, fitStepper, [idx, stageNames]);
  useLayoutFit(nameRef, fitStageName, [idx, stageNames]);
  // Read from the lesson state the board already polls (no fetch of its own): null while Lesson goals is off.
  const goalText = useQuery({ ...lessonQueryOptions(lesson.contextId), enabled: false, refetchInterval: false, refetchOnWindowFocus: false, select: (q) => q.data.lessonGoal?.text ?? null }).data ?? null;
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
  const goalStage = current?.id === LEARNING_GOAL_STAGE_ID;
  // A longer sentence is set smaller (like the board's goal box), so 140 characters stay in the box.
  const goalLength = goalText && goalText.length > 90 ? 'long' : goalText && goalText.length > 45 ? 'mid' : undefined;
  // While the goal is shown the topics move up beside the stage name and the goal gets a line of its own
  // under the head; with two or more topics Previous / Next move down beside the goal, so the topics have
  // the whole width for one line (app.css; review of D-197: the goal must not take the last card row).
  const goalLayout = goalStage && goalText ? (lesson.topics.length > 1 ? 'many' : 'one') : undefined;
  return (
    <section className="cc-card cc-routine" aria-labelledby="cc-routine-title">
      <div className="cc-routine__head" data-goal={goalLayout}>
        <div className="cc-routine__now" data-testid="current-stage">
          <h2 id="cc-routine-title" className="cc-routine__title">
            {pickText(lesson.routine.name, locale) || t('routine.title')}
          </h2>
          <span className="cc-routine__now-label">{t('routine.now', { n: idx + 1, total: stages.length })}</span>
          <span ref={nameRef} className="cc-routine__now-name">{current ? pickText(current.name, locale) : ''}</span>
          {goalStage && lesson.topics.length ? (
            <div className="cc-routine__focus" data-testid="stage-focus">
              <span className="cc-routine__now-label">{t('lesson.topic.todaysFocus')}</span>
              <FocusTopics topics={lesson.topics} />
            </div>
          ) : null}
        </div>
        {goalStage && goalText ? (
          <p className="cc-routine__goal" data-testid="stage-goal" data-length={goalLength}>
            <IconTarget />
            <span className="cc-routine__goal-body">
              <span className="cc-routine__now-label cc-routine__goal-label">{t('lessonGoals.title')}</span> <span className="cc-routine__goal-text">{goalText}</span>
            </span>
          </p>
        ) : null}
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
              {/* Named by its visible text (number, name, "Now"), so speech input and screen readers agree (WCAG 2.5.3). */}
              <Button size="small" className="cc-stepper__btn" onPress={() => go(i)}>
                <span className="cc-stepper__num">
                  {state === 'done' ? (
                    <>
                      {/* A compact chip shows the number with the tick as a badge (S29 review), so done stages stay apart. */}
                      <span className="cc-stepper__tick">
                        <IconCheck />
                      </span>
                      <span className="cc-stepper__done-num">{i + 1}</span>
                      <span className="cc-visually-hidden">{t('routine.stageDone')}</span>
                    </>
                  ) : (
                    i + 1
                  )}
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
