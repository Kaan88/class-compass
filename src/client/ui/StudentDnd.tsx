/**
 * Moving students between lists (S14c, D-150): the groups of the teacher's group editor and of the
 * classroom group screen, each with a "Not in a group" list. Three ways that do the same thing:
 * - drag a name onto another list (mouse, pen and touch: a long press on tablets), with a
 *   "Drop here" line where it will land;
 * - tap a name (it is picked: filled and outlined), then "Move here" on the list it should go to;
 *   Enter on a name picks it from the keyboard;
 * - keyboard and screen readers: every name has a drag handle ("Drag <name>", our own label: react-aria's
 *   Turkish one adds a fixed "’i" suffix that is wrong for most names);
 *   Tab to a list, arrows to a name, Right arrow to its handle, Enter starts a drag, Tab goes from
 *   list to list, Enter drops and Escape cancels.
 * Picking is the row's action, not react-aria selection: react-aria selects whatever a drop inserts
 * (feedback for plain lists), which here would look like "picked" after every drag. The screens name
 * the picked student in a `role="status"` hint, so a screen reader hears the pick too.
 * Built on react-aria `GridList` + `useDragAndDrop`, one per list, inside a react-aria
 * `I18nProvider` with the screen's locale (the class's on the classroom screen, the teacher's in the
 * teacher area), so the screen-reader drag instructions speak the same language as the page.
 * Every list shares one picked student and one `onMove(studentId, toListId)`; the screen decides
 * what a move does (an outbox command in the classroom, a draft change in the editor). A drop
 * inside the list a name came from does nothing (lists are not ordered).
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { DropIndicator, GridList, GridListItem, I18nProvider as AriaI18nProvider, isTextDropItem, useDragAndDrop, type DropItem } from 'react-aria-components';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { IconMove } from './icons.tsx';

/** The drag data type of a student id; a drop of anything else (text, files) is refused. */
export const STUDENT_DRAG_TYPE = 'application/x-class-compass-student';

interface DndContext {
  picked: string | null;
  onPick: (studentId: string | null) => void;
  onMove: (studentId: string, toListId: string) => void;
}
const Ctx = createContext<DndContext | null>(null);

/**
 * The shared state of a set of student lists. `picked` is the student chosen by a tap (or Enter) for
 * "Move here"; the screen keeps it so it can name the student in its own hint.
 */
export function StudentDnd({ picked, onPick, onMove, children }: DndContext & { children: ReactNode }) {
  const { locale } = useI18n();
  const value = useMemo(() => ({ picked, onPick, onMove }), [picked, onPick, onMove]);
  return (
    <AriaI18nProvider locale={locale === 'tr' ? 'tr-TR' : 'en-GB'}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </AriaI18nProvider>
  );
}

export interface DndStudent {
  id: string;
  /** The name as written (also the row's text for screen readers and type-ahead). */
  name: string;
}

export interface StudentDropListProps<S extends DndStudent> {
  /** The list's id, passed to `onMove` (a group id, or `UNPLACED`). */
  id: string;
  /** The list's short name, used in "Move here: <name>". */
  name: string;
  /** The accessible name of the list (e.g. "Group 1, 4 students"); defaults to `name`. */
  label?: string;
  students: readonly S[];
  /** What a row shows (avatar, name, role or level chip). */
  renderStudent: (student: S) => ReactNode;
  /** Shown in an empty list, which still takes drops. */
  emptyText?: string;
  className?: string;
  /** `data-testid` of each row. */
  itemTestId?: string;
  testId?: string;
}

async function droppedIds(items: readonly DropItem[]): Promise<string[]> {
  const out: string[] = [];
  for (const item of items) if (isTextDropItem(item) && item.types.has(STUDENT_DRAG_TYPE)) out.push(await item.getText(STUDENT_DRAG_TYPE));
  return out.filter(Boolean);
}

/**
 * After "Move here" the pressed button is gone (nothing is picked any more), so focus would fall to the
 * page. Keep the keyboard user's place: focus the moved name once it shows in this list, or the list
 * itself when it does not show (the move was refused).
 */
function focusMoved(box: RefObject<HTMLDivElement | null>, studentId: string, frames: { current: number }, tries = 10) {
  frames.current = requestAnimationFrame(() => {
    const el = box.current;
    if (!el) return;
    const row = [...el.querySelectorAll<HTMLElement>('[role="row"]')].find((r) => r.dataset.studentId === studentId);
    if (row) row.focus();
    else if (tries > 0) focusMoved(box, studentId, frames, tries - 1);
    else el.querySelector<HTMLElement>('[role="grid"]')?.focus();
  });
}

/** One list of students: a drop target, a drag source, tap-to-pick and its own "Move here" button. */
export function StudentDropList<S extends DndStudent>({ id, name, label, students, renderStudent, emptyText, className = '', itemTestId, testId }: StudentDropListProps<S>) {
  const { t } = useI18n();
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('StudentDropList must be inside StudentDnd');
  const { picked, onPick, onMove } = ctx;
  const here = new Set(students.map((s) => s.id));
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const moveHere = (studentId: string) => {
    onMove(studentId, id);
    focusMoved(box, studentId, frame);
  };
  const dropped = async (items: readonly DropItem[]) => {
    for (const sid of await droppedIds(items)) onMove(sid, id);
  };
  const { dragAndDropHooks } = useDragAndDrop<S>({
    getItems: (keys) => [...keys].map((k) => ({ [STUDENT_DRAG_TYPE]: String(k), 'text/plain': students.find((s) => s.id === k)?.name ?? '' })),
    getAllowedDropOperations: () => ['move'],
    acceptedDragTypes: [STUDENT_DRAG_TYPE],
    // Drops from another list only (react-aria refuses a drop back into the list a name came from,
    // because neither onReorder nor onMove is given): between two names, or anywhere on the list.
    onInsert: (e) => void dropped(e.items),
    onRootDrop: (e) => void dropped(e.items),
    renderDropIndicator: (target) => (
      <DropIndicator target={target} className="cc-dnd__indicator">
        {({ isDropTarget }) => (isDropTarget ? <span className="cc-dnd__indicator-text">{t('studentDnd.dropHere')}</span> : null)}
      </DropIndicator>
    ),
  });
  return (
    <div ref={box} className={`cc-dnd ${className}`.trim()} data-testid={testId}>
      <GridList
        aria-label={label ?? name}
        className="cc-dnd__list"
        items={students}
        dragAndDropHooks={dragAndDropHooks}
        onAction={(key) => onPick(picked === key ? null : String(key))}
        renderEmptyState={({ isDropTarget }) => (
          <span className="cc-dnd__empty" data-drop-target={isDropTarget || undefined}>
            {isDropTarget ? t('studentDnd.dropHere') : (emptyText ?? t('studentDnd.empty'))}
          </span>
        )}
      >
        {(s) => (
          <GridListItem id={s.id} textValue={s.name} className="cc-dnd__item" data-testid={itemTestId} data-student-id={s.id} data-picked={picked === s.id || undefined}>
            {/* The keyboard and screen-reader drag start (react-aria gives it its press; the label is ours). */}
            <Button slot="drag" variant="ghost" size="small" className="cc-dnd__grip" aria-label={t('studentDnd.dragName', { name: s.name })}>
              <IconMove />
            </Button>
            {renderStudent(s)}
          </GridListItem>
        )}
      </GridList>
      {picked && !here.has(picked) ? (
        <Button size="small" variant="primary" className="cc-dnd__here" onPress={() => moveHere(picked)}>
          {t('studentDnd.moveHere', { list: name })}
        </Button>
      ) : null}
    </div>
  );
}
