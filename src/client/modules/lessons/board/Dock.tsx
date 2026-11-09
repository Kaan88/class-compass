/**
 * The board's dock (S14b, D-148): one big button per panel that is not shown as a box (in the
 * teacher's order), a spacer, then End lesson, always at the bottom of the board. A slot with a dock
 * spec gets a button (icon, label, optional badge) that opens its full-screen view; a slot without
 * one renders its own control here (the attendance button and dialog).
 */
import { useState } from 'react';
import type { BoxKey } from '../../../../shared/classroomLayout.ts';
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { Button } from '../../../ui/Button.tsx';
import { IconFlag } from '../../../ui/icons.tsx';
import { slotForBox } from '../../registry.ts';
import type { ClassroomContext, DashboardSlot, DockSpec } from '../../types.ts';
import { DockView } from './DockView.tsx';

const noBadge: NonNullable<DockSpec['useBadge']> = () => null;

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

export function Dock({ items, context, lesson, onEnd }: { items: readonly BoxKey[]; context: ClassroomContext; lesson: LessonState; onEnd: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="cc-dock" aria-label={t('board.dock')} data-testid="lesson-dock">
      {items.map((k) => (
        <DockItem key={k} boxKey={k} context={context} lesson={lesson} />
      ))}
      <span className="cc-dock__spacer" aria-hidden="true" />
      <Button size="big" variant="danger" className="cc-dock__end" onPress={onEnd}>
        <IconFlag />
        {t('lesson.end')}
      </Button>
    </nav>
  );
}
