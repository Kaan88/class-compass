/**
 * Classroom dashboard during a lesson (DSH-1..8, RTN-3, LES-2/4): the lesson timer, End Lesson, the
 * student grid and the module pieces from the manifests (D-069), only for enabled modules that
 * contribute one: `stage` slots beside the timer (routine stepper), `actions` slots before End Lesson
 * (attendance), `panels` (counters, assistant, Secret Students) and student-card add-ons (attendance
 * chips, counts). Every write is an outbox command naming this lesson.
 */
import { Fragment, useState } from 'react';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { IconChevronDown, IconChevronUp, IconFlag } from '../../ui/icons.tsx';
import { StudentCard, StudentGrid } from '../../ui/Students.tsx';
import { LessonTimer } from './LessonTimer.tsx';
import { useLessonRoster } from './lessonClient.ts';
import { dashboardSlotsFor, useStudentCardAddons, type ClassroomContext, type StudentCardExtras } from '../registry.ts';

export { classLabel } from './labels.ts';

const GRID_KEY = 'cc.studentGridOpen';
const readGridOpen = () => {
  try {
    return localStorage.getItem(GRID_KEY) !== 'closed';
  } catch {
    return true;
  }
};

export function LessonDashboard({ context, lesson, onEnd }: { context: ClassroomContext; lesson: LessonState; onEnd: () => void }) {
  const { t } = useI18n();
  const roster = useLessonRoster(context.id, lesson.id);
  const [gridOpen, setGridOpen] = useState(readGridOpen);
  const students = roster.data?.students ?? [];
  const stage = dashboardSlotsFor(context, 'stage');
  const actions = dashboardSlotsFor(context, 'actions');
  const panels = dashboardSlotsFor(context, 'panels');
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
    <div className="cc-stack" data-testid="lesson-dashboard" data-lesson-id={lesson.id}>
      <div className="cc-lesson-grid">
        {stage.map(({ key, Component }) => (
          <Component key={key} context={context} lesson={lesson} />
        ))}
        <LessonTimer lesson={lesson} />
      </div>
      <div className="cc-row">
        {actions.map(({ key, Component }) => (
          <Component key={key} context={context} lesson={lesson} />
        ))}
        <Button size="big" variant="danger" onPress={onEnd} className="cc-push-right">
          <IconFlag />
          {t('lesson.end')}
        </Button>
      </div>
      {panels.length ? (
        <section className="cc-dashboard" aria-label={t('classroom.dashboard')}>
          {panels.map(({ key, Component }) => (
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
          {addons.map((a) => (a.summary ? <Fragment key={a.key}>{a.summary}</Fragment> : null))}
        </div>
        {gridOpen ? (
          <div id="cc-student-grid" className="cc-stack">
            {addons.map((a) => (a.header ? <div key={a.key}>{a.header}</div> : null))}
            <StudentGrid count={students.length} label={t('lesson.studentCards')}>
              {students.map((s) => (
                <StudentCard key={s.id} student={s} {...extrasFor(s.id, s.fullName)} />
              ))}
            </StudentGrid>
          </div>
        ) : null}
      </section>
    </div>
  );
}
