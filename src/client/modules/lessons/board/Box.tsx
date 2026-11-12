/**
 * One box of the classroom board (S14b, D-148): the timer, the student grid, the dock, or a module's
 * dashboard slot (`presentation="box"`). A box whose slot renders nothing is hidden by the stylesheet
 * (its row neighbours take the space), so a module with nothing to show never leaves an empty card.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { BoxKey, ClassroomLayout } from '../../../../shared/classroomLayout.ts';
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import type { MessageKey } from '../../../../shared/i18n/index.ts';
import { motionAllowed, useDisplay } from '../../../lib/display.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { Button } from '../../../ui/Button.tsx';
import { IconChevronDown, IconChevronUp } from '../../../ui/icons.tsx';
import { StudentCard, StudentGrid } from '../../../ui/Students.tsx';
import { slotForBox, useStudentCardAddons, type ClassroomContext, type StudentCardExtras } from '../../registry.ts';
import { LessonTimer } from '../LessonTimer.tsx';
import { useLessonRoster } from '../lessonClient.ts';
import { CARD_FIT_EVENT, useCardFit } from './cardFit.ts';
import { Dock } from './Dock.tsx';
import { StudentCardDialog } from './StudentCardDialog.tsx';

const GRID_KEY = 'cc.studentGridOpen';
const readGridOpen = () => {
  try {
    return localStorage.getItem(GRID_KEY) !== 'closed';
  } catch {
    return true;
  }
};

/**
 * How many student cards are not fully in view below the bottom of the box that scrolls the grid
 * (S14i review): on a short display (1280×720) the grid scrolls inside its box and a cut row must not
 * hide that more children are there. 0 when the box does not scroll (the page scrolls below 64rem).
 */
