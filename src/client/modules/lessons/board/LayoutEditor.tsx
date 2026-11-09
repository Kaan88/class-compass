/**
 * Customise layout (S14b, D-148): the classroom board in edit mode, opened from the top bar's Display
 * popover after the teacher's PIN. The board stays visible with its real content, made inert under a
 * frame per box: a move handle, a "Put in dock" button, a width splitter between boxes and a height
 * splitter under each row, over a 12-column guide. The dock row lists the dock buttons with "Show as
 * box" and their order.
 *
 * Pointer and keyboard use the same pure operations (`domain/classroomLayout.ts`):
 * - pointer: drag a handle (pointer capture, a ghost that follows the pointer at most once a frame)
 *   onto a row, between rows (a new row) or onto the dock; drag a splitter to resize;
 * - keyboard: the handles are one roving tab stop (arrows move between them); Enter picks a box up,
 *   arrows move it, Shift+arrows resize it, Enter puts it down, Escape cancels; every step is
 *   announced (aria-live). The toolbar's buttons do the same for the selected box with single taps
 *   (WCAG 2.5.7).
 *
 * Save (this class or all my classes), Cancel, Reset, inactivity and hiding the page all end the
 * editor and lock the teacher area again (`lockNow`); so does the editor leaving the screen, or never
 * reaching it (`layoutClient`), so the PIN unlock never outlives the editor.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { findBox, fromDock, moveBox, moveInDock, resizeH, resizeW, stepBox, stepSize, toDock, type KeyboardMove } from '../../../../domain/classroomLayout.ts';
import { BOX_CATALOGUE, LAYOUT_COLUMNS, type BoxKey, type ClassroomLayout } from '../../../../shared/classroomLayout.ts';
import type { LayoutScope } from '../../../../shared/contracts/classroomLayout.ts';
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import { errorText } from '../../../lib/errors.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { createIdleTimer, CLIENT_IDLE_LOCK_MS } from '../../../lib/idle.ts';
import { lockNow } from '../../../lib/session.ts';
import { showToast } from '../../../lib/toast.ts';
import { Button } from '../../../ui/Button.tsx';
import { DialogActions, Modal } from '../../../ui/Dialog.tsx';
import { Alert } from '../../../ui/Feedback.tsx';
import { IconCheck, IconChevronDown, IconChevronUp, IconMinus, IconMove, IconNext, IconPlus, IconPrev, IconUndo, IconX } from '../../../ui/icons.tsx';
import type { ClassroomContext } from '../../types.ts';
import { BoardRows } from './Board.tsx';
import { boxLabelKey } from './Box.tsx';
import { editorMounted, resetLayout, saveLayout, setLayoutEditing } from './layoutClient.ts';

const ARROWS: Record<string, KeyboardMove> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

type Drag =
  | { kind: 'move'; key: BoxKey; start: ClassroomLayout; x: number; y: number; moved: boolean }
  | { kind: 'w'; row: number; index: number; start: ClassroomLayout; x: number; unit: number }
  | { kind: 'h'; row: number; start: ClassroomLayout; y: number; unit: number };

const rowBoxes = (l: ClassroomLayout) => l.rows.flatMap((r) => r.boxes.map((b) => b.key)).filter((k) => !BOX_CATALOGUE[k].fixed);

/**
 * The box that takes over the keyboard tab stop when `key` leaves the rows (put in the dock): the next
 * box after it in `before`'s reading order that is still in a row, else the one before it, else the first.
 */
export function nextRowBox(before: ClassroomLayout, after: ClassroomLayout, key: BoxKey): BoxKey | null {
  const now = rowBoxes(after);
  const order = rowBoxes(before);
  const i = order.indexOf(key);
  const candidates = i < 0 ? [] : [...order.slice(i + 1), ...order.slice(0, i).reverse()];
  return candidates.find((k) => now.includes(k)) ?? now[0] ?? null;
}

