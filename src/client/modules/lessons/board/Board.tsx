/**
 * The classroom board during a lesson (S14b, D-148; DSH-1..8, RTN-3, LES-2/4). Replaces the S13a rail
 * layout (D-103/D-139): a wide row on top with the routine (every stage visible) beside a big timer,
 * today's focus and the class counter, the full-width student grid, and a bottom dock of big buttons
 * for the other panels with End lesson. The board fills the screen under the top bar: only the
 * student grid scrolls (inside its box), so the routine, the timer, the counter and the dock with
 * End lesson stay in view on every display.
 *
 * Every box comes from the teacher's layout for this class (`/api/classroom/layout`, or the default),
 * healed for the modules that are on (`effectiveLayout`): a module switched off leaves no hole. The
 * pieces come from the manifests (D-069): dashboard slots by box key, student-card add-ons; the board
 * names no module. Below 64rem it is one column that scrolls with the page, with the dock at the
 * bottom of the screen. "Customise layout" (top bar, PIN) turns the board into the layout editor.
 */
import { useCallback, useMemo, type ReactNode, type Ref } from 'react';
import { BOX_CATALOGUE, effectiveLayout, type BoxKey, type ClassroomLayout } from '../../../../shared/classroomLayout.ts';
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { availableBoxKeys, type ClassroomContext } from '../../registry.ts';
import { BoxContent } from './Box.tsx';
import { LayoutEditor } from './LayoutEditor.tsx';
import { useClassroomLayout, useLayoutEditing, useWideEnough } from './layoutClient.ts';

/**
 * The board ends at the bottom of the screen: its height is the viewport minus where it starts on
 * the page (top bar, class switcher), measured after layout and whenever the page changes size.
 */
export function useBoardTop() {
  return useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--cc-board-top', `${Math.max(0, Math.round(top))}px`);
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
}

/** What the editor adds to the board: frames over the boxes, row splitters, its own dock row. */
export interface BoardEditing {
  frame: (key: BoxKey, row: number, index: number) => ReactNode;
  rowSplitter: (row: number) => ReactNode;
  dock: ReactNode;
  guide: ReactNode;
  toolbar: ReactNode;
}

const isDockRow = (r: ClassroomLayout['rows'][number]) => r.boxes.some((b) => b.key === 'core.dock');

export function BoardRows({
  layout,
  context,
  lesson,
  onEnd,
  editing,
  boardRef,
}: {
  layout: ClassroomLayout;
  context: ClassroomContext;
  lesson: LessonState;
  onEnd: () => void;
  editing?: BoardEditing;
  boardRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useI18n();
  return (
    <div
      ref={boardRef}
      className="cc-lesson-board"
      data-testid="lesson-dashboard"
      data-lesson-id={lesson.id}
      data-editing={editing ? '' : undefined}
      role="region"
      aria-label={t('classroom.dashboard')}
    >
      {editing?.toolbar}
      <div className="cc-lesson-board__rows">
        {editing?.guide}
        {layout.rows.map((row, ri) => {
          const dockRow = isDockRow(row);
          const students = row.boxes.some((b) => b.key === 'core.students');
          return (
            <div
              key={row.boxes.map((b) => b.key).join('|')}
              className="cc-lesson-row"
              data-row={ri}
              data-dock-row={dockRow ? '' : undefined}
              data-students-row={students ? '' : undefined}
              style={{ ['--cc-row-h' as string]: String(row.h) }}
            >
              {row.boxes.map((b, bi) => (
                <div
                  key={b.key}
                  className="cc-lesson-box"
                  data-box={b.key}
                  data-w={b.w}
                  data-fill={BOX_CATALOGUE[b.key].defaultPlace === 'dock' ? '' : undefined}
                  style={{ ['--cc-box-w' as string]: String(b.w) }}
                >
                  <div className="cc-lesson-box__body" inert={editing ? true : undefined}>
                    {dockRow && editing ? null : <BoxContent boxKey={b.key} layout={layout} context={context} lesson={lesson} onEnd={onEnd} />}
                  </div>
                  {dockRow && editing ? editing.dock : null}
                  {editing && !dockRow ? editing.frame(b.key, ri, bi) : null}
                </div>
              ))}
              {editing && !dockRow ? editing.rowSplitter(ri) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LessonBoard({ context, lesson, onEnd }: { context: ClassroomContext; lesson: LessonState; onEnd: () => void }) {
  const q = useClassroomLayout(context.id);
  const editing = useLayoutEditing();
  const wide = useWideEnough();
  const boardRef = useBoardTop();
  const available = availableBoxKeys(context);
  const availableKey = [...available].sort().join(',');
  const stored = q.data?.layout ?? null;
  // `available` is a new Set on every render: the layout is recomputed only when its contents change.
  const layout = useMemo(() => effectiveLayout(stored, available), [stored, availableKey]);
  if (editing === context.id && wide) return <LayoutEditor key={context.id} initial={layout} source={q.data?.source ?? 'default'} context={context} lesson={lesson} onEnd={onEnd} boardRef={boardRef} />;
  return <BoardRows layout={layout} context={context} lesson={lesson} onEnd={onEnd} boardRef={boardRef} />;
}
