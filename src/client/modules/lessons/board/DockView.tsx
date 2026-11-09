/**
 * A dock panel opened full screen (S14b, D-148): the slot's own component with `presentation="dock"`,
 * mounted only while the view is open. The rest of the page is inert under a full-screen dialog, so
 * a panel shows its feedback and undo inside the view, not as a toast (CONVENTIONS, S13a hooks).
 * A slot that has nothing to show leaves a short note instead of an empty view.
 */
import type { LessonState } from '../../../../shared/contracts/lessons.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { Modal } from '../../../ui/Dialog.tsx';
import type { ClassroomContext, DashboardSlot } from '../../types.ts';

export function DockView({ slot, context, lesson, onClose }: { slot: DashboardSlot; context: ClassroomContext; lesson: LessonState; onClose: () => void }) {
  const { t } = useI18n();
  const { Component } = slot;
  return (
    <Modal isOpen onOpenChange={(open) => (open ? undefined : onClose())} title={t(slot.dock!.label)} size="full" closeButton testId={`dock-view-${slot.key}`}>
      <div className="cc-dock-view">
        <div className="cc-dock-view__slot">
          <Component context={context} lesson={lesson} presentation="dock" />
        </div>
        <p className="cc-dock-view__empty cc-muted">{t('board.dockViewEmpty')}</p>
      </div>
    </Modal>
  );
}
