/**
 * One box of the classroom board (S14b, D-148): the timer, the student grid, the dock, or a module's
 * dashboard slot (`presentation="box"`). A box whose slot renders nothing is hidden by the stylesheet
 * (its row neighbours take the space), so a module with nothing to show never leaves an empty card.
 */
import { Fragment, useState, type ReactNode } from 'react';
import type { BoxKey, ClassroomLayout } from '../../../../shared/classroomLayout.ts';
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import type { MessageKey } from '../../../../shared/i18n/index.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { Button } from '../../../ui/Button.tsx';
import { IconChevronDown, IconChevronUp } from '../../../ui/icons.tsx';
import { StudentCard, StudentGrid } from '../../../ui/Students.tsx';
import { slotForBox, useStudentCardAddons, type ClassroomContext, type StudentCardExtras } from '../../registry.ts';
import { LessonTimer } from '../LessonTimer.tsx';
import { useLessonRoster } from '../lessonClient.ts';
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

/** The student heading (count, show/hide, the modules' summaries) and the card grid (scrolls inside its box). */
function StudentsBox({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const roster = useLessonRoster(context.id, lesson.id);
  const [gridOpen, setGridOpen] = useState(readGridOpen);
  // The classroom card a tapped name opens (S14e2, D-154): positive things only, no full statistics.
  const [cardFor, setCardFor] = useState<string | null>(null);
  const students = roster.data?.students ?? [];
  const cardStudent = cardFor ? students.find((s) => s.id === cardFor) : undefined;
  const addons = useStudentCardAddons(context, lesson);
  const extrasFor = (id: string, name: string): StudentCardExtras => Object.assign({}, ...addons.map((a) => a.cardProps(id, name))) as StudentCardExtras;
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
    <section className="cc-students-box" aria-labelledby="cc-students-title">
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
      </div>
      {gridOpen ? (
        <div id="cc-student-grid" className="cc-students-box__grid">
          <StudentGrid count={students.length} label={t('lesson.studentCards')}>
            {students.map((s) => (
              <StudentCard key={s.id} student={s} {...extrasFor(s.id, s.fullName)} onOpen={() => setCardFor(s.id)} />
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