export function LayoutEditor({
  initial,
  source,
  context,
  lesson,
  onEnd,
  boardRef,
}: {
  initial: ClassroomLayout;
  source: 'class' | 'all' | 'default';
  context: ClassroomContext;
  lesson: LessonState;
  onEnd: () => void;
  boardRef: Ref<HTMLDivElement>;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [draft, setDraftState] = useState(initial);
  const draftRef = useRef(initial);
  const setDraft = (l: ClassroomLayout) => {
    draftRef.current = l;
    setDraftState(l);
  };
  const [history, setHistory] = useState<ClassroomLayout[]>([]);
  const [scope, setScope] = useState<LayoutScope>(source === 'all' ? 'all' : 'class');
  const [selected, setSelected] = useState<BoxKey>(() => rowBoxes(initial)[0] ?? 'core.timer');
  const [picked, setPicked] = useState<{ key: BoxKey; before: ClassroomLayout } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const refocus = useRef<BoxKey | null>(null);
  const rowsEl = useRef<HTMLElement | null>(null);

  const name = (k: BoxKey) => t(boxLabelKey(context, k));
  const describe = (l: ClassroomLayout, k: BoxKey) => {
    const at = findBox(l, k);
    if (!at) return t('board.editor.docked', { name: name(k) });
    return t('board.editor.position', { name: name(k), row: at.row + 1, place: at.index + 1, w: l.rows[at.row]!.boxes[at.index]!.w, h: l.rows[at.row]!.h });
  };

  /** Apply an edit as one undo step; tell the teacher when there was no room for it. */
  const commit = (next: ClassroomLayout, said?: string) => {
    const before = draftRef.current;
    if (next === before) {
      setAnnounce(t('board.editor.noRoom'));
      return false;
    }
    setHistory((h) => [...h, before].slice(-50));
    setDraft(next);
    if (said) setAnnounce(said);
    return true;
  };

  // ------------------------------------------------------------ closing (always relocks)
  const finished = useRef(false);
  const finish = async () => {
    if (finished.current) return;
    finished.current = true;
    setLayoutEditing(null);
    await lockNow(qc).catch(() => undefined);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // On screen for this class: the PIN unlock lasts only while an editor is mounted (layoutClient).
  useLayoutEffect(() => editorMounted(context.id), [context.id]);
  useEffect(() => {
    const idle = createIdleTimer({ ms: CLIENT_IDLE_LOCK_MS, onIdle: () => void finishRef.current() });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void finishRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Gone while still open (another class, the lesson ended, a narrow window): layoutClient closes
    // the editor and locks once no editor for the class is on screen.
    return () => {
      idle.stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /**
   * The roving tab stop and the toolbar's box: the selected box while it is in a row, otherwise (it
   * went to the dock: its button, a drag, Undo) the first box in a row, so a keyboard user can always
   * reach a move handle (WCAG 2.1.1).
   */
  const current: BoxKey | null = findBox(draft, selected) ? selected : (rowBoxes(draft)[0] ?? null);
  /** `key` leaves the rows: the next box takes the selection, and the focus when `key` had it. */
  const handOver = (before: ClassroomLayout, after: ClassroomLayout, key: BoxKey, hadFocus: boolean) => {
    if (findBox(after, key)) return;
    const next = nextRowBox(before, after, key);
    if (!next) return;
    setSelected(next);
    if (hadFocus) refocus.current = next;
  };
  const focusIn = (key: BoxKey) => Boolean(document.activeElement?.closest(`[data-testid="layout-frame-${key}"]`));

  // Keep keyboard focus on the moved box (its frame is re-created in its new row).
  useLayoutEffect(() => {
    const k = refocus.current;
    if (!k) return;
    refocus.current = null;
    document.querySelector<HTMLElement>(`[data-handle="${k}"]`)?.focus();
  }, [draft]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveLayout(context.id, scope, draftRef.current);
      showToast({ message: t(scope === 'all' ? 'board.editor.savedAll' : 'board.editor.saved'), kind: 'success', scope: 'classroom' });
      await finish();
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  };
  const reset = async () => {
    setConfirmReset(false);
    setBusy(true);
    setError(null);
    try {
      await resetLayout(context.id, scope);
      showToast({ message: t('board.editor.resetDone'), kind: 'success', scope: 'classroom' });
      await finish();
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setPicked(null);
    if (current) handOver(draftRef.current, prev, current, false);
    setDraft(prev);
    setAnnounce(t('board.editor.undone'));
  };

  // ------------------------------------------------------------ keyboard
  const onHandleKey = (key: BoxKey) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = ARROWS[e.key];
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(key);
      if (picked?.key === key) {
        if (draftRef.current !== picked.before) setHistory((h) => [...h, picked.before].slice(-50));
        setPicked(null);
        setAnnounce(t('board.editor.dropped', { name: name(key) }));
      } else {
        setPicked({ key, before: draftRef.current });
        setAnnounce(t('board.editor.picked', { name: name(key) }));
      }
      return;
    }
    if (e.key === 'Escape' && picked?.key === key) {
      e.preventDefault();
      e.stopPropagation();
      refocus.current = key;
      setDraft(picked.before);
      setPicked(null);
      setAnnounce(t('board.editor.cancelled', { name: name(key) }));
      return;
    }
    if (!dir) return;
    e.preventDefault();
    if (e.shiftKey) {
      refocus.current = key;
      commit(stepSize(draftRef.current, key, dir), describe(stepSize(draftRef.current, key, dir), key));
      return;
    }
    if (picked?.key === key) {
      const next = stepBox(draftRef.current, key, dir);
      if (next === draftRef.current) setAnnounce(t('board.editor.noRoom'));
      else {
        refocus.current = key;
        setDraft(next);
        setAnnounce(describe(next, key));
      }
      return;
    }
    // Not picked up: the arrows move between the boxes (one tab stop for all of them).
    const order = rowBoxes(draftRef.current);
    const i = order.indexOf(key);
    const j = dir === 'left' || dir === 'up' ? i - 1 : i + 1;
    const target = order[(j + order.length) % order.length];
    if (target) {
      setSelected(target);
      document.querySelector<HTMLElement>(`[data-handle="${target}"]`)?.focus();
    }
  };

  // ------------------------------------------------------------ pointer
  const rowsOf = () => [...(rowsEl.current?.querySelectorAll<HTMLElement>(':scope > .cc-lesson-row') ?? [])];

  /** Where a dragged box lands: the dock, a new row between rows, or a place in a row. */
  const dropTarget = (start: ClassroomLayout, key: BoxKey, x: number, y: number): ClassroomLayout => {
    const rows = rowsOf();
    const dockEl = rows.find((el) => el.dataset.dockRow !== undefined);
    if (dockEl && y >= dockEl.getBoundingClientRect().top - 4) return toDock(start, key);
    const content = rows.filter((el) => el !== dockEl);
    if (!content.length) return start;
    if (y < content[0]!.getBoundingClientRect().top) return moveBox(start, key, { newRow: 0 });
    for (let i = 0; i < content.length; i += 1) {
      const el = content[i]!;
      const r = el.getBoundingClientRect();
      const ri = Number(el.dataset.row);
      if (y > r.bottom) {
        // Between this row and the next (or under the last one): a new row there.
        const next = content[i + 1]?.getBoundingClientRect();
        if (!next || y < next.top) return moveBox(start, key, { newRow: ri + 1 });
        continue;
      }
      const band = Math.min(16, r.height * 0.2);
      if (y < r.top + band) return moveBox(start, key, { newRow: ri });
      if (y > r.bottom - band) return moveBox(start, key, { newRow: ri + 1 });
      const boxes = [...el.querySelectorAll<HTMLElement>(':scope > .cc-lesson-box')].filter((b) => b.dataset.box !== key);
      const index = boxes.filter((b) => {
        const br = b.getBoundingClientRect();
        return br.left + br.width / 2 < x;
      }).length;
      return moveBox(start, key, { row: ri, index });
    }
    return start;
  };

  const flush = () => {
    frame.current = null;
    const p = pointer.current;
    const d = drag.current;
    if (!p || !d) return;
    if (d.kind === 'move') {
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 6) return;
      d.moved = true;
      setGhost({ x: p.x, y: p.y, label: name(d.key) });
    } else if (d.kind === 'w') setDraft(resizeW(d.start, d.row, d.index, Math.round((p.x - d.x) / d.unit)));
    else setDraft(resizeH(d.start, d.row, Math.round((p.y - d.y) / d.unit)));
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  const endDrag = (e: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setGhost(null);
    if (!d) return;
    if (d.kind === 'move') {
      if (cancelled || !d.moved) return;
      const next = dropTarget(d.start, d.key, e.clientX, e.clientY);
      if (next !== d.start) {
        const hadFocus = focusIn(d.key);
        if (commit(next, describe(next, d.key))) handOver(d.start, next, d.key, hadFocus);
      } else setAnnounce(t('board.editor.noRoom'));
      return;
    }
    if (cancelled) {
      setDraft(d.start);
      return;
    }
    if (draftRef.current !== d.start) {
      setHistory((h) => [...h, d.start].slice(-50));
      if (d.kind === 'w') {
        const k = draftRef.current.rows[d.row]?.boxes[d.index]?.key;
        if (k) setAnnounce(describe(draftRef.current, k));
      }
    }
  };
  const capture = (e: PointerEvent, d: Drag) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY };
    drag.current = d;
  };
  const pointerHandlers = (start: (e: PointerEvent) => Drag | null) => ({
    onPointerDown: (e: PointerEvent) => {
      const d = start(e);
      if (d) capture(e, d);
    },
    onPointerMove,
    onPointerUp: (e: PointerEvent) => endDrag(e, false),
    onPointerCancel: (e: PointerEvent) => endDrag(e, true),
  });

  // ------------------------------------------------------------ pieces
  const frameFor = (key: BoxKey, row: number, index: number) => {
    const r = draft.rows[row]!;
    const box = r.boxes[index]!;
    const isPicked = picked?.key === key;
    return (
      <div className="cc-layout-frame" data-selected={current === key ? '' : undefined} data-picked={isPicked ? '' : undefined} data-testid={`layout-frame-${key}`}>
        <div className="cc-layout-frame__bar">
          <button
            type="button"
            className="cc-layout-frame__handle"
            data-handle={key}
            tabIndex={current === key ? 0 : -1}
            aria-pressed={isPicked}
            aria-describedby="cc-layout-help"
            aria-label={t('board.editor.handle', { name: name(key) })}
            onFocus={() => setSelected(key)}
            onClick={() => setSelected(key)}
            onKeyDown={onHandleKey(key)}
            {...pointerHandlers((e) => {
              setSelected(key);
              return { kind: 'move', key, start: draftRef.current, x: e.clientX, y: e.clientY, moved: false };
            })}
          >
            <IconMove />
            <span className="cc-layout-frame__name">{name(key)}</span>
          </button>
          <span className="cc-layout-frame__size">{t('board.editor.size', { w: box.w, h: r.h })}</span>
          {BOX_CATALOGUE[key].dock ? (
            <Button
              size="small"
              onPress={() => {
                const before = draftRef.current;
                const next = toDock(before, key);
                // The pressed button goes away with its frame: the focus moves to the next box's handle.
                if (commit(next, t('board.editor.docked', { name: name(key) }))) handOver(before, next, key, true);
              }}
              data-testid={`layout-to-dock-${key}`}
            >
              {t('board.editor.toDock')}
            </Button>
          ) : null}
        </div>
        {index < r.boxes.length - 1 ? (
          <div
            className="cc-layout-frame__wsplit"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('board.editor.widthSplitter', { name: name(key) })}
            data-testid={`layout-wsplit-${key}`}
            {...pointerHandlers((e) => {
              const rowEl = (e.currentTarget as HTMLElement).closest('.cc-lesson-row');
              const width = rowEl?.getBoundingClientRect().width ?? 1200;
              return { kind: 'w', row, index, start: draftRef.current, x: e.clientX, unit: width / LAYOUT_COLUMNS };
            })}
          />
        ) : null}
      </div>
    );
  };

  const rowSplitter = (row: number) => (
    <div
      className="cc-layout-rowsplit"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('board.editor.heightSplitter', { row: row + 1 })}
      data-testid={`layout-hsplit-${row}`}
      {...pointerHandlers((e) => {
        const h = rowsEl.current?.getBoundingClientRect().height ?? 720;
        return { kind: 'h', row, start: draftRef.current, y: e.clientY, unit: h / 12 };
      })}
    />
  );

  const dockEditor = (
    <div className="cc-layout-dock" data-testid="layout-dock">
      <span className="cc-layout-dock__title">{t('board.dock')}</span>
      {draft.dock.length ? (
        <ul className="cc-layout-dock__items">
          {draft.dock.map((k, i) => (
            <li key={k} className="cc-layout-dock__item" data-dock-item={k}>
              <span>{name(k)}</span>
              <Button size="small" aria-label={t('board.editor.dockLeft', { name: name(k) })} isDisabled={i === 0} onPress={() => commit(moveInDock(draftRef.current, k, -1))}>
                <IconPrev />
              </Button>
              <Button size="small" aria-label={t('board.editor.dockRight', { name: name(k) })} isDisabled={i === draft.dock.length - 1} onPress={() => commit(moveInDock(draftRef.current, k, 1))}>
                <IconNext />
              </Button>
              {BOX_CATALOGUE[k].row ? (
                <Button
                  size="small"
                  data-testid={`layout-from-dock-${k}`}
                  onPress={() => {
                    if (commit(fromDock(draftRef.current, k), t('board.editor.undocked', { name: name(k) }))) setSelected(k);
                  }}
                >
                  {t('board.editor.fromDock')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="cc-muted">{t('board.editor.dockEmpty')}</span>
      )}
      <span className="cc-muted cc-layout-dock__end">{t('board.editor.endStays')}</span>
    </div>
  );

  const guide = (
    <div className="cc-layout-guide" aria-hidden="true">
      {Array.from({ length: LAYOUT_COLUMNS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );

  const sel = current;
  const step = (fn: (l: ClassroomLayout, k: BoxKey, d: KeyboardMove) => ClassroomLayout, dir: KeyboardMove) => {
    if (!sel) return;
    const next = fn(draftRef.current, sel, dir);
    commit(next, describe(next, sel));
  };

  const toolbar = (
    <div className="cc-layout-toolbar" data-testid="layout-editor">
      <div className="cc-layout-toolbar__row">
        <h2 className="cc-h2">{t('board.editor.title')}</h2>
        <div className="cc-row cc-segmented" role="group" aria-label={t('board.editor.applyTo')} data-testid="layout-scope">
          <Button size="small" aria-pressed={scope === 'class'} onPress={() => setScope('class')}>
            {t('board.editor.thisClass')}
          </Button>
          <Button size="small" aria-pressed={scope === 'all'} onPress={() => setScope('all')}>
            {t('board.editor.allClasses')}
          </Button>
        </div>
        <div className="cc-row cc-layout-toolbar__actions">
          <Button onPress={undo} isDisabled={!history.length || busy}>
            <IconUndo />
            {t('board.editor.undo')}
          </Button>
          <Button onPress={() => setConfirmReset(true)} isDisabled={busy}>
            {t('board.editor.reset')}
          </Button>
          <Button onPress={() => void finish()} isDisabled={busy}>
            <IconX />
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onPress={() => void save()} isDisabled={busy} data-testid="layout-save">
            <IconCheck />
            {t('board.editor.save')}
          </Button>
        </div>
      </div>
      {sel ? (
        <div className="cc-layout-toolbar__row cc-layout-toolbar__box" role="group" aria-label={t('board.editor.boxControls', { name: name(sel) })} data-testid="layout-box-controls">
          <span className="cc-layout-toolbar__name">{name(sel)}</span>
          <Button size="small" onPress={() => step(stepBox, 'left')} aria-label={t('board.editor.moveLeft', { name: name(sel) })}>
            <IconPrev />
          </Button>
          <Button size="small" onPress={() => step(stepBox, 'right')} aria-label={t('board.editor.moveRight', { name: name(sel) })}>
            <IconNext />
          </Button>
          <Button size="small" onPress={() => step(stepBox, 'up')} aria-label={t('board.editor.moveUp', { name: name(sel) })}>
            <IconChevronUp />
          </Button>
          <Button size="small" onPress={() => step(stepBox, 'down')} aria-label={t('board.editor.moveDown', { name: name(sel) })}>
            <IconChevronDown />
          </Button>
          <Button size="small" onPress={() => step(stepSize, 'left')}>
            <IconMinus />
            {t('board.editor.narrower')}
          </Button>
          <Button size="small" onPress={() => step(stepSize, 'right')}>
            <IconPlus />
            {t('board.editor.wider')}
          </Button>
          <Button size="small" onPress={() => step(stepSize, 'up')}>
            <IconMinus />
            {t('board.editor.lower')}
          </Button>
          <Button size="small" onPress={() => step(stepSize, 'down')}>
            <IconPlus />
            {t('board.editor.taller')}
          </Button>
        </div>
      ) : null}
      <p id="cc-layout-help" className="cc-muted cc-layout-toolbar__help">
        {t('board.editor.help')}
      </p>
      <p className="cc-visually-hidden" aria-live="assertive" data-testid="layout-announce">
        {announce}
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <Modal isOpen={confirmReset} onOpenChange={setConfirmReset} title={t('board.editor.resetTitle')} role="alertdialog">
        <p>{t(scope === 'all' ? 'board.editor.resetBodyAll' : 'board.editor.resetBody')}</p>
        <DialogActions>
          <Button variant="primary" onPress={() => setConfirmReset(false)}>
            {t('board.editor.resetKeep')}
          </Button>
          <Button variant="danger-outline" onPress={() => void reset()} data-testid="layout-reset-confirm">
            {t('board.editor.resetConfirm')}
          </Button>
        </DialogActions>
      </Modal>
      {ghost ? (
        <div className="cc-layout-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <IconMove />
          {ghost.label}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="cc-layout-editor"
      ref={(el) => {
        rowsEl.current = el?.querySelector<HTMLElement>('.cc-lesson-board__rows') ?? null;
      }}
    >
      <BoardRows layout={draft} context={context} lesson={lesson} onEnd={onEnd} boardRef={boardRef} editing={{ frame: frameFor, rowSplitter, dock: dockEditor, guide, toolbar }} />
    </div>
  );
}