export function useCardsBelow(sectionRef: RefObject<HTMLElement | null>, deps: readonly unknown[]): number {
  const [below, setBelow] = useState(0);
  useEffect(() => {
    const section = sectionRef.current;
    const scroller = section?.parentElement;
    if (!section || !scroller) return;
    const measure = () => {
      // Whole pixels for the scroll check and half a pixel for a card: a last row cut by 0.6 px (1440×787,
      // S27c review) is a row that is not whole, and the card fit (D-177) did not count it either.
      const scrolls = scroller.scrollHeight > scroller.clientHeight && /auto|scroll/u.test(getComputedStyle(scroller).overflowY);
      if (!scrolls) return setBelow(0);
      const bottom = scroller.getBoundingClientRect().bottom;
      let n = 0;
      for (const card of section.querySelectorAll('.cc-student-card')) if (card.getBoundingClientRect().bottom > bottom + 0.5) n += 1;
      setBelow(n);
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    section.addEventListener(CARD_FIT_EVENT, measure);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(scroller);
    ro?.observe(section);
    return () => {
      scroller.removeEventListener('scroll', measure);
      section.removeEventListener(CARD_FIT_EVENT, measure);
      ro?.disconnect();
    };
  }, [sectionRef, ...deps]);
  return below;
}

/** The student heading (count, show/hide, the modules' summaries) and the card grid (scrolls inside its box). */
function StudentsBox({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const display = useDisplay();
  const sectionRef = useRef<HTMLElement>(null);
  const roster = useLessonRoster(context.id, lesson.id);
  const [gridOpen, setGridOpen] = useState(readGridOpen);
  // The classroom card a tapped name opens (S14e2, D-154): positive things only, no full statistics.
  const [cardFor, setCardFor] = useState<string | null>(null);
  const students = roster.data?.students ?? [];
  const cardStudent = cardFor ? students.find((s) => s.id === cardFor) : undefined;
  const addons = useStudentCardAddons(context, lesson);
  // Later add-ons replace a field of an earlier one, except the marks, which add up (S22c, D-177).
  const extrasFor = (id: string, name: string): StudentCardExtras => {
    const parts = addons.map((a) => a.cardProps(id, name));
    const marks = parts.flatMap((p) => p.marks ?? []);
    return { ...(Object.assign({}, ...parts) as StudentCardExtras), marks: marks.length ? marks : undefined };
  };
  const extras = new Map(students.map((s) => [s.id, extrasFor(s.id, s.fullName)]));
  const below = useCardsBelow(sectionRef, [gridOpen, students.length]);
  // What changes a card's height (not a passing notice): the fit measures again when it changes.
  const cardShape = students.map((s) => {
    const e = extras.get(s.id)!;
    return `${e.marks?.length ?? 0}${e.attendance ?? ''}${e.weeklyCount === undefined ? '' : 'c'}${e.onAdd ? '+' : ''}`;
  });
  useCardFit(sectionRef, [gridOpen, students.length, cardShape.join('|'), addons.some((a) => a.header)]);
  const showMore = () => {
    const scroller = sectionRef.current?.parentElement;
    scroller?.scrollBy({ top: Math.max(80, scroller.clientHeight * 0.8), behavior: motionAllowed(display) ? 'smooth' : 'auto' });
  };
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
    <section ref={sectionRef} className="cc-students-box" aria-labelledby="cc-students-title">
      <div className="cc-row cc-students-box__head">
        <h2 id="cc-students-title" className="cc-h2">
          {t('lesson.students', { count: students.length })}
        </h2>
        <Button size="small" onPress={toggleGrid} aria-expanded={gridOpen} aria-controls="cc-student-grid">
          {gridOpen ? <IconChevronUp /> : <IconChevronDown />}
          {gridOpen ? t('lesson.hideStudents') : t('lesson.showStudents')}
        </Button>
        {addons.map((a) => (a.summary ? <Fragment key={a.key}>{a.summary}</Fragment> : null))}
        {addons.map((a) => (a.header ? <div key={`${a.key}-header`} className="cc-students-box__header">{a.header}</div> : null))}
        {/* The cue sits in the heading line, which stays at the top of the box, so it never covers a
            card or its buttons (S21 review: at the bottom of the box it sat on the cut row). */}
        {gridOpen && below > 0 ? (
          <Button size="small" className="cc-students-box__more" onPress={showMore} aria-controls="cc-student-grid" data-testid="students-more">
            <IconChevronDown />
            {t('lesson.moreStudents', { count: below })}
          </Button>
        ) : null}
      </div>
      {gridOpen ? (
        <div id="cc-student-grid" className="cc-students-box__grid">
          <StudentGrid count={students.length} label={t('lesson.studentCards')}>
            {students.map((s) => (
              <StudentCard key={s.id} student={s} {...extras.get(s.id)} onOpen={() => setCardFor(s.id)} />
            ))}
          </StudentGrid>
        </div>
      ) : null}
      {cardStudent ? <StudentCardDialog contextId={context.id} student={cardStudent} onClose={() => setCardFor(null)} /> : null}
    </section>
  );
}

/** A box's name for the editor and announcements. */
export function boxLabelKey(context: ClassroomContext, key: BoxKey): MessageKey {
  if (key === 'core.timer') return 'timer.title';
  if (key === 'core.students') return 'lesson.studentCards';
  if (key === 'core.dock') return 'board.dock';
  const slot = slotForBox(context, key);
  return slot?.dock?.label ?? (key === 'attendance' ? 'attendance.open' : 'board.box');
}

export function BoxContent({ boxKey, layout, context, lesson, onEnd }: { boxKey: BoxKey; layout: ClassroomLayout; context: ClassroomContext; lesson: LessonState; onEnd: () => void }): ReactNode {
  if (boxKey === 'core.timer') return <LessonTimer lesson={lesson} />;
  if (boxKey === 'core.students') return <StudentsBox context={context} lesson={lesson} />;
  if (boxKey === 'core.dock') return <Dock items={layout.dock} context={context} lesson={lesson} onEnd={onEnd} />;
  const slot = slotForBox(context, boxKey);
  if (!slot) return null;
  const { Component } = slot;
  return <Component context={context} lesson={lesson} presentation="box" />;
}
