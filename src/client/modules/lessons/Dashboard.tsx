/**
 * Classroom dashboard during a lesson (DSH-1..8, RTN-3, LES-2/4): the lesson timer, End Lesson, the
 * student grid and the module pieces from the manifests (D-069), only for enabled modules that
 * contribute one: `top` slots above the grid (today's focus), `stage` slots (routine stepper),
 * `actions` slots before End Lesson (attendance), `panels` (counters, assistant, groups, Secret
 * Students, homework) and student-card add-ons (attendance chips, counts). Every write is an outbox
 * command naming this lesson.
 *
 * Layout (S13a, D-103; rebalanced in the November usability pass, D-139): the student grid is the
 * main area, with the module panels in a grid of their own under it (they use the space the cards
 * leave free, so the counter is on screen for the class). The rail of a fixed width holds the routine,
 * the timer and the actions; it ends at the bottom of the screen, scrolls on its own and keeps
 * Attendance + End lesson pinned at its foot, so End lesson is always in view. Switching modules off
 * only removes pieces, so no combination leaves an empty or stretched panel (the "layout breaks when
 * modules are off" bug); below 64rem everything is one column.
 */
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * The rail ends at the bottom of the screen: its height is the viewport minus where it starts on the
 * page (top bar, class switcher), measured after layout and whenever the page changes size (D-139).
 */
function useRailTop() {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--cc-rail-top', `${Math.max(0, Math.round(top))}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);
  return ref;
}

export function LessonDashboard({ context, lesson, onEnd }: { context: ClassroomContext; lesson: LessonState; onEnd: () => void }) {
  const { t } = useI18n();
  const roster = useLessonRoster(context.id, lesson.id);
  const [gridOpen, setGridOpen] = useState(readGridOpen);
  const railRef = useRailTop();
  const students = roster.data?.students ?? [];
  const top = dashboardSlotsFor(context, 'top');
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
    <div className="cc-lesson-layout" data-testid="lesson-dashboard" data-lesson-id={lesson.id}>
      <aside ref={railRef} className="cc-lesson-layout__rail cc-stack" aria-label={t('classroom.dashboard')} data-testid="lesson-rail">
        {stage.map(({ key, Component }) => (
          <Component key={key} context={context} lesson={lesson} />
        ))}
        <LessonTimer lesson={lesson} />
        <div className="cc-row cc-lesson-actions" data-testid="lesson-actions">
          {actions.map(({ key, Component }) => (
            <Component key={key} context={context} lesson={lesson} />
          ))}
          <Button size="big" variant="danger" onPress={onEnd} className="cc-push-right">
            <IconFlag />
            {t('lesson.end')}
          </Button>
        </div>
      </aside>
      <div className="cc-lesson-layout__main cc-stack">
        {top.map(({ key, Component }) => (
          <Component key={key} context={context} lesson={lesson} />
        ))}
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
        {panels.length ? (
          <div className="cc-lesson-panels" data-testid="lesson-panels">
            {panels.map(({ key, Component }) => (
              <Component key={key} context={context} lesson={lesson} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
