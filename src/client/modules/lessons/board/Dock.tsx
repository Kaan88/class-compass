/**
 * The board's dock (S14b, D-148): one big button per panel that is not shown as a box (in the
 * teacher's order), a spacer, then End lesson, always at the bottom of the board. A slot with a dock
 * spec gets a button (icon, label, optional badge) that opens its full-screen view; a slot without
 * one renders its own control here (the attendance button and dialog).
 *
 * On a phone (S23b, D-183) the dock is one line: the buttons that fit there whole, then "More" and End
 * lesson. The buttons that do not fit are not drawn (and not focusable) until "More" opens the whole
 * dock, which then wraps over a few lines with every button drawn in full; "Fewer" folds it again. No
 * button is ever cut off or drawn under another (before, the row scrolled sideways and clipped its
 * next button at End lesson's edge, D-168, which read as End lesson lying on top of it).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { BoxKey } from '../../../../shared/classroomLayout.ts';
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { Button } from '../../../ui/Button.tsx';
import { IconChevronDown, IconFlag } from '../../../ui/icons.tsx';
import { slotForBox } from '../../registry.ts';
import type { ClassroomContext, DashboardSlot, DockSpec } from '../../types.ts';
import { DockView } from './DockView.tsx';

const noBadge: NonNullable<DockSpec['useBadge']> = () => null;
/** The phone layout of the dock (the same width as its CSS rules in app.css). */
const PHONE = '(max-width: 40rem)';

function DockButton({ slot, context, lesson }: { slot: DashboardSlot; context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const spec = slot.dock!;
  const useBadge = spec.useBadge ?? noBadge;
  const badge = useBadge(context, lesson);
  const { Icon } = spec;
  return (
    <>
      <Button size="big" className="cc-dock__button" onPress={() => setOpen(true)} data-testid={`dock-${slot.key}`} aria-haspopup="dialog">
        <Icon />
        <span className="cc-dock__label">{t(spec.label)}</span>
        {badge ? <span className="cc-dock__badge">{badge}</span> : null}
      </Button>
      {open ? <DockView slot={slot} context={context} lesson={lesson} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DockItem({ boxKey, context, lesson }: { boxKey: BoxKey; context: ClassroomContext; lesson: LessonState }) {
  const slot = slotForBox(context, boxKey);
  if (!slot) return null;
  if (slot.dock) return <DockButton slot={slot} context={context} lesson={lesson} />;
  const { Component } = slot;
  return <Component context={context} lesson={lesson} presentation="dock" />;
}

/** The first drawn box of a dock item (its button; a dialog it opens lives in a portal). */
function itemBox(item: HTMLElement): DOMRect | null {
  for (const child of item.children) if (child.getClientRects().length > 0) return child.getBoundingClientRect();
  return null;
}

/**
 * Folds the phone dock to one line: shows every item, measures which ones sit whole on the first line
 * of the wrapping row, and hides the rest (`data-dock-overflow`: not drawn, inert). "More" is shown
 * only when something is hidden, and the fit is measured again with it in place. Plain DOM attributes
 * (React does not render them), so a fit never re-renders the dock's panels; only the count changes.
 */
function foldDock(row: HTMLElement, more: HTMLElement, phone: boolean, expanded: boolean): number {
  const items = [...row.querySelectorAll<HTMLElement>(':scope > .cc-dock__item')];
  row.removeAttribute('data-empty');
  for (const it of items) {
    it.removeAttribute('data-dock-overflow');
    it.inert = false;
  }
  if (!phone) {
    more.hidden = true;
    return 0;
  }
  if (expanded) {
    more.hidden = false;
    return 0;
  }
  const overflowing = () => {
    const limit = row.getBoundingClientRect();
    let top: number | null = null;
    return items.filter((it) => {
      const r = itemBox(it);
      if (!r) return false;
      top ??= r.top;
      return r.top > top + 1 || r.right > limit.right + 1;
    });
  };
  more.hidden = true;
  const drawn = items.filter((it) => itemBox(it) !== null).length;
  let over = overflowing();
  if (over.length > 0) {
    more.hidden = false;
    over = overflowing();
  }
  for (const it of over) {
    it.setAttribute('data-dock-overflow', '');
    it.inert = true;
  }
  // Not even the first button fits beside "More" and End lesson (large text on a narrow phone): the
  // empty line gives its width to those two.
  if (over.length > 0 && over.length === drawn) row.setAttribute('data-empty', '');
  return over.length;
}

export function Dock({ items, context, lesson, onEnd }: { items: readonly BoxKey[]; context: ClassroomContext; lesson: LessonState; onEnd: () => void }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(0);
  const navRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const itemsKey = items.join(' ');

  useLayoutEffect(() => {
    const nav = navRef.current;
    const row = rowRef.current;
    const more = nav?.querySelector<HTMLElement>('.cc-dock__more');
    const end = nav?.querySelector<HTMLElement>('.cc-dock__end');
    if (!nav || !row || !more) return;
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE) : null;
    const fit = () => setHidden(foldDock(row, more, mq?.matches ?? false, expanded));
    fit();
    // Measured again when the dock's width or the size of its text changes (End lesson is always drawn,
    // so its size follows the text size), and when a panel's button appears or its label or badge
    // changes (attendance shows its button once the roster is loaded); never on what a fit changes.
    const sizes = () => `${Math.round(nav.getBoundingClientRect().width)} ${end ? Math.round(end.getBoundingClientRect().width) : 0}`;
    let last = sizes();
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const now = sizes();
            if (now === last) return;
            last = now;
            fit();
          });
    ro?.observe(nav);
    if (end) ro?.observe(end);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(fit);
    mo?.observe(row, { childList: true, subtree: true, characterData: true });
    mq?.addEventListener?.('change', fit);
    // Fonts arriving late change the labels' widths.
    let alive = true;
    void document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
      ro?.disconnect();
      mo?.disconnect();
      mq?.removeEventListener?.('change', fit);
    };
  }, [expanded, itemsKey, locale]);

  return (
    <nav className="cc-dock" aria-label={t('board.dock')} data-testid="lesson-dock" data-expanded={expanded ? '' : undefined} ref={navRef}>
      {/* The panels' buttons: part of the dock's own row on wider screens (display: contents); on a
          phone one line that folds the buttons that do not fit behind "More" (S23b, D-183). */}
      <div className="cc-dock__items" ref={rowRef}>
        {items.map((k) => (
          <div key={k} className="cc-dock__item">
            <DockItem boxKey={k} context={context} lesson={lesson} />
          </div>
        ))}
        <span className="cc-dock__spacer" aria-hidden="true" />
      </div>
      {/* Shown by the fit only (the `hidden` attribute is not React's), so a fit never re-renders it. */}
      <Button size="big" className="cc-dock__more" onPress={() => setExpanded((e) => !e)} aria-expanded={expanded} data-testid="dock-more">
        {/* Folded, the count says what "More" holds (no icon: the line keeps its width for a button). */}
        {expanded ? <IconChevronDown /> : null}
        <span className="cc-dock__label">{expanded ? t('board.dockFewer') : t('board.dockMore')}</span>
        {/* Always there while folded (a fixed width), so the count never changes the fit. */}
        {expanded ? null : <span className="cc-dock__badge cc-dock__count">+{hidden}</span>}
      </Button>
      <Button size="big" variant="danger" className="cc-dock__end" onPress={onEnd}>
        <IconFlag />
        {t('lesson.end')}
      </Button>
    </nav>
  );
}
