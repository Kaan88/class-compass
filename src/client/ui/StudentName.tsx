/**
 * A student's name that opens their statistics (S14e2, D-154).
 *
 * In the teacher area (inside `StudentStatsProvider`, which `TeacherLayout` puts behind the PIN gate)
 * every student name is a button that opens the statistics drawer (`reports/StudentStatsDrawer.tsx`,
 * loaded lazily): the student's own report in one class+subject and period, their latest events and
 * "Open full report". Outside the provider (the classroom screen, the admin area, the student page,
 * the drawer itself) the same component renders the plain name, so a shared component can always use
 * it. Where a name already does something else (opens the student's goals or achievements), keep that
 * and add `StudentStatsButton` next to it. The classroom screen never opens statistics: its student
 * cards open the positive-only classroom card instead.
 */
import { createContext, lazy, Suspense, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Button as RACButton } from 'react-aria-components';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { IconChart } from './icons.tsx';

export interface StudentStatsTarget {
  studentId: string;
  name: string;
  /** The class+subject to show first (the page's own), when the screen has one. */
  contextId?: string | undefined;
  /** Otherwise a class: its current class+subject of this teacher is shown first. */
  classId?: string | undefined;
}

const StudentStatsDrawer = lazy(() => import('../reports/StudentStatsDrawer.tsx').then((m) => ({ default: m.StudentStatsDrawer })));

interface StatsApi {
  open: (target: StudentStatsTarget) => void;
  /** Id of the hidden "Opens this student's statistics" text every name button points to. */
  hintId: string;
}

const StatsContext = createContext<StatsApi | null>(null);

/** Makes the student names below it open the statistics drawer (one drawer for the whole area). */
export function StudentStatsProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<StudentStatsTarget | null>(null);
  const hintId = useId();
  const api = useMemo<StatsApi>(() => ({ open: setTarget, hintId }), [hintId]);
  return (
    <StatsContext.Provider value={api}>
      {children}
      <span id={hintId} hidden>
        {t('studentStats.nameHint')}
      </span>
      {target ? (
        <Suspense fallback={null}>
          {/* Inside the drawer names are plain text: it already shows this student. */}
          <StatsContext.Provider value={null}>
            <StudentStatsDrawer key={target.studentId} target={target} onClose={() => setTarget(null)} />
          </StatsContext.Provider>
        </Suspense>
      ) : null}
    </StatsContext.Provider>
  );
}

/** The function that opens the drawer, or null where statistics are not available (classroom, admin). */
export function useStudentStats(): ((target: StudentStatsTarget) => void) | null {
  return useContext(StatsContext)?.open ?? null;
}

/** The name as a button that opens the student's statistics (plain text where they are not available). */
export function StudentName({
  id,
  name,
  contextId,
  classId,
  className,
}: {
  id: string;
  name: string;
  contextId?: string | undefined;
  classId?: string | undefined;
  className?: string;
}) {
  const stats = useContext(StatsContext);
  if (!stats) return <span className={className}>{name}</span>;
  return (
    <RACButton
      className={`cc-student-name${className ? ` ${className}` : ''}`}
      aria-haspopup="dialog"
      aria-describedby={stats.hintId}
      data-testid="student-name"
      onPress={() => stats.open({ studentId: id, name, contextId, classId })}
    >
      {name}
    </RACButton>
  );
}

/** A separate statistics button, for places where the name already does something else. */
export function StudentStatsButton({ id, name, contextId, classId }: { id: string; name: string; contextId?: string | undefined; classId?: string | undefined }) {
  const { t } = useI18n();
  const open = useStudentStats();
  if (!open) return null;
  return (
    <Button size="small" variant="ghost" className="cc-student-stats-btn" aria-label={t('studentStats.button', { name })} aria-haspopup="dialog" onPress={() => open({ studentId: id, name, contextId, classId })}>
      <IconChart />
    </Button>
  );
}
